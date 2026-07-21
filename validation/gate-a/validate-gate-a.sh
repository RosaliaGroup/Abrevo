#!/usr/bin/env bash
# ============================================================================
# validate-gate-a.sh — Gate A PREVIEW validation (Session 4)  [v1]
# ----------------------------------------------------------------------------
# SAFE by construction: read-only HTTP only. No sends, no DB writes, no valid
# internal tokens, no scheduled-function invocation, no mutating booking calls.
# Reconciled to the ACTUAL Abrevo routes/functions — not the public bundle.
#
# Required:  PREVIEW_URL   e.g. https://deploy-preview-42--abrevo.netlify.app
# Optional:  ADMIN_USER / ADMIN_PASS   (Basic creds for authenticated checks)
#            GATEA_INTERNAL_TOKEN_INVALID  (defaults to a bogus token; NEVER a real one)
#            GATEA_ALLOW_PROD_OVERRIDE=I_UNDERSTAND   (bypass prod-host refusal — uncommitted use only)
#
# Exit nonzero on any admin leak / unexpected auth status. DEP items (targets
# not yet deployed) are surfaced but do not fail the run.
# ============================================================================
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$HERE/lib/common.sh"
SCRIPT_VERSION="gate-a-validate v1 (Session 4)"
SCRATCH="${GATEA_SCRATCH:-${TMPDIR:-/tmp}}/gatea.$$"; mkdir -p "$SCRATCH" 2>/dev/null
cleanup() { rm -rf "$SCRATCH" 2>/dev/null; }
trap cleanup EXIT

# ---------------------------------------------------------------------------
# SIDE-EFFECT / PRODUCTION-TARGET SAFEGUARDS  (run BEFORE any network call)
# ---------------------------------------------------------------------------
BASE="${PREVIEW_URL:-}"
if [ -z "$BASE" ]; then echo "ABORT: set PREVIEW_URL (a preview/branch deploy or localhost)."; exit 2; fi
case "$BASE" in http://*|https://*) ;; *) echo "ABORT: PREVIEW_URL must be an absolute http(s) URL."; exit 2 ;; esac
HOST="$(printf '%s' "$BASE" | sed -E 's#^https?://##; s#/.*$##; s#:.*$##')"

# Known PRODUCTION hosts — never validate against these (they trigger real infra).
PROD_HOSTS_RE='^(app\.abrevo\.co|abrevo\.co|www\.abrevo\.co|rosaliagroup\.com|www\.rosaliagroup\.com|mechanicalenterprise\.com|book\.rosaliagroup\.com|book\.mechanicalenterprise\.com)$'
# Recognised SAFE preview/local shapes.
SAFE_HOST_RE='(\.netlify\.app$|^deploy-preview-|--.*\.netlify\.app$|^localhost$|^127\.0\.0\.1$|^0\.0\.0\.0$)'

echo "$SCRIPT_VERSION"
echo "target host: $HOST"
if printf '%s' "$HOST" | grep -Eq "$PROD_HOSTS_RE"; then
  if [ "${GATEA_ALLOW_PROD_OVERRIDE:-}" = "I_UNDERSTAND" ]; then
    warn "PRODUCTION host explicitly overridden — proceeding read-only. This is discouraged."
  else
    echo "ABORT: '$HOST' looks like PRODUCTION. Gate A validation runs on previews only."
    echo "       (If you truly must, set GATEA_ALLOW_PROD_OVERRIDE=I_UNDERSTAND in your shell — never in the repo.)"
    exit 2
  fi
elif ! printf '%s' "$HOST" | grep -Eq "$SAFE_HOST_RE"; then
  warn "host '$HOST' is not a recognised preview/localhost shape — verify this is NOT production before trusting results."
fi

AU="${ADMIN_USER:-}"; AP="${ADMIN_PASS:-}"
# NEVER a real token. We only ever send an *invalid* token to prove rejection.
BAD_TOKEN="${GATEA_INTERNAL_TOKEN_INVALID:-invalid-preview-token-do-not-honor}"

# POST probes (even empty-body) may reach a not-yet-gated send/mutation function.
# Only ever POST to a genuine preview/localhost host. On a prod-override run we
# hard-disable POSTs so nothing mutating can touch production.
SAFE_TO_POST=0
printf '%s' "$HOST" | grep -Eq "$SAFE_HOST_RE" && SAFE_TO_POST=1
if [ "$SAFE_TO_POST" -eq 0 ]; then
  warn "host is not a confirmed preview/localhost — POST probes DISABLED (GET/read-only checks only)."
