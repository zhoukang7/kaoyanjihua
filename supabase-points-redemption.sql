-- 积分兑换、余额校验与积分流水
-- 前置条件：已执行 supabase.sql 和 supabase-points-separation.sql。
-- 本脚本可重复执行，不会清空任务、评论、积分发放或兑换记录。

begin;

create table if not exists public.point_redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null,
  display_name text not null,
  item_name text not null
    check (char_length(btrim(item_name)) between 1 and 120),
  points_cost integer not null
    check (points_cost between 1 and 999),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  review_note text
    check (review_note is null or char_length(btrim(review_note)) <= 1000),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists point_redemptions_status_idx
  on public.point_redemptions (status, submitted_at desc);

create index if not exists point_redemptions_user_idx
  on public.point_redemptions (user_id, submitted_at desc);

alter table public.point_redemptions replica identity full;

-- 当前可用积分：管理员已发放积分 - 已审核通过的兑换积分。
create or replace function public.get_user_point_balance(
  p_user_id uuid default auth.uid()
)
returns table (
  awarded_points integer,
  redeemed_points integer,
  pending_points integer,
  available_points integer
)
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select p.id
    from public.profiles p
    where p.id = p_user_id
      and p.username = 'user_1'
  ),
  awards as (
    select coalesce(sum(ts.points_awarded), 0)::integer as value
    from public.task_submissions ts
    join target t on t.id = ts.user_id
    where ts.task_type = 'daily'
  ),
  approved_redemptions as (
    select coalesce(sum(pr.points_cost), 0)::integer as value
    from public.point_redemptions pr
    join target t on t.id = pr.user_id
    where pr.status = 'approved'
  ),
  pending_redemptions as (
    select coalesce(sum(pr.points_cost), 0)::integer as value
    from public.point_redemptions pr
    join target t on t.id = pr.user_id
    where pr.status = 'pending'
  )
  select
    awards.value,
    approved_redemptions.value,
    pending_redemptions.value,
    greatest(awards.value - approved_redemptions.value, 0)
  from awards, approved_redemptions, pending_redemptions;
$$;

-- user_1 提交兑换申请。待审核申请会预占额度，避免同时申请超过已有积分。
create or replace function public.submit_point_redemption(
  p_item_name text,
  p_points_cost integer
)
returns public.point_redemptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_balance record;
  v_result public.point_redemptions%rowtype;
begin
  if auth.uid() is null then
    raise exception '请先登录。';
  end if;

  select *
  into v_profile
  from public.profiles
  where id = auth.uid();

  if not found or v_profile.username <> 'user_1' then
    raise exception '只有 user_1 可以提交积分兑换申请。';
  end if;

  p_item_name := btrim(coalesce(p_item_name, ''));
  if char_length(p_item_name) < 1 or char_length(p_item_name) > 120 then
    raise exception '兑换内容长度必须为 1 到 120 个字符。';
  end if;

  if p_points_cost is null or p_points_cost < 1 or p_points_cost > 999 then
    raise exception '兑换积分必须为 1 到 999。';
  end if;

  perform pg_advisory_xact_lock(hashtext(auth.uid()::text)::bigint);

  select * into v_balance
  from public.get_user_point_balance(auth.uid());

  if coalesce(v_balance.available_points, 0) - coalesce(v_balance.pending_points, 0) < p_points_cost then
    raise exception '可用积分不足，或已有待审核兑换占用了积分。';
  end if;

  insert into public.point_redemptions (
    user_id,
    username,
    display_name,
    item_name,
    points_cost,
    status,
    submitted_at,
    updated_at
  ) values (
    auth.uid(),
    v_profile.username,
    v_profile.display_name,
    p_item_name,
    p_points_cost,
    'pending',
    now(),
    now()
  )
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.withdraw_point_redemption(
  p_redemption_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_task_submitter() then
    raise exception '只有 user_1 可以撤回积分兑换申请。';
  end if;

  delete from public.point_redemptions
  where id = p_redemption_id
    and user_id = auth.uid()
    and status = 'pending';

  if not found then
    raise exception '只能撤回自己的待审核兑换申请。';
  end if;
end;
$$;

-- 管理员审核兑换。批准时再次锁定账户并校验余额，成功后该记录即构成积分减法流水。
create or replace function public.review_point_redemption(
  p_redemption_id uuid,
  p_decision text,
  p_review_note text default null
)
returns public.point_redemptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_redemption public.point_redemptions%rowtype;
  v_balance record;
begin
  if not public.is_owner() then
    raise exception '只有管理员可以审核积分兑换。';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception '审核结果必须是 approved 或 rejected。';
  end if;

  select *
  into v_redemption
  from public.point_redemptions
  where id = p_redemption_id
  for update;

  if not found then
    raise exception '兑换申请不存在。';
  end if;

  if v_redemption.status <> 'pending' then
    raise exception '该兑换申请已经审核，不能重复处理。';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_redemption.user_id::text)::bigint);

  if p_decision = 'approved' then
    select * into v_balance
    from public.get_user_point_balance(v_redemption.user_id);

    if coalesce(v_balance.available_points, 0) < v_redemption.points_cost then
      raise exception '当前可用积分不足，不能批准兑换。';
    end if;
  end if;

  update public.point_redemptions
  set status = p_decision,
      review_note = nullif(btrim(coalesce(p_review_note, '')), ''),
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now()
  where id = p_redemption_id
  returning * into v_redemption;

  return v_redemption;
end;
$$;

drop trigger if exists point_redemptions_set_updated_at on public.point_redemptions;
create trigger point_redemptions_set_updated_at
before update on public.point_redemptions
for each row execute function public.set_updated_at();

alter table public.point_redemptions enable row level security;

drop policy if exists point_redemptions_authenticated_read on public.point_redemptions;
create policy point_redemptions_authenticated_read
on public.point_redemptions
for select
to authenticated
using (true);

revoke all on public.point_redemptions from anon;
revoke all on public.point_redemptions from authenticated;
grant select on public.point_redemptions to authenticated;

revoke all on function public.get_user_point_balance(uuid) from public;
revoke all on function public.submit_point_redemption(text, integer) from public;
revoke all on function public.withdraw_point_redemption(uuid) from public;
revoke all on function public.review_point_redemption(uuid, text, text) from public;

grant execute on function public.get_user_point_balance(uuid) to authenticated;
grant execute on function public.submit_point_redemption(text, integer) to authenticated;
grant execute on function public.withdraw_point_redemption(uuid) to authenticated;
grant execute on function public.review_point_redemption(uuid, text, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'point_redemptions'
     ) then
    alter publication supabase_realtime add table public.point_redemptions;
  end if;
end
$$;

commit;
