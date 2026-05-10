#!/usr/bin/env python3
"""
Migration script: Old WordPress site hotel data -> Cloudflare D1 (daydreamhub-db)
Parses SQL dumps and generates INSERT OR IGNORE SQL for the hotels table.
"""

import re
import json
import subprocess
import os
import sys

# ─── File paths ────────────────────────────────────────────────────────────────
POSTS_SQL      = "/tmp/old_site_data/20260323_wp_posts.sql"
POSTMETA_SQL   = "/tmp/old_site_data/20260322_wp_postmeta.sql"
TERMS_SQL      = "/tmp/old_site_data/20260323_wp_terms.sql"
TERM_REL_SQL   = "/tmp/old_site_data/20260323_wp_term_relationships.sql"

PROJECT_DIR    = "/Users/byaoluajnicreo/Desktop/daydreamhub"
OUTPUT_SQL     = os.path.join(PROJECT_DIR, "scripts", "hotel_migration.sql")

# ─── Helpers ───────────────────────────────────────────────────────────────────

def esc(s):
    """Escape a string for SQLite single-quoted literals."""
    if s is None:
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"


def parse_row_values(row_str):
    """
    Parse one SQL VALUES row (without surrounding parentheses).
    Handles: NULL, integers, 'string with \\' escapes and '' quotes'.
    Returns list of Python values (str/int/None).
    """
    values = []
    current = []
    in_string = False
    i = 0
    s = row_str.strip()
    while i < len(s):
        c = s[i]
        if not in_string:
            if c == "'":
                in_string = True
                i += 1
            elif c == ',':
                token = ''.join(current).strip()
                if token.upper() == 'NULL':
                    values.append(None)
                else:
                    try:
                        values.append(int(token))
                    except ValueError:
                        try:
                            values.append(float(token))
                        except ValueError:
                            values.append(token)
                current = []
                i += 1
            else:
                current.append(c)
                i += 1
        else:
            if c == '\\':
                # MySQL escape sequence
                if i + 1 < len(s):
                    nc = s[i + 1]
                    if nc == 'n':
                        current.append('\n')
                    elif nc == 'r':
                        current.append('\r')
                    elif nc == 't':
                        current.append('\t')
                    elif nc == "'":
                        current.append("'")
                    elif nc == '\\':
                        current.append('\\')
                    else:
                        current.append(nc)
                    i += 2
                else:
                    current.append(c)
                    i += 1
            elif c == "'":
                # '' = escaped single quote
                if i + 1 < len(s) and s[i + 1] == "'":
                    current.append("'")
                    i += 2
                else:
                    in_string = False
                    i += 1
            else:
                current.append(c)
                i += 1

    # Last token
    token = ''.join(current).strip()
    if token.upper() == 'NULL':
        values.append(None)
    elif token:
        try:
            values.append(int(token))
        except ValueError:
            try:
                values.append(float(token))
            except ValueError:
                values.append(token)

    return values


def get_current_slugs():
    """Fetch existing hotel slugs from the remote D1 database."""
    result = subprocess.run(
        ["npx", "wrangler", "d1", "execute", "daydreamhub-db", "--remote",
         "--command", "SELECT slug FROM hotels;"],
        capture_output=True, text=True, cwd=PROJECT_DIR
    )
    slugs = set(re.findall(r'"slug":\s*"([^"]+)"', result.stdout))
    print(f"  → Existing slugs in DB: {len(slugs)}")
    return slugs


# ─── Step 1: Parse wp_posts (estate_property, publish) ─────────────────────────

def parse_wp_posts():
    """
    Returns dict: post_id -> {id, title, content, slug, date, status}
    Only includes estate_property with publish status.
    """
    print("Parsing wp_posts...")
    posts = {}
    
    # Column indices from the INSERT header
    # ID(0), post_author(1), post_date(2), post_date_gmt(3), post_content(4),
    # post_title(5), post_excerpt(6), post_status(7), ..., post_name(11), ...,
    # post_type(20), ...
    COL_ID = 0
    COL_DATE = 2
    COL_CONTENT = 4
    COL_TITLE = 5
    COL_STATUS = 7
    COL_SLUG = 11
    COL_TYPE = 20

    with open(POSTS_SQL, "r", encoding="utf-8") as f:
        for line in f:
            # Skip non-data lines
            if not line.startswith("("):
                continue
            # Quick filter
            if "estate_property" not in line:
                continue
            if "'publish'" not in line:
                continue

            # Remove trailing comma/semicolon
            row_str = line.strip().rstrip(",;")
            if row_str.startswith("(") and row_str.endswith(")"):
                row_str = row_str[1:-1]
            else:
                continue

            try:
                vals = parse_row_values(row_str)
            except Exception as e:
                print(f"  WARN parse_wp_posts: {e}", file=sys.stderr)
                continue

            if len(vals) < 21:
                continue

            post_type = str(vals[COL_TYPE]).strip("'")
            status    = str(vals[COL_STATUS]).strip("'")
            if post_type != "estate_property" or status != "publish":
                continue

            post_id = int(vals[COL_ID])
            slug    = str(vals[COL_SLUG]) if vals[COL_SLUG] else ""
            title   = str(vals[COL_TITLE]) if vals[COL_TITLE] else ""
            content = str(vals[COL_CONTENT]) if vals[COL_CONTENT] else ""
            date    = str(vals[COL_DATE]) if vals[COL_DATE] else ""

            posts[post_id] = {
                "id": post_id,
                "title": title,
                "content": content,
                "slug": slug,
                "date": date,
            }

    print(f"  → Found {len(posts)} publish estate_property posts")
    return posts


