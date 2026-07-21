#!/usr/bin/env bash
# ============================================================================
# scan-secrets.sh — redacting secret scanner for Gate A (Session 4)  [v2]
# ----------------------------------------------------------------------------
# Side-effect-free. Reads files only. Prints REDACTED findings — never a full
# secret value.
#
# Usage:
#   scan-secrets.sh --mode browser <file|dir...>   # HTML/JS shipped to browsers
#   scan-secrets.sh --mode code    <file|dir...>   # functions/scripts (server)
#   [--allowlist <file>]                            # documented deferrals
#
# Accuracy design (why this is not a naive grep):
#   * VALUE patterns match literal secret MATERIAL and are findings anywhere:
#       JWT, PEM private key, Gmail app-password, hardcoded Bearer/Basic token.
#   * JWTs are DECODED: a Supabase *anon* key is public-by-design (WARN), a
#       *service_role* key in a browser asset is a hard FAIL. We never cry wolf
#       on an anon key.
#   * In CODE mode, identifier names (service_role, VAPI_KEY, TEXTBELT_KEY,
#       GMAIL_PASS, textbelt, private_key) are findings ONLY when a quoted
#       literal is assigned to them — `x = process.env.X` and bare variable
#       references are the SAFE pattern and are ignored.
#   * In BROWSER mode, any reference to those privileged systems is a finding:
#       a browser asset has no legitimate reason to name them at all.
#
# Exit: nonzero if any non-allowlisted, non-anon finding remains.
# ============================================================================
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$HERE/lib/common.sh"

MODE="code"; ALLOWLIST=""; TARGETS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --allowlist) ALLOWLIST="$2"; shift 2 ;;
    *) TARGETS+=("$1"); shift ;;
  esac
done
[ "${#TARGETS[@]}" -eq 0 ] && { echo "usage: scan-secrets.sh --mode browser|code <paths...>"; exit 2; }

REPO_ROOT="$(resolve_repo_root)"
rel_of() { printf '%s' "${1#"$REPO_ROOT"/}"; }

# ---- allowlist (repo-relative "path::label", label optional) --------------
allow_hit() {
  local rel="$1" label="$2" line apath alabel
  [ -n "$ALLOWLIST" ] && [ -f "$ALLOWLIST" ] || return 1
  while IFS= read -r line; do
    case "$line" in ''|\#*) continue ;; esac
    line="${line%%#*}"; line="$(printf '%s' "$line" | sed 's/[[:space:]]*$//')"
    [ -z "$line" ] && continue
    apath="${line%%::*}"; alabel="${line#*::}"; [ "$alabel" = "$line" ] && alabel=""
    if [ "$apath" = "$rel" ] && { [ -z "$alabel" ] || [ "$alabel" = "$label" ]; }; then return 0; fi
  done < "$ALLOWLIST"
  return 1
}

# ---- JWT role decode (anon vs service_role) --------------------------------
# Prints: role string ("anon","service_role","authenticated", or "unknown").
jwt_role() {
  local tok="$1"
  if have node; then
    node -e '
      try {
        const t = process.argv[1].split(".");
        if (t.length < 2) { console.log("unknown"); process.exit(0); }
        let p = t[1].replace(/-/g,"+").replace(/_/g,"/");
        while (p.length % 4) p += "=";
        const j = JSON.parse(Buffer.from(p, "base64").toString("utf8"));
        console.log(String(j.role || j.roles || "unknown"));
      } catch (e) { console.log("unknown"); }
    ' "$tok" 2>/dev/null
  else
    echo "unknown"
  fi
}

# ---- emit helpers ----------------------------------------------------------
# findings  = hard FAIL (fails the run)
# review    = surfaced WARN (non-fatal): a privileged-system *reference* in a
#             browser asset, or an anon key — a human should confirm no secret
#             rides along, but it is not itself a high-confidence secret value.
findings=0; accepted=0; anon_notes=0; review=0
is_test_path() { printf '%s' "$1" | grep -Eq '__tests__|__mocks__|/fixtures/|\.test\.|\.spec\.'; }
emit() { # sev file line label raw
  local sev="$1" file="$2" ln="$3" label="$4" raw="$5" rel; rel="$(rel_of "$file")"
  if allow_hit "$rel" "$label"; then accepted=$((accepted+1)); warn "accepted/deferred $rel:$ln [$label] $(redact "$raw")"; return; fi
  # Test/fixture files legitimately use DUMMY credentials — downgrade weak-shape
  # findings there to review. Real secret shapes (PEM/service-role JWT/app-pw)
  # are never dummy and keep failing even in tests.
  if is_test_path "$file"; then
    case "$label" in literal_*|vapi_key_literal|vapi_uuid*|TEXTBELT_KEY_URL) sev=review ;; esac
  fi
  case "$sev" in
    anon)   anon_notes=$((anon_notes+1)); warn "$rel:$ln [$label] Supabase ANON key (public-by-design) $(redact "$raw")" ;;
    review) review=$((review+1));         warn "review $rel:$ln [$label] privileged-system reference (verify no secret) $(redact "$raw")" ;;
    *)      findings=$((findings+1));      report_finding "$rel" "$ln" "$label" "$raw" ;;
  esac
}

