// Major airport coordinates by city name
// [latitude, longitude]
export const airportByCity: Record<string, [number, number]> = {
  // Asia - Southeast
  'Bangkok': [13.6811, 100.7472],        // Suvarnabhumi (BKK)
  'Bali': [-8.7482, 115.1671],            // Ngurah Rai (DPS)
  'Denpasar': [-8.7482, 115.1671],
  'Dalung': [-8.7482, 115.1671],
  'Ubud': [-8.7482, 115.1671],
  'Ho Chi Minh City': [10.8188, 106.6520], // Tan Son Nhat (SGN)
  'Hanoi': [21.2187, 105.8072],            // Noi Bai (HAN)
  'Da Nang': [16.0439, 108.1993],          // Da Nang (DAD)
  'Kuala Lumpur': [2.7456, 101.7072],      // KLIA (KUL)
  'Petaling Jaya': [2.7456, 101.7072],
  'Singapore': [1.3644, 103.9915],         // Changi (SIN)
  'Jakarta': [-6.1256, 106.6559],          // Soekarno-Hatta (CGK)
  'Padang': [-0.7869, 100.2806],           // Minangkabau (PDG)
  'Cebu City': [10.3075, 123.9792],        // Mactan-Cebu (CEB)
  'Danao City': [10.3075, 123.9792],
  'Manila': [14.5086, 121.0194],           // NAIA (MNL)
  'Phuket': [8.1132, 98.3161],             // Phuket (HKT)
  'Koh Samui': [9.5479, 100.0623],         // Koh Samui (USM)
  'Phnom Penh': [11.5466, 104.8440],
  'Luang Prabang': [19.8973, 102.1608],
  'Vientiane': [17.9883, 102.5633],
  // Asia - East
  'Tokyo': [35.5494, 139.7798],            // Haneda (HND)
  'Shibuya': [35.5494, 139.7798],
  'Kyoto': [34.7855, 135.4381],            // Kansai (KIX)
  'Seoul': [37.4691, 126.4510],            // Incheon (ICN)
  'Beijing': [40.0799, 116.6031],          // Capital (PEK)
  'Shanghai': [31.1443, 121.8083],         // Pudong (PVG)
  'Hong Kong': [22.3080, 113.9185],        // HKIA (HKG)
  'Taipei': [25.0777, 121.2328],           // Taoyuan (TPE)
  // Asia - South
  'Mumbai': [19.0896, 72.8656],
  'Delhi': [28.5562, 77.1000],
  'New Delhi': [28.5562, 77.1000],
  'Agra': [27.1558, 77.9629],              // Agra (AGR)
  'Colombo': [7.1806, 79.8841],            // BIA (CMB)
  'Thimphu': [27.4033, 89.6414],           // Paro (PBH)
  'Islamabad': [33.6167, 73.0997],         // New Islamabad (ISB)
  'Lahore': [31.5216, 74.4036],            // Allama Iqbal (LHE)
  // Central Asia
  'Tashkent': [41.2580, 69.2811],          // Tashkent (TAS)
  'Yakkasaray': [41.2580, 69.2811],
  'Samarkand': [39.7005, 66.9838],         // Samarkand (SKD)
  'Almaty': [43.3521, 77.0405],            // Almaty (ALA)
  'Ulaanbaatar': [47.8431, 106.7664],      // Chinggis Khaan (UBN)
  // Middle East
  'Dubai': [25.2528, 55.3644],             // DXB
  'Sharjah': [25.3275, 55.5117],           // SHJ
  'Abu Dhabi': [24.4330, 54.6511],         // AUH
  'Doha': [25.2731, 51.6081],              // Hamad (DOH)
  'Manama': [26.2708, 50.6336],            // BAH
  'Riyadh': [24.9578, 46.6989],
  'Muscat': [23.5933, 58.2844],
  'Salalah': [17.0381, 54.0913],
  'Kuwait City': [29.2267, 47.9689],
  // South Asia / Gulf
  'Tbilisi': [41.6692, 44.9547],           // TBS
  'Batumi': [41.5997, 41.5997],            // BUS
  // Europe
  'London': [51.4706, -0.4619],            // Heathrow (LHR)
  'Essex': [51.5074, 0.1278],
  'Birmingham': [52.4539, -1.7480],        // BHX
  'Paris': [49.0097, 2.5479],              // CDG
  'Toulouse': [43.6293, 1.3638],
  'Amsterdam': [52.3086, 4.7639],          // AMS
  'Rijswijk': [52.3086, 4.7639],
  'Madrid': [40.4936, -3.5668],
  'Alicante': [38.2822, -0.5582],          // ALC
  'Valencia': [39.4893, -0.4816],
  'Barcelona': [41.2971, 2.0785],
  'Rome': [41.8003, 12.2389],
  'Venice': [45.5053, 12.3519],
  'Milan': [45.6300, 8.7231],
  'Frankfurt': [50.0379, 8.5622],
  'Munich': [48.3537, 11.7750],
  'Prague': [50.1008, 14.2600],
  'Sofia': [42.6967, 23.4062],
  'Belgrade': [44.8184, 20.3091],
  'Porto': [41.2481, -8.6814],
  'Oslo': [60.1939, 11.1004],
  'Oulu': [64.9301, 25.3545],
  'Saint Petersburg': [59.8003, 30.2625],
  'Russia': [55.9736, 37.4125],
  // Africa
  'Nairobi': [-1.3192, 36.9275],           // JKIA (NBO)
  'Kiambu': [-1.3192, 36.9275],
  'Kigali': [-1.9686, 30.1395],            // KGL
  'Dodoma': [-6.1699, 35.7526],
  'Kano': [12.0476, 8.5247],
  'Abuja': [9.0065, 7.2632],               // ABV
  'Abuja (F.c.t.)': [9.0065, 7.2632],
  'Cairo': [30.1219, 31.4056],             // CAI
  'Giza': [30.1219, 31.4056],
  'Cape Town': [-33.9715, 18.6021],        // CPT
  'Johannesburg': [-26.1367, 28.2411],
  // Americas
  'New York': [40.6413, -73.7781],         // JFK
  'Los Angeles': [33.9425, -118.4081],
  'Seal Beach': [33.9425, -118.4081],
  'California City': [35.1583, -118.0144],
  'Ontario': [43.6772, -79.6306],
  'Calgary': [51.1314, -114.0133],
  'Boston': [42.3656, -71.0096],
  'Philadelphia': [39.8720, -75.2437],
  'Denver': [39.8561, -104.6737],
  'Bogotá': [4.7016, -74.1469],
  'Medellín': [6.1645, -75.4232],
  'Quito': [-0.1292, -78.3575],
  'Pichincha': [-0.1292, -78.3575],
  'Arequipa': [-16.3412, -71.5830],
  'Tijuana': [32.5411, -116.9700],
  'Mexico City': [19.4363, -99.0721],
  'Honolulu': [21.3245, -157.9251],
  'Kailua-Kona': [19.7388, -156.0456],
  // Oceania
  'Sydney': [-33.9399, 151.1753],
  'Melbourne': [-37.6690, 144.8410],
  'Brisbane': [-27.3842, 153.1175],
  'Loganholme': [-27.6500, 153.1500],
  'Perth': [-31.9403, 115.9669],
  'Auckland': [-37.0082, 174.7850],
  'Auckland Central': [-37.0082, 174.7850],
  // Bahrain / South Asia
  'Goris': [39.5112, 46.3500],
};