fi
post_code() { # like http_code but refuses to POST unless SAFE_TO_POST
  if [ "$SAFE_TO_POST" -eq 1 ]; then http_code "$@"; else echo "SKIP"; fi
}
post_body() { # like fetch_body but refuses unless SAFE_TO_POST
  if [ "$SAFE_TO_POST" -eq 1 ]; then fetch_body "$@"; else return 9; fi
}

echo "base URL:    $BASE"
echo "admin creds: $([ -n "$AU" ] && echo provided || echo '(none — auth-positive checks will be DEP)')"
echo "time:        $(_ts)"

# ---------------------------------------------------------------------------
# HTTP helpers (read-only)
# ---------------------------------------------------------------------------
CURL_COMMON=(--connect-timeout 4 --max-time 12 -s)
http_code() { curl "${CURL_COMMON[@]}" -o /dev/null -w '%{http_code}' "$@"; }
fetch_headers() { curl "${CURL_COMMON[@]}" -D - -o /dev/null "$@"; }
fetch_body() { curl "${CURL_COMMON[@]}" -o "$1" "${@:2}"; }

FN() { printf '%s/.netlify/functions/%s' "$BASE" "$1"; }

# ---------------------------------------------------------------------------
# Reconciled inventory (see static-checks.sh — same source of truth)
# ---------------------------------------------------------------------------
ADMIN_HTML="rosalia.html crm.html social.html mechanical.html"
# bare aliases only exist if Session 2 registers edge matchers; tested as conditional
ADMIN_ALIASES="rosalia crm social mechanical"
PRIV_FUNCS="inventory ai-enrich admin-healthcheck-run"
INTERNAL_FUNCS="respondrosalia hvac-outreach sendemail sendcallrecap"
REMOVED_FUNCS="sms-campaign-hvac bulkemail"
PUBLIC_PAGES="index.html booking-rosalia.html booking-form.html reschedule-rosalia.html cancel-reschedule.html"
PUBLIC_FUNCS="book get-availability reschedule cancel"

# ===========================================================================
section "[P1] Admin dashboards: anonymous must NOT receive protected HTML"
# ===========================================================================
for p in $ADMIN_HTML; do
  hdr="$(fetch_headers "$BASE/$p")"
  code="$(printf '%s' "$hdr" | awk 'NR==1{print $2}')"
  challenge="$(printf '%s' "$hdr" | grep -i 'www-authenticate' | head -1 | tr -d '\r')"
  body="$SCRATCH/dash.$p.html"; fetch_body "$body" "$BASE/$p"
  # does the anonymous response leak a real service-role key or admin-only markup?
  leak=0
  if bash "$HERE/scan-secrets.sh" --mode browser "$body" 2>/dev/null | grep -q 'SECRET-SCAN: FINDINGS'; then leak=1; fi
  if [ "$code" = "401" ] || [ "$code" = "403" ]; then
    if [ "$leak" = "1" ]; then fail "$p: returned $code BUT body still leaks a privileged credential"; else
      pass "$p: challenged ($code$([ -n "$challenge" ] && echo ", $challenge"))"
    fi
  else
    if [ "$leak" = "1" ]; then
      fail "$p: anonymous $code and body leaks privileged credential — dashboard UNPROTECTED"
    else
      # 200 without secrets could be a login page OR an unprotected-but-cleaned page.
      dep "$p: anonymous $code, no secret in body — auth gate not confirmed (Session 2 edge admin-gate). Do NOT treat generic $code as protected."
    fi
  fi
done
# bare aliases (only meaningful once edge matchers exist)
for p in $ADMIN_ALIASES; do
  code="$(http_code "$BASE/$p")"
  case "$code" in
    401|403) pass "/$p alias challenged ($code)" ;;
    *) dep "/$p alias -> $code (no edge matcher yet, or served by SPA fallback; Session 2)" ;;
  esac
done