collect_files() {
  local t
  for t in "${TARGETS[@]}"; do
    if [ -d "$t" ]; then
      find "$t" -type f \( -name '*.html' -o -name '*.js' -o -name '*.ts' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.json' \) 2>/dev/null \
        | grep -vE '/node_modules/|/\.git/|/validation/gate-a/'
    elif [ -f "$t" ]; then printf '%s\n' "$t"; fi
  done
}

# identifier patterns handled contextually (code: literal-only; browser: any ref)
IDENT_LABELS=(service_role SUPABASE_SERVICE_ROLE textbelt VAPI_KEY TEXTBELT_KEY GMAIL_PASS private_key monFetchSupabase api_vapi_ai)
ident_pat() {
  case "$1" in
    service_role) echo 'service_role' ;;
    SUPABASE_SERVICE_ROLE) echo 'SUPABASE_SERVICE_ROLE' ;;
    textbelt) echo 'textbelt' ;;
    VAPI_KEY) echo 'VAPI_KEY' ;;
    TEXTBELT_KEY) echo 'TEXTBELT_KEY' ;;
    GMAIL_PASS) echo 'GMAIL_PASS' ;;
    private_key) echo 'private_key' ;;
    monFetchSupabase) echo 'monFetchSupabase' ;;
    api_vapi_ai) echo 'api\.vapi\.ai' ;;
  esac
}

