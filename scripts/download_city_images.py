#!/usr/bin/env python3
import urllib.request
import urllib.parse
import json
import os
import time
import ssl

# SSL証明書の検証を無効化（macOSのPythonでよく発生する問題）
ssl_context = ssl.create_default_context()
ssl_context.check_hostname = False
ssl_context.verify_mode = ssl.CERT_NONE

OUTPUT_DIR = os.path.expanduser("~/Desktop/daydreamhub/public/cities")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 都市名 → Wikipedia記事名のマッピング（Wikipediaに正確な記事がある名前）
CITY_WIKI_MAP = {
    # Japan
    "Tokyo": "Tokyo",
    "Shibuya": "Shibuya",
    "Osaka": "Osaka",
    "Kyoto": "Kyoto",
    "Sapporo": "Sapporo",
    "Fukuoka": "Fukuoka",
    "Nagoya": "Nagoya",
    "Yokohama": "Yokohama",
    "Kobe": "Kobe,_Hyogo",
    "Hiroshima": "Hiroshima",
    "Nara": "Nara,_Nara",
    # Southeast Asia
    "Bangkok": "Bangkok",
    "Bang Rak": "Bang_Rak_district",
    "Sathon": "Sathon_district",
    "Nonthaburi": "Nonthaburi_(city)",
    "Sukhumvit": "Sukhumvit_Road",
    "Lat Krabang": "Lat_Krabang_district",
    "Bali": "Bali",
    "Ubud": "Ubud",
    "Seminyak": "Seminyak",
    "Denpasar": "Denpasar",
    "Candidasa": "Candidasa",
    "Kubutambahan": "Kubutambahan,_Buleleng",
    "Lovina": "Lovina,_Bali",
    "Dalung": "Bali",
    "Plaga": "Bali",
    "Singapore": "Singapore",
    "Kuala Lumpur": "Kuala_Lumpur",
    "Kajang": "Kajang",
    "Petaling Jaya": "Petaling_Jaya",
    "Jakarta": "Jakarta",
    "Padang": "Padang,_West_Sumatra",
    "Lombok": "Lombok",
    "Ho Chi Minh City": "Ho_Chi_Minh_City",
    "Ho Chi Minh": "Ho_Chi_Minh_City",
    "Hanoi": "Hanoi",
    "Da Nang": "Da_Nang",
    "Phuket": "Phuket_City",
    "Koh Samui": "Ko_Samui",
    "Chiang Mai": "Chiang_Mai",
    "Phnom Penh": "Phnom_Penh",
    "Siem Reap": "Siem_Reap",
    "Luang Prabang": "Luang_Prabang",
    "Vientiane": "Vientiane",
    "Manila": "Manila",
    "Makati": "Makati",
    "Cebu": "Cebu_City",
    "Cebu City": "Cebu_City",
    "Cebu city": "Cebu_City",
    "Liloan": "Liloan,_Cebu",
    "Lapulapu": "Lapu-Lapu_City",
    "Danao City": "Danao,_Cebu",
    "Colombo": "Colombo",
    # East Asia
    "Seoul": "Seoul",
    "Busan": "Busan",
    "Beijing": "Beijing",
    "Shanghai": "Shanghai",
    "Hong Kong": "Hong_Kong",
    "Hong Kong Island": "Hong_Kong_Island",
    "Yau Tsim Mong District": "Yau_Tsim_Mong_District",
    "Taipei": "Taipei",
    # Central/South Asia
    "Almaty": "Almaty",
    "Tashkent": "Tashkent",
    "Yakkasaray": "Yakkasaray_District",
    "Samarkand": "Samarkand",
    "Ulaanbaatar": "Ulaanbaatar",
    "Islamabad": "Islamabad",
    "Lahore": "Lahore",
    "Agra": "Agra",
    "New Delhi": "New_Delhi",
    "Thimphu": "Thimphu",
    # Middle East
    "Dubai": "Dubai",
    "Abu Dhabi": "Abu_Dhabi",
    "Doha": "Doha",
    "Riyadh": "Riyadh",
    "Manama": "Manama",
    "Sharjah": "Sharjah",
    "Mesaieed": "Mesaieed",
    "Salalah": "Salalah",
    # Caucasus
    "Tbilisi": "Tbilisi",
    "Batumi": "Batumi",
    "Yerevan": "Yerevan",
    "Goris": "Goris",
    # Europe
    "London": "London",
    "Birmingham": "Birmingham,_West_Midlands",
    "Essex": "Essex",
    "Paris": "Paris",
    "Toulouse": "Toulouse",
    "Rome": "Rome",
    "Venice": "Venice",
    "Barcelona": "Barcelona",
    "Valencia": "Valencia",
    "Alicante": "Alicante",
    "Amsterdam": "Amsterdam",
    "Rijswijk": "Rijswijk",
    "Prague": "Prague",
    "Vienna": "Vienna",
    "Istanbul": "Istanbul",
    "Belgrade": "Belgrade",
    "Sofia": "Sofia",
    "sofia": "Sofia",
    "Porto": "Porto",
    "Saint Petersburg": "Saint_Petersburg",
    "Russia": "Russia",
    "Oulu": "Oulu",
    # Africa
    "Cape Town": "Cape_Town",
    "Nairobi": "Nairobi",
    "Kiambu": "Kiambu",
    "Cairo": "Cairo",
    "Giza": "Giza",
    "Marrakech": "Marrakesh",
    "Kigali": "Kigali",
    "Abuja": "Abuja",
    "Abuja (F.c.t.)": "Abuja",
    "Kano": "Kano,_Kano",
    "Dodoma": "Dodoma",
    # Oceania
    "Sydney": "Sydney",
    "Melbourne": "Melbourne",
    "Auckland": "Auckland",
    "Auckland Central": "Auckland_city_centre",
    "Perth": "Perth,_Western_Australia",
    "Loganholme": "Loganholme,_Queensland",
    # Americas
    "New York": "New_York_City",
    "Los Angeles": "Los_Angeles",
    "Las Vegas": "Las_Vegas",
    "Chicago": "Chicago",
    "San Francisco": "San_Francisco",
    "Miami": "Miami",
    "Toronto": "Toronto",
    "Vancouver": "Vancouver",
    "Calgary": "Calgary",
    "Ontario": "Ontario",
    "California City": "California_City,_California",
    "Seal Beach": "Seal_Beach,_California",
    "Bogotá": "Bogotá",
    "Arequipa": "Arequipa",
    "Quito": "Quito",
    "Pichincha": "Pichincha_Province",
    "Tijuana": "Tijuana",
}

