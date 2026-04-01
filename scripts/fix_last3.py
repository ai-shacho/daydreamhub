#!/usr/bin/env python3
import urllib.request
import json
import os
import time
import ssl

ssl_context = ssl.create_default_context()
ssl_context.check_hostname = False
ssl_context.verify_mode = ssl.CERT_NONE

OUTPUT_DIR = os.path.expanduser("~/Desktop/daydreamhub/public/cities")

# 有効なサイズの画像を使用
DIRECT = {
    "Nonthaburi": [
        "https://upload.wikimedia.org/wikipedia/commons/thumb/1/16/Nonthaburi_city_hall_2014.jpg/640px-Nonthaburi_city_hall_2014.jpg",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/1/16/Nonthaburi_city_hall_2014.jpg/320px-Nonthaburi_city_hall_2014.jpg",
    ],
    "Padang": [
        "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dc/Aerial_View_of_Padang_City.jpg/640px-Aerial_View_of_Padang_City.jpg",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dc/Aerial_View_of_Padang_City.jpg/320px-Aerial_View_of_Padang_City.jpg",
    ],
    "Singapore": [
        "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b4/The_Singapore_Skyline_-_Dec_2020.jpg/640px-The_Singapore_Skyline_-_Dec_2020.jpg",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f7/Sg_kallang_panorama.jpg/640px-Sg_kallang_panorama.jpg",
    ],
}

mapping_path = os.path.join(OUTPUT_DIR, "_mapping.json")
with open(mapping_path) as f:
    results = json.load(f)

for city, urls in DIRECT.items():
    safe_name = city.replace("/", "_").replace("\\", "_").replace(":", "_").replace(" ", "_").replace("(", "_").replace(")", "_").replace(".", "_")
    
    success = False
    for url in urls:
        print(f"→ {city}: {url[:80]}...")
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"})
        try:
            with urllib.request.urlopen(req, timeout=20, context=ssl_context) as resp:
                data = resp.read()
            ext = ".jpg" if ".jpg" in url.lower() or ".jpeg" in url.lower() else ".png"
            filepath = os.path.join(OUTPUT_DIR, safe_name + ext)
            with open(filepath, "wb") as f:
                f.write(data)
            size = os.path.getsize(filepath)
            if size < 5000:
                os.remove(filepath)
                print(f"  ✗ Too small ({size}B)")
            else:
                print(f"  ✓ OK ({size//1024}KB)")
                results[city] = f"/cities/{safe_name}{ext}"
                success = True
                break
        except Exception as e:
            print(f"  ✗ ERROR: {e}")
            time.sleep(3)
    
    if not success:
        print(f"  ✗ All URLs failed for {city}")
    time.sleep(1)

with open(mapping_path, "w") as f:
    json.dump(results, f, indent=2, ensure_ascii=False)

print(f"\nTotal mapped: {len(results)}")
