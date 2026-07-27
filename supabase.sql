-- 研程 · 822 共享学习看板
-- 在 Supabase SQL Editor 中完整执行本文件。
--
-- 权限模型：
-- 1. admin（owner）维护学习进度、审核 user_1 的任务提交、回复评论。
-- 2. user_1 只能提交每日/每周任务完成申请，不能直接修改学习进度。
-- 3. user_2 保持只读，不能提交任务。
-- 4. user_1 的每日任务经 admin 审核通过后，每项计 1 积分。
-- 5. 所有登录用户可发布评论；匿名访问全部拒绝。
--
-- 本脚本可重复执行，不会清空已有学习数据、评论或审核记录。

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
  author_id uuid not null references auth.users(id) on delete cascade,
  author_username text not null,
  author_display_name text not null,

  category text not null default 'suggestion'
    check (category in ('suggestion', 'question', 'encouragement', 'plan_adjustment')),

  subject text not null default 'general'
    check (subject in ('general', 'math', 'english', 'politics', 'control822', 'daily', 'weekly')),

  target_type text not null default 'general'
    check (target_type in ('general', 'subject', 'daily_task', 'weekly_task')),
  target_key text,

  content text not null
    check (char_length(btrim(content)) between 1 and 2000),

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

-- ---------------------------------------------------------------------------
-- user_1 任务提交、管理员审核与积分
-- ---------------------------------------------------------------------------

create table if not exists public.task_submissions (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null,
  display_name text not null,

  task_type text not null
    check (task_type in ('daily', 'weekly')),

  task_key text not null,
  period_key text not null
    check (period_key ~ '^\d{4}-\d{2}-\d{2}$'),

  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),

  review_note text
    check (review_note is null or char_length(btrim(review_note)) <= 1000),

  points_awarded integer not null default 0
    check (points_awarded in (0, 1)),

  submitted_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),

  constraint task_submissions_valid_task check (
    (task_type = 'daily' and task_key in (
      'd_words', 'd_math', 'd_read', 'd_ctl', 'd_pol', 'd_review'
    ))
    or
    (task_type = 'weekly' and task_key in (
      'w_math', 'w_eng', 'w_pol', 'w_ctl', 'w_review'
    ))
  ),

  constraint task_submissions_one_per_period
    unique (user_id, task_type, task_key, period_key)
);

create index if not exists task_submissions_status_idx
  on public.task_submissions (status, submitted_at desc);

create index if not exists task_submissions_user_period_idx
  on public.task_submissions (user_id, task_type, period_key);

alter table public.study_dashboard replica identity full;
alter table public.comments replica identity full;
alter table public.task_submissions replica identity full;

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

create or replace function public.is_task_submitter()
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
      and username = 'user_1'
  );
$$;

create or replace function public.increment_dashboard_metric(
  p_state jsonb,
  p_metric_key text,
  p_delta numeric
)
returns jsonb
language plpgsql
immutable
security invoker
as $$
declare
  v_state jsonb := coalesce(p_state, '{}'::jsonb);
  v_metrics jsonb;
  v_metric jsonb;
  v_done numeric;