def get_wikipedia_image(wiki_title, size=800):
    url = f"https://en.wikipedia.org/w/api.php?action=query&titles={urllib.parse.quote(wiki_title)}&prop=pageimages&format=json&pithumbsize={size}"
    req = urllib.request.Request(url, headers={"User-Agent": "DDH-City-Images/1.0 (https://daydreamhub.com)"})
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

def download_image(url, filepath):
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    })
    try:
        with urllib.request.urlopen(req, timeout=15, context=ssl_context) as resp:
            with open(filepath, "wb") as f:
                f.write(resp.read())
        size = os.path.getsize(filepath)
        if size < 5000:  # 5KB未満は無効
            os.remove(filepath)
            return False
        return True
    except Exception as e:
        print(f"  DOWNLOAD ERROR {url}: {e}")
        return False

results = {}
failed = []

for city, wiki_title in CITY_WIKI_MAP.items():
    # ファイル名をサニタイズ
    safe_name = city.replace("/", "_").replace("\\", "_").replace(":", "_").replace(" ", "_").replace("(", "_").replace(")", "_").replace(".", "_")
    # 重複チェック - jpgもpngも確認
    jpg_path = os.path.join(OUTPUT_DIR, safe_name + ".jpg")
    png_path = os.path.join(OUTPUT_DIR, safe_name + ".png")
    
    if os.path.exists(jpg_path) and os.path.getsize(jpg_path) > 5000:
        print(f"✓ SKIP (exists jpg): {city}")
        results[city] = f"/cities/{safe_name}.jpg"
        continue
    if os.path.exists(png_path) and os.path.getsize(png_path) > 5000:
        print(f"✓ SKIP (exists png): {city}")
        results[city] = f"/cities/{safe_name}.png"
        continue
    
    print(f"→ {city} ({wiki_title})...")
    img_url = get_wikipedia_image(wiki_title, 800)
    
    if img_url:
        # 拡張子を判定
        if img_url.lower().endswith(".png") or ".png/" in img_url.lower():
            ext = ".png"
        elif img_url.lower().endswith(".gif") or ".gif/" in img_url.lower():
            ext = ".gif"
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
    
    time.sleep(0.3)

print(f"\n=== DONE: {len(results)} success, {len(failed)} failed ===")
if failed:
    print("Failed:", failed)

# 結果をJSONで保存
with open(os.path.join(OUTPUT_DIR, "_mapping.json"), "w") as f:
    json.dump(results, f, indent=2, ensure_ascii=False)

print("Mapping saved to _mapping.json")
