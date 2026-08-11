// Region / country / city reference data and image lookups.
//
// Extracted from index.astro so the mobile app's browse-by-area API and the
// website share one source of truth — previously the tables lived inside the
// page and could not be reused.

export const REGION_JA: Record<string, string> = {
  'Asia': 'アジア', 'Middle East': '中東', 'Europe': 'ヨーロッパ', 'Africa': 'アフリカ',
  'Americas': '南北アメリカ', 'North America': '北米', 'South America': '南米',
  'Oceania': 'オセアニア', 'Caucasus': 'コーカサス', 'Central Asia': '中央アジア', 'Other': 'その他',
};

export const cityImages: Record<string, string> = {
  'Abu Dhabi':            'https://images.unsplash.com/photo-1512632578888-169bbbc64f33?w=600&q=80&fm=webp', // Sheikh Zayed Grand Mosque
  'Abuja':                'https://images.unsplash.com/photo-1554457606-ed16c39db884?w=600&q=80&fm=webp', // Abuja city gate Welcome arch
  'Abuja (F.c.t.)':       'https://images.unsplash.com/photo-1657742846794-35f1d090c054?w=600&q=80&fm=webp', // Mosque minaret FCT
  'Agra':                 'https://images.unsplash.com/photo-1548013146-72479768bada?w=600&q=80&fm=webp', // Taj Mahal
  'Alicante':             '/cities/alicante.jpg', // Santa Bárbara Castle
  'Almaty':               '/cities/almaty.jpg', // Almaty cityscape mountains
  'Amsterdam':            'https://images.unsplash.com/photo-1512470876302-972faa2aa9a4?w=600&q=80&fm=webp', // canal houses
  'Arequipa':             'https://images.unsplash.com/photo-1653494343724-d29ee9028bed?w=600&q=80&fm=webp', // El Misti volcano
  'Auckland':             'https://images.unsplash.com/photo-1507699622108-4be3abd695ad?w=600&q=80&fm=webp', // Sky Tower
  'Auckland Central':     'https://images.unsplash.com/photo-1507699622108-4be3abd695ad?w=600&q=80&fm=webp',
  'Bali':                 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=600&q=80&fm=webp', // rice terraces
  'Bang Rak':             'https://images.unsplash.com/photo-1563492065599-3520f775eeed?w=600&q=80&fm=webp', // Bangkok waterway
  'Bangkok':              'https://images.unsplash.com/photo-1563492065599-3520f775eeed?w=600&q=80&fm=webp', // Wat Arun temple
  'Barcelona':            'https://images.unsplash.com/photo-1539037116277-4db20889f2d4?w=600&q=80&fm=webp', // Sagrada Família
  'Batumi':               'https://images.unsplash.com/photo-1643792412669-f7900db4e0c1?w=600&q=80&fm=webp', // Batumi aerial coast Black Sea skyline
  'Beijing':              'https://images.unsplash.com/photo-1508804185872-d7badad00f7d?w=600&q=80&fm=webp', // Great Wall
  'Belgrade':             '/cities/belgrade.jpg', // Kalemegdan fortress
  'Birmingham':           'https://images.unsplash.com/photo-1526129318478-62ed807ebdf9?w=600&q=80&fm=webp', // Bullring & Selfridges
  'Bogotá':               'https://images.unsplash.com/photo-1633624465404-166b904af53d?w=600&q=80&fm=webp', // Bogotá Monserrate cable car cityscape
  'Busan':                'https://images.unsplash.com/photo-1578637387939-43c525550085?w=600&q=80&fm=webp', // Gamcheon Culture Village
  'Cairo':                'https://images.unsplash.com/photo-1724921812241-6554e4703ef0?w=600&q=80&fm=webp', // Cairo colonial architecture downtown
  'Calgary':              'https://images.unsplash.com/photo-1680488736383-6e890a804b50?w=600&q=80&fm=webp', // Calgary Tower skyline sunset
  'California City':      '/cities/california_city.jpg', // California desert
  'Candidasa':            '/cities/candidasa.jpg', // Bali east coast
  'Cape Town':            'https://images.unsplash.com/photo-1580060839134-75a5edca2e99?w=600&q=80&fm=webp', // Table Mountain
  'Cebu':                 'https://images.unsplash.com/photo-1518509562904-e7ef99cdcc86?w=600&q=80&fm=webp', // Magellan's Cross
  'Cebu City':            'https://images.unsplash.com/photo-1581493085664-1f55f9197d5a?w=600&q=80&fm=webp', // Cebu City skyline
  'Cebu city':            'https://images.unsplash.com/photo-1581493085664-1f55f9197d5a?w=600&q=80&fm=webp',
  'Chiang Mai':           'https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=600&q=80&fm=webp', // Doi Suthep temple
  'Chicago':              'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=600&q=80&fm=webp', // Millennium Park
  'Colombo':              'https://images.unsplash.com/photo-1700805047443-ab0ba14e0ced?w=600&q=80&fm=webp', // Colombo Lotus Tower
  'Da Nang':              'https://images.unsplash.com/photo-1505018620898-92616e1849cc?w=600&q=80&fm=webp', // Da Nang beach
  'Dalung':               'https://images.unsplash.com/photo-1623042392889-8073b7791004?w=600&q=80&fm=webp', // Bali north coast
  'Danao City':           'https://images.unsplash.com/photo-1715884487912-27ec236680e0?w=600&q=80&fm=webp', // Danao City, Cebu
  'Denpasar':             'https://images.unsplash.com/photo-1518548419970-58e3b4079ab2?w=600&q=80&fm=webp', // Denpasar temple
  'Dodoma':               'https://images.unsplash.com/photo-1523805009345-7448845a9e53?w=600&q=80&fm=webp', // Tanzania landscape
  'Doha':                 'https://images.unsplash.com/photo-1685113872064-de4180a0ea93?w=600&q=80&fm=webp', // Doha skyline
  'Dubai':                'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=600&q=80&fm=webp', // Burj Khalifa
  'Essex':                '/cities/essex.jpg', // English countryside
  'Fukuoka':              'https://images.unsplash.com/photo-1601823984263-b87b59798b70?w=600&q=80&fm=webp', // Fukuoka skyline
  'Giza':                 'https://images.unsplash.com/photo-1541769740-098e80269166?w=600&q=80&fm=webp', // Aerial view all 3 Giza pyramids
  'Goris':                'https://images.unsplash.com/photo-1571950266038-907c83d664ac?w=600&q=80&fm=webp', // Armenia Syunik canyon rock landscape
  'Hanoi':                'https://images.unsplash.com/photo-1583417319070-4a69db38a482?w=600&q=80&fm=webp', // Hoan Kiem Lake
  'Hiroshima':            'https://images.unsplash.com/photo-1545569341-9eb8b30979d9?w=600&q=80&fm=webp', // Peace Memorial
  'Ho Chi Minh':          'https://images.unsplash.com/photo-1557750255-c76072a7aad1?w=600&q=80&fm=webp', // Ben Thanh Market
  'Ho Chi Minh City':     'https://images.unsplash.com/photo-1557750255-c76072a7aad1?w=600&q=80&fm=webp',
  'Hong Kong':            'https://images.unsplash.com/photo-1506970845246-18f21d533b20?w=600&q=80&fm=webp', // Victoria Harbour skyline
  'Hong Kong Island':     '/cities/hong_kong_island.jpg',
  'Islamabad':            'https://images.unsplash.com/photo-1633938312695-e7b9a9cf50c6?w=600&q=80&fm=webp', // Faisal Mosque
  'Istanbul':             'https://images.unsplash.com/photo-1524231757912-21f4fe3a7200?w=600&q=80&fm=webp', // Hagia Sophia
  'Jakarta':              'https://images.unsplash.com/photo-1555899434-94d1368aa7af?w=600&q=80&fm=webp', // Monas monument
  'Kajang':               '/cities/kajang.jpg', // Malaysia
  'Kano':                 'https://images.unsplash.com/photo-1559833064-6f4573ec1ac9?w=600&q=80&fm=webp', // Nigeria cityscape
  'Kiambu':               '/cities/kiambu.jpg', // Kenya landscape
  'Kigali':               'https://images.unsplash.com/photo-1708772565588-33785e13aa46?w=600&q=80&fm=webp', // Kigali hills
  'Kobe':                 'https://images.unsplash.com/photo-1590422749897-47036da0b0ff?w=600&q=80&fm=webp', // Kobe port
  'Koh Samui':            'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&q=80&fm=webp', // Koh Samui island
  'Kuala Lumpur':         'https://images.unsplash.com/photo-1596422846543-75c6fc197f07?w=600&q=80&fm=webp', // Petronas Towers
  'Kubutambahan':         '/cities/kubutambahan.jpg', // Bali rice terraces
  'Kyoto':                'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=600&q=80&fm=webp', // Fushimi Inari torii
  'Lahore':               'https://images.unsplash.com/photo-1658073404255-5c1da0f13f75?w=600&q=80&fm=webp', // Badshahi Mosque
  'Lapulapu':             '/cities/lapulapu.jpg', // Cebu area
  'Las Vegas':            'https://images.unsplash.com/photo-1581351721010-8cf859cb14a4?w=600&q=80&fm=webp', // Las Vegas strip
  'Lat Krabang':          '/cities/lat_krabang.jpg', // Bangkok area
  'Liloan':               '/cities/liloan.jpg', // Cebu area
  'Loganholme':           '/cities/loganholme.jpg', // Brisbane area
  'Lombok':               '/cities/lombok.jpg', // Rinjani volcano
  'London':               'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=600&q=80&fm=webp', // Tower Bridge
  'Los Angeles':          'https://images.unsplash.com/photo-1534430480872-3498386e7856?w=600&q=80&fm=webp', // Hollywood hills
  'Lovina':               '/cities/lovina.jpg', // north Bali coast
  'Luang Prabang':        'https://images.unsplash.com/photo-1684918169953-088fe974b398?w=600&q=80&fm=webp', // Luang Prabang temple
  'Makati':               'https://images.unsplash.com/photo-1521367887256-cd1eb3a83057?w=600&q=80&fm=webp', // Makati skyline
  'Manama':               'https://images.unsplash.com/photo-1684252569089-2dd18848e4bd?w=600&q=80&fm=webp', // Bahrain WTC
  'Manila':               'https://images.unsplash.com/photo-1746168632944-5b1ea8140251?w=600&q=80&fm=webp', // Manila cityscape
  'Marrakech':            'https://images.unsplash.com/photo-1736718126635-bb273406d30b?w=600&q=80&fm=webp', // Jemaa el-Fna square
  'Melbourne':            'https://images.unsplash.com/photo-1514395462725-fb4566210144?w=600&q=80&fm=webp', // Flinders St Station
  'Mesaieed':             '/cities/mesaieed.jpg', // Qatar desert
  'Miami':                'https://images.unsplash.com/photo-1514214246283-d427a95c5d2f?w=600&q=80&fm=webp', // South Beach
  'Nagoya':               'https://images.unsplash.com/photo-1557409518-691ebcd96038?w=600&q=80&fm=webp', // Nagoya Castle
  'Nairobi':              'https://images.unsplash.com/photo-1693902997450-7e912c0d3554?w=600&q=80&fm=webp', // Nairobi skyline KICC downtown
  'Nara':                 '/cities/nara.jpg', // Todai-ji temple
  'New Delhi':            'https://images.unsplash.com/photo-1587474260584-136574528ed5?w=600&q=80&fm=webp', // India Gate
  'New York':             'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=600&q=80&fm=webp', // Manhattan skyline
  'Nonthaburi':           '/cities/nonthaburi.jpg', // Bangkok suburb
  'Ontario':              'https://images.unsplash.com/photo-1507992781348-310259076fe0?w=600&q=80&fm=webp', // Toronto CN Tower Ontario skyline
  'Osaka':                'https://images.unsplash.com/photo-1590559899731-a382839e5549?w=600&q=80&fm=webp', // Osaka Castle
  'Oulu':                 'https://images.unsplash.com/photo-1577102935271-2306c1bbc72b?w=600&q=80&fm=webp', // Oulu Finland winter snow landscape
  'Padang':               '/cities/padang.jpg', // West Sumatra
  'Paris':                'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=600&q=80&fm=webp', // Eiffel Tower
  'Perth':                'https://images.unsplash.com/photo-1524293581917-878a6d017c71?w=600&q=80&fm=webp', // Perth skyline
  'Petaling Jaya':        '/cities/petaling_jaya.jpg', // Malaysia
  'Phnom Penh':           'https://images.unsplash.com/photo-1672858818088-73d0996c569e?w=600&q=80&fm=webp', // Royal Palace
  'Phuket':               'https://images.unsplash.com/photo-1589394815804-964ed0be2eb5?w=600&q=80&fm=webp', // Big Buddha aerial
  'Pichincha':            '/cities/pichincha.jpg', // Quito Ecuador colonial old town
  'Plaga':                '/cities/plaga.jpg', // Bali coast
  'Porto':                'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?w=600&q=80&fm=webp', // Porto ribeira
  'Prague':               'https://images.unsplash.com/photo-1541849546-216549ae216d?w=600&q=80&fm=webp', // Prague old town
  'Quito':                'https://images.unsplash.com/photo-1610226977124-9fd2755d09f2?w=600&q=80&fm=webp', // Quito old town
  'Rijswijk':             '/cities/rijswijk.jpg', // Netherlands
  'Riyadh':               'https://images.unsplash.com/photo-1591604466107-ec97de577aff?w=600&q=80&fm=webp', // Kingdom Tower
  'Rome':                 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=600&q=80&fm=webp', // Colosseum
  'Russia':               'https://images.unsplash.com/photo-1513326738677-b964603b136d?w=600&q=80&fm=webp', // St Basil's Cathedral
  'Saint Petersburg':     'https://images.unsplash.com/photo-1532887626447-69c3b6bfa3bd?w=600&q=80&fm=webp', // Church on Spilled Blood
  'Salalah':              '/cities/salalah.jpg', // Oman coast
  'Samarkand':            'https://images.unsplash.com/photo-1604580864964-0462f5d5b1a8?w=600&q=80&fm=webp', // Registan Square
  'San Francisco':        'https://images.unsplash.com/photo-1501594907352-04cda38ebc29?w=600&q=80&fm=webp', // Golden Gate Bridge
  'Sapporo':              '/cities/sapporo.jpg', // Odori Park snow festival
  'Sathon':               '/cities/sathon.jpg', // Bangkok
  'Seal Beach':           '/cities/seal_beach.jpg', // California beach
  'Seminyak':             '/cities/seminyak.jpg', // Bali beach
  'Seoul':                'https://images.unsplash.com/photo-1538485399081-7191377e8241?w=600&q=80&fm=webp', // N Seoul Tower
  'Shanghai':             'https://images.unsplash.com/photo-1548919973-5cef591cdbc9?w=600&q=80&fm=webp', // The Bund at night
  'Sharjah':              '/cities/sharjah.jpg', // UAE cityscape
  'Shibuya':              'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=600&q=80&fm=webp', // Shibuya crossing
  'Siem Reap':            'https://images.unsplash.com/photo-1742804810674-408f3b5927b8?w=600&q=80&fm=webp', // Angkor Wat
  'Singapore':            'https://images.unsplash.com/photo-1525625293386-3f8f99389edd?w=600&q=80&fm=webp', // Marina Bay Sands
  'Sofia':                '/cities/sofia.jpg', // Alexander Nevsky Cathedral
  'Sukhumvit':            '/cities/sukhumvit.jpg', // Bangkok
  'Sydney':               'https://images.unsplash.com/photo-1506973035872-a4ec16b8e8d9?w=600&q=80&fm=webp', // Opera House
  'Taipei':               'https://images.unsplash.com/photo-1470004914212-05527e49370b?w=600&q=80&fm=webp', // Taipei 101
  'Tashkent':             'https://images.unsplash.com/photo-1544735716-392fe2489ffa?w=600&q=80&fm=webp', // Tashkent cityscape
  'Tbilisi':              'https://images.unsplash.com/photo-1760566817890-84ef17f3c4e8?w=600&q=80&fm=webp', // Tbilisi Old Town Metekhi Mother of Georgia
  'Thimphu':              'https://images.unsplash.com/photo-1646486159569-17e7fd2c47cb?w=600&q=80&fm=webp', // Tashichho Dzong
  'Tijuana':              '/cities/tijuana.jpg', // Baja California
  'Tokyo':                '/cities/tokyo.jpg', // Tokyo Tower at night
  'Toronto':              'https://images.unsplash.com/photo-1517090504586-fde19ea6066f?w=600&q=80&fm=webp', // CN Tower
  'Toulouse':             '/cities/toulouse.jpg', // France pink city
  'Ubud':                 'https://images.unsplash.com/photo-1555400038-63f5ba517a47?w=600&q=80&fm=webp', // Tegalalang rice terraces
  'Ulaanbaatar':          'https://images.unsplash.com/photo-1600176209323-879e2565a763?w=600&q=80&fm=webp', // Ulaanbaatar cityscape
  'Valencia':             '/cities/valencia.jpg', // City of Arts & Sciences
  'Vancouver':            'https://images.unsplash.com/photo-1519832979-6fa011b87667?w=600&q=80&fm=webp', // downtown & mountains
  'Venice':               'https://images.unsplash.com/photo-1523906834658-6e24ef2386f9?w=600&q=80&fm=webp', // Grand Canal
  'Vienna':               'https://images.unsplash.com/photo-1516550893923-42d28e5677af?w=600&q=80&fm=webp', // Schönbrunn Palace
  'Vientiane':            '/cities/vientiane.jpg', // Vientiane Patuxai arch
  'Yakkasaray':           '/cities/yakkasaray.jpg', // Tashkent area
  'Yau Tsim Mong District': '/cities/yau_tsim_mong_district.jpg', // Hong Kong
  'Yerevan':              'https://images.unsplash.com/photo-1648970964128-39feff1bc705?w=600&q=80&fm=webp', // Republic Square
  'Yokohama':             '/cities/yokohama.jpg', // Yokohama port
  'sofia':                '/cities/sofia.jpg',
};

