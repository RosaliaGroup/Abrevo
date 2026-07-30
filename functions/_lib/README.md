# Communications foundation (`functions/_lib`) — Phase 1

Server-side foundation for the internal Communications (SMS conversations)
system. **Foundation only** — no Textbelt sender has been migrated, no inbound/
delivery webhooks exist yet, no UI, and nothing performs a production send.

## Modules

| File | Responsibility |
|---|---|
| `phone.js` | Canonical E.164 normalization (single source of truth). Non-throwing. |
| `supabaseRepo.js` | Server-only PostgREST data access for `conversations` / `messages` / `conversation_links`. Injectable `fetch`. |
| `conversations.js` | Server-owned get-or-create service. Reuse, race-safe create, idempotent CRM linkage by stable id. |
| `telnyx.js` | Telnyx client foundation. Injectable transport, `configCheck()` (non-sending health), normalized `sendSms()`. |
| `smsService.js` | Outbound orchestration: opt-out enforcement, idempotency, persist-before-send, persist result. |
| `../telnyx-health.js` | Non-sending Netlify handler that returns config booleans (no credential values). |

## Required environment variables (server-side only; never sent to the browser)

- `SUPABASE_URL` — Supabase project URL (`supabaseRepo.js`).
- `SUPABASE_SERVICE_KEY` — Supabase service-role key (`supabaseRepo.js`). Shares the
  name/value already used by the existing `functions/api.js` and other functions.
- `TELNYX_API_KEY` — Telnyx API key, outbound send (`telnyx.js`).
- `TELNYX_FROM_ROSALIA` — E.164 Rosalia sender, e.g. `+1XXXXXXXXXX` (`telnyx.js`). NOT
  `TELNYX_FROM_NUMBER` (that holds another tenant's number — see `functions/lib/sms.js`).
- `TELNYX_PUBLIC_KEY` — Telnyx Ed25519 webhook signing key; required by the inbound
  and delivery-status webhooks (`telnyx-inbound.js`, `telnyx-status.js`).
- `OPERATOR_SESSION_SECRET` — HMAC secret for the operator session/CSRF gate on
  `communications.js` and `telnyx-health.js` (`operatorGate.js`). Shares the
  name/value already used by `functions/api.js`; the operator endpoints fail closed
  (500) when it is absent.

No credentials are hardcoded. Config is validated via `telnyx.configCheck()` /
`GET` on the `telnyx-health` function without exposing any value.

## Migrations

`supabase/migrations/2026072012000{0,1,2}_communications_*.sql` — **review only,
not applied remotely.** Apply via the Supabase SQL editor / CLI after review.

- Uniqueness on `conversations.normalized_phone` (concurrency-safe get-or-create).
- `messages` persists queued→sent/failed/blocked with provider id + errors;
  unique partial indexes on `idempotency_key` and `(provider, provider_message_id)`.
- `conversation_links` links by stable id to the only entity tables that exist
  in this project: **`lead`** and **`booking`**. Others (contact, customer,
  property-as-table, showing, rental application, owner, campaign) do not exist
  here and are intentionally not modelled.

## Running the tests

```
node --test functions/_lib/__tests__/*.test.js
```

Tests use an in-memory repo fake and a mock Telnyx transport — **no network I/O
and no real SMS send.**