# ===========================================================================
section "[P2] Admin-only functions: anon GET & POST must be 401/403 (NOT 405)"
# ===========================================================================
for f in $PRIV_FUNCS; do
  for m in GET POST; do
    if [ "$m" = "POST" ]; then code="$(post_code -X POST "$(FN "$f")")"; else code="$(http_code -X GET "$(FN "$f")")"; fi
    case "$code" in
      SKIP) info "$f [POST] skipped (POST disabled off-preview)" ;;
      401|403) pass "$f [$m] rejected ($code)" ;;
      404) dep "$f [$m] -> 404 (function not deployed yet — Session 3 for admin-healthcheck-run)" ;;
      405) fail "$f [$m] -> 405: method rejected before auth — 405 is NOT proof of authentication" ;;
      000) warn "$f [$m] -> no response (network/preview issue)" ;;
      *)   fail "$f [$m] -> $code: not an auth rejection — endpoint may be anonymously callable" ;;
    esac
  done
  # wildcard CORS must not be advertised on a privileged endpoint
  acao="$(fetch_headers "$(FN "$f")" | grep -i 'access-control-allow-origin' | tr -d '\r')"
  printf '%s' "$acao" | grep -q '\*' && fail "$f: wildcard CORS advertised ($acao)"
done

# ===========================================================================
section "[P3] Internal-token endpoints: reject BEFORE body/provider work"
# ===========================================================================
# Send a SAFE empty body (a) with no token and (b) with an INVALID token.
# Both must be rejected (401). We never send a valid token (no live send).
for f in $INTERNAL_FUNCS; do
  c_none="$(post_code -X POST -H 'Content-Type: application/json' --data '{}' "$(FN "$f")")"
  c_bad="$(post_code  -X POST -H 'Content-Type: application/json' -H "X-Internal-Token: $BAD_TOKEN" --data '{}' "$(FN "$f")")"
  if [ "$c_none" = "SKIP" ]; then info "$f: internal-token POST probes skipped (POST disabled off-preview)"; continue; fi
  if [ "$c_none" = "404" ]; then dep "$f -> 404 (not deployed / not yet gated — Session 2)"; continue; fi
  ok_none=0; ok_bad=0
  { [ "$c_none" = "401" ] || [ "$c_none" = "403" ]; } && ok_none=1
  { [ "$c_bad"  = "401" ] || [ "$c_bad"  = "403" ]; } && ok_bad=1
  if [ "$ok_none" = "1" ] && [ "$ok_bad" = "1" ]; then
    pass "$f: rejects no-token ($c_none) and invalid-token ($c_bad) before processing"
  elif [ "$c_none" = "200" ] || [ "$c_bad" = "200" ]; then
    fail "$f: returned 200 to an unauthenticated/invalid-token request — internal guard missing"
  else
    dep "$f: no-token=$c_none invalid-token=$c_bad — internal guard not confirmed (Session 2 requireInternalToken)"
  fi
done

# ===========================================================================
section "[P4] Removed functions: old URLs must be 404 / absent from deploy"
# ===========================================================================
for f in $REMOVED_FUNCS; do
  code="$(http_code "$(FN "$f")")"
  case "$code" in
    404) pass "$f -> 404 (no longer a deployed endpoint)" ;;
    401|403) warn "$f -> $code: still deployed (guarded) — Gate A wants it MOVED to scripts/ (404), not merely gated" ;;
    000) warn "$f -> no response" ;;
    *) dep "$f -> $code: still on deploy surface — Session 2/3 to git mv -> scripts/ (expect 404 after redeploy)" ;;
  esac
done

# ===========================================================================
section "[P5] Public customer routes still load (no auth) — non-mutating"
# ===========================================================================
for p in $PUBLIC_PAGES; do
  code="$(http_code "$BASE/$p")"
  [ "$code" = "200" ] && pass "$p -> 200" || fail "$p -> $code (public page regressed)"
done
# Public FUNCTIONS: prove reachability WITHOUT creating records.
# We never POST a booking payload. A GET / bare probe proving 'not 404, not blocked'
# is enough (405/400/200 all confirm the endpoint exists and is not auth-gated).
for f in $PUBLIC_FUNCS; do
  code="$(http_code "$(FN "$f")")"          # bare GET, no body => no mutation
  case "$code" in
    401|403) fail "$f -> $code: public booking function should NOT be auth-gated" ;;
    404) dep "$f -> 404 (not deployed on this preview?)" ;;
    000) warn "$f -> no response" ;;
    *) pass "$f reachable ($code) via non-mutating probe" ;;
  esac
done

# ===========================================================================
section "[P6] Healthcheck: authenticated, sanitized, dry-run, 'unknown' honest"
# ===========================================================================
HCRUN="admin-healthcheck-run"
c_anon="$(post_code -X POST -H 'Content-Type: application/json' --data '{}' "$(FN "$HCRUN")")"
if [ "$c_anon" = "SKIP" ]; then
  info "$HCRUN semantic checks skipped (POST disabled off-preview)"