export function getCityImage(city: string): string {
  if (cityImages[city]) return cityImages[city];
  // fallback: generic travel cityscape
  return 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=600&q=80&fm=webp';
}

export const countryRegion: Record<string, string> = {
  // Asia
  'Thailand': 'Asia', 'Japan': 'Asia', 'Indonesia': 'Asia', 'Malaysia': 'Asia',
  'Singapore': 'Asia', 'Vietnam': 'Asia', 'Philippines': 'Asia', 'Cambodia': 'Asia',
  'Myanmar': 'Asia', 'Laos': 'Asia', 'South Korea': 'Asia', 'China': 'Asia',
  'Hong Kong': 'Asia', 'Taiwan': 'Asia', 'Sri Lanka': 'Asia', 'Nepal': 'Asia',
  'Bangladesh': 'Asia', 'India': 'Asia', 'Maldives': 'Asia',
  // Middle East
  'UAE': 'Middle East', 'Qatar': 'Middle East', 'Bahrain': 'Middle East',
  'Saudi Arabia': 'Middle East', 'Kuwait': 'Middle East', 'Oman': 'Middle East',
  'Jordan': 'Middle East', 'Lebanon': 'Middle East', 'Israel': 'Middle East',
  'Turkey': 'Middle East', 'Iran': 'Middle East', 'Iraq': 'Middle East',
  // Europe
  'United Kingdom': 'Europe', 'Germany': 'Europe', 'France': 'Europe',
  'Netherlands': 'Europe', 'Spain': 'Europe', 'Italy': 'Europe', 'Portugal': 'Europe',
  'Belgium': 'Europe', 'Switzerland': 'Europe', 'Austria': 'Europe',
  'Sweden': 'Europe', 'Norway': 'Europe', 'Denmark': 'Europe', 'Finland': 'Europe',
  'Poland': 'Europe', 'Czech Republic': 'Europe', 'Hungary': 'Europe',
  'Romania': 'Europe', 'Bulgaria': 'Europe', 'Serbia': 'Europe', 'Croatia': 'Europe',
  'Georgia': 'Europe', 'Ukraine': 'Europe', 'Russia': 'Europe',
  // Africa
  'Nigeria': 'Africa', 'Kenya': 'Africa', 'Ghana': 'Africa', 'South Africa': 'Africa',
  'Tanzania': 'Africa', 'Ethiopia': 'Africa', 'Uganda': 'Africa', 'Rwanda': 'Africa',
  'Senegal': 'Africa', 'Egypt': 'Africa', 'Morocco': 'Africa', 'Tunisia': 'Africa',
  // Oceania
  'Australia': 'Oceania', 'New Zealand': 'Oceania', 'Fiji': 'Oceania',
  // Americas
  'United States': 'Americas', 'Canada': 'Americas', 'Mexico': 'Americas',
  'Brazil': 'Americas', 'Argentina': 'Americas', 'Colombia': 'Americas',
  // Central Asia → Asia
  'Uzbekistan': 'Asia', 'Kazakhstan': 'Asia', 'Kyrgyzstan': 'Asia',
  'Tajikistan': 'Asia', 'Turkmenistan': 'Asia', 'Afghanistan': 'Asia',
  'Mongolia': 'Asia',
  // South Asia → Asia
  'Pakistan': 'Asia', 'Bhutan': 'Asia',
  // Country abbreviations
  'UK': 'Europe', 'USA': 'Americas', 'US': 'Americas',
  // Europe (additional)
  'Armenia': 'Europe', 'Azerbaijan': 'Europe', 'Albania': 'Europe',
  'Bosnia and Herzegovina': 'Europe', 'North Macedonia': 'Europe',
  'Moldova': 'Europe', 'Belarus': 'Europe', 'Estonia': 'Europe',
  'Latvia': 'Europe', 'Lithuania': 'Europe', 'Slovenia': 'Europe',
  'Slovakia': 'Europe', 'Luxembourg': 'Europe', 'Malta': 'Europe',
  'Iceland': 'Europe', 'Ireland': 'Europe', 'Greece': 'Europe',
  // Americas (additional)
  'Ecuador': 'Americas', 'Peru': 'Americas', 'Chile': 'Americas',
  'Bolivia': 'Americas', 'Venezuela': 'Americas', 'Uruguay': 'Americas',
  'Paraguay': 'Americas', 'Panama': 'Americas', 'Costa Rica': 'Americas',
  'Guatemala': 'Americas', 'Honduras': 'Americas', 'El Salvador': 'Americas',
  'Nicaragua': 'Americas', 'Cuba': 'Americas', 'Jamaica': 'Americas',
  'Dominican Republic': 'Americas', 'Trinidad and Tobago': 'Americas',
};

