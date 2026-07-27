-- 任务审核与积分发放分离迁移
-- 在已执行最新版 supabase.sql 的前提下，在 Supabase SQL Editor 中执行本文件。
-- 可重复执行，不会清空已有任务、评论或积分记录。

begin;

alter table public.task_submissions
  add column if not exists points_awarded_by uuid references auth.users(id) on delete set null;

alter table public.task_submissions
  add column if not exists points_awarded_at timestamptz;

-- 管理员审核：
-- 1. 所有每日/每周任务都必须审核后才算完成；
-- 2. 每日任务审核通过后同步主看板并计入学习进度；
-- 3. 审核本身不再自动增加积分。
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
      points_awarded = 0,
      points_awarded_by = null,
      points_awarded_at = null,
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

-- 独立积分按钮：仅管理员可操作，仅已审核通过的每日任务可发放一次 1 积分。
create or replace function public.award_task_point(
  p_submission_id uuid
)
returns public.task_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submission public.task_submissions%rowtype;
begin
  if not public.is_owner() then
    raise exception '只有管理员可以发放积分。';
  end if;

  select *
  into v_submission
  from public.task_submissions
  where id = p_submission_id
  for update;

  if not found then
    raise exception '任务提交记录不存在。';
  end if;

  if v_submission.status <> 'approved' then
    raise exception '只有审核通过的任务可以发放积分。';
  end if;

  if v_submission.task_type <> 'daily' then
    raise exception '只有每日任务可以发放积分。';
  end if;

  if v_submission.points_awarded = 1 then
    raise exception '该任务已经发放过积分。';
  end if;

  update public.task_submissions
  set points_awarded = 1,
      points_awarded_by = auth.uid(),
      points_awarded_at = now(),
      updated_at = now()
  where id = p_submission_id
  returning * into v_submission;

  return v_submission;
end;
$$;

revoke all on function public.award_task_point(uuid) from public;
grant execute on function public.award_task_point(uuid) to authenticated;

commit;
