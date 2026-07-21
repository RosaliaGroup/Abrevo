-- Migration: login_attempts — persistent, server-only tracking for operator login lockout.
-- Additive only. Does not alter existing tables. Must be applied in Supabase before the
-- authenticated API is deployed (see remediation report: provider-dashboard steps).
--
-- The table is written/read ONLY by the server (service_role) from functions/api.js.
-- RLS is enabled with NO policies, so anon/authenticated clients get no access.

create table if not exists public.login_attempts (
  id           bigint generated always as identity primary key,
  ip           text        not null,
  username     text,
  success      boolean     not null default false,
  attempted_at timestamptz not null default now()
);

-- Lockout query filters by ip + recent window; index supports it.
create index if not exists idx_login_attempts_ip_time
  on public.login_attempts (ip, attempted_at);

alter table public.login_attempts enable row level security;
-- Intentionally no policies: only the service_role key (server) may access this table.
