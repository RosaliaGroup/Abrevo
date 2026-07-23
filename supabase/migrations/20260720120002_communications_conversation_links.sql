-- Communications foundation (Phase 1) — conversation_links
-- Project: fhkgpepkwibxbxsepetd (Supabase). REVIEW ONLY — not applied remotely.
--
-- Links a conversation to existing CRM records by STABLE ID, without creating
-- or duplicating any CRM entity. A separate link table (rather than nullable
-- FK columns on conversations) is used because:
--   * a phone/thread can relate to several records (e.g. multiple leads or a
--     lead + a booking) — a one-to-many that FK columns cannot express cleanly;
--   * it is additive and reversible, and adds no columns to CRM tables.
--
-- SCOPE — only entity types that actually exist in this Abrevo Supabase project
-- with a stable id are permitted here:
--   * 'lead'    -> public.leads.id
--   * 'booking' -> public.bookings.id
-- The following requested entity types have NO table in this project and are
-- therefore NOT modelled (documented, not invented): contact, customer,
-- property (a text column on leads/bookings, not a table), showing, rental
-- application (represented as a lead with status='applied'), owner, campaign.
-- When those tables exist, extend the check constraint below.
--
-- entity_id is TEXT: leads/bookings id column type (bigint vs uuid) is not
-- verified from application code, so a stringified stable id keeps linkage
-- type-agnostic and uniform across entity types. No cross-table FK is declared
-- for the same reason (and to avoid coupling); referential correctness of
-- entity_id is enforced by the application, which only links ids it already
-- holds.

create table if not exists public.conversation_links (
  id              uuid        primary key default gen_random_uuid(),
  conversation_id uuid        not null
                  references public.conversations (id) on delete cascade,
  entity_type     text        not null
                  check (entity_type in ('lead', 'booking')),
  entity_id       text        not null,
  created_at      timestamptz not null default now()
);

-- Idempotent linkage: the same (conversation, entity) pair cannot be linked
-- twice. Repeated link attempts become no-ops.
create unique index if not exists conversation_links_unique
  on public.conversation_links (conversation_id, entity_type, entity_id);

-- Reverse lookup: "which conversation(s) is this CRM record linked to?"
create index if not exists conversation_links_entity_idx
  on public.conversation_links (entity_type, entity_id);
