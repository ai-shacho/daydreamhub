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
