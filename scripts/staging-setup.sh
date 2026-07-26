#!/usr/bin/env bash
# One-off staging environment setup, run from the "Setup Staging" workflow.
# 1) create daydreamhub-db-staging  2) seed it from the production DB
# 3) bind it to the Pages Preview environment + set preview env vars
# Idempotent: safe to re-run.
set -euo pipefail

DB_STAGING="daydreamhub-db-staging"
DB_PROD="daydreamhub-db"
PROJECT="daydreamhub"

echo "== 1. Create staging D1 (if missing) =="
if npx wrangler d1 list --json | python3 -c "import json,sys; sys.exit(0 if any(d.get('name')=='${DB_STAGING}' for d in json.load(sys.stdin)) else 1)"; then
  echo "staging DB already exists"
  CREATED=0
else
  npx wrangler d1 create "${DB_STAGING}"
  CREATED=1
fi

DB_ID=$(npx wrangler d1 list --json | python3 -c "import json,sys; print(next(d['uuid'] for d in json.load(sys.stdin) if d.get('name')=='${DB_STAGING}'))")
echo "STAGING_DB_ID=${DB_ID}"
export STAGING_DB_ID="${DB_ID}"

echo "== 2. Seed from production (only when freshly created or empty) =="
HAS_TABLES=$(npx wrangler d1 execute "${DB_STAGING}" --remote --json --command "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='hotels'" | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['results'][0]['c'])")
if [ "${HAS_TABLES}" = "0" ]; then
  echo "exporting production DB..."
  npx wrangler d1 export "${DB_PROD}" --remote --output=/tmp/prod.sql
  echo "importing into staging ($(wc -c </tmp/prod.sql) bytes)..."
  npx wrangler d1 execute "${DB_STAGING}" --remote --file=/tmp/prod.sql
else
  echo "staging DB already has tables — skipping seed"
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