begin
  v_metrics := coalesce(v_state -> 'metrics', '{}'::jsonb);
  v_metric := coalesce(v_metrics -> p_metric_key, '{}'::jsonb);
  v_done := coalesce((v_metric ->> 'done')::numeric, 0);

  v_metric := jsonb_set(
    v_metric,
    array['done'],
    to_jsonb(v_done + p_delta),
    true
  );

  v_metrics := jsonb_set(
    v_metrics,
    array[p_metric_key],
    v_metric,
    true
  );

  return jsonb_set(v_state, array['metrics'], v_metrics, true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 评论安全函数
-- ---------------------------------------------------------------------------

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

  new.status := 'pending';
  new.admin_reply := null;
  new.admin_replied_by := null;
  new.admin_replied_at := null;
  new.created_at := now();
  new.updated_at := now();

  return new;
end;
$$;

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

    new.status := old.status;
    new.admin_reply := old.admin_reply;
    new.admin_replied_by := old.admin_replied_by;
    new.admin_replied_at := old.admin_replied_at;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- user_1 提交、撤回任务
-- ---------------------------------------------------------------------------

create or replace function public.submit_task_completion(
  p_task_type text,
  p_task_key text,
  p_period_key text
)
returns public.task_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_result public.task_submissions%rowtype;
begin
  if auth.uid() is null then
    raise exception '请先登录。';
  end if;

  select *
  into v_profile
  from public.profiles
  where id = auth.uid();

  if not found or v_profile.username <> 'user_1' then
    raise exception '只有 user_1 可以提交任务完成申请。';
  end if;

  if p_task_type not in ('daily', 'weekly') then
    raise exception '任务类型无效。';
  end if;

  if p_period_key is null
     or p_period_key !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception '任务周期格式无效。';
  end if;

  perform p_period_key::date;

  if p_task_type = 'daily'
     and p_task_key not in (
       'd_words', 'd_math', 'd_read', 'd_ctl', 'd_pol', 'd_review'
     ) then
    raise exception '每日任务编号无效。';
  end if;

  if p_task_type = 'weekly'
     and p_task_key not in (
       'w_math', 'w_eng', 'w_pol', 'w_ctl', 'w_review'
     ) then
    raise exception '每周任务编号无效。';
  end if;

  insert into public.task_submissions (
    user_id,
    username,
    display_name,
    task_type,
    task_key,
    period_key,
    status,
    review_note,
    points_awarded,
    submitted_at,
    reviewed_by,
    reviewed_at,
    updated_at
  )
  values (
    auth.uid(),
    v_profile.username,
    v_profile.display_name,
    p_task_type,
    p_task_key,
    p_period_key,
    'pending',
    null,
    0,
    now(),
    null,
    null,
    now()
  )
  on conflict (user_id, task_type, task_key, period_key)
  do update
  set status = 'pending',
      review_note = null,
      points_awarded = 0,
      submitted_at = now(),
      reviewed_by = null,
      reviewed_at = null,
      updated_at = now()
  where public.task_submissions.status = 'rejected'
  returning * into v_result;

  if v_result.id is null then
    select *
    into v_result
    from public.task_submissions
    where user_id = auth.uid()
      and task_type = p_task_type
      and task_key = p_task_key
      and period_key = p_period_key;
  end if;

  return v_result;
end;
$$;

create or replace function public.withdraw_task_completion(
  p_task_type text,
  p_task_key text,
  p_period_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_task_submitter() then
    raise exception '只有 user_1 可以撤回任务完成申请。';
  end if;

  delete from public.task_submissions
  where user_id = auth.uid()
    and task_type = p_task_type
    and task_key = p_task_key
    and period_key = p_period_key
    and status = 'pending';

  if not found then
    raise exception '只能撤回尚未审核的任务。';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- admin 审核任务并在通过时同步主看板及积分
-- ---------------------------------------------------------------------------

create or replace function public.review_task_completion(
  p_submission_id uuid,
  p_decision text,
  p_review_note text default null
)
returns public.task_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submission public.task_submissions%rowtype;
  v_state jsonb;
  v_period jsonb;
  v_group jsonb;
  v_already_completed boolean := false;
begin
  if not public.is_owner() then
    raise exception '只有管理员可以审核任务。';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception '审核结果必须是 approved 或 rejected。';
  end if;

  select *
  into v_submission
  from public.task_submissions
  where id = p_submission_id
  for update;

  if not found then
    raise exception '任务提交记录不存在。';
  end if;

  if v_submission.status <> 'pending' then
    raise exception '该任务已经审核，不能重复处理。';
  end if;

  update public.task_submissions
  set status = p_decision,
      review_note = nullif(btrim(coalesce(p_review_note, '')), ''),
      points_awarded = case
        when p_decision = 'approved' and task_type = 'daily' then 1
        else 0
      end,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now()
  where id = p_submission_id
  returning * into v_submission;

  if p_decision = 'rejected' then
    return v_submission;
  end if;

  select state
  into v_state
  from public.study_dashboard
  where id = 'main'
  for update;

  v_state := coalesce(v_state, '{}'::jsonb);

  if v_submission.task_type = 'daily' then
    v_already_completed := coalesce(
      (v_state #>> array['daily', v_submission.period_key, v_submission.task_key])::boolean,
      false
    );

    v_group := coalesce(v_state -> 'daily', '{}'::jsonb);
    v_period := coalesce(v_group -> v_submission.period_key, '{}'::jsonb);
    v_period := jsonb_set(
      v_period,
      array[v_submission.task_key],
      'true'::jsonb,
      true
    );
    v_group := jsonb_set(
      v_group,
      array[v_submission.period_key],
      v_period,
      true
    );
    v_state := jsonb_set(v_state, array['daily'], v_group, true);

    if not v_already_completed then
      case v_submission.task_key
        when 'd_words' then
          v_state := public.increment_dashboard_metric(v_state, 'eng_w', 50);
        when 'd_math' then
          v_state := public.increment_dashboard_metric(v_state, 'math_h', 25);
        when 'd_read' then
          v_state := public.increment_dashboard_metric(v_state, 'eng_r', 1);
        when 'd_ctl' then
          v_state := public.increment_dashboard_metric(v_state, 'ctl_b', 18);
          v_state := public.increment_dashboard_metric(v_state, 'ctl_q', 5);
        when 'd_pol' then
          v_state := public.increment_dashboard_metric(v_state, 'pol_c', 1);
          v_state := public.increment_dashboard_metric(v_state, 'pol_q', 20);
        else
          null;
      end case;
    end if;
  else
    v_group := coalesce(v_state -> 'weekly', '{}'::jsonb);
    v_period := coalesce(v_group -> v_submission.period_key, '{}'::jsonb);
    v_period := jsonb_set(
      v_period,
      array[v_submission.task_key],
      'true'::jsonb,
      true
    );
    v_group := jsonb_set(
      v_group,
      array[v_submission.period_key],
      v_period,
      true
    );
    v_state := jsonb_set(v_state, array['weekly'], v_group, true);
  end if;

  update public.study_dashboard
  set state = v_state,
      updated_by = auth.uid(),
      updated_at = now()
  where id = 'main';

  return v_submission;
end;
$$;

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

drop trigger if exists task_submissions_set_updated_at on public.task_submissions;
create trigger task_submissions_set_updated_at
before update on public.task_submissions
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.study_dashboard enable row level security;
alter table public.comments enable row level security;
alter table public.task_submissions enable row level security;

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

drop policy if exists task_submissions_authenticated_read on public.task_submissions;

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

create policy comments_update_own_pending
on public.comments
for update
to authenticated
using (author_id = auth.uid() and status = 'pending')
with check (author_id = auth.uid());

create policy comments_owner_update_all
on public.comments
for update
to authenticated
using (public.is_owner())
with check (public.is_owner());

create policy comments_delete_own_pending
on public.comments
for delete
to authenticated
using (author_id = auth.uid() and status = 'pending');

create policy comments_owner_delete_all
on public.comments
for delete
to authenticated
using (public.is_owner());

create policy task_submissions_authenticated_read
on public.task_submissions
for select
to authenticated
using (true);

-- ---------------------------------------------------------------------------
-- 最小权限
-- ---------------------------------------------------------------------------

revoke all on public.profiles from anon;
revoke all on public.study_dashboard from anon;
revoke all on public.comments from anon;
revoke all on public.task_submissions from anon;

revoke all on public.profiles from authenticated;
revoke all on public.study_dashboard from authenticated;
revoke all on public.comments from authenticated;
revoke all on public.task_submissions from authenticated;

grant select on public.profiles to authenticated;
grant select, insert, update on public.study_dashboard to authenticated;
grant select, insert, update, delete on public.comments to authenticated;
grant select on public.task_submissions to authenticated;

revoke all on function public.is_owner() from public;
revoke all on function public.is_task_submitter() from public;
revoke all on function public.increment_dashboard_metric(jsonb, text, numeric) from public;
revoke all on function public.prepare_comment_insert() from public;
revoke all on function public.guard_comment_update() from public;
revoke all on function public.submit_task_completion(text, text, text) from public;
revoke all on function public.withdraw_task_completion(text, text, text) from public;
revoke all on function public.review_task_completion(uuid, text, text) from public;

grant execute on function public.is_owner() to authenticated;
grant execute on function public.is_task_submitter() to authenticated;
grant execute on function public.submit_task_completion(text, text, text) to authenticated;
grant execute on function public.withdraw_task_completion(text, text, text) to authenticated;
grant execute on function public.review_task_completion(uuid, text, text) to authenticated;

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

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'task_submissions'
    ) then
      alter publication supabase_realtime add table public.task_submissions;
    end if;
  end if;
end
$$;

commit;