section "Secret scan (mode=$MODE)"
while IFS= read -r file; do
  [ -z "$file" ] && continue

  # ---- VALUE: JWT (decode role) ----
  while IFS=: read -r ln _; do
    [ -z "$ln" ] && continue
    tok="$(sed -n "${ln}p" "$file" | grep -oE 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(\.[A-Za-z0-9_-]+)?' | head -1)"
    [ -z "$tok" ] && tok="$(sed -n "${ln}p" "$file" | grep -oE 'eyJ[A-Za-z0-9_-]{18,}' | head -1)"
    role="$(jwt_role "$tok")"
    case "$role" in
      service_role) emit fail "$file" "$ln" "JWT_service_role" "$tok" ;;
      anon)         emit anon "$file" "$ln" "JWT_anon" "$tok" ;;
      *)            emit fail "$file" "$ln" "JWT_${role}" "$tok" ;;   # unknown/authenticated -> verify
    esac
  done < <(grep -nE 'eyJ[A-Za-z0-9_-]{18,}' "$file" 2>/dev/null)

  # ---- VALUE: PEM private key ----
  while IFS=: read -r ln txt; do [ -z "$ln" ] && continue
    emit fail "$file" "$ln" "PRIVATE_KEY_PEM" "$(printf '%s' "$txt" | grep -oE 'BEGIN [A-Z ]*PRIVATE KEY' | head -1)"
  done < <(grep -nE 'BEGIN [A-Z ]*PRIVATE KEY' "$file" 2>/dev/null)

  # ---- VALUE: Gmail app password (quoted 16 letters, optional spaces) ----
  while IFS=: read -r ln txt; do [ -z "$ln" ] && continue
    printf '%s' "$txt" | grep -Eq 'process\.env' && continue
    emit fail "$file" "$ln" "GMAIL_APP_PW" "$(printf '%s' "$txt" | grep -oE '["'"'"'][a-z]{4} ?[a-z]{4} ?[a-z]{4} ?[a-z]{4}["'"'"']' | head -1)"
  done < <(grep -nE '["'"'"'][a-z]{4} ?[a-z]{4} ?[a-z]{4} ?[a-z]{4}["'"'"']' "$file" 2>/dev/null)

  # ---- VALUE: hardcoded Authorization header literal ----
  while IFS=: read -r ln txt; do [ -z "$ln" ] && continue
    printf '%s' "$txt" | grep -Eq '\$\{|process\.env|` *\+|"[[:space:]]*\+' && continue
    emit fail "$file" "$ln" "HARDCODED_AUTH" "$(printf '%s' "$txt" | grep -oE '(Bearer|Basic) [A-Za-z0-9._~+/=-]{12,}' | head -1)"
  done < <(grep -nE '[Aa]uthorization["'"'"']?[[:space:]]*:[[:space:]]*["'"'"']?(Bearer|Basic) [A-Za-z0-9._~+/=-]{12,}' "$file" 2>/dev/null)

  # ---- VALUE: textbelt send-key embedded in a URL (e.g. textbelt.com/quota/KEY) ----
  while IFS=: read -r ln txt; do [ -z "$ln" ] && continue
    printf '%s' "$txt" | grep -Eq 'process\.env|\$\{' && continue
    emit fail "$file" "$ln" "TEXTBELT_KEY_URL" "$(printf '%s' "$txt" | grep -oE 'textbelt\.com/[a-z]+/[A-Za-z0-9_-]{8,}' | head -1)"
  done < <(grep -nE 'textbelt\.com/[a-z]+/[A-Za-z0-9_-]{8,}' "$file" 2>/dev/null)

  # ---- VALUE: Vapi UUID used as a CREDENTIAL (key/token/secret/private/Bearer) ----
  # (assistantId/resource UUIDs are NOT secrets and are intentionally excluded)
  while IFS=: read -r ln txt; do [ -z "$ln" ] && continue
    printf '%s' "$txt" | grep -Eq 'process\.env|\$\{' && continue
    emit fail "$file" "$ln" "vapi_key_literal" "$(printf '%s' "$txt" | grep -oE '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' | head -1)"
  done < <(grep -nE '(secret|private|Bearer|[Aa]uthorization|VAPI_KEY|api[_-]?key)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"']?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' "$file" 2>/dev/null)

  # ---- SENSITIVE IDENTIFIER assigned a hardcoded literal (hard FAIL, both modes) ----
  # The literal must be assigned DIRECTLY to the identifier (not merely share the line).
  sens='service_role|SUPABASE_SERVICE_ROLE|TEXTBELT_KEY|GMAIL_PASS|private_key|VAPI_KEY|api[_-]?key|secret'
  while IFS=: read -r ln txt; do [ -z "$ln" ] && continue
    printf '%s' "$txt" | grep -Eq 'process\.env|Deno\.env|import\.meta\.env|\$\{' && continue
    lbl="$(printf '%s' "$txt" | grep -oiE "$sens" | head -1)"
    emit fail "$file" "$ln" "literal_${lbl}" "$(printf '%s' "$txt" | grep -oE '["'"'"'][^"'"'"']{8,}' | head -1)"
  done < <(grep -niE "($sens)[\"']?[[:space:]]*[:=][[:space:]]*[\"'][^\"']{8,}" "$file" 2>/dev/null)

  # ---- BROWSER-only REVIEW signals: privileged-system references (non-fatal) ----
  # A browser asset should not reference these at all; surface for human review
  # (a Vapi web public key / anon key is public-by-design, hence WARN not FAIL).
  if [ "$MODE" = "browser" ]; then
    for label in monFetchSupabase api_vapi_ai VAPI_KEY TEXTBELT_KEY textbelt service_role; do
      pat="$(ident_pat "$label" 2>/dev/null)"; [ -z "$pat" ] && case "$label" in
        api_vapi_ai) pat='api\.vapi\.ai';; textbelt) pat='textbelt';; service_role) pat='service_role';; esac
      while IFS=: read -r ln txt; do [ -z "$ln" ] && continue
        emit review "$file" "$ln" "$label" "$(printf '%s' "$txt" | grep -oiE "$pat" | head -1)"
      done < <(grep -niE "$pat" "$file" 2>/dev/null)
    done
    # standalone vapi/resource UUIDs in browser → review
    while IFS=: read -r ln txt; do [ -z "$ln" ] && continue
      emit review "$file" "$ln" "vapi_uuid_ref" "$(printf '%s' "$txt" | grep -oE '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' | head -1)"
    done < <(grep -nE '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' "$file" 2>/dev/null)
  fi
done < <(collect_files)

hr
printf 'secret-scan: findings=%s  review-signals=%s  anon-key-notes=%s  accepted-deferred=%s  (mode=%s)\n' \
  "$findings" "$review" "$anon_notes" "$accepted" "$MODE"
[ "$findings" -eq 0 ] && { echo "SECRET-SCAN: CLEAN"; exit 0; }
echo "SECRET-SCAN: FINDINGS PRESENT (redacted above)"; exit 1
