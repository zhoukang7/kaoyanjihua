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

revoke all on function public.deduct_user_points(integer, text) from public;
grant execute on function public.deduct_user_points(integer, text) to authenticated;

commit;