export function getAirportCoords(city: string): [number, number] | null {
  if (!city) return null;
  // Exact match
  if (airportByCity[city]) return airportByCity[city];
  // Partial match (city contains a known key)
  const lower = city.toLowerCase();
  for (const [key, coords] of Object.entries(airportByCity)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) {
      return coords;
    }
  }
  return null;
}

// Haversine distance in km
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Airport list with codes for "nearest airport" lookup
export const airportList: Array<{ code: string; name: string; lat: number; lng: number }> = [
  // Southeast Asia
  { code: 'BKK', name: 'BKK', lat: 13.6811, lng: 100.7472 },
  { code: 'DMK', name: 'DMK', lat: 13.9126, lng: 100.6067 },
  { code: 'DPS', name: 'DPS', lat: -8.7482, lng: 115.1671 },
  { code: 'CGK', name: 'CGK', lat: -6.1256, lng: 106.6559 },
  { code: 'KUL', name: 'KUL', lat: 2.7456, lng: 101.7072 },
  { code: 'SIN', name: 'SIN', lat: 1.3644, lng: 103.9915 },
  { code: 'MNL', name: 'MNL', lat: 14.5086, lng: 121.0194 },
  { code: 'CEB', name: 'CEB', lat: 10.3075, lng: 123.9792 },
  { code: 'SGN', name: 'SGN', lat: 10.8188, lng: 106.6520 },
  { code: 'HAN', name: 'HAN', lat: 21.2187, lng: 105.8072 },
  { code: 'DAD', name: 'DAD', lat: 16.0439, lng: 108.1993 },
  { code: 'HKT', name: 'HKT', lat: 8.1132, lng: 98.3161 },
  { code: 'USM', name: 'USM', lat: 9.5479, lng: 100.0623 },
  { code: 'PNH', name: 'PNH', lat: 11.5466, lng: 104.8440 },
  { code: 'RGN', name: 'RGN', lat: 16.9073, lng: 96.1332 },
  // East Asia
  { code: 'HND', name: 'HND', lat: 35.5494, lng: 139.7798 },
  { code: 'NRT', name: 'NRT', lat: 35.7720, lng: 140.3929 },
  { code: 'KIX', name: 'KIX', lat: 34.4347, lng: 135.2440 },
  { code: 'ICN', name: 'ICN', lat: 37.4691, lng: 126.4510 },
  { code: 'PEK', name: 'PEK', lat: 40.0799, lng: 116.6031 },
  { code: 'PVG', name: 'PVG', lat: 31.1443, lng: 121.8083 },
  { code: 'HKG', name: 'HKG', lat: 22.3080, lng: 113.9185 },
  { code: 'TPE', name: 'TPE', lat: 25.0777, lng: 121.2328 },
  // South Asia
  { code: 'BOM', name: 'BOM', lat: 19.0896, lng: 72.8656 },
  { code: 'DEL', name: 'DEL', lat: 28.5562, lng: 77.1000 },
  { code: 'CMB', name: 'CMB', lat: 7.1806, lng: 79.8841 },
  // Middle East
  { code: 'DXB', name: 'DXB', lat: 25.2528, lng: 55.3644 },
  { code: 'AUH', name: 'AUH', lat: 24.4330, lng: 54.6511 },
  { code: 'DOH', name: 'DOH', lat: 25.2731, lng: 51.6081 },
  { code: 'BAH', name: 'BAH', lat: 26.2708, lng: 50.6336 },
  { code: 'KWI', name: 'KWI', lat: 29.2267, lng: 47.9689 },
  { code: 'MCT', name: 'MCT', lat: 23.5933, lng: 58.2844 },
  // Africa
  { code: 'NBO', name: 'NBO', lat: -1.3192, lng: 36.9275 },
  { code: 'CAI', name: 'CAI', lat: 30.1219, lng: 31.4056 },
  { code: 'JNB', name: 'JNB', lat: -26.1392, lng: 28.2460 },
  // South Asia (additional)
  { code: 'ISB', name: 'ISB', lat: 33.6167, lng: 73.0992 },
  { code: 'AGR', name: 'AGR', lat: 27.1558, lng: 77.9608 },
  { code: 'PBH', name: 'PBH', lat: 27.4032, lng: 89.4246 },
  // Central Asia
  { code: 'TAS', name: 'TAS', lat: 41.2579, lng: 69.2813 },
  { code: 'SKD', name: 'SKD', lat: 39.7005, lng: 66.9838 },
  { code: 'ULN', name: 'ULN', lat: 47.8431, lng: 106.7666 },
  // Caucasus
  { code: 'TBS', name: 'TBS', lat: 41.6692, lng: 44.9547 },
  { code: 'EVN', name: 'EVN', lat: 40.1473, lng: 44.3959 },
  { code: 'BUS', name: 'BUS', lat: 41.6103, lng: 41.5997 },
  // Europe
  { code: 'LHR', name: 'LHR', lat: 51.4775, lng: -0.4614 },
  { code: 'CDG', name: 'CDG', lat: 49.0097, lng: 2.5479 },
  { code: 'AMS', name: 'AMS', lat: 52.3086, lng: 4.7639 },
  { code: 'FRA', name: 'FRA', lat: 50.0379, lng: 8.5622 },
  { code: 'BHX', name: 'BHX', lat: 52.4539, lng: -1.7480 },
  { code: 'HEL', name: 'HEL', lat: 60.3172, lng: 24.9633 },
  { code: 'OUL', name: 'OUL', lat: 64.9301, lng: 25.3546 },
  { code: 'LED', name: 'LED', lat: 59.8003, lng: 30.2625 },
  { code: 'PRG', name: 'PRG', lat: 50.1008, lng: 14.2600 },
  { code: 'BEG', name: 'BEG', lat: 44.8184, lng: 20.3091 },
  { code: 'SOF', name: 'SOF', lat: 42.6952, lng: 23.4062 },
  { code: 'OPO', name: 'OPO', lat: 41.2481, lng: -8.6814 },
  { code: 'VLC', name: 'VLC', lat: 39.4893, lng: -0.4816 },
  { code: 'FCO', name: 'FCO', lat: 41.8003, lng: 12.2389 },
  { code: 'VCE', name: 'VCE', lat: 45.5053, lng: 12.3519 },
  { code: 'TLS', name: 'TLS', lat: 43.6291, lng: 1.3678 },
  { code: 'RTM', name: 'RTM', lat: 51.9569, lng: 4.4372 },
  // Americas
  { code: 'JFK', name: 'JFK', lat: 40.6413, lng: -73.7781 },
  { code: 'LAX', name: 'LAX', lat: 33.9425, lng: -118.4081 },
  { code: 'BWI', name: 'BWI', lat: 39.1754, lng: -76.6684 },
  { code: 'YYC', name: 'YYC', lat: 51.1215, lng: -114.0076 },
  { code: 'BOG', name: 'BOG', lat: 4.7016, lng: -74.1469 },
  { code: 'UIO', name: 'UIO', lat: -0.1292, lng: -78.3575 },
  { code: 'AQP', name: 'AQP', lat: -16.3411, lng: -71.5680 },
  { code: 'TIJ', name: 'TIJ', lat: 32.5411, lng: -116.9700 },
  // Africa (additional)
  { code: 'ABV', name: 'ABV', lat: 9.0068, lng: 7.2632 },
  { code: 'CPT', name: 'CPT', lat: -33.9648, lng: 18.6017 },
  { code: 'KGL', name: 'KGL', lat: -1.9686, lng: 30.1395 },
  // Oceania
  { code: 'SYD', name: 'SYD', lat: -33.9399, lng: 151.1753 },
  { code: 'MEL', name: 'MEL', lat: -37.6690, lng: 144.8410 },
  { code: 'AKL', name: 'AKL', lat: -37.0082, lng: 174.7850 },
  { code: 'PER', name: 'PER', lat: -31.9403, lng: 115.9672 },
  { code: 'BNE', name: 'BNE', lat: -27.3842, lng: 153.1175 },
];

