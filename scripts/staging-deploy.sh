#!/usr/bin/env bash
# Staging deploy: build → (optional) staging D1 migrations → Pages preview deploy.
# Runs in GitHub Actions (deploy-staging.yml) with CLOUDFLARE_API_TOKEN /
# CLOUDFLARE_ACCOUNT_ID in the environment. Kept as a plain repo file so the
# workflow file itself never needs editing (PAT lacks workflow scope).
set -euo pipefail

echo "== Build =="
npm run build

echo "== D1 migrations (staging) =="
# Applied only once the staging database exists and wrangler.toml has the
# [env.staging] d1 binding (added during initial setup from the server).
if grep -q "daydreamhub-db-staging" wrangler.toml 2>/dev/null; then
  npx wrangler d1 migrations apply daydreamhub-db-staging --remote --env preview || {
    echo "staging migrations failed" >&2
    exit 1
  }
else
  echo "staging DB not configured yet — skipping migrations"
fi

echo "== Deploy to Pages preview (branch=staging) =="
npx wrangler pages deploy dist --project-name=daydreamhub --branch=staging

echo "== Done: https://staging.daydreamhub-1sv.pages.dev =="
