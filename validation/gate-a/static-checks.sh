#!/usr/bin/env bash
# ============================================================================
# static-checks.sh — Gate A LOCAL/STATIC validation (Session 4)  [v1]
# ----------------------------------------------------------------------------
# Runs entirely offline against the working tree. NO network, NO writes, NO
# deploy, NO function invocation. Reconciled to the ACTUAL Abrevo repo, not to
# the public-source bundle.
#
# Result vocabulary (see lib/common.sh):
#   PASS  a Gate A property is met now
#   FAIL  a positively wrong/dangerous state exists now (fails the run)
#   DEP   a Gate A target not yet implemented by Sessions 1-3 (surfaced, non-fatal)
#   WARN  a documented / deferred finding (non-fatal)
#
# Usage:  static-checks.sh            (scans the repo this worktree points at)
#         GATEA_BASE=main static-checks.sh
# ============================================================================
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$HERE/lib/common.sh"

ROOT="$(cd "$HERE/../.." && pwd)"     # repo root of THIS worktree
cd "$ROOT" || { echo "cannot cd repo root"; exit 2; }
BASE="${GATEA_BASE:-main}"
ALLOWLIST="${GATEA_SECRET_ALLOWLIST:-$HERE/deferrals.allowlist}"

echo "Gate A static validation"
echo "repo:   $ROOT"
echo "base:   $BASE  (for changed-file detection)"
echo "commit: $(git rev-parse --short HEAD 2>/dev/null || echo '?')  branch: $(git branch --show-current 2>/dev/null)"
echo "time:   $(_ts)"

# ---------------------------------------------------------------------------
# Reconciled Gate A inventory (verified against the live functions/ + *.html).
# ---------------------------------------------------------------------------
ADMIN_DASHBOARDS="rosalia.html crm.html social.html mechanical.html"
PRIV_FUNCS="inventory ai-enrich admin-healthcheck-run"          # gate_now
INTERNAL_FUNCS="respondrosalia hvac-outreach sendemail sendcallrecap"
REMOVED_FUNCS="sms-campaign-hvac bulkemail"                     # must leave functions/
SCHEDULED_FUNCS="readmail autocall fubsync healthcheck sendsurvey followup appointment-reminder appointment-reminder-evening"
PUBLIC_FUNCS="book get-availability reschedule cancel"
REQUIRED_GATEA_FILES="functions/_gate-a-auth.js functions/_internal-auth.js functions/admin-healthcheck-run.js functions/_healthcheck-worker.js"
REQUIRED_ENV_VARS="ADMIN_GATE_USER ADMIN_GATE_PASS ADMIN_ALLOWED_ORIGINS INTERNAL_TOKEN ALLOW_MANUAL_HEALTHCHECK_WRITE"

fn() { printf 'functions/%s.js' "$1"; }
is_gated() { grep -Eq 'requireGateA|requireInternalToken|_gate-a-auth|_internal-auth' "$1" 2>/dev/null; }

# Compute changed JS since base (best-effort; base may be absent).
CHANGED=""
if git rev-parse --verify -q "$BASE" >/dev/null 2>&1; then
  MB="$(git merge-base HEAD "$BASE" 2>/dev/null || echo "$BASE")"
  CHANGED="$(git diff --name-only "$MB"...HEAD 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null)"
fi

# ===========================================================================
section "[1] JavaScript syntax (node --check) — Gate A-owned + changed JS"
# ===========================================================================
if have node; then
  # Gate A-owned JS that exists now:
  owned=""
  for f in $PRIV_FUNCS $INTERNAL_FUNCS $SCHEDULED_FUNCS; do [ -f "$(fn "$f")" ] && owned="$owned $(fn "$f")"; done
  for f in $REQUIRED_GATEA_FILES; do [ -f "$f" ] && owned="$owned $f"; done
  [ -d netlify/edge-functions ] && owned="$owned $(find netlify/edge-functions -name '*.js' -o -name '*.mjs' -o -name '*.cjs' 2>/dev/null)"
  # changed JS from the diff (skip our own validation tree + non-js):
  chjs="$(printf '%s\n' "$CHANGED" | grep -E '\.(js|mjs|cjs)$' | grep -vE '^validation/gate-a/' || true)"
  list="$(printf '%s\n%s\n' "$owned" "$chjs" | tr ' ' '\n' | sed '/^$/d' | sort -u)"
  n=0; bad=0
  while IFS= read -r f; do
    [ -z "$f" ] && continue; [ -f "$f" ] || continue
    n=$((n+1))
    if node --check "$f" 2>/tmp/gatea_nc.$$; then :; else bad=$((bad+1)); fail "syntax error: $f -> $(tr -d '\n' </tmp/gatea_nc.$$ | cut -c1-140)"; fi
  done <<< "$list"
  rm -f /tmp/gatea_nc.$$ 2>/dev/null
  [ "$bad" -eq 0 ] && pass "node --check clean on $n JS file(s)"