// Full airport names for display
export const airportNames: Record<string, string> = {
  'BKK': 'Suvarnabhumi Airport', 'DMK': 'Don Mueang Airport',
  'DPS': 'Ngurah Rai Airport', 'CGK': 'Soekarno-Hatta Airport',
  'KUL': 'Kuala Lumpur International Airport', 'SIN': 'Changi Airport',
  'MNL': 'Ninoy Aquino Airport', 'CEB': 'Mactan-Cebu Airport',
  'SGN': 'Tan Son Nhat Airport', 'HAN': 'Noi Bai Airport',
  'DAD': 'Da Nang Airport', 'HKT': 'Phuket Airport',
  'USM': 'Samui Airport', 'PNH': 'Phnom Penh Airport',
  'RGN': 'Yangon Airport',
  'HND': 'Haneda Airport', 'NRT': 'Narita Airport',
  'KIX': 'Kansai Airport', 'ICN': 'Incheon Airport',
  'PEK': 'Beijing Capital Airport', 'PVG': 'Pudong Airport',
  'HKG': 'Hong Kong Airport', 'TPE': 'Taoyuan Airport',
  'BOM': 'Mumbai Airport', 'DEL': 'Delhi Airport',
  'CMB': 'Bandaranaike Airport',
  'DXB': 'Dubai Airport', 'AUH': 'Abu Dhabi Airport',
  'DOH': 'Hamad Airport', 'BAH': 'Bahrain Airport',
  'KWI': 'Kuwait Airport', 'MCT': 'Muscat Airport',
  'NBO': 'Jomo Kenyatta Airport', 'CAI': 'Cairo Airport',
  'JNB': 'O.R. Tambo Airport',
  'LHR': 'Heathrow Airport', 'CDG': 'Charles de Gaulle Airport',
  'AMS': 'Schiphol Airport', 'FRA': 'Frankfurt Airport',
  'BHX': 'Birmingham Airport',
  'ISB': 'Islamabad Airport', 'AGR': 'Agra Airport', 'PBH': 'Paro Airport',
  'TAS': 'Tashkent Airport', 'SKD': 'Samarkand Airport', 'ULN': 'Chinggis Khaan Airport',
  'TBS': 'Tbilisi Airport', 'EVN': 'Zvartnots Airport', 'BUS': 'Batumi Airport',
  'HEL': 'Helsinki-Vantaa Airport', 'OUL': 'Oulu Airport', 'LED': 'Pulkovo Airport',
  'PRG': 'Václav Havel Airport', 'BEG': 'Belgrade Airport', 'SOF': 'Sofia Airport',
  'OPO': 'Porto Airport', 'VLC': 'Valencia Airport', 'FCO': 'Fiumicino Airport',
  'VCE': 'Venice Airport', 'TLS': 'Toulouse Airport', 'RTM': 'Rotterdam Airport',
  'JFK': 'JFK Airport', 'LAX': 'LAX Airport',
  'BWI': 'Baltimore Airport', 'YYC': 'Calgary Airport',
  'BOG': 'El Dorado Airport', 'UIO': 'Quito Airport', 'AQP': 'Arequipa Airport', 'TIJ': 'Tijuana Airport',
  'ABV': 'Abuja Airport', 'CPT': 'Cape Town Airport', 'KGL': 'Kigali Airport',
  'SYD': 'Sydney Airport', 'MEL': 'Melbourne Airport',
  'AKL': 'Auckland Airport', 'PER': 'Perth Airport', 'BNE': 'Brisbane Airport',
};

