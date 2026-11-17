#!/usr/bin/env bash
# Post-deployment smoke test. Usage: smoke-test.sh https://your-app.vercel.app
set -euo pipefail
BASE="${1:?base url required}"
BASE="${BASE%/}"
[[ "$BASE" == http* ]] || BASE="https://$BASE"
fail() { echo "✗ $1"; exit 1; }
pass() { echo "✓ $1"; }

for i in $(seq 1 10); do
  code=$(curl -s -o /tmp/health.json -w '%{http_code}' "$BASE/api/v1/health" || true)
  [ "$code" = "200" ] && break
  echo "  waiting for health ($code)…"; sleep 6
done
[ "$code" = "200" ] || fail "health returned $code: $(cat /tmp/health.json 2>/dev/null)"
grep -q '"database":{"ok":true' /tmp/health.json || fail "database check not ok"
pass "health + database ready"

code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")
[ "$code" = "200" ] || fail "landing page returned $code"; pass "landing page"

code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/incidents")
[ "$code" = "401" ] || fail "unauthenticated API returned $code (expected 401)"; pass "API requires authentication"

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' "$BASE/api/v1/webhooks/n8n/incident")
[ "$code" = "401" ] || fail "unsigned webhook returned $code (expected 401)"; pass "unsigned webhook rejected"

code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/cron/recoveries")
[ "$code" = "401" ] || fail "cron without secret returned $code (expected 401)"; pass "cron endpoint protected"

headers=$(curl -sI "$BASE/")
echo "$headers" | grep -qi 'x-content-type-options: nosniff' || fail "missing security headers"; pass "security headers"
echo "smoke test passed for $BASE"
