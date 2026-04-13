# DayDreamHub - Project Reference

## Project Structure

- Framework: Astro v5.4 (SSR) + Cloudflare Pages
- Database: Cloudflare D1 (SQLite)
- Email: Resend API
- Phone: Telnyx API
- Payment: PayPal REST API
- Maps: Leaflet.js (CDN)
- Source: `src/` | Deploy: GitHub Actions (`main` push)

## Admin SQL Console

`/admin/sql` で D1 に直接 SQL を実行できる。admin ログイン必須。

### よく使うクエリ

```sql
-- ホテル一覧（位置情報の有無）
SELECT id, name, city, country, latitude, longitude FROM hotels ORDER BY id;

-- オーナー紐付け状況
SELECT
  CASE
    WHEN h.email IS NULL OR h.email = '' THEN 'Unassigned'
    WHEN u.id IS NOT NULL THEN 'Linked'
    ELSE 'No Account'
  END as status, COUNT(*) as count
FROM hotels h
LEFT JOIN users u ON h.email = u.email AND u.role IN ('owner', 'inactive')
GROUP BY status;

-- 未紐付けホテル一覧
SELECT id, name, slug, email FROM hotels WHERE email IS NULL OR email = '' ORDER BY name;

-- オーナー一覧
SELECT id, name, email FROM users WHERE role = 'owner' ORDER BY id;

-- ホテル名でオーナーを自動マッチング
SELECT h.id as hotel_id, h.name as hotel_name, u.id as owner_id, u.name as owner_name, u.email
FROM hotels h
JOIN users u ON u.role = 'owner' AND LOWER(REPLACE(h.name, ' ', '')) = LOWER(REPLACE(u.name, ' ', ''))
WHERE (h.email IS NULL OR h.email = '')
ORDER BY h.id;

-- ホテルにオーナーを紐付け
UPDATE hotels SET email = 'owner@example.com' WHERE id = 123 AND (email IS NULL OR email = '');

-- 位置情報の確認
SELECT COUNT(*) as total,
  SUM(CASE WHEN latitude IS NOT NULL AND latitude != 0 AND latitude != '' THEN 1 ELSE 0 END) as with_location
FROM hotels;
```

## Admin Pages

| Path | Description |
|------|-------------|
| `/admin` | Dashboard |
| `/admin/hotels` | Hotels (Assign Owner, Edit, Delete) |
| `/admin/bookings` | Bookings |
| `/admin/users` | Users (Create, Edit, Delete) |
| `/admin/owner-applications` | Owner Applications |
| `/admin/contact-inquiries` | Contact Inquiries |
| `/admin/news` | What's New |
| `/admin/blog` | Blog |
| `/admin/messages` | Messages |
| `/admin/sql` | SQL Console |

## Key Files

| File | Description |
|------|-------------|
| `src/lib/airports.ts` | 150+ airports (add new airports here only) |
| `src/lib/email.ts` | All email templates |
| `src/lib/paypal.ts` | PayPal API wrapper |
| `src/lib/autoRefund.ts` | Auto refund logic |
| `src/lib/autoCall.ts` | AI phone call trigger |
| `src/lib/ownerAuth.ts` | Owner auth + hotel linking (email-based) |
| `src/lib/adminAuth.ts` | Admin JWT auth |
| `d1/migrations/` | D1 migration files |
| `wrangler.toml` | Cloudflare config (migrations_dir = d1/migrations) |
| `.github/workflows/deploy.yml` | CI/CD (build + D1 migration + deploy) |
| `DEPLOY.md` | Deploy instructions |
| `scripts/` | Migration scripts, geocoding, WP XML tools |

## Owner-Hotel Linking

Hotels are linked to owners via `hotels.email` = `users.email`.
No `owner_id` column exists. Staff use `hotel_staff` junction table.
Assign via `/admin/hotels` UI or SQL: `UPDATE hotels SET email = ? WHERE id = ?`

## Fee Calculation (PayPal)

```
Processing Fee = price_usd * 6%
Service Fee = max(0, $10 - price_usd * 10%)
Total = price_usd + Processing Fee + Service Fee
```

## Environment Variables (Cloudflare Pages)

- `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_MODE` (default: live)
- `RESEND_API_KEY`
- `TELNYX_API_KEY`, `TELNYX_CONNECTION_ID`, `TELNYX_FROM_NUMBER`
- `JWT_SECRET`
- `ADMIN_EMAIL` (default: info@daydreamhub.com)
- `GOOGLE_PLACES_API_KEY` (external hotel search for AI concierge)
- `CRON_SECRET`
- `DB` (D1 binding)
- `AI` (Workers AI binding)

## D1 Tables

users, hotels, plans, bookings, booking_messages, call_logs,
concierge_calls, concierge_call_groups, messages, password_resets,
owner_applications, contact_inquiries, news, blog_posts, reviews,
cities, hotel_images, hotel_staff, coupons, wishlists
