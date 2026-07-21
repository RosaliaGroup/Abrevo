# Phase 2A — Migration Review & Setup Requirements

**Date:** 2026-07-20 · **Status:** reviewed, **NOT applied anywhere** (no verified isolated environment found). Do not apply to production.

## Migration files reviewed
1. `supabase/migrations/20260720120000_communications_conversations.sql`
2. `supabase/migrations/20260720120001_communications_messages.sql`
3. `supabase/migrations/20260720120002_communications_conversation_links.sql`
4. `supabase/migrations/20260720130000_communications_phase2.sql` (additive columns + RLS)

## 1. Collision check against the existing schema
Existing objects confirmed from application code: tables **`leads`**, **`bookings`**, **`tasks`**. New objects are **`conversations`**, **`messages`**, **`conversation_links`** — **no name collision**. All statements use `create table if not exists` / `add column if not exists` / `create index if not exists`, so re-runs are safe. New columns are added only to the new `conversations` table, never to `leads`/`bookings`/`tasks` (no CRM schema change).

> Note: a live introspection (information_schema) was **not** performed — that needs database credentials, and there is no isolated environment (see §2). The collision check is against the known/observed schema. Re-confirm with a dry-run before applying (see §8).

## 2. Isolated environment
**None found.** Only one Supabase project is referenced anywhere in the code: `fhkgpepkwibxbxsepetd` (production). There is no separate dev/staging project. Per the instructions, **the migration was not applied**. Setup requirements to apply safely are in §8.

## 3. RLS & access control decision
- The Communications tables are written/read **only by server-side Netlify functions** using the **service-role key** (env `SUPABASE_SERVICE_KEY`), which bypasses RLS by design.
- Migration 4 **enables RLS on all three tables with NO permissive policies**, plus `revoke all … from anon, authenticated`. Effect: anon/authenticated (any browser client, even one holding the anon key) is **denied by default**; only the service role (server) can touch these tables.
- The Communications **UI** (`communications.html`) calls the server-owned `communications` function and contains **no Supabase or Telnyx credentials** (verified by grep + `security.test.js`).

### ⚠️ Critical pre-existing finding (separate from this migration)
`crm.html` (line ~415) ships the Supabase **`service_role`** key to the browser (`SB_KEY` decodes to `role: service_role`). That key bypasses RLS and is fully privileged — a severe existing exposure that predates this work. **It does not affect the new tables' security** (they are server-only), but it means the *rest* of the schema currently has no effective RLS from the browser's perspective. Recommendation (out of Phase 2 scope): rotate that service key and move `crm.html`'s data access behind server functions. Added to the rotation list.

## 4. Uniqueness scope for `normalized_phone`
**Unique on `normalized_phone` alone.** Abrevo is a single account; the only discriminator (`client` = 'rosalia'/'hvac' on leads/bookings) is a per-record business line, not a tenant boundary. One phone = one thread; business-line context lives on linked entities. The unique index is the concurrency-safety mechanism for get-or-create.

## 5. Linkage cannot reference unsupported/malformed entities
- `conversation_links.entity_type` has a **CHECK constraint** allowing only `'lead'` and `'booking'` — the only entity tables that exist here with stable ids. Unsupported types are rejected at the DB and at the API (`SUPPORTED_ENTITY_TYPES`).
- The service/API reject `null`/empty ids before insert; `entity_id` is `text` (stringified stable id) to stay type-agnostic.
- **Unique `(conversation_id, entity_type, entity_id)`** makes linkage idempotent (no duplicate links); linking never creates a CRM record.

## 6. Index coverage (maps to required lookups)
| Required lookup | Index |
|---|---|
| Normalized-phone lookup | `conversations_normalized_phone_key` (unique) |
| Recent conversation ordering | order by `last_message_at desc nullslast` — served by seq/scan on paged reads; add `create index on conversations(last_message_at desc)` if volume grows (noted) |
| Conversation message ordering | `messages_conversation_id_created_at_idx (conversation_id, created_at)` |
| Provider message lookup (delivery/idempotency) | `messages_provider_message_id_key (provider, provider_message_id)` unique partial |
| Entity-linked conversation lookup | `conversation_links_entity_idx (entity_type, entity_id)` |
| Outbound idempotency | `messages_idempotency_key_key (idempotency_key)` unique partial |

**Recommended addition before production scale:** an explicit `create index if not exists conversations_last_message_at_idx on public.conversations (last_message_at desc nulls last);` to back the list ordering (currently relies on the planner). Left out of the applied set intentionally so it can be reviewed; add in the same migration when approved.

## 7. Service-role-only writes / authenticated reads
All writes and reads go through server functions with the service key. There is no "authenticated end-user" role in Abrevo (no Supabase Auth users); the CRM is an internal tool. So "appropriate authenticated reads" = **server-mediated reads only**; no client-role read policy is granted (deny-by-default). If a future authenticated-staff role is introduced, add explicit `select` policies then.

## 8. Setup requirements to apply (when approved)
Because there is no isolated environment, applying safely requires one of:
1. **Create a dedicated dev/staging Supabase project**, set its `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` in a staging Netlify context, apply migrations 1→4 in order via the SQL editor or `supabase db push`, then run the API/webhook flows against it.
2. Or apply to production **only after** review, in a maintenance window, in file order 1→4 (all additive/idempotent), having first run a dry-run (`EXPLAIN`/transaction rollback) to confirm no collision.

**Dry-run note:** a local Postgres dry-run was not possible in this environment (no Postgres/`psql` available); validation here is static review + idempotent DDL. A `BEGIN; … ROLLBACK;` dry-run on any Postgres 14+ with `pgcrypto` will validate syntax and collisions.

**Do not apply to production as part of Phase 2.**
