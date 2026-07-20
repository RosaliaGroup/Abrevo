-- Communications foundation (Phase 1) — messages
-- Project: fhkgpepkwibxbxsepetd (Supabase). REVIEW ONLY — not applied remotely.
--
-- Every inbound/outbound SMS is one row. Outbound rows are persisted BEFORE the
-- provider call (status 'queued'), then updated with the provider result. This
-- gives an auditable record even if the send fails.

create table if not exists public.messages (
  id                  uuid        primary key default gen_random_uuid(),
  conversation_id     uuid        not null
                      references public.conversations (id) on delete cascade,
  direction           text        not null
                      check (direction in ('outbound', 'inbound')),
  body                text        not null,
  status              text        not null default 'queued'
                      check (status in ('queued', 'sent', 'delivered', 'failed', 'blocked', 'received')),
  provider            text        not null default 'telnyx',
  provider_message_id text        null,
  error_code          text        null,
  error_message       text        null,
  -- Idempotency: a caller-supplied key that de-duplicates retries of the same
  -- logical send. NULL when not supplied. Unique when present (partial index).
  idempotency_key     text        null,
  sent_at             timestamptz null,
  delivered_at        timestamptz null,
  received_at         timestamptz null,
  created_at          timestamptz not null default now()
);

-- Thread read pattern: messages of a conversation in chronological order.
create index if not exists messages_conversation_id_created_at_idx
  on public.messages (conversation_id, created_at);

-- Delivery-status webhooks look up by provider message id; also a secondary
-- idempotency signal for inbound provider events.
create unique index if not exists messages_provider_message_id_key
  on public.messages (provider, provider_message_id)
  where provider_message_id is not null;

-- Outbound idempotency: at most one message per idempotency_key.
create unique index if not exists messages_idempotency_key_key
  on public.messages (idempotency_key)
  where idempotency_key is not null;
