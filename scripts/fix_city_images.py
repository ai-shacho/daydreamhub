#!/usr/bin/env python3
"""特定の問題都市の画像を修正する（正確なURLを使用）"""
import urllib.request
import ssl
import os
import time

OUTPUT_DIR = os.path.expanduser("~/Desktop/daydreamhub/public/cities")

# 検証済みの正確なWikimedia Commons URLマッピング
FIXES = {
    # バリ島 - 田んぼの棚田
    "Bali": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/Tegallalang_Rice_Terrace.jpg/960px-Tegallalang_Rice_Terrace.jpg",
    "Kubutambahan": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/Tegallalang_Rice_Terrace.jpg/960px-Tegallalang_Rice_Terrace.jpg",
    "Seminyak": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/Tegallalang_Rice_Terrace.jpg/960px-Tegallalang_Rice_Terrace.jpg",
    "Candidasa": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/Tegallalang_Rice_Terrace.jpg/960px-Tegallalang_Rice_Terrace.jpg",
    "Denpasar": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/Tegallalang_Rice_Terrace.jpg/960px-Tegallalang_Rice_Terrace.jpg",
    "Lovina": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/Tegallalang_Rice_Terrace.jpg/960px-Tegallalang_Rice_Terrace.jpg",
    "Dalung": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/Tegallalang_Rice_Terrace.jpg/960px-Tegallalang_Rice_Terrace.jpg",
    "Plaga": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/Tegallalang_Rice_Terrace.jpg/960px-Tegallalang_Rice_Terrace.jpg",
    # Goris (アルメニア)
    "Goris": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/Goris_banner.jpg/960px-Goris_banner.jpg",
    # バンコク
    "Bangkok": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f6/Bangkok_skytrain_sunset.jpg/960px-Bangkok_skytrain_sunset.jpg",
    "Bang_Rak": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f6/Bangkok_skytrain_sunset.jpg/960px-Bangkok_skytrain_sunset.jpg",
    "Sathon": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f6/Bangkok_skytrain_sunset.jpg/960px-Bangkok_skytrain_sunset.jpg",
    "Nonthaburi": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f6/Bangkok_skytrain_sunset.jpg/960px-Bangkok_skytrain_sunset.jpg",
    "Sukhumvit": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f6/Bangkok_skytrain_sunset.jpg/960px-Bangkok_skytrain_sunset.jpg",
    "Lat_Krabang": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f6/Bangkok_skytrain_sunset.jpg/960px-Bangkok_skytrain_sunset.jpg",
    # セブ
    "Cebu_City": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/Skyline_of_Cebu_City.jpg/960px-Skyline_of_Cebu_City.jpg",
    "Cebu": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/Skyline_of_Cebu_City.jpg/960px-Skyline_of_Cebu_City.jpg",
    "Cebu_city": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/Skyline_of_Cebu_City.jpg/960px-Skyline_of_Cebu_City.jpg",
    "Liloan": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/Skyline_of_Cebu_City.jpg/960px-Skyline_of_Cebu_City.jpg",
    "Danao_City": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/Skyline_of_Cebu_City.jpg/960px-Skyline_of_Cebu_City.jpg",
    # ラプラプ
    "Lapulapu": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6b/Mactan_Cebu_International_Airport.jpg/960px-Mactan_Cebu_International_Airport.jpg",
    # マカティ
    "Makati": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/Makati_skyline.jpg/960px-Makati_skyline.jpg",
    # ローガンホルム → Brisbane
    "Loganholme": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ad/Brisbane_City_Hall.jpg/960px-Brisbane_City_Hall.jpg",
    # オークランド
    "Auckland_Central": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Auckland_from_Devonport.jpg/960px-Auckland_from_Devonport.jpg",
}

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def download(url, filepath):
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    })
    try:
        with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
            code = resp.getcode()
            if code != 200:
                print(f"  HTTP {code}")
                return False
            data = resp.read()
            if len(data) < 5000:
                print(f"  Too small: {len(data)} bytes")
                return False
            with open(filepath, "wb") as f:
                f.write(data)
            print(f"  OK: {len(data)//1024}KB")
            return True
    except Exception as e:
        print(f"  ERROR: {e}")
        return False

failed = []
for city_key, url in FIXES.items():
    ext = ".png" if url.endswith(".png") else ".jpg"
    filepath = os.path.join(OUTPUT_DIR, city_key + ext)
    # 既存ファイルを削除して再ダウンロード
    for old_ext in [".jpg", ".png", ".jpeg"]:
        old_path = os.path.join(OUTPUT_DIR, city_key + old_ext)
        if os.path.exists(old_path):
            os.remove(old_path)
    
    print(f"→ {city_key}...")
    ok = download(url, filepath)
    if not ok:
        failed.append(city_key)
    time.sleep(0.5)

print(f"\nDone. Failed: {failed}")
