#!/usr/bin/env python3
"""失敗した都市のリトライと、フラグ画像になってしまったものの修正"""
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
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 失敗 or 修正が必要な都市の再マッピング
# フラグ/地図画像になってしまったものも含む
RETRY_MAP = {
    # 429 failed - retry with same article
    "Sapporo": "Sapporo",
    "Yokohama": "Yokohama",
    "Kobe": "Kobe,_Hyogo",
    "Nara": "Nara,_Nara",
    "Bangkok": "Bangkok",
    "Nonthaburi": "Nonthaburi_(city)",
    "Seminyak": "Seminyak",
    "Denpasar": "Denpasar",
    "Candidasa": "Candidasa,_Bali",
    "Lovina": "Lovina_Beach",
    "Kajang": "Kajang",
    "Jakarta": "Jakarta",
    "Padang": "Padang,_West_Sumatra",
    "Hanoi": "Hanoi",
    "Phuket": "Phuket_province",
    "Phnom Penh": "Phnom_Penh",
    "Vientiane": "Vientiane",
    "Cebu City": "Cebu_City",
    "Liloan": "Liloan,_Cebu",
    "Danao City": "Danao,_Cebu",
    "Busan": "Busan",
    "Shanghai": "Shanghai",
    "Hong Kong Island": "Hong_Kong_Island",
    "Taipei": "Taipei",
    "Tashkent": "Tashkent",
    "Yakkasaray": "Tashkent",  # 記事に画像がないのでTashkentで代替
    "Ulaanbaatar": "Ulaanbaatar",
    "Lahore": "Lahore",
    "New Delhi": "New_Delhi",
    "Dubai": "Dubai",
    "Manama": "Manama",
    "Tbilisi": "Tbilisi",
    "Goris": "Goris",
    "Birmingham": "Birmingham,_West_Midlands",
    "Paris": "Paris",
    "Rome": "Rome",
    "Barcelona": "Barcelona",
    "Amsterdam": "Amsterdam",
    "Rijswijk": "Rijswijk",
    "Vienna": "Vienna",
    "Belgrade": "Belgrade",
    "Sofia": "Sofia",
    "sofia": "Sofia",
    "Russia": "Moscow",  # Russiaは国なのでMoscowで
    "Oulu": "Oulu",
    "Nairobi": "Nairobi",
    "Kiambu": "Kiambu_County",
    "Giza": "Giza_Governorate",
    "Kigali": "Kigali",
    "Abuja (F.c.t.)": "Abuja",
    "Kano": "Kano,_Kano",
    "Auckland": "Auckland",
    "Auckland Central": "Auckland_city_centre",
    "Perth": "Perth,_Western_Australia",
    "Las Vegas": "Las_Vegas_Valley",
    "San Francisco": "San_Francisco",
    "Toronto": "Toronto",
    "California City": "California_City,_California",
    "Seal Beach": "Seal_Beach,_California",
    "Arequipa": "Arequipa",
    "Pichincha": "Quito",  # Pichincha→Quito
    "Tijuana": "Tijuana",
    # フラグ/地図画像を修正
    "Singapore": "Skyline_of_Singapore",
    "Hong Kong": "Hong_Kong_skyline",
    "Bali": "Bali",  # check if ok
    "Ontario": "Toronto",  # フラグ→都市
    "Dalung": "Badung_Regency",  # バリの行政区
    "Plaga": "Tabanan_Regency",  # バリの行政区
    "Sukhumvit": "Sukhumvit_Road",
}

def get_wikipedia_image(wiki_title, size=800):
    url = f"https://en.wikipedia.org/w/api.php?action=query&titles={urllib.parse.quote(wiki_title)}&prop=pageimages&format=json&pithumbsize={size}"
    req = urllib.request.Request(url, headers={"User-Agent": "DDH-City-Images/1.0 (contact@daydreamhub.com)"})
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
if os.path.exists(mapping_path):
    with open(mapping_path) as f:
        results = json.load(f)
else:
    results = {}

failed = []

for city, wiki_title in RETRY_MAP.items():
    safe_name = city.replace("/", "_").replace("\\", "_").replace(":", "_").replace(" ", "_").replace("(", "_").replace(")", "_").replace(".", "_")
    
    # 既存ファイルチェック（フラグ修正が必要なものはスキップしない）
    flag_cities = {"Singapore", "Hong Kong", "Ontario", "Dalung", "Plaga", "Russia"}
    
    jpg_path = os.path.join(OUTPUT_DIR, safe_name + ".jpg")
    png_path = os.path.join(OUTPUT_DIR, safe_name + ".png")
    
    if city not in flag_cities:
        if os.path.exists(jpg_path) and os.path.getsize(jpg_path) > 5000:
            print(f"✓ SKIP (exists): {city}")
            if city not in results:
                results[city] = f"/cities/{safe_name}.jpg"
            continue
        if os.path.exists(png_path) and os.path.getsize(png_path) > 5000:
            print(f"✓ SKIP (exists png): {city}")
            if city not in results:
                results[city] = f"/cities/{safe_name}.png"
            continue
    else:
        # フラグ都市は既存を削除して再取得
        if os.path.exists(jpg_path):
            os.remove(jpg_path)
        if os.path.exists(png_path):
            os.remove(png_path)
    
    print(f"→ {city} ({wiki_title})...")
    img_url = get_wikipedia_image(wiki_title, 800)
    
    if img_url:
        if img_url.lower().endswith(".png") or ".png/" in img_url.lower():
            ext = ".png"
        elif img_url.lower().endswith(".svg") or ".svg/" in img_url.lower():
            ext = ".png"  # SVGはpngとして保存
        else:
            ext = ".jpg"
        filepath = os.path.join(OUTPUT_DIR, safe_name + ext)
        
        ok = download_image(img_url, filepath)
        if ok:
            print(f"  ✓ OK ({ext}): {img_url[:80]}")
            results[city] = f"/cities/{safe_name}{ext}"
        else:
            print(f"  ✗ FAIL download")
            failed.append(city)
    else:
        print(f"  ✗ No Wikipedia image")
        failed.append(city)
    
    time.sleep(1.0)  # 429対策で長めに待つ

print(f"\n=== RETRY DONE: {len(results)} total, {len(failed)} still failed ===")
if failed:
    print("Still failed:", failed)

with open(mapping_path, "w") as f:
    json.dump(results, f, indent=2, ensure_ascii=False)

print("Mapping updated.")
