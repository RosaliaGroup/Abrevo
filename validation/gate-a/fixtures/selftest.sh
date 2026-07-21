#!/usr/bin/env bash
# ============================================================================
# selftest.sh — proves the Gate A validators actually CATCH defects (Session 4)
# ----------------------------------------------------------------------------
# Runs only against local fixtures + a loopback mock server. No repo scan, no
# network beyond 127.0.0.1, no side effects. Exit 0 iff every negative fixture
# is caught and the good scenario passes.
# ============================================================================
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GA="$(cd "$HERE/.." && pwd)"           # validation/gate-a
# shellcheck source=../lib/common.sh
. "$GA/lib/common.sh"
FX="$HERE/static"
MOCK="$HERE/mock-preview-server.js"
PORT_GOOD="${GATEA_SELFTEST_PORT_GOOD:-8894}"
PORT_BAD="${GATEA_SELFTEST_PORT_BAD:-8895}"

t=0; ok=0
ck() { # ck "<desc>"  <expect: 0 pass|1 fail>  (reads $? via caller pattern)
  local desc="$1" want="$2" got="$3"
  t=$((t+1))
  if [ "$got" = "$want" ]; then ok=$((ok+1)); printf '  [ok ] %s\n' "$desc"; else printf '  [XX ] %s (want=%s got=%s)\n' "$desc" "$want" "$got"; fi
}
has() { grep -q "$1" "$2" && echo yes || echo no; }

echo "Gate A validator self-test"; hr

# ---------------------------------------------------------------------------
section "A. Static detector — embedded secrets (scan-secrets.sh --mode code)"
# ---------------------------------------------------------------------------
OUT="$(bash "$GA/scan-secrets.sh" --mode code "$FX/embedded-secret.fixture.js" 2>&1)"; rc=$?
ck "scan exits nonzero on leaky fixture" 1 "$rc"
ck "catches service_role JWT"      yes "$(printf '%s' "$OUT" | grep -q 'JWT_service_role' && echo yes || echo no)"
ck "catches PEM private key"       yes "$(printf '%s' "$OUT" | grep -q 'PRIVATE_KEY_PEM' && echo yes || echo no)"
ck "catches Gmail app password"    yes "$(printf '%s' "$OUT" | grep -q 'GMAIL_APP_PW' && echo yes || echo no)"
ck "catches textbelt URL key"      yes "$(printf '%s' "$OUT" | grep -q 'TEXTBELT_KEY_URL' && echo yes || echo no)"
ck "anon JWT downgraded (not a hard finding)" yes "$(printf '%s' "$OUT" | grep -qi 'ANON key (public-by-design)' && echo yes || echo no)"
ck "env-ref (process.env) NOT flagged as a finding" no "$(printf '%s' "$OUT" | grep -E '^\s+! ' | grep -q 'realKeyFromEnv\|process.env' && echo yes || echo no)"
# redaction: the raw fake secret material must NOT appear in output
ck "output is REDACTED (no raw service_role payload)" no "$(printf '%s' "$OUT" | grep -q 'eyJyb2xlIjoic2VydmljZV9yb2xl' && echo yes || echo no)"

# ---------------------------------------------------------------------------
section "B. Static detector — wildcard CORS"
# ---------------------------------------------------------------------------
grep -Eq "$GATEA_WILDCARD_CORS_RE" "$FX/wildcard-cors.fixture.js"; ck "wildcard CORS detected" 0 "$?"
grep -Eq "$GATEA_WILDCARD_CORS_RE" "$GA/scan-secrets.sh"           ; ck "no false wildcard match on a clean script" 1 "$?"

# ---------------------------------------------------------------------------
section "C. Static detector — operational healthcheck URL"
# ---------------------------------------------------------------------------
n="$(grep -Ec "$GATEA_OP_URL_RE" "$FX/operational-healthcheck.fixture.js")"
ck "operational function URL(s) detected (>=2)" yes "$([ "${n:-0}" -ge 2 ] && echo yes || echo no)"
grep -Eq "$GATEA_OP_URL_RE" "$FX/embedded-secret.fixture.js"; ck "no operational-URL false positive on non-healthcheck fixture" 1 "$?"

# ---------------------------------------------------------------------------
section "D. Static detector — 'unknown' -> healthy mapping (object-scoped)"
# ---------------------------------------------------------------------------
ck "honest body => FOUND HONEST"    "FOUND HONEST"    "$(node "$GA/lib/check-unknown-mapping.js" "$FX/healthcheck-honest.json")"
ck "dishonest body => FOUND DISHONEST" "FOUND DISHONEST" "$(node "$GA/lib/check-unknown-mapping.js" "$FX/healthcheck-dishonest.json")"

# ---------------------------------------------------------------------------
section "E. Preview validator — GOOD mock must PASS (exit 0)"
# ---------------------------------------------------------------------------
node "$MOCK" "$PORT_GOOD" good >/dev/null 2>&1 &
GPID=$!; sleep 1
PREVIEW_URL="http://127.0.0.1:$PORT_GOOD" ADMIN_USER=admin ADMIN_PASS=admin bash "$GA/validate-gate-a.sh" >/tmp/gatea_st_good.$$ 2>&1
rc=$?; kill $GPID 2>/dev/null
ck "good preview => exit 0" 0 "$rc"
ck "good preview has zero FAIL lines" no "$(grep -q '\[FAIL\]' /tmp/gatea_st_good.$$ && echo yes || echo no)"
rm -f /tmp/gatea_st_good.$$

# ---------------------------------------------------------------------------
section "F. Preview validator — BAD mock must FAIL and name each defect"
# ---------------------------------------------------------------------------
node "$MOCK" "$PORT_BAD" bad >/dev/null 2>&1 &
BPID=$!; sleep 1
PREVIEW_URL="http://127.0.0.1:$PORT_BAD" ADMIN_USER=admin ADMIN_PASS=admin bash "$GA/validate-gate-a.sh" >/tmp/gatea_st_bad.$$ 2>&1
rc=$?; kill $BPID 2>/dev/null
B=/tmp/gatea_st_bad.$$
ck "bad preview => nonzero exit" 1 "$rc"
ck "flags 405-as-auth trap"                    yes "$(grep -q '405 is NOT proof of authentication' $B && echo yes || echo no)"
ck "flags anonymous dashboard credential leak" yes "$(grep -q 'dashboard UNPROTECTED' $B && echo yes || echo no)"
ck "flags internal endpoint 200 to unauth"     yes "$(grep -q 'internal guard missing' $B && echo yes || echo no)"
ck "flags wildcard CORS on privileged fn"      yes "$(grep -q 'wildcard CORS advertised' $B && echo yes || echo no)"
ck "flags healthcheck secret leak"             yes "$(grep -q 'not sanitized' $B && echo yes || echo no)"
ck "flags 'unknown' mapped to healthy"         yes "$(grep -q 'mapped to healthy' $B && echo yes || echo no)"
ck "flags live-asset credential"               yes "$(grep -q 'LIVE .*privileged credential' $B && echo yes || echo no)"
rm -f "$B"

hr
printf 'SELF-TEST: %s/%s assertions passed\n' "$ok" "$t"
[ "$ok" -eq "$t" ] && { echo "RESULT: PASS"; exit 0; } || { echo "RESULT: FAIL"; exit 1; }
