# Deferred Credential Rotation and Legacy Archive Runbook — Not Executed

**Status: DEFERRED. Nothing in this document has been performed.** No credential
has been rotated, no legacy or backup file has been modified, and no secret value
appears here. This is a planning/runbook artifact only. It requires separate,
explicit owner approval before any step is carried out.

This document does **not** describe changes to `crm.html`, `rosalia.html`, or any
other page on `main` — those pages were already remediated on `origin/main`
(privileged operations routed through the authenticated `/api` layer) and are
**not** touched by the Communications reconciliation branch.

---

## 1. Scope and boundaries

- **In scope (planning only):** documenting where legacy/archived credential
  material still exists in the repository, the order in which a rotation *would*
  proceed, how it *would* be validated, and rollback considerations.
- **Explicitly out of scope for this branch:** editing legacy/backup files,
  rotating any key, connecting to Supabase/Telnyx, deploying, or configuring any
  external dashboard.
- The active application on `origin/main` carries **no** browser-side privileged
  credential (verified by the security test suite). The items below are
  **legacy/archived** or **non-deployed** locations, deferred by prior decision.

## 2. Legacy / archived credential locations (high level, no values)

Identified during read-only discovery. Character values are **not** reproduced.

| Location (high level) | Nature | Deployed? | Disposition |
|---|---|---|---|
| `netlify/functions/*` (secondary/legacy function tree) | Hardcoded Supabase key literal in several files | **No** — `netlify.toml` builds the top-level `functions/` dir only | Rotation moots it; scrub or remove tree under separate approval |
| `backups/**` | Historical page/function copies containing JWT-shaped and provider literals | No | Archive; rotation moots; optional scrub with approval |
| `ABREVO-FINAL-BACKUP-*/**` | Point-in-time backup snapshot with the same classes of literal | No | Archive; rotation moots; optional scrub with approval |
| Git history | Prior revisions that once contained literals | N/A | Rotation is the real fix; history rewrite only if explicitly approved |

Note: the same provider secrets may appear in more than one archived location.
The remediation is **rotation at the provider**, which invalidates every copy at
once, rather than editing individual archived files.

## 3. Required rotation order (do NOT execute without authorization)

Perform provider rotation only after confirming no **active** page or deployed
function depends on the key being rotated. On `origin/main` the active pages
already source credentials server-side, so the active surface is expected to be
clear — **re-verify at rotation time**.

1. **Supabase service credential (highest priority).**
   - Confirm the project's key model in the Supabase dashboard first. Legacy
     Supabase projects derive the `anon` and `service_role` JWTs from a single
     project JWT secret, so rotating that secret rotates **both** keys together;
     newer projects support independently rollable API keys. **Do not guess —
     verify the model before rotating**, and plan for the `anon` key to change in
     the same window if the legacy model is in use.
   - Set the new value in server-side environment only (Netlify env
     `SUPABASE_SERVICE_KEY`). Never place it in any HTML or client bundle.
   - Validate (section 4), then revoke the old value, then confirm the old value
     is rejected.
2. **Textbelt key(s).** Update server-side env only; validate; revoke old; confirm
   rejection. Keep only until the Textbelt senders migrate to Telnyx in a later
   phase.
3. **Telnyx** (only if a key was ever exposed). Roll in the Telnyx dashboard,
   update `TELNYX_API_KEY` server-side, re-verify webhook signing key
   (`TELNYX_PUBLIC_KEY`) still matches.

## 4. Post-rotation validation

- Static check that **no active page or deployed function** contains a JWT-shaped
  or provider literal (expect zero in the built `functions/` tree and all active
  HTML).
- Exercise the authenticated `/api` layer and the Communications endpoints against
  a **non-production** target to confirm the new server-side keys work.
- Confirm the **old** key is rejected by the provider (e.g., a request with the old
  key returns 401).
- Confirm no credential value is present in logs.

## 5. Backup / archive remediation (separate approval required)

- Scrubbing or deleting `netlify/functions/*`, `backups/**`, and
  `ABREVO-FINAL-BACKUP-*/**`, and any Git-history rewrite, are **separate actions**
  that must be individually approved. They are **not** part of the Communications
  reconciliation.
- Once provider rotation is complete, the literals in these archives are inert
  (they authenticate to nothing). Removal is hygiene, not an active-risk fix.

## 6. Rollback considerations

- Rotating a provider key is effectively irreversible (the old key is revoked). The
  safe rollback is **forward**: if a service breaks after rotation, set the correct
  new key in server env and redeploy — do not attempt to un-revoke.
- Sequence rotation immediately after deploying the server-side consumers of the
  new key so there is no window where a live surface holds only the old key.
- Keep the previous env values recorded in a secure secret store until validation
  succeeds, so a mis-paste can be corrected before the old key is revoked.

## 7. Preconditions before any deployment that would exercise this material

- **Do not deploy the Communications reconciliation branch until its
  authentication tests pass** (operator-session gate on `communications.js` and
  `telnyx-health.js`; Ed25519 gate on the webhooks). Deployment and Telnyx
  configuration belong to a later controlled phase after code review and merge
  approval.
- This runbook is informational input to that later phase and confers no
  authorization to act.