export const regionOrder = ['Asia', 'Middle East', 'Europe', 'Africa', 'Oceania', 'Americas'];

export const cityRegionOverride: Record<string, string> = {
  'Goris': 'Europe', // Armenia
  'Bang Rak': 'Asia', // Bangkok district
};

export const REGION_IMAGES: Record<string, string> = {
  'Asia': 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=600&q=80&fm=webp', // Fushimi Inari torii
  'Middle East': 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=600&q=80&fm=webp', // Burj Khalifa
  'Europe': 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=600&q=80&fm=webp', // Eiffel Tower
  'Africa': 'https://images.unsplash.com/photo-1580060839134-75a5edca2e99?w=600&q=80&fm=webp', // Table Mountain
  'Oceania': 'https://images.unsplash.com/photo-1506973035872-a4ec16b8e8d9?w=600&q=80&fm=webp', // Sydney Opera House
  'Americas': 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=600&q=80&fm=webp', // Manhattan skyline
};

export function getRegionForCountry(country: string): string | undefined {
  if (!country) return undefined;
  // Try exact match first
  if (countryRegion[country]) return countryRegion[country];
  // Try title-cased
  const titled = country.charAt(0).toUpperCase() + country.slice(1).toLowerCase();
  if (countryRegion[titled]) return countryRegion[titled];
  // Try case-insensitive scan
  const lower = country.toLowerCase();
  for (const [key, val] of Object.entries(countryRegion)) {
    if (key.toLowerCase() === lower) return val;
  }
  return undefined;
}

