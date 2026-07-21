# shellcheck shell=bash
# ============================================================================
# common.sh — shared helpers for Gate A validation (Session 4)
# ----------------------------------------------------------------------------
# Sourced by static-checks.sh, validate-gate-a.sh, scan-secrets.sh.
# Pure helpers only. No network, no writes, no side effects on source.
# ============================================================================

# --- result accounting ------------------------------------------------------
# Counters are global so the sourcing script can read them after checks run.
: "${GATEA_PASS:=0}"
: "${GATEA_FAIL:=0}"
: "${GATEA_DEP:=0}"    # dependency: not-yet-implemented by Sessions 1-3 (non-fatal)
: "${GATEA_WARN:=0}"   # documented/deferred finding (non-fatal by default)

# Colorless, CI-friendly, grep-able tags.
_ts() { date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "?"; }

pass() { GATEA_PASS=$((GATEA_PASS+1)); printf '  [PASS] %s\n' "$*"; }
fail() { GATEA_FAIL=$((GATEA_FAIL+1)); printf '  [FAIL] %s\n' "$*"; }
dep()  { GATEA_DEP=$((GATEA_DEP+1));   printf '  [DEP ] %s\n' "$*"; }
warn() { GATEA_WARN=$((GATEA_WARN+1)); printf '  [WARN] %s\n' "$*"; }
info() { printf '  [ .. ] %s\n' "$*"; }
hr()   { printf '%s\n' "------------------------------------------------------------"; }
section() { printf '\n== %s ==\n' "$*"; }

# --- redaction --------------------------------------------------------------
# Never print a full secret. Show at most the leading 4 chars, then a marker.
# Usage: redact "<raw match>"
redact() {
  local s="${1:-}"
  local n=${#s}
  if [ "$n" -le 4 ]; then
    printf '****(len=%s)' "$n"
  else
    printf '%s…REDACTED(len=%s)' "${s:0:4}" "$n"
  fi
}

# Print a redacted finding line: file, 1-based line no, pattern label, snippet.
# Usage: report_finding <file> <lineno> <label> <raw-snippet>
report_finding() {
  local file="$1" lineno="$2" label="$3" raw="$4"
  printf '     ! %s:%s  [%s]  %s\n' "$file" "$lineno" "$label" "$(redact "$raw")"
}

# --- shared detector regexes (single source of truth) -----------------------
# Wildcard CORS: Access-Control-Allow-Origin set to '*'.
GATEA_WILDCARD_CORS_RE='[Aa]ccess-[Cc]ontrol-[Aa]llow-[Oo]rigin["'"'"']?[[:space:]]*[:,][[:space:]]*["'"'"']?\*'
# Operational function URL (a healthcheck must NOT fetch these).
GATEA_OP_URL_RE='/\.netlify/functions/[a-z-]+|abrevo\.co/\.netlify|https?://[^"'"'"'`]*/\.netlify/functions/'

# --- environment / toolchain detection -------------------------------------
have() { command -v "$1" >/dev/null 2>&1; }

# Resolve the repo root of the validation worktree (dir containing this lib's
# grandparent). Callers may override with REPO_ROOT.
resolve_repo_root() {
  if [ -n "${REPO_ROOT:-}" ]; then printf '%s' "$REPO_ROOT"; return; fi
  # lib/ -> gate-a/ -> validation/ -> repo root
  local here; here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  ( cd "$here/../../.." && pwd )
}

# --- summary ----------------------------------------------------------------
# Exit status contract: FAIL>0 => nonzero. DEP/WARN never fail the run on their
# own (they are surfaced but represent not-yet-implemented / documented items).
gatea_summary() {
  hr
  printf 'SUMMARY  pass=%s  fail=%s  dependency=%s  warn=%s\n' \
    "$GATEA_PASS" "$GATEA_FAIL" "$GATEA_DEP" "$GATEA_WARN"
  if [ "$GATEA_FAIL" -eq 0 ]; then
    printf 'RESULT: PASS'
    [ "$GATEA_DEP" -gt 0 ] && printf ' (with %s unmet dependency(ies) — see [DEP] lines)' "$GATEA_DEP"
    printf '\n'
    return 0
  fi
  printf 'RESULT: FAIL — review [FAIL] lines above. Do NOT deploy production.\n'
  return 1
}