# ─── Step 2: Parse wp_postmeta ─────────────────────────────────────────────────

def parse_postmeta(post_ids):
    """
    Returns dict: post_id -> {meta_key: meta_value}
    Only for post_ids we care about.
    """
    print("Parsing wp_postmeta...")
    meta = {pid: {} for pid in post_ids}

    # Format: INSERT INTO p VALUES(meta_id, post_id, 'meta_key', 'meta_value', ...);
    pattern = re.compile(r"INSERT INTO p VALUES\((\d+), (\d+), '(.*?)', (.*?), '[\d\- :]+', '[\d\- :]+'\);$")

    # Keys we care about
    WANTED_KEYS = {
        "property-name", "property_country", "property_latitude",
        "property_longitude", "property_address", "property_state",
        "property_county", "property_price", "cancellation_policy",
        "guest_no", "outdoor-facilities", "_thumbnail_id",
        "room_ids", "property_admin_area", "property_phone", "property_email",
    }

    with open(POSTMETA_SQL, "r", encoding="utf-8") as f:
        for line in f:
            if not line.startswith("INSERT INTO p VALUES("):
                continue
            m = pattern.match(line.strip())
            if not m:
                # Try looser match
                mm = re.match(r"INSERT INTO p VALUES\((\d+), (\d+), '([^']*)', (.*)\);$", line.strip())
                if not mm:
                    continue
                meta_id, post_id_str, meta_key = mm.group(1), mm.group(2), mm.group(3)
                meta_val_raw = mm.group(4)
            else:
                meta_id, post_id_str, meta_key = m.group(1), m.group(2), m.group(3)
                meta_val_raw = m.group(4)

            post_id = int(post_id_str)
            if post_id not in meta:
                continue
            if meta_key not in WANTED_KEYS:
                continue

            # Parse meta_value
            meta_val_raw = meta_val_raw.strip()
            if meta_val_raw == "NULL":
                meta_value = None
            elif meta_val_raw.startswith("'"):
                # Strip surrounding quotes and unescape
                inner = meta_val_raw[1:]
                if inner.endswith("'"):
                    inner = inner[:-1]
                meta_value = inner.replace("''", "'").replace("\\'", "'")
            else:
                meta_value = meta_val_raw

            meta[post_id][meta_key] = meta_value

    print(f"  → Parsed meta for {sum(1 for m in meta.values() if m)} posts")
    return meta


# ─── Step 3: Parse wp_terms ────────────────────────────────────────────────────

def parse_terms():
    """Returns dict: term_id -> term_name"""
    terms = {}
    pattern = re.compile(r"\((\d+), '(.*?)', '(.*?)', \d+\)")
    with open(TERMS_SQL, "r", encoding="utf-8") as f:
        for line in f:
            for m in pattern.finditer(line):
                tid = int(m.group(1))
                name = m.group(2).replace("''", "'")
                terms[tid] = name
    return terms


# ─── Step 4: Parse wp_term_relationships ──────────────────────────────────────

def parse_term_relationships(post_ids):
    """Returns dict: post_id -> [term_taxonomy_ids]"""
    rels = {pid: [] for pid in post_ids}
    # Rows look like: (object_id, term_taxonomy_id, term_order),
    pattern = re.compile(r"\((\d+), (\d+), \d+\)")
    with open(TERM_REL_SQL, "r", encoding="utf-8") as f:
        for line in f:
            for m in pattern.finditer(line):
                oid = int(m.group(1))
                if oid in rels:
                    rels[oid].append(int(m.group(2)))
    return rels


# ─── Main ──────────────────────────────────────────────────────────────────────

