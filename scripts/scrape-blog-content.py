#!/usr/bin/env python3
"""Scrape blog post content from daydreamhub.pages.dev and update D1 DB."""

import subprocess, json, re, time, sys, os
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE_URL = "https://daydreamhub.pages.dev/blog/"
DB_NAME = "daydreamhub-db"
WORKDIR = "/Users/byaoluajnicreo/Desktop/daydreamhub"

def get_all_posts():
    result = subprocess.run(
        ["npx", "wrangler", "d1", "execute", DB_NAME, "--remote",
         "--command", "SELECT id, slug FROM blog_posts WHERE length(content) = 0 OR content IS NULL ORDER BY id"],
        capture_output=True, text=True, cwd=WORKDIR
    )
    text = result.stdout + result.stderr
    match = re.search(r'\[.*\]', text, re.DOTALL)
    if not match:
        print("ERROR: Could not parse slug list"); sys.exit(1)
    data = json.loads(match.group())
    return data[0]['results']

def fetch_post(post):
    pid, slug = post['id'], post['slug']
    url = BASE_URL + slug
    result = subprocess.run(
        ["curl", "-sk", "--max-time", "15", "-A", "Mozilla/5.0", url],
        capture_output=True, timeout=20, cwd=WORKDIR
    )
    html = result.stdout.decode("utf-8", errors="replace")
    if not html:
        return pid, slug, None, None, None
    
    # Extract article content
    m = re.search(r'<article[^>]*>(.*?)</article>', html, re.DOTALL)
    content = m.group(1).strip() if m else ""
    
    # Extract thumbnail
    img_m = re.search(r'<img[^>]+src="(https://[^"]*(?:daydreamhub\.com|unsplash\.com)[^"]*)"', html)
    thumbnail = img_m.group(1) if img_m else ""
    
    # Extract published date
    date_m = re.search(r'datetime="(\d{4}-\d{2}-\d{2})', html)
    published_at = date_m.group(1) if date_m else ""
    
    return pid, slug, content, thumbnail, published_at

def escape(s):
    return (s or "").replace("'", "''")

def batch_update(posts_data, batch_num):
    """Execute a batch of SQL updates."""
    sqls = []
    for pid, content, thumbnail, published_at in posts_data:
        parts = [f"content = '{escape(content)}'"]
        if thumbnail:
            parts.append(f"thumbnail_url = '{escape(thumbnail)}'")
        if published_at:
            parts.append(f"published_at = '{escape(published_at)}'")
        sqls.append(f"UPDATE blog_posts SET {', '.join(parts)} WHERE id = {pid};")
    
    combined = " ".join(sqls)
    result = subprocess.run(
        ["npx", "wrangler", "d1", "execute", DB_NAME, "--remote", "--command", combined],
        capture_output=True, text=True, cwd=WORKDIR, timeout=60
    )
    ok = "success" in (result.stdout + result.stderr)
    return ok

def main():
    posts = get_all_posts()
    total = len(posts)
    print(f"Fetching {total} blog posts (parallel)...\n")
    
    fetched = {}
    failed = []
    
    # Parallel fetch with 10 workers
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(fetch_post, p): p for p in posts}
        done = 0
        for future in as_completed(futures):
            pid, slug, content, thumbnail, published_at = future.result()
            done += 1
            if content:
                fetched[pid] = (pid, content, thumbnail, published_at)
                print(f"[{done}/{total}] ✓ {slug[:50]}")
            else:
                failed.append(slug)
                print(f"[{done}/{total}] ✗ {slug[:50]}")
    
    print(f"\nFetched {len(fetched)} posts. Running batch DB updates...")
    
    # Batch update: 10 posts at a time
    items = list(fetched.values())
    batch_size = 10
    ok_count = 0
    for i in range(0, len(items), batch_size):
        batch = items[i:i+batch_size]
        ok = batch_update(batch, i // batch_size + 1)
        if ok:
            ok_count += len(batch)
            print(f"  Batch {i//batch_size+1}: {len(batch)} posts updated ✓")
        else:
            print(f"  Batch {i//batch_size+1}: ERROR")
        time.sleep(0.5)
    
    print(f"\nComplete! {ok_count}/{total} posts saved to DB.")
    if failed:
        print(f"Failed fetches: {failed[:5]}")

if __name__ == "__main__":
    main()