else
  dep "node not available — cannot run JS syntax check"
fi

# ===========================================================================
section "[2] Edge TypeScript/JS validity (repo's actual toolchain)"
# ===========================================================================
if [ -d netlify/edge-functions ] && [ -n "$(find netlify/edge-functions -type f 2>/dev/null)" ]; then
  tsfiles="$(find netlify/edge-functions -name '*.ts' 2>/dev/null)"
  jsfiles="$(find netlify/edge-functions \( -name '*.js' -o -name '*.mjs' \) 2>/dev/null)"
  if [ -n "$tsfiles" ]; then
    if have deno; then
      if deno check $tsfiles >/tmp/gatea_deno.$$ 2>&1; then pass "deno check clean on edge .ts"; else fail "deno check errors: $(head -3 /tmp/gatea_deno.$$ | tr '\n' ' ')"; fi
      rm -f /tmp/gatea_deno.$$
    elif npx --no-install tsc --version >/dev/null 2>&1; then
      if npx --no-install tsc --noEmit --allowJs --skipLibCheck $tsfiles >/tmp/gatea_tsc.$$ 2>&1; then pass "tsc --noEmit clean on edge .ts"; else fail "tsc errors: $(head -3 /tmp/gatea_tsc.$$ | tr '\n' ' ')"; fi
      rm -f /tmp/gatea_tsc.$$
    else
      dep "edge .ts present but no deno/tsc in this env — TS validity unverified (install toolchain to check)"
    fi
  fi
  if [ -n "$jsfiles" ] && have node; then
    ebad=0; for f in $jsfiles; do node --check "$f" 2>/dev/null || { ebad=1; fail "edge JS syntax error: $f"; }; done
    [ "$ebad" -eq 0 ] && pass "node --check clean on edge .js"
  fi
else
  dep "netlify/edge-functions/ absent — admin-gate edge fn not yet landed (Session 2)"
fi

# ===========================================================================
section "[3] Stale/invalid patch placeholders & conflict markers"
# ===========================================================================
# Scan APPLICATION files only (never our own validation tree, which uses ==== banners).
appfiles="$(git ls-files 'functions/*' 'netlify/*' 'scripts/*' '*.html' '*.toml' 2>/dev/null | grep -vE '^validation/')"
ph=0
while IFS= read -r f; do
  [ -z "$f" ] && continue; [ -f "$f" ] || continue
  # 7-char git conflict markers, or leftover unified-diff headers, or fill-me tokens
  while IFS=: read -r ln txt; do
    [ -z "$ln" ] && continue
    ph=$((ph+1)); fail "placeholder/conflict in $f:$ln -> $(printf '%s' "$txt" | cut -c1-60)"
  done < <(grep -nE '^(<{7}|>{7}|={7}$)|^(--- a/|\+\+\+ b/)|(REPLACE_ME|CHANGE_ME|__FILL__|<PASTE|TODO-GATE-A|XXXX-XXXX|PLACEHOLDER_KEY)' "$f" 2>/dev/null)
done <<< "$appfiles"
[ "$ph" -eq 0 ] && pass "no stale placeholders / conflict markers in application files"

# ===========================================================================
section "[4] Privileged credentials in BROWSER-delivered assets"
# ===========================================================================
htmls="$(git ls-files '*.html' 2>/dev/null | grep -vE '^validation/')"
if [ -n "$htmls" ]; then
  if bash "$HERE/scan-secrets.sh" --mode browser $htmls >/tmp/gatea_bsec.$$ 2>&1; then
    pass "browser assets clean of privileged credentials ($(printf '%s\n' "$htmls" | wc -l | tr -d ' ') files)"
  else
    fail "privileged credential(s) in browser asset(s):"
    grep -E '^\s+! ' /tmp/gatea_bsec.$$ | sed 's/^/    /'
  fi
  rm -f /tmp/gatea_bsec.$$
