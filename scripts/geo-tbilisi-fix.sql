-- Fix Tbilisi hotel coordinates: assign individual locations based on hotel addresses
-- Previously all shared 41.693459, 44.801449 (generic city center)

-- Khedi Hotel (3 rooms) - 24 Ketevan Tsamebuli Avenue, 0103 Tbilisi
UPDATE hotels SET latitude = 41.6935, longitude = 44.8117
  WHERE slug = 'standard-room-a-block-twin-size-beds-khedi-hotel-by-ginza-project';
UPDATE hotels SET latitude = 41.6935, longitude = 44.8117
  WHERE slug = 'standard-room-b-block-twin-size-beds-khedi-hotel-by-ginza-project-copy';
UPDATE hotels SET latitude = 41.6935, longitude = 44.8117
  WHERE slug = 'standard-room-b-block-king-size-bed-khedi-hotel-by-ginza-project-copy-copy';

-- Shota @Rustaveli Boutique Hotel (3 rooms) - near Rustaveli Avenue
UPDATE hotels SET latitude = 41.6993, longitude = 44.7932
  WHERE slug = 'shota-rustaveli-boutique-hotel-standard-double-room-copy-2';
UPDATE hotels SET latitude = 41.6993, longitude = 44.7932
  WHERE slug = 'shota-rustaveli-boutique-hotel-standard-double-room-copy';
UPDATE hotels SET latitude = 41.6993, longitude = 44.7932
  WHERE slug = 'shota-rustaveli-boutique-hotel-standard-double-room-3';

-- Boutique Hotel Manufactura - Avlabari district
UPDATE hotels SET latitude = 41.6925, longitude = 44.8130
  WHERE slug = 'boutique-hotel-manufactura-budget-double-room-3';

-- Eco-friendly Why Me Tbilisi (2 rooms) - central Tbilisi
UPDATE hotels SET latitude = 41.7060, longitude = 44.7850
  WHERE slug = 'eco-friendly-why-me-tbilisi-studio-with-kitchenette-and-private-bathroom';
UPDATE hotels SET latitude = 41.7060, longitude = 44.7850
  WHERE slug = 'eco-friendly-why-me-tbilisi-double-room-private-bathoom';

-- Family Room - central Tbilisi (no address available)
UPDATE hotels SET latitude = 41.7151, longitude = 44.8271
  WHERE slug = 'family-room' AND city = 'Tbilisi';
