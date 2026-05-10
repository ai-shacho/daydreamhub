#!/usr/bin/env python3
"""残りの失敗都市を代替記事で修正"""
import urllib.request
import urllib.parse
import json
import os
import time
import ssl

ssl_context = ssl.create_default_context()
ssl_context.check_hostname = False
ssl_context.verify_mode = ssl.CERT_NONE

OUTPUT_DIR = os.path.expanduser("~/Desktop/daydreamhub/public/cities")

# 直接URLで画像を取得（Wikipedia APIではなく画像URLを直指定）
DIRECT_URLS = {
    "Kobe": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/83/Kobe-motomachi-street.jpg/960px-Kobe-motomachi-street.jpg",
    "Nara": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9a/Todaiji7988.jpg/960px-Todaiji7988.jpg",
    "Nonthaburi": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6e/Nonthaburi_city_hall.jpg/960px-Nonthaburi_city_hall.jpg",
    "Candidasa": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/Candidasa_Beach.jpg/960px-Candidasa_Beach.jpg",
    "Padang": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dc/Aerial_View_of_Padang_City.jpg/960px-Aerial_View_of_Padang_City.jpg",
    "Liloan": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f3/Liloan_Cebu_Phil.jpg/960px-Liloan_Cebu_Phil.jpg",
    "Birmingham": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Birmingham_UK_Skyline_from_Edgbaston.jpg/960px-Birmingham_UK_Skyline_from_Edgbaston.jpg",
    "Kano": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Kano_Emirate_palace.jpg/960px-Kano_Emirate_palace.jpg",
    "Auckland Central": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/Auckland_skyline_-_May_2024_%282%29.jpg/960px-Auckland_skyline_-_May_2024_%282%29.jpg",
    "Perth": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Perth_Australia_from_Kings_Park.jpg/960px-Perth_Australia_from_Kings_Park.jpg",
    "Singapore": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/62/Singapore_Skyline_2023.jpg/960px-Singapore_Skyline_2023.jpg",
    "Hong Kong": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Hong_Kong_Island_Skyline_201108.jpg/960px-Hong_Kong_Island_Skyline_201108.jpg",
}

# API検索でも試す代替記事
FALLBACK_WIKI = {
    "Kobe": "Kobe",
    "Nara": "Nara_(city)",
    "Nonthaburi": "Nonthaburi_Province",
    "Candidasa": "Karangasem_Regency",
    "Padang": "West_Sumatra",
    "Liloan": "Cebu_City",
    "Birmingham": "Birmingham",
    "Kano": "Kano_State",
    "Auckland Central": "Auckland",
    "Perth": "Perth",
    "Singapore": "Singapore",
    "Hong Kong": "Hong_Kong",
}

def get_wikipedia_image(wiki_title, size=800):
    url = f"https://en.wikipedia.org/w/api.php?action=query&titles={urllib.parse.quote(wiki_title)}&prop=pageimages&format=json&pithumbsize={size}"
    req = urllib.request.Request(url, headers={"User-Agent": "DDH-City-Images/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=10, context=ssl_context) as resp:
            data = json.loads(resp.read())
            pages = data["query"]["pages"]
            for pid, page in pages.items():
                thumb = page.get("thumbnail", {}).get("source", "")
                if thumb:
                    return thumb
    except Exception as e:
        print(f"  ERROR getting {wiki_title}: {e}")
    return None

def download_image(url, filepath, retries=3):
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    })
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=20, context=ssl_context) as resp:
                with open(filepath, "wb") as f:
                    f.write(resp.read())
            size = os.path.getsize(filepath)
            if size < 5000:
                os.remove(filepath)
                return False
            return True
        except Exception as e:
            if "429" in str(e) and attempt < retries - 1:
                wait = 5 * (attempt + 1)
                print(f"  429 rate limit, waiting {wait}s...")
                time.sleep(wait)
            else:
                print(f"  DOWNLOAD ERROR: {e}")
                return False
    return False

# 既存のmappingを読み込み
mapping_path = os.path.join(OUTPUT_DIR, "_mapping.json")
with open(mapping_path) as f:
    results = json.load(f)

still_failed = []

for city, wiki_title in FALLBACK_WIKI.items():
    safe_name = city.replace("/", "_").replace("\\", "_").replace(":", "_").replace(" ", "_").replace("(", "_").replace(")", "_").replace(".", "_")
    
    # まず削除して再取得
    for ext in [".jpg", ".png", ".gif"]:
        fp = os.path.join(OUTPUT_DIR, safe_name + ext)
        if os.path.exists(fp):
            os.remove(fp)
    
    print(f"→ {city} ({wiki_title})...")
    
    # Wikipedia APIで試す
    img_url = get_wikipedia_image(wiki_title, 800)
    
    if img_url and "flag" not in img_url.lower() and "svg" not in img_url.lower():
        if img_url.lower().endswith(".png") or ".png/" in img_url.lower():
            ext = ".png"
        else:
            ext = ".jpg"
        filepath = os.path.join(OUTPUT_DIR, safe_name + ext)
        ok = download_image(img_url, filepath)
        if ok:
            print(f"  ✓ OK via API: {img_url[:80]}")
            results[city] = f"/cities/{safe_name}{ext}"
            time.sleep(1.0)
            continue
    
    print(f"  API failed, skipping...")
    still_failed.append(city)
    time.sleep(0.5)

print(f"\n=== FIX DONE: {len(results)} total, {len(still_failed)} still failed ===")
if still_failed:
    print("Still failed:", still_failed)

with open(mapping_path, "w") as f:
    json.dump(results, f, indent=2, ensure_ascii=False)
print("Mapping updated.")
