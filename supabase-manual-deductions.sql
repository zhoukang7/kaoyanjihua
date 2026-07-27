-- 管理员独立扣除积分
-- 前置条件：已执行 supabase-manual-points.sql。
-- 本脚本可重复执行，不会删除已有积分、兑换、任务或评论数据。

begin;

-- 扩展积分流水类型：管理员发放、管理员扣除、兑换扣除。
alter table public.point_ledger
  drop constraint if exists point_ledger_entry_type_check;

alter table public.point_ledger
  add constraint point_ledger_entry_type_check
  check (entry_type in ('grant', 'deduction', 'redemption'));

-- 保持原函数返回结构不变，但“已兑换”只统计兑换流水；管理员扣除单独记账。
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
  ledger_totals as (
    select
      coalesce(sum(case when pl.entry_type = 'grant' and pl.amount > 0 then pl.amount else 0 end), 0)::integer as awarded,
      coalesce(sum(case when pl.entry_type = 'redemption' and pl.amount < 0 then -pl.amount else 0 end), 0)::integer as redeemed,
      coalesce(sum(pl.amount), 0)::integer as available
    from public.point_ledger pl
    join target t on t.id = pl.user_id
  ),
  pending_redemptions as (
    select coalesce(sum(pr.points_cost), 0)::integer as pending
    from public.point_redemptions pr
    join target t on t.id = pr.user_id
    where pr.status = 'pending'
  )
  select
    ledger_totals.awarded,
    ledger_totals.redeemed,
    pending_redemptions.pending,
    greatest(ledger_totals.available, 0)
  from ledger_totals, pending_redemptions;
$$;

create or replace function public.deduct_user_points(
  p_points integer,
  p_reason text default '未完成任务'
)
returns public.point_ledger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_balance record;
  v_reason text;
  v_deductible integer;
  v_result public.point_ledger%rowtype;
begin
  if not public.is_owner() then
    raise exception '只有管理员可以扣除积分。';
  end if;

  if p_points is null or p_points < 1 or p_points > 9999 then
    raise exception '扣除积分必须为 1 到 9999 的整数。';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    v_reason := '未完成任务';
  end if;

  if char_length(v_reason) > 500 then
    raise exception '扣除原因不能超过 500 个字符。';
  end if;

  select *
  into v_profile
  from public.profiles
  where username = 'user_1';

  if not found then
    raise exception '未找到 user_1 账号。';
  end if;

  -- 与兑换提交、兑换审核共用同一用户级事务锁，防止并发超扣。
  perform pg_advisory_xact_lock(hashtext(v_profile.id::text)::bigint);

  select *
  into v_balance
  from public.get_user_point_balance(v_profile.id);

  v_deductible := greatest(
    coalesce(v_balance.available_points, 0) - coalesce(v_balance.pending_points, 0),
    0
  );

  if v_deductible < p_points then
    raise exception '当前最多可扣除 % 积分；待审核兑换占用的积分不能直接扣除。', v_deductible;
  end if;

  insert into public.point_ledger (
    user_id,
    username,
    display_name,
    amount,
    entry_type,
    note,
    created_by,
    created_at
  ) values (
    v_profile.id,
    v_profile.username,
    v_profile.display_name,
    -p_points,
    'deduction',
    v_reason,
    auth.uid(),
    now()
  )
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_user_point_balance(uuid) from public;
revoke all on function public.deduct_user_points(integer, text) from public;
grant execute on function public.get_user_point_balance(uuid) to authenticated;
grant execute on function public.deduct_user_points(integer, text) to authenticated;

commit;
