#!/usr/bin/env python3
import urllib.request
import json
import os
import ssl

ssl_context = ssl.create_default_context()
ssl_context.check_hostname = False
ssl_context.verify_mode = ssl.CERT_NONE

OUTPUT_DIR = os.path.expanduser("~/Desktop/daydreamhub/public/cities")

# 直接URLで強制取得
DIRECT = {
    "Nonthaburi": ("https://upload.wikimedia.org/wikipedia/commons/thumb/1/16/Nonthaburi_city_hall_2014.jpg/800px-Nonthaburi_city_hall_2014.jpg", ".jpg"),
    "Padang": ("https://upload.wikimedia.org/wikipedia/commons/thumb/d/dc/Aerial_View_of_Padang_City.jpg/800px-Aerial_View_of_Padang_City.jpg", ".jpg"),
    "Singapore": ("https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/Singapore_Skyline_as_seen_from_Gardens_by_the_Bay_-_20140716.jpg/960px-Singapore_Skyline_as_seen_from_Gardens_by_the_Bay_-_20140716.jpg", ".jpg"),
    "Hong Kong": ("https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Hong_Kong_Island_Skyline_201108.jpg/960px-Hong_Kong_Island_Skyline_201108.jpg", ".jpg"),
}

mapping_path = os.path.join(OUTPUT_DIR, "_mapping.json")
with open(mapping_path) as f:
    results = json.load(f)

for city, (url, ext) in DIRECT.items():
    safe_name = city.replace("/", "_").replace("\\", "_").replace(":", "_").replace(" ", "_").replace("(", "_").replace(")", "_").replace(".", "_")
    filepath = os.path.join(OUTPUT_DIR, safe_name + ext)
    
    print(f"→ {city}: {url[:80]}...")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"})
    try:
        with urllib.request.urlopen(req, timeout=20, context=ssl_context) as resp:
            data = resp.read()
        with open(filepath, "wb") as f:
            f.write(data)
        size = os.path.getsize(filepath)
        if size < 5000:
            os.remove(filepath)
            print(f"  ✗ Too small ({size}B)")
        else:
            print(f"  ✓ OK ({size//1024}KB)")
            results[city] = f"/cities/{safe_name}{ext}"
    except Exception as e:
        print(f"  ✗ ERROR: {e}")

with open(mapping_path, "w") as f:
    json.dump(results, f, indent=2, ensure_ascii=False)

print(f"\nTotal mapped: {len(results)}")
print("Done.")