def main():
    # Step 1: Current slugs in DB
    print("\n[1] Fetching current DB slugs...")
    existing_slugs = get_current_slugs()

    # Step 2: Parse posts
    print("\n[2] Parsing WP posts...")
    posts = parse_wp_posts()

    # Step 3: Parse postmeta
    print("\n[3] Parsing postmeta...")
    meta = parse_postmeta(set(posts.keys()))

    # Step 4: Parse terms (for categories)
    print("\n[4] Parsing terms...")
    terms = parse_terms()

    # Step 5: Parse term relationships
    print("\n[5] Parsing term relationships...")
    term_rels = parse_term_relationships(set(posts.keys()))

    # ── Build SQL ──────────────────────────────────────────────────────────────
    print("\n[6] Building SQL...")

    # Known amenity-like term IDs (from wp_terms we can see)
    AMENITY_TERM_NAMES = {
        "Air Conditioner (Cooling)", "Bar / Restaurant", "Breakfast Included",
        "Doorman", "Hair Dryer", "Elevator in Building", "Essentials",
        "Family/Kid Friendly", "Fax", "Parking on Premises", "Gym",
        "Air Conditioner (Heating)", "Hot Tub", "Indoor Fireplace", "Internet",
        "Kitchen", "Non Smoking", "Pets Allowed", "Phone (booth/lines)",
        "Pool", "Projector(s)", "Scanner / Printer", "Smoking Allowed",
        "Suitable for Events", "TV", "Washer", "Wheelchair Accessible",
        "Free Wi-Fi",
    }

    # Build term_id -> category type mapping
    # (We don't have taxonomy table, so we'll guess by name patterns)
    PROPERTY_TYPE_NAMES = {"Entire Home", "Private Room", "Shared Room", "Hotel"}
    term_amenities = {}
    term_prop_types = {}
    for tid, tname in terms.items():
        if tname in AMENITY_TERM_NAMES:
            term_amenities[tid] = tname
        if tname in PROPERTY_TYPE_NAMES:
            term_prop_types[tid] = tname

    inserts = []
    skipped = 0
    migrated = 0

    for post_id, post in posts.items():
        slug = post["slug"]
        if not slug:
            continue

        # Skip existing
        if slug in existing_slugs:
            skipped += 1
            continue

        m = meta.get(post_id, {})

        name = post["title"] or m.get("property-name", "")
        if not name:
            continue

        description = post["content"] or ""
        city = (m.get("property_state") or m.get("property_county") or "").strip()
        country = (m.get("property_country") or "").strip()
        address = (m.get("property_address") or "").strip()
        lat_str = m.get("property_latitude") or m.get("_lat") or ""
        lon_str = m.get("property_longitude") or m.get("_lng") or ""
        cancellation = (m.get("cancellation_policy") or "").strip()
        # Parse amenities from outdoor-facilities (JSON array string)
        amenities_raw = m.get("outdoor-facilities") or "[]"
        try:
            amenities_list = json.loads(amenities_raw)
            if not isinstance(amenities_list, list):
                amenities_list = []
        except Exception:
            amenities_list = []

        # Add amenities from term relationships
        post_term_ids = term_rels.get(post_id, [])
        for tid in post_term_ids:
            if tid in term_amenities:
                amenities_list.append(term_amenities[tid])
        amenities_list = list(dict.fromkeys(amenities_list))  # dedupe

        # Property type from terms
        property_type = None
        for tid in post_term_ids:
            if tid in term_prop_types:
                property_type = term_prop_types[tid]
                break

        # Lat/lon
        try:
            lat = float(lat_str) if lat_str else None
        except (ValueError, TypeError):
            lat = None
        try:
            lon = float(lon_str) if lon_str else None
        except (ValueError, TypeError):
            lon = None

        created_at = post["date"] or "2024-01-01 00:00:00"

        # Build INSERT
        sql = (
            f"INSERT OR IGNORE INTO hotels "
            f"(name, slug, description, city, country, address, "
            f"latitude, longitude, amenities, property_type, "
            f"cancellation_policy, created_at, is_active) VALUES ("
            f"{esc(name)}, "
            f"{esc(slug)}, "
            f"{esc(description)}, "
            f"{esc(city) if city else 'NULL'}, "
            f"{esc(country) if country else 'NULL'}, "
            f"{esc(address) if address else 'NULL'}, "
            f"{'NULL' if lat is None else lat}, "
            f"{'NULL' if lon is None else lon}, "
            f"{esc(json.dumps(amenities_list, ensure_ascii=False))}, "
            f"{esc(property_type) if property_type else 'NULL'}, "
            f"{esc(cancellation) if cancellation else 'NULL'}, "
            f"{esc(created_at)}, "
            f"1"
            f");"
        )
        inserts.append(sql)
        migrated += 1

    # Write output SQL
    print(f"\n[7] Writing SQL file... ({migrated} inserts, {skipped} skipped)")
    with open(OUTPUT_SQL, "w", encoding="utf-8") as f:
        f.write("-- Hotel migration from WordPress\n")
        f.write(f"-- Total to insert: {migrated}\n")
        f.write(f"-- Skipped (already in DB): {skipped}\n\n")
        for sql in inserts:
            f.write(sql + "\n")

    print(f"\nDone! Output: {OUTPUT_SQL}")
    print(f"  Migrated : {migrated}")
    print(f"  Skipped  : {skipped}")
    return migrated, skipped


if __name__ == "__main__":
    main()