else
  dep "no browser HTML found to scan"
fi

# ===========================================================================
section "[5] Hardcoded secrets in functions & scripts"
# ===========================================================================
codepaths=""
[ -d functions ] && codepaths="$codepaths functions"
[ -d scripts ] && codepaths="$codepaths scripts"
[ -f delete-maria-events.js ] && codepaths="$codepaths delete-maria-events.js"
if [ -n "$codepaths" ]; then
  if bash "$HERE/scan-secrets.sh" --mode code --allowlist "$ALLOWLIST" $codepaths >/tmp/gatea_csec.$$ 2>&1; then
    pass "functions/scripts secret scan clean (or all findings documented in deferrals.allowlist)"
  else
    fail "hardcoded secret(s) in functions/scripts (redacted):"
    grep -E '^\s+! ' /tmp/gatea_csec.$$ | sed 's/^/    /'
    info "record accepted deferrals in: $ALLOWLIST  (AC: clean OR every finding documented)"
  fi
  rm -f /tmp/gatea_csec.$$
else
  dep "no functions/scripts dirs found"
fi

# ===========================================================================
section "[6] Removed functions absent from deploy surface (functions/)"
# ===========================================================================
for f in $REMOVED_FUNCS; do
  if [ -f "$(fn "$f")" ]; then
    if [ -f "scripts/$f.js" ]; then
      warn "$f present in BOTH functions/ and scripts/ — remove functions/$f.js"
    else
      dep "$f still in functions/ (deployable) — Session 2/3 to git mv -> scripts/$f.js"
    fi
  else
    if [ -f "scripts/$f.js" ]; then pass "$f moved to scripts/ (no longer an endpoint)"; else warn "$f not in functions/ nor scripts/ (verify intended)"; fi
  fi
done

# ===========================================================================
section "[7] Healthcheck must not call operational function URLs"
# ===========================================================================
hc_refactored=0
[ -f functions/_healthcheck-worker.js ] && hc_refactored=1
[ -f functions/admin-healthcheck-run.js ] && hc_refactored=1
hcfiles=""
for f in functions/_healthcheck-worker.js functions/admin-healthcheck-run.js functions/healthcheck.js; do [ -f "$f" ] && hcfiles="$hcfiles $f"; done
opurl_hits=0
for f in $hcfiles; do
  while IFS=: read -r ln txt; do
    [ -z "$ln" ] && continue
    opurl_hits=$((opurl_hits+1))
    if [ "$hc_refactored" -eq 1 ] && { [ "$f" = "functions/_healthcheck-worker.js" ] || [ "$f" = "functions/admin-healthcheck-run.js" ]; }; then
      fail "healthcheck calls operational URL in $f:$ln -> $(printf '%s' "$txt" | grep -oE 'https?://[^"'"'"'\`]+|/\.netlify/functions/[a-z-]+' | head -1)"
    else
      dep "pre-remediation healthcheck ($f:$ln) probes operational URL — Session 3 to remove -> $(printf '%s' "$txt" | grep -oE 'https?://[^"'"'"'\`]+|/\.netlify/functions/[a-z-]+' | head -1)"
    fi
  done < <(grep -nE "$GATEA_OP_URL_RE" "$f" 2>/dev/null)
done
[ "$opurl_hits" -eq 0 ] && [ -n "$hcfiles" ] && pass "no operational function-URL calls in healthcheck implementation"
[ -z "$hcfiles" ] && dep "no healthcheck implementation files found"

# ===========================================================================
section "[8] Wildcard CORS on privileged endpoints"
# ===========================================================================
for f in $PRIV_FUNCS $INTERNAL_FUNCS; do
  file="$(fn "$f")"; [ -f "$file" ] || { dep "$f function absent (skip CORS check)"; continue; }
  wild=0; grep -Eq "$GATEA_WILDCARD_CORS_RE" "$file" && wild=1
  if is_gated "$file"; then
    if [ "$wild" -eq 1 ]; then fail "$f is gated but still emits wildcard CORS"; else pass "$f: gated, no wildcard CORS"; fi
  else
    if [ "$wild" -eq 1 ]; then dep "$f not yet gated (Session 2) AND has wildcard CORS — both to be fixed"; else dep "$f not yet gated (Session 2); no wildcard CORS present"; fi
  fi
done

