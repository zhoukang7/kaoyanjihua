-- 研程 · 822 共享学习看板
-- Run this SQL in Supabase SQL Editor.

begin;

create extension if not exists pgcrypto;

create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 username text not null unique,
 display_name text not null default '查看用户',
 role text not null default 'viewer' check (role in ('owner','viewer')),
 created_at timestamptz default now(),
 updated_at timestamptz default now()
);

create unique index if not exists one_owner_only
on public.profiles ((role)) where role='owner';

create table if not exists public.study_dashboard (
 id text primary key,
 state jsonb not null default '{}'::jsonb,
 updated_by uuid references auth.users(id),
 updated_at timestamptz default now()
);

insert into public.study_dashboard(id,state)
values('main','{}'::jsonb)
on conflict(id) do nothing;

create or replace function public.is_owner()
returns boolean
language sql stable security definer
set search_path=public
as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role='owner');
$$;

alter table public.profiles enable row level security;
alter table public.study_dashboard enable row level security;

drop policy if exists profiles_self on public.profiles;
drop policy if exists profiles_owner on public.profiles;
drop policy if exists dashboard_read on public.study_dashboard;
drop policy if exists dashboard_write on public.study_dashboard;

create policy profiles_self on public.profiles
for select to authenticated
using(id=auth.uid());

create policy profiles_owner on public.profiles
for select to authenticated
using(public.is_owner());

create policy dashboard_read on public.study_dashboard
for select to authenticated
using(true);

create policy dashboard_write on public.study_dashboard
for all to authenticated
using(public.is_owner())
with check(public.is_owner());

revoke all on public.profiles from anon;
revoke all on public.study_dashboard from anon;
grant select on public.profiles to authenticated;
grant select,insert,update on public.study_dashboard to authenticated;

commit;
