-- Supabase audit_log table for the Jarvis dashboard.
-- Run this once in the Supabase SQL editor before using the Supabase store.
-- Columns mirror AuditRow in src/db/audit.ts.

create table if not exists public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  ts         timestamptz not null,
  channel    text        not null,
  user_msg   text        not null,
  tool_calls jsonb       not null default '[]'::jsonb,
  response   text        not null,
  status     text        not null default 'ok',
  error      text
);

create index if not exists audit_log_ts_idx on public.audit_log (ts desc);

-- The worker uses the service_role key (bypasses RLS). RLS stays enabled so the
-- anon/public key can't read the log; only the server-side service key can.
alter table public.audit_log enable row level security;