// Japanese airport names
export const airportNamesJa: Record<string, string> = {
  'BKK': 'スワンナプーム国際空港', 'DMK': 'ドンムアン空港',
  'DPS': 'ングラライ国際空港', 'CGK': 'スカルノ・ハッタ国際空港',
  'KUL': 'クアラルンプール国際空港', 'SIN': 'チャンギ国際空港',
  'MNL': 'ニノイ・アキノ国際空港', 'CEB': 'マクタン・セブ国際空港',
  'SGN': 'タンソンニャット国際空港', 'HAN': 'ノイバイ国際空港',
  'DAD': 'ダナン国際空港', 'HKT': 'プーケット国際空港',
  'USM': 'サムイ空港', 'PNH': 'プノンペン国際空港',
  'RGN': 'ヤンゴン国際空港',
  'HND': '羽田空港', 'NRT': '成田国際空港',
  'KIX': '関西国際空港', 'ICN': '仁川国際空港',
  'PEK': '北京首都国際空港', 'PVG': '上海浦東国際空港',
  'HKG': '香港国際空港', 'TPE': '桃園国際空港',
  'BOM': 'ムンバイ国際空港', 'DEL': 'デリー国際空港',
  'CMB': 'バンダラナイケ国際空港',
  'DXB': 'ドバイ国際空港', 'AUH': 'アブダビ国際空港',
  'DOH': 'ハマド国際空港', 'BAH': 'バーレーン国際空港',
  'KWI': 'クウェート国際空港', 'MCT': 'マスカット国際空港',
  'NBO': 'ジョモ・ケニヤッタ国際空港', 'CAI': 'カイロ国際空港',
  'JNB': 'O.R.タンボ国際空港',
  'LHR': 'ヒースロー空港', 'CDG': 'シャルル・ド・ゴール空港',
  'AMS': 'スキポール空港', 'FRA': 'フランクフルト空港',
  'BHX': 'バーミンガム空港',
  'ISB': 'イスラマバード空港', 'AGR': 'アグラ空港', 'PBH': 'パロ空港',
  'TAS': 'タシケント空港', 'SKD': 'サマルカンド空港', 'ULN': 'チンギスハーン空港',
  'TBS': 'トビリシ空港', 'EVN': 'ズヴァルトノッツ空港', 'BUS': 'バトゥミ空港',
  'HEL': 'ヘルシンキ・ヴァンター空港', 'OUL': 'オウル空港', 'LED': 'プルコヴォ空港',
  'PRG': 'プラハ空港', 'BEG': 'ベオグラード空港', 'SOF': 'ソフィア空港',
  'OPO': 'ポルト空港', 'VLC': 'バレンシア空港', 'FCO': 'フィウミチーノ空港',
  'VCE': 'ヴェネツィア空港', 'TLS': 'トゥールーズ空港', 'RTM': 'ロッテルダム空港',
  'JFK': 'JFK国際空港', 'LAX': 'ロサンゼルス国際空港',
  'BWI': 'ボルチモア空港', 'YYC': 'カルガリー空港',
  'BOG': 'エルドラド空港', 'UIO': 'キト空港', 'AQP': 'アレキパ空港', 'TIJ': 'ティファナ空港',
  'ABV': 'アブジャ空港', 'CPT': 'ケープタウン空港', 'KGL': 'キガリ空港',
  'SYD': 'シドニー国際空港', 'MEL': 'メルボルン空港',
  'AKL': 'オークランド空港', 'PER': 'パース空港', 'BNE': 'ブリスベン空港',
};

// Find nearest airport from hotel coordinates
export function nearestAirport(hotelLat: number, hotelLng: number): { code: string; name: string; km: number } | null {
  let best: { code: string; name: string; km: number } | null = null;
  for (const ap of airportList) {
    const km = haversineKm(hotelLat, hotelLng, ap.lat, ap.lng);
    if (!best || km < best.km) {
      best = { code: ap.code, name: airportNames[ap.code] || ap.code, km };
    }
  }
  return best;
}
