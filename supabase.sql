-- Run this SQL in Supabase SQL Editor.
-- Dashboard tables and RLS will be added here.

create table if not exists study_dashboard (
 id uuid primary key default gen_random_uuid(),
 data jsonb not null default '{}'::jsonb,
 updated_at timestamptz default now()
);

alter table study_dashboard enable row level security;

create policy "viewer can read dashboard" on study_dashboard
for select using (true);
