# Gate A — Validation Results

> Copy this file to `VALIDATION-RESULTS-<preview>-<date>.md` and fill it in for
> each preview run. Paste ONLY sanitized/redacted evidence — never a full secret.

## Run metadata
| Field | Value |
|---|---|
| Date (UTC) | `____-__-__T__:__:__Z` |
| Branch | `security/gate-a-validation` (+ preview branch under test: `__________`) |
| Commit SHA (validated deploy) | `________` |
| Preview URL | `https://deploy-preview-__--________.netlify.app` |
| Script version | `gate-a-validate v1 (Session 4)` / `static-checks v1` |
| Static exit status | `0 = PASS` / `nonzero = FAIL` → `___` |
| Preview exit status | `0 = PASS` / `nonzero = FAIL` → `___` |
| Self-test exit status | `___` (expect 0) |
| Operator initials | `___` |

## Static checks (`static-checks.sh`)
| # | Check | Result (PASS/FAIL/DEP/WARN) | Notes (sanitized) |
|---|---|---|---|
| 1 | JS syntax (node --check) | | |
| 2 | Edge TS/JS validity | | |
| 3 | Stale placeholders / conflict markers | | |
| 4 | Browser-asset privileged credentials | | |
| 5 | Hardcoded secrets in functions/scripts | | |
| 6 | Removed functions absent from functions/ | | |
| 7 | Healthcheck operational-URL calls | | |
| 8 | Wildcard CORS on privileged endpoints | | |
| 9 | Auth ordering (guard before body/provider) | | |
| 10 | Required Gate A env-var names referenced | | |
| 11 | Required Gate A files present | | |
| 12 | Duplicate/conflicting edge matchers | | |

## Preview checks (`validate-gate-a.sh`)
| ID | Check | Result | Notes (sanitized) |
|---|---|---|---|
| P1 | Admin dashboards challenge anon (no HTML/secret) | | |
| P2 | Admin functions reject anon GET+POST (401/403, not 405) | | |
| P3 | Internal endpoints reject no-token & invalid-token before work | | |
| P4 | Removed functions 404 at old URLs | | |
| P5 | Public pages 200 + public functions reachable (non-mutating) | | |
| P6 | Healthcheck: auth, dry-run, sanitized, 'unknown' honest | | |
| P7 | Live browser-asset credential scan | | |

## Intentional deferrals (documented, non-blocking)
> e.g. server-side embedded secrets slated for Gate D rotation; functions still
> awaiting Session 2/3 move. Record path + reason + owner + date.

- [ ] `__________` — reason: `__________` — owner: `___` — date: `____-__-__`

## Unmet dependencies (Sessions 1–3) observed this run
- [ ] `__________`

## Sanitized failure evidence
```
(paste redacted [FAIL] lines here — the scanners already redact secret values)
```

## Verdict
- [ ] Static PASS (or all FAILs are documented deferrals)
- [ ] Preview PASS on a genuine preview URL (not production)
- [ ] Self-test PASS (validators proven to catch defects)
- [ ] **Gate A acceptance: PASS / FAIL** → `______`

_Signed:_ `___` (operator)  _Date:_ `____-__-__`
