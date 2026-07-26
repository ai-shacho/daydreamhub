#!/usr/bin/env bash
# One-off staging environment setup, run from the "Setup Staging" workflow.
# 1) create daydreamhub-db-staging  2) seed it from the production DB
# 3) bind it to the Pages Preview environment + set preview env vars
# Idempotent: safe to re-run.
set -euo pipefail

DB_STAGING="daydreamhub-db-staging"
DB_PROD="daydreamhub-db"
PROJECT="daydreamhub"

db_exists() {
  npx wrangler d1 list --json | python3 -c "import json,sys; sys.exit(0 if any(d.get('name')=='${DB_STAGING}' for d in json.load(sys.stdin)) else 1)"
}
hotel_rows() {
  npx wrangler d1 execute "${DB_STAGING}" --remote --json --command "SELECT COUNT(*) AS c FROM hotels" 2>/dev/null \
    | python3 -c "import json,sys
try: print(json.load(sys.stdin)[0]['results'][0]['c'])
except Exception: print(-1)" || echo -1
}

echo "== 1. Create staging D1 (recreate if partially seeded) =="
NEED_SEED=1
if db_exists; then
  ROWS=$(hotel_rows)
  echo "existing staging DB, hotels rows: ${ROWS}"
  if [ "${ROWS}" -gt 0 ] 2>/dev/null; then
    echo "staging DB already seeded — keeping as is"
    NEED_SEED=0
  else
    echo "empty or partially imported — recreating for a clean slate"
    npx wrangler d1 delete "${DB_STAGING}" --skip-confirmation
    npx wrangler d1 create "${DB_STAGING}"
  fi
else
  npx wrangler d1 create "${DB_STAGING}"
fi

DB_ID=$(npx wrangler d1 list --json | python3 -c "import json,sys; print(next(d['uuid'] for d in json.load(sys.stdin) if d.get('name')=='${DB_STAGING}'))")
echo "STAGING_DB_ID=${DB_ID}"
export STAGING_DB_ID="${DB_ID}"

echo "== 2. Seed from production =="
if [ "${NEED_SEED}" = "1" ]; then
  echo "exporting production DB (read-only)..."
  npx wrangler d1 export "${DB_PROD}" --remote --output=/tmp/prod.sql
  echo "splitting dump into chunks (skipping oversized statements)..."
  python3 - <<'PYSPLIT'
import os, re
MAX_STMT = 95_000         # D1 hard limit is 100KB per SQL statement
MAX_CHUNK = 4_000_000     # bytes per import chunk

def split_multirow_insert(line):
    """d1 export emits multi-row INSERTs; split into one INSERT per row so a
    single huge batch never trips the 100KB statement limit."""
    m = re.match(r'(INSERT INTO .*?VALUES\s*)(\(.*\));?\s*$', line, re.S)
    if not m:
        return [line]
    head, body = m.group(1), m.group(2)
    rows, cur, depth, inq, i, n = [], [], 0, False, 0, len(body)
    while i < n:
        ch = body[i]
        if inq:
            cur.append(ch)
            if ch == "'":
                if i + 1 < n and body[i + 1] == "'":
                    cur.append("'"); i += 1
                else:
                    inq = False
        elif ch == "'":
            inq = True; cur.append(ch)
        elif ch == '(':
            depth += 1; cur.append(ch)
        elif ch == ')':
            depth -= 1; cur.append(ch)
            if depth == 0:
                rows.append(''.join(cur)); cur = []
                while i + 1 < n and body[i + 1] in ', \t\n':
                    i += 1
        else:
            if depth > 0:
                cur.append(ch)
        i += 1
    if len(rows) <= 1:
        return [line]
    return [head + r + ';\n' for r in rows]

os.makedirs('/tmp/chunks', exist_ok=True)
skipped = {}
idx, size, out = 0, 0, open('/tmp/chunks/chunk_000.sql', 'w')
out.write('PRAGMA defer_foreign_keys = true;\n')
for raw in open('/tmp/prod.sql'):
    for line in (split_multirow_insert(raw) if len(raw.encode()) > MAX_STMT else [raw]):
        b = len(line.encode())
        if b > MAX_STMT:
            m = re.search(r'INSERT INTO "?([A-Za-z0-9_]+)', line)
            t = m.group(1) if m else '?'
            skipped[t] = skipped.get(t, 0) + 1
            continue
        if size + b > MAX_CHUNK:
            out.close(); idx += 1; size = 0
            out = open(f'/tmp/chunks/chunk_{idx:03d}.sql', 'w')
            out.write('PRAGMA defer_foreign_keys = true;\n')
        out.write(line); size += b
out.close()
print(f'chunks: {idx + 1}')
for t, c in skipped.items():
    print(f'SKIPPED {c} oversized row(s) from table {t}')
PYSPLIT
  for f in /tmp/chunks/chunk_*.sql; do
    echo "importing ${f} ($(wc -c <"${f}") bytes)..."
    npx wrangler d1 execute "${DB_STAGING}" --remote --file="${f}"
  done
  echo "seed done — hotels rows now: $(hotel_rows)"
else
  echo "seed skipped"
fi

echo "== 3. Bind staging DB + env vars to Pages Preview environment =="
# Preview env vars: names from SYNC_SECRET_NAMES, values from ALL_SECRETS JSON
# (same convention as deploy.yml). PAYPAL_MODE is forced to sandbox on staging.
python3 - <<'PYEOF'
import json, os, urllib.request

acct = os.environ['CLOUDFLARE_ACCOUNT_ID']
token = os.environ['CLOUDFLARE_API_TOKEN']
db_id = os.environ['STAGING_DB_ID']
all_secrets = json.loads(os.environ.get('ALL_SECRETS') or '{}')
names = [n.strip() for n in (os.environ.get('SYNC_SECRET_NAMES') or '').replace(',', ' ').split() if n.strip()]

env_vars = {}
for n in names:
    v = all_secrets.get(n)
    if v:
        env_vars[n] = {'type': 'secret_text', 'value': v}
env_vars['PAYPAL_MODE'] = {'type': 'plain_text', 'value': 'sandbox'}
env_vars['DDH_ENV'] = {'type': 'plain_text', 'value': 'staging'}

payload = {
    'deployment_configs': {
        'preview': {
            'd1_databases': {'DB': {'id': db_id}},
            'env_vars': env_vars,
        }
    }
}
req = urllib.request.Request(
    f'https://api.cloudflare.com/client/v4/accounts/{acct}/pages/projects/daydreamhub',
    data=json.dumps(payload).encode(),
    headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
    method='PATCH',
)
with urllib.request.urlopen(req) as r:
    res = json.load(r)
print('pages project PATCH success:', res.get('success'))
if not res.get('success'):
    print(json.dumps(res.get('errors'), indent=2))
    raise SystemExit(1)
PYEOF

echo "== Setup complete =="
echo "Staging DB id: ${DB_ID}"
echo "Next: add [env.staging] d1 config to wrangler.toml with this id, then push the staging branch."
