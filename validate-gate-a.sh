#!/usr/bin/env bash
# ============================================================================
# validate-gate-a.sh — SAFE Gate A validation [v3]
# No sends, no destructive writes, no scheduled-fn URL invocation.
# Env: PREVIEW_URL (req), ADMIN_USER/ADMIN_PASS (opt), INTERNAL_TOKEN (opt, dry-run only)
# Exits nonzero on any admin leak / unexpected status.
# ============================================================================
set -u
BASE="${PREVIEW_URL:?set PREVIEW_URL}"
AU="${ADMIN_USER:-}"; AP="${ADMIN_PASS:-}"; IT="${INTERNAL_TOKEN:-}"
fail=0
hr(){ printf '%s\n' "----------------------------------------"; }
code(){ curl -s -o /dev/null -w "%{http_code}" "$@"; }
SECRETS='eyJhbGciOiJIUzI1NiI|service_role|textbelt\.com|api\.vapi\.ai|VAPI_KEY|TEXTBELT_KEY|Rosalia Admin Dashboard|monFetchSupabase'

echo "Gate A v3 validation: $BASE"; hr
echo "[1] Admin routes challenged w/o creds (401/403) + no secret leak"
for p in /rosalia.html /rosalia /crm.html /crm /social.html /social /mechanical.html /mechanical; do
  c=$(code "$BASE$p"); ok="OK"; { [ "$c" != "401" ] && [ "$c" != "403" ]; } && { ok="**UNEXPECTED**"; fail=1; }
  printf "  %-20s %s %s\n" "$p" "$c" "$ok"
  n=$(curl -s "$BASE$p" | grep -Ec "$SECRETS" 2>/dev/null || true)
  [ "${n:-0}" != "0" ] && { echo "     !! LEAK at $p"; fail=1; }
done
hr
echo "[2] Admin routes WITH creds (200 or redirect) — if creds set"
if [ -n "$AU" ] && [ -n "$AP" ]; then
  for p in /rosalia.html /crm.html /social.html /mechanical.html; do
    c=$(curl -s -L -o /dev/null -w "%{http_code}" -u "$AU:$AP" "$BASE$p")
    ok="OK"; case "$c" in 200|301|302|304) ;; *) ok="**UNEXPECTED**"; fail=1;; esac
    printf "  %-20s %s %s\n" "$p" "$c" "$ok"
  done
else echo "  (skipped — no ADMIN_USER/PASS)"; fi
hr
echo "[3] Group 1 functions reject unauth (401/403) + no PII/wildcard-CORS"
for f in inventory ai-enrich admin-healthcheck-run; do
  c=$(code "$BASE/.netlify/functions/$f"); ok="OK"
  { [ "$c" != "401" ] && [ "$c" != "403" ] && [ "$c" != "405" ]; } && { ok="**UNEXPECTED**"; fail=1; }
  printf "  %-24s %s %s\n" "$f" "$c" "$ok"
  # wildcard CORS must be gone:
  acao=$(curl -s -D - -o /dev/null "$BASE/.netlify/functions/$f" | grep -i 'access-control-allow-origin' | tr -d '\r')
  echo "$acao" | grep -q '\*' && { echo "     !! wildcard CORS on $f"; fail=1; }
  n=$(curl -s "$BASE/.netlify/functions/$f" | grep -Ec '@|"phone"|eyJhbGciOiJIUzI1NiI' 2>/dev/null || true)
  [ "${n:-0}" != "0" ] && { echo "     !! possible PII in rejection body ($f)"; fail=1; }
done
hr
echo "[4] Authenticated manual healthcheck DEFAULTS to dry-run (no DB write)"
if [ -n "$AU" ] && [ -n "$AP" ]; then
  body=$(curl -s -u "$AU:$AP" -H 'Content-Type: application/json' -d '{}' "$BASE/.netlify/functions/admin-healthcheck-run")
  echo "$body" | grep -q '"effectiveDryRun":true' && echo "  dry-run default: OK" || { echo "  ** dry-run default NOT confirmed **"; fail=1; }
  # Even explicit {dryRun:false} must stay dry unless server flag set — expect effectiveDryRun:true on preview
  body2=$(curl -s -u "$AU:$AP" -H 'Content-Type: application/json' -d '{"dryRun":false}' "$BASE/.netlify/functions/admin-healthcheck-run")
  echo "$body2" | grep -q '"effectiveDryRun":true' && echo "  forced dry-run w/o server flag: OK" || echo "  (note: server write flag may be enabled — verify intentionally)"
else echo "  (skipped — no creds)"; fi
hr
echo "[5] Send endpoints: reject unauth OR absent (never 200 to anon)"
for f in respondrosalia hvac-outreach sendemail sendcallrecap sms-campaign-hvac bulkemail; do
  c=$(code "$BASE/.netlify/functions/$f"); ok="OK"
  # acceptable: 401 (token guard) or 404 (removed). NOT 200/500-with-work.
  case "$c" in 401|404) ;; *) ok="**REVIEW ($c)**"; fail=1;; esac
  printf "  %-22s %s %s\n" "$f" "$c" "$ok"
done
echo "  (do NOT send: no INTERNAL_TOKEN live-send test here; token paths tested in dry-run only)"
hr
echo "[6] Public pages load w/o auth (200)"
for p in /index.html /booking-rosalia.html /booking-form.html /reschedule-rosalia.html /cancel-reschedule.html; do
  c=$(code "$BASE$p"); ok="OK"; [ "$c" != "200" ] && { ok="**UNEXPECTED**"; fail=1; }
  printf "  %-26s %s %s\n" "$p" "$c" "$ok"
done
c=$(code "$BASE/.netlify/functions/get-availability"); ok="OK"
case "$c" in 401|403) ok="**BLOCKED**"; fail=1;; esac
printf "  %-26s %s %s\n" "get-availability" "$c" "$ok"
hr
echo "[7] Dev bypass must NOT work on preview (CONTEXT=deploy-preview)"
# An unauthenticated admin fn call must still be 401 even if GATE_A_DEV_BYPASS were set,
# because bypass requires CONTEXT==='dev'. Covered by [3] returning 401 above.
echo "  verified via [3] (admin fns 401 unauth on preview)"
hr
echo "[NOTE] Scheduled functions (readmail, autocall, fubsync, healthcheck, sendsurvey,"
echo "  followup, appointment-reminder[-evening]) are NOT curl-tested (not URL-invocable"
echo "  in prod; don't auto-run on previews). Test via Netlify UI 'Run now' or"
echo "  'netlify functions:invoke'. Ensure worker dry-run for send-capable ones."
hr
[ "$fail" -eq 0 ] && echo "RESULT: PASS" || echo "RESULT: FAIL — review flags above. Do NOT deploy production."
exit "$fail"
