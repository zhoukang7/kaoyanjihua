-- 研程 · 822 共享学习看板
-- 在 Supabase SQL Editor 中完整执行本文件。
--
-- 权限模型：
-- 1. owner（管理员）可以维护学习进度、回复评论并修改评论处理状态。
-- 2. viewer（user_1、user_2）只能读取学习进度，但可以发布意见。
-- 3. 普通用户只能编辑或删除自己尚未处理的评论。
-- 4. 所有匿名访问均被拒绝。
--
-- 本脚本可重复执行，不会清空已有学习数据或评论。

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 用户资料与角色
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null default '查看用户',
  role text not null default 'viewer' check (role in ('owner', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 数据库层确保最多只有一个最高管理员。
create unique index if not exists one_owner_only
  on public.profiles ((role))
  where role = 'owner';

-- ---------------------------------------------------------------------------
-- 共享学习看板
-- ---------------------------------------------------------------------------

create table if not exists public.study_dashboard (
  id text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.study_dashboard (id, state)
values ('main', '{}'::jsonb)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 学习交流与意见
-- ---------------------------------------------------------------------------

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),

  -- author_* 是发布时的姓名快照，避免读取评论时依赖跨用户 profiles 权限。
  author_id uuid not null references auth.users(id) on delete cascade,
  author_username text not null,
  author_display_name text not null,

  -- 评论类型：建议、问题、鼓励、计划调整。
  category text not null default 'suggestion'
    check (category in ('suggestion', 'question', 'encouragement', 'plan_adjustment')),

  -- 学科或页面区域。
  subject text not null default 'general'
    check (subject in ('general', 'math', 'english', 'politics', 'control822', 'daily', 'weekly')),

  -- 为后续“针对具体任务评论”预留关联字段。
  target_type text not null default 'general'
    check (target_type in ('general', 'subject', 'daily_task', 'weekly_task')),
  target_key text,

  content text not null
    check (char_length(btrim(content)) between 1 and 2000),

  -- 只有管理员可以修改处理状态和回复字段。
  status text not null default 'pending'
    check (status in ('pending', 'replied', 'adopted', 'not_adopted')),
  admin_reply text
    check (admin_reply is null or char_length(btrim(admin_reply)) between 1 and 2000),
  admin_replied_by uuid references auth.users(id) on delete set null,
  admin_replied_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (target_key is null or char_length(target_key) <= 120)
);

create index if not exists comments_created_at_idx
  on public.comments (created_at desc);

create index if not exists comments_status_created_at_idx
  on public.comments (status, created_at desc);

create index if not exists comments_subject_created_at_idx
  on public.comments (subject, created_at desc);

create index if not exists comments_author_created_at_idx
  on public.comments (author_id, created_at desc);

-- Realtime UPDATE/DELETE 事件可包含完整旧记录。
alter table public.study_dashboard replica identity full;
alter table public.comments replica identity full;

-- ---------------------------------------------------------------------------
-- 通用函数
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'owner'
  );
$$;

revoke all on function public.is_owner() from public;
grant execute on function public.is_owner() to authenticated;

-- 评论发布前强制绑定当前登录用户，并从 profiles 写入可信作者快照。
create or replace function public.prepare_comment_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to create a comment.';
  end if;

  select *
  into current_profile
  from public.profiles
  where id = auth.uid();

  if not found then
    raise exception 'The current account does not have an authorized profile.';
  end if;

  new.author_id := auth.uid();
  new.author_username := current_profile.username;
  new.author_display_name := current_profile.display_name;
  new.content := btrim(new.content);
  new.target_key := nullif(btrim(coalesce(new.target_key, '')), '');

  -- 新评论一律从“待处理”开始，客户端不能伪造管理员回复。
  new.status := 'pending';
  new.admin_reply := null;
  new.admin_replied_by := null;
  new.admin_replied_at := null;
  new.created_at := now();
  new.updated_at := now();

  return new;
end;
$$;

-- 评论更新保护：
-- - 普通用户只能修改自己的待处理评论内容与分类；
-- - 管理员可以回复和修改状态，但不能篡改其他用户的原始评论内容。
create or replace function public.guard_comment_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.id := old.id;
  new.author_id := old.author_id;
  new.author_username := old.author_username;
  new.author_display_name := old.author_display_name;
  new.created_at := old.created_at;

  if public.is_owner() then
    -- 管理员不是原作者时，保留原评论正文及关联信息。
    if old.author_id <> auth.uid() then
      new.category := old.category;
      new.subject := old.subject;
      new.target_type := old.target_type;
      new.target_key := old.target_key;
      new.content := old.content;
    else
      new.content := btrim(new.content);
      new.target_key := nullif(btrim(coalesce(new.target_key, '')), '');
    end if;

    if new.admin_reply is distinct from old.admin_reply then
      new.admin_reply := nullif(btrim(coalesce(new.admin_reply, '')), '');

      if new.admin_reply is null then
        new.admin_replied_by := null;
        new.admin_replied_at := null;
      else
        new.admin_replied_by := auth.uid();
        new.admin_replied_at := now();

        if new.status = 'pending' then
          new.status := 'replied';
        end if;
      end if;
    else
      new.admin_replied_by := old.admin_replied_by;
      new.admin_replied_at := old.admin_replied_at;
    end if;
  else
    if old.author_id <> auth.uid() then
      raise exception 'You may only edit your own comments.';
    end if;

    if old.status <> 'pending' then
      raise exception 'A processed comment can no longer be edited.';
    end if;

    new.content := btrim(new.content);
    new.target_key := nullif(btrim(coalesce(new.target_key, '')), '');

    -- 普通用户不能修改任何管理员处理字段。
    new.status := old.status;
    new.admin_reply := old.admin_reply;
    new.admin_replied_by := old.admin_replied_by;
    new.admin_replied_at := old.admin_replied_at;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.prepare_comment_insert() from public;