# ===========================================================================
section "[9] Auth ordering: guard before body-parse / provider calls"
# ===========================================================================
for f in $PRIV_FUNCS $INTERNAL_FUNCS; do
  file="$(fn "$f")"; [ -f "$file" ] || continue
  if ! is_gated "$file"; then dep "$f not yet gated — auth-ordering not applicable yet (Session 2)"; continue; fi
  gline=$(grep -nE 'requireGateA\(|requireInternalToken\(' "$file" | head -1 | cut -d: -f1)
  bline=$(grep -nE 'JSON\.parse\(\s*event\.body|event\.body|await fetch\(|nodemailer|createTransport|supabase|\.from\(' "$file" | head -1 | cut -d: -f1)
  if [ -n "$gline" ] && [ -n "$bline" ]; then
    if [ "$gline" -lt "$bline" ]; then pass "$f: auth (L$gline) precedes body/provider work (L$bline)"; else fail "$f: auth (L$gline) occurs AFTER body/provider work (L$bline)"; fi
  elif [ -n "$gline" ]; then pass "$f: guard present (L$gline); no body/provider work detected before it"; fi
done

# ===========================================================================
section "[10] Required Gate A environment-variable names referenced"
# ===========================================================================
gatecode="functions/_gate-a-auth.js functions/_internal-auth.js functions/admin-healthcheck-run.js"
present_any=0; for f in $gatecode; do [ -f "$f" ] && present_any=1; done
if [ "$present_any" -eq 1 ]; then
  for v in $REQUIRED_ENV_VARS; do
    if grep -Rqs "\b$v\b" $gatecode 2>/dev/null; then pass "env var referenced: $v"; else warn "expected Gate A env var not referenced in gate code: $v"; fi
  done
else
  dep "gate code not landed — cannot verify env-var names ($REQUIRED_ENV_VARS)"
fi

# ===========================================================================
section "[11] Required Gate A files present"
# ===========================================================================
for f in $REQUIRED_GATEA_FILES; do
  [ -f "$f" ] && pass "present: $f" || dep "missing: $f (Session 2/3 deliverable)"
done
# admin-gate edge fn (either extension)
if ls netlify/edge-functions/admin-gate.* >/dev/null 2>&1; then pass "present: netlify/edge-functions/admin-gate.*"; else dep "missing: netlify/edge-functions/admin-gate.(js|ts) (Session 2)"; fi

# ===========================================================================
section "[12] Duplicate / conflicting Netlify edge matchers"
# ===========================================================================
if [ -f netlify.toml ]; then
  # Extract path = "..." lines that fall inside [[edge_functions]] blocks.
  awk '
    /^\[\[edge_functions\]\]/ { inblk=1; path=""; func=""; next }
    /^\[/ && !/^\[\[edge_functions\]\]/ { inblk=0 }
    inblk && /^[[:space:]]*path[[:space:]]*=/ { gsub(/.*=[[:space:]]*"?|"[[:space:]]*$/,""); path=$0 }
    inblk && /^[[:space:]]*function[[:space:]]*=/ { gsub(/.*=[[:space:]]*"?|"[[:space:]]*$/,""); func=$0; if(path!=""){print path"\t"func} }
  ' netlify.toml > /tmp/gatea_edges.$$ 2>/dev/null
  cnt=$(wc -l < /tmp/gatea_edges.$$ | tr -d ' ')
  if [ "$cnt" -eq 0 ]; then
    dep "no [[edge_functions]] matchers in netlify.toml — admin-gate not registered (Session 2)"
  else
    dups=$(cut -f1 /tmp/gatea_edges.$$ | sort | uniq -d)
    if [ -n "$dups" ]; then
      while IFS= read -r d; do [ -n "$d" ] && fail "duplicate edge matcher path: $d"; done <<< "$dups"
    else
      pass "no duplicate edge matcher paths ($cnt matcher(s))"
    fi
    # each referenced function should exist
    while IFS=$'\t' read -r p func; do
      [ -z "$func" ] && continue
      if ls "netlify/edge-functions/$func".* >/dev/null 2>&1; then :; else warn "edge matcher $p -> '$func' but netlify/edge-functions/$func.* not found"; fi
    done < /tmp/gatea_edges.$$
  fi
  rm -f /tmp/gatea_edges.$$
else
  fail "netlify.toml missing"
fi

# ---------------------------------------------------------------------------
gatea_summary
exit $?
