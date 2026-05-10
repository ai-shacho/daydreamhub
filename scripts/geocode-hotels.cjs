#!/usr/bin/env node
/**
 * Geocode hotels using OpenStreetMap Nominatim API
 * Double-checks by searching both address+city+country AND hotel name
 * Outputs SQL UPDATE statements
 */

const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'geocode-updates.sql');

// Rate limit: 1 request per second (Nominatim policy)
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'DayDreamHub-Geocoder/1.0 (contact@daydreamhub.com)' }
  });
  const data = await res.json();
  if (data && data[0]) {
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), display: data[0].display_name };
  }
  return null;
}

function distance(lat1, lon1, lat2, lon2) {
  // Haversine distance in km
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function main() {
  // Read hotel list from stdin (JSON array from SQL Console)
  // Format: [{ id, name, address, city, country, latitude, longitude }, ...]
  const inputFile = process.argv[2];
  if (!inputFile) {
    console.error('Usage: node geocode-hotels.cjs <hotels.json>');
    console.error('');
    console.error('Get hotels.json by running this in SQL Console:');
    console.error("  SELECT id, name, address, city, country, latitude, longitude FROM hotels WHERE latitude IS NULL OR latitude = 0");
    console.error('Then save the result as JSON.');
    process.exit(1);
  }

  const hotels = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  console.log(`Processing ${hotels.length} hotels...\n`);

  const sqlLines = [];
  sqlLines.push('-- Geocode results for hotels');
  sqlLines.push(`-- Generated: ${new Date().toISOString()}`);
  sqlLines.push('');

  let success = 0, failed = 0, skipped = 0, mismatch = 0;

  for (const h of hotels) {
    // Skip if already has coordinates
    if (h.latitude && h.longitude && h.latitude !== 0 && h.longitude !== 0) {
      skipped++;
      continue;
    }

    // Query 1: address + city + country
    const addressQuery = [h.address, h.city, h.country].filter(Boolean).join(', ');
    // Query 2: hotel name + city + country
    const nameQuery = [h.name, h.city, h.country].filter(Boolean).join(', ');

    console.log(`[${h.id}] ${h.name}`);
    console.log(`  Q1: ${addressQuery}`);

    let result1 = null, result2 = null;

    // Search by address
    if (addressQuery) {
      result1 = await geocode(addressQuery);
      await sleep(1100); // Nominatim rate limit
    }

    // Search by hotel name
    console.log(`  Q2: ${nameQuery}`);
    result2 = await geocode(nameQuery);
    await sleep(1100);

    let finalLat = null, finalLon = null;
    let confidence = 'unknown';

    if (result1 && result2) {
      const dist = distance(result1.lat, result1.lon, result2.lat, result2.lon);
      if (dist < 50) {
        // Both agree within 50km — high confidence, use address result
        finalLat = result1.lat;
        finalLon = result1.lon;
        confidence = `HIGH (${dist.toFixed(1)}km apart)`;
      } else {
        // Mismatch — use address result but flag
        finalLat = result1.lat;
        finalLon = result1.lon;
        confidence = `MISMATCH (${dist.toFixed(0)}km apart) — address:${result1.display?.slice(0,50)} vs name:${result2.display?.slice(0,50)}`;
        mismatch++;
      }
    } else if (result1) {
      finalLat = result1.lat;
      finalLon = result1.lon;
      confidence = 'ADDRESS_ONLY';
    } else if (result2) {
      finalLat = result2.lat;
      finalLon = result2.lon;
      confidence = 'NAME_ONLY';
    } else {
      confidence = 'NOT_FOUND';
      failed++;
      console.log(`  ❌ Not found\n`);
      sqlLines.push(`-- ${h.name} (${h.city}, ${h.country}) — NOT FOUND`);
      continue;
    }

    console.log(`  ✅ ${finalLat.toFixed(6)}, ${finalLon.toFixed(6)} — ${confidence}\n`);
    const slug = (h.slug || '').replace(/'/g, "''");
    sqlLines.push(`UPDATE hotels SET latitude = ${finalLat.toFixed(6)}, longitude = ${finalLon.toFixed(6)} WHERE slug = '${slug}' AND (latitude IS NULL OR latitude = 0); -- ${h.name} [${confidence}]`);
    success++;
  }

  sqlLines.push('');
  sqlLines.push(`-- Summary: ${success} updated, ${failed} not found, ${mismatch} mismatches, ${skipped} skipped`);

  fs.writeFileSync(OUTPUT_FILE, sqlLines.join('\n'), 'utf8');
  console.log(`\n========================================`);
  console.log(`Done! ${success} updated, ${failed} not found, ${mismatch} mismatches, ${skipped} skipped`);
  console.log(`SQL saved to: ${OUTPUT_FILE}`);
  console.log(`Review the file, then paste into /admin/sql to apply.`);
}

main().catch(console.error);