elif [ "$c_anon" = "404" ]; then
  dep "$HCRUN not deployed — Session 3 manual healthcheck endpoint. Semantic checks below are DEP."
else
  { [ "$c_anon" = "401" ] || [ "$c_anon" = "403" ]; } \
    && pass "$HCRUN: anonymous POST rejected ($c_anon)" \
    || fail "$HCRUN: anonymous POST -> $c_anon (manual healthcheck must require auth)"
fi
if [ -n "$AU" ] && [ -n "$AP" ] && [ "$c_anon" != "404" ] && [ "$c_anon" != "SKIP" ] && [ "$SAFE_TO_POST" -eq 1 ]; then
  hb="$SCRATCH/hc.json"
  fetch_body "$hb" -u "$AU:$AP" -X POST -H 'Content-Type: application/json' --data '{}' "$(FN "$HCRUN")"
  grep -q '"effectiveDryRun":[[:space:]]*true' "$hb" && pass "healthcheck defaults to dry-run (effectiveDryRun:true)" || fail "healthcheck did not confirm effectiveDryRun:true (no-DB-write default)"
  # forced {dryRun:false} must STILL be dry unless server flag is set on preview
  fb="$SCRATCH/hc2.json"
  fetch_body "$fb" -u "$AU:$AP" -X POST -H 'Content-Type: application/json' --data '{"dryRun":false}' "$(FN "$HCRUN")"
  grep -q '"effectiveDryRun":[[:space:]]*true' "$fb" && pass "forced dryRun:false stays dry without server write-flag" || warn "forced dryRun:false not forced dry — verify ALLOW_MANUAL_HEALTHCHECK_WRITE is intentionally set on this preview"
  # sanitized output: no secrets, no raw provider errors, no inventory rows, unknown!=healthy
  if bash "$HERE/scan-secrets.sh" --mode browser "$hb" 2>/dev/null | grep -q 'SECRET-SCAN: FINDINGS'; then fail "healthcheck response contains a privileged credential (not sanitized)"; else pass "healthcheck response carries no privileged credential"; fi
  grep -qiE 'ECONNREFUSED|ETIMEDOUT|stack trace|at Object\.<anonymous>|nodemailer|getaddrinfo' "$hb" && fail "healthcheck leaks a raw provider/stack error (not sanitized)" || pass "healthcheck output has no raw provider/stack error"
  # scheduler execution must be reported unknown where no heartbeat exists, and
  # that specific 'unknown' probe must NOT be mapped to healthy/ok:true. Parse the
  # JSON (object-scoped) rather than regex across unrelated envelope fields.
  verdict="$(node "$HERE/lib/check-unknown-mapping.js" "$hb" 2>/dev/null || echo 'UNPARSEABLE')"
  case "$verdict" in
    "FOUND HONEST")    pass "scheduler execution reported 'unknown' and NOT mapped to healthy" ;;
    "FOUND DISHONEST") fail "'unknown' scheduler state is mapped to healthy/ok:true in the same probe (dishonest)" ;;
    "NONE HONEST")     dep "no scheduler-execution 'unknown' field found — Session 3 to emit heartbeat-derived 'unknown' semantics" ;;
    *)                 warn "healthcheck body not JSON-parseable for 'unknown' semantics check" ;;
  esac
else
  dep "healthcheck semantic checks skipped (need ADMIN_USER/PASS and a deployed $HCRUN)"
fi

# ===========================================================================
section "[P7] Browser credential scan on LIVE assets (fetch + scan response)"
# ===========================================================================
leaks=0
for p in $ADMIN_HTML $PUBLIC_PAGES; do
  b="$SCRATCH/live.$(printf '%s' "$p" | tr '/.' '__')"
  code="$(curl "${CURL_COMMON[@]}" -o "$b" -w '%{http_code}' "$BASE/$p")"
  [ "$code" = "000" ] && { warn "$p: no response, skipped"; continue; }
  if bash "$HERE/scan-secrets.sh" --mode browser "$b" 2>/dev/null | grep -q 'SECRET-SCAN: FINDINGS'; then
    leaks=$((leaks+1)); fail "LIVE $p ($code): privileged credential present in delivered asset"
  fi
done
[ "$leaks" -eq 0 ] && pass "no privileged credential found in any live browser asset scanned"

# ---------------------------------------------------------------------------
gatea_summary
exit $?
