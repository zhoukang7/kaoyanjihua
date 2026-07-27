-- 管理员撤销任务审核与学习进度回退
-- 前置条件：已执行最新版 supabase.sql。
-- 若此前执行过积分相关迁移，本脚本仍可独立执行。
-- 本脚本可重复执行，不会删除任务提交、评论或独立积分账本。

begin;

alter table public.task_submissions
  add column if not exists completion_applied boolean not null default false;

alter table public.task_submissions
  add column if not exists progress_applied boolean not null default false;

alter table public.task_submissions
  add column if not exists revoked_by uuid references auth.users(id) on delete set null;

alter table public.task_submissions
  add column if not exists revoked_at timestamptz;

-- 兼容旧版已审核记录：当前仍处于完成状态的记录视为曾由审核写入。
-- 这使管理员首次撤销旧记录时也能同步回退每日学习进度。
update public.task_submissions ts
set completion_applied = true,
    progress_applied = (ts.task_type = 'daily')
from public.study_dashboard sd
where sd.id = 'main'
  and ts.status = 'approved'
  and coalesce(
    (sd.state #>> array[ts.task_type, ts.period_key, ts.task_key])::boolean,
    false
  )
  and not ts.completion_applied;

create or replace function public.decrement_dashboard_metric(
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
  v_done := greatest(coalesce((v_metric ->> 'done')::numeric, 0) - p_delta, 0);

  v_metric := jsonb_set(v_metric, array['done'], to_jsonb(v_done), true);
  v_metrics := jsonb_set(v_metrics, array[p_metric_key], v_metric, true);
  return jsonb_set(v_state, array['metrics'], v_metrics, true);
end;
$$;

-- 覆盖审核函数：审核通过时记录本次审核是否实际写入任务状态和学习进度。
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

  if p_decision = 'rejected' then
    update public.task_submissions
    set status = 'rejected',
        review_note = nullif(btrim(coalesce(p_review_note, '')), ''),
        points_awarded = 0,
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        completion_applied = false,
        progress_applied = false,
        revoked_by = null,
        revoked_at = null,
        updated_at = now()
    where id = p_submission_id
    returning * into v_submission;

    return v_submission;
  end if;

  select state
  into v_state
  from public.study_dashboard
  where id = 'main'
  for update;

  if not found then
    raise exception '学习看板主记录不存在。';
  end if;

  v_state := coalesce(v_state, '{}'::jsonb);
  v_already_completed := coalesce(
    (v_state #>> array[v_submission.task_type, v_submission.period_key, v_submission.task_key])::boolean,
    false
  );

  v_group := coalesce(v_state -> v_submission.task_type, '{}'::jsonb);
  v_period := coalesce(v_group -> v_submission.period_key, '{}'::jsonb);
  v_period := jsonb_set(v_period, array[v_submission.task_key], 'true'::jsonb, true);
  v_group := jsonb_set(v_group, array[v_submission.period_key], v_period, true);
  v_state := jsonb_set(v_state, array[v_submission.task_type], v_group, true);

  if v_submission.task_type = 'daily' and not v_already_completed then
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

  update public.study_dashboard
  set state = v_state,
      updated_by = auth.uid(),
      updated_at = now()
  where id = 'main';

  update public.task_submissions
  set status = 'approved',
      review_note = nullif(btrim(coalesce(p_review_note, '')), ''),
      points_awarded = 0,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      completion_applied = not v_already_completed,
      progress_applied = (task_type = 'daily' and not v_already_completed),
      revoked_by = null,
      revoked_at = null,
      updated_at = now()
  where id = p_submission_id
  returning * into v_submission;

  return v_submission;
end;
$$;

-- 管理员取消已通过任务：状态改为未通过，并撤销任务完成与对应学习进度。
create or replace function public.revoke_task_completion(
  p_submission_id uuid,
  p_review_note text default '管理员撤销审核'
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
  v_currently_completed boolean := false;
begin
  if not public.is_owner() then
    raise exception '只有管理员可以撤销任务审核。';
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
    raise exception '只有已审核通过的任务可以撤销。';
  end if;

  select state
  into v_state
  from public.study_dashboard
  where id = 'main'
  for update;

  if not found then
    raise exception '学习看板主记录不存在。';
  end if;

  v_state := coalesce(v_state, '{}'::jsonb);
  v_currently_completed := coalesce(
    (v_state #>> array[v_submission.task_type, v_submission.period_key, v_submission.task_key])::boolean,
    false
  );

  v_group := coalesce(v_state -> v_submission.task_type, '{}'::jsonb);
  v_period := coalesce(v_group -> v_submission.period_key, '{}'::jsonb);
  v_period := jsonb_set(v_period, array[v_submission.task_key], 'false'::jsonb, true);
  v_group := jsonb_set(v_group, array[v_submission.period_key], v_period, true);
  v_state := jsonb_set(v_state, array[v_submission.task_type], v_group, true);

  if v_currently_completed
     and v_submission.task_type = 'daily'
     and v_submission.progress_applied then
    case v_submission.task_key
      when 'd_words' then
        v_state := public.decrement_dashboard_metric(v_state, 'eng_w', 50);
      when 'd_math' then
        v_state := public.decrement_dashboard_metric(v_state, 'math_h', 25);
      when 'd_read' then
        v_state := public.decrement_dashboard_metric(v_state, 'eng_r', 1);
      when 'd_ctl' then
        v_state := public.decrement_dashboard_metric(v_state, 'ctl_b', 18);
        v_state := public.decrement_dashboard_metric(v_state, 'ctl_q', 5);
      when 'd_pol' then
        v_state := public.decrement_dashboard_metric(v_state, 'pol_c', 1);
        v_state := public.decrement_dashboard_metric(v_state, 'pol_q', 20);
      else
        null;
    end case;
  end if;

  update public.study_dashboard
  set state = v_state,
      updated_by = auth.uid(),
      updated_at = now()
  where id = 'main';

  update public.task_submissions
  set status = 'rejected',
      review_note = coalesce(
        nullif(btrim(coalesce(p_review_note, '')), ''),
        '管理员撤销审核'
      ),
      points_awarded = 0,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      completion_applied = false,
      progress_applied = false,
      revoked_by = auth.uid(),
      revoked_at = now(),
      updated_at = now()
  where id = p_submission_id
  returning * into v_submission;

  return v_submission;
end;
$$;

revoke all on function public.decrement_dashboard_metric(jsonb, text, numeric) from public;
revoke all on function public.review_task_completion(uuid, text, text) from public;
revoke all on function public.revoke_task_completion(uuid, text) from public;

grant execute on function public.review_task_completion(uuid, text, text) to authenticated;
grant execute on function public.revoke_task_completion(uuid, text) to authenticated;

commit;