revoke all on function public.guard_comment_update() from public;

-- ---------------------------------------------------------------------------
-- 触发器
-- ---------------------------------------------------------------------------

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists study_dashboard_set_updated_at on public.study_dashboard;
create trigger study_dashboard_set_updated_at
before update on public.study_dashboard
for each row execute function public.set_updated_at();

drop trigger if exists comments_prepare_insert on public.comments;
create trigger comments_prepare_insert
before insert on public.comments
for each row execute function public.prepare_comment_insert();

drop trigger if exists comments_guard_update on public.comments;
create trigger comments_guard_update
before update on public.comments
for each row execute function public.guard_comment_update();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.study_dashboard enable row level security;
alter table public.comments enable row level security;

-- 清理旧策略和本脚本的策略，使脚本可重复执行。
drop policy if exists profiles_self on public.profiles;
drop policy if exists profiles_owner on public.profiles;
drop policy if exists profiles_select_self on public.profiles;
drop policy if exists owner_select_all_profiles on public.profiles;

drop policy if exists dashboard_read on public.study_dashboard;
drop policy if exists dashboard_write on public.study_dashboard;
drop policy if exists dashboard_authenticated_read on public.study_dashboard;
drop policy if exists dashboard_owner_update on public.study_dashboard;
drop policy if exists dashboard_owner_insert on public.study_dashboard;

drop policy if exists comments_authenticated_read on public.comments;
drop policy if exists comments_authenticated_insert on public.comments;
drop policy if exists comments_update_own_pending on public.comments;
drop policy if exists comments_owner_update_all on public.comments;
drop policy if exists comments_delete_own_pending on public.comments;
drop policy if exists comments_owner_delete_all on public.comments;

-- 用户读取自己的资料；管理员读取全部资料。
create policy profiles_select_self
on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy owner_select_all_profiles
on public.profiles
for select
to authenticated
using (public.is_owner());

-- 所有登录用户可读共享看板，只有管理员可写。
create policy dashboard_authenticated_read
on public.study_dashboard
for select
to authenticated
using (true);

create policy dashboard_owner_update
on public.study_dashboard
for update
to authenticated
using (public.is_owner())
with check (public.is_owner());

create policy dashboard_owner_insert
on public.study_dashboard
for insert
to authenticated
with check (public.is_owner());

-- 所有登录用户可以查看和发布评论。
create policy comments_authenticated_read
on public.comments
for select
to authenticated
using (true);

create policy comments_authenticated_insert
on public.comments
for insert
to authenticated
with check (author_id = auth.uid());

-- 普通用户只能更新自己的待处理评论；触发器进一步保护管理员字段。
create policy comments_update_own_pending
on public.comments
for update
to authenticated
using (author_id = auth.uid() and status = 'pending')
with check (author_id = auth.uid());

-- 管理员可以更新全部评论，用于回复和修改状态。
create policy comments_owner_update_all
on public.comments
for update
to authenticated
using (public.is_owner())
with check (public.is_owner());

-- 普通用户只能删除自己的待处理评论。
create policy comments_delete_own_pending
on public.comments
for delete
to authenticated
using (author_id = auth.uid() and status = 'pending');

-- 管理员可以删除任意评论。
create policy comments_owner_delete_all
on public.comments
for delete
to authenticated
using (public.is_owner());

-- ---------------------------------------------------------------------------
-- 最小数据库权限；最终访问仍由 RLS 决定
-- ---------------------------------------------------------------------------

revoke all on public.profiles from anon;
revoke all on public.study_dashboard from anon;
revoke all on public.comments from anon;

revoke all on public.profiles from authenticated;
revoke all on public.study_dashboard from authenticated;
revoke all on public.comments from authenticated;

grant select on public.profiles to authenticated;
grant select, insert, update on public.study_dashboard to authenticated;
grant select, insert, update, delete on public.comments to authenticated;

-- ---------------------------------------------------------------------------
-- Supabase Realtime
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'study_dashboard'
    ) then
      alter publication supabase_realtime add table public.study_dashboard;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'comments'
    ) then
      alter publication supabase_realtime add table public.comments;
    end if;
  end if;
end
$$;

commit;
