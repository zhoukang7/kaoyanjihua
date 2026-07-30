-- 管理员可编辑每日任务文字、时间和完成进度
-- 在 Supabase SQL Editor 中完整执行一次。
-- 本脚本不会清空现有学习进度或任务审核记录。

begin;

alter table public.task_submissions
  add column if not exists progress_delta jsonb not null default '{}'::jsonb;

alter table public.task_submissions
  drop constraint if exists task_submissions_progress_delta_object;

alter table public.task_submissions
  add constraint task_submissions_progress_delta_object
  check (jsonb_typeof(progress_delta) = 'object')
  not valid;

alter table public.task_submissions
  validate constraint task_submissions_progress_delta_object;

create or replace function public.daily_task_default_config()
returns jsonb
language sql
immutable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'd_words', jsonb_build_object(
      'title', '背诵 50 个新词并复习旧词',
      'subtitle', '英语 · 单词',
      'time', '07:30',
      'increments', jsonb_build_object('eng_w', 50)
    ),
    'd_math', jsonb_build_object(
      'title', '660题完成 25 题并标记错因',
      'subtitle', '数学 · 高数',
      'time', '08:00',
      'increments', jsonb_build_object('math_h', 25)
    ),
    'd_read', jsonb_build_object(
      'title', '精读 1 篇真题阅读',
      'subtitle', '英语 · 阅读',
      'time', '10:15',
      'increments', jsonb_build_object('eng_r', 1)
    ),
    'd_ctl', jsonb_build_object(
      'title', '学习教材 18 页并完成 5 道题',
      'subtitle', '822 · 教材与习题',
      'time', '14:00',
      'increments', jsonb_build_object('ctl_b', 18, 'ctl_q', 5)
    ),
    'd_pol', jsonb_build_object(
      'title', '听 1 节课程并做 20 道选择题',
      'subtitle', '政治',
      'time', '16:00',
      'increments', jsonb_build_object('pol_c', 1, 'pol_q', 20)
    ),
    'd_review', jsonb_build_object(
      'title', '整理错题与明日计划',
      'subtitle', '复盘',
      'time', '20:30',
      'increments', '{}'::jsonb
    )
  );
$$;

create or replace function public.safe_daily_task_integer(
  p_value text,
  p_fallback integer
)
returns integer
language plpgsql
immutable
security invoker
set search_path = public
as $$
declare
  v_value numeric;
begin
  if p_value is null or p_value !~ '^\d{1,6}$' then
    return greatest(0, least(100000, coalesce(p_fallback, 0)));
  end if;

  v_value := p_value::numeric;
  return greatest(0, least(100000, round(v_value)::integer));
exception
  when others then
    return greatest(0, least(100000, coalesce(p_fallback, 0)));
end;
$$;

create or replace function public.normalize_daily_task_item(
  p_config jsonb,
  p_task_key text,
  p_default jsonb
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = public
as $$
declare
  v_item jsonb := coalesce(p_config -> p_task_key, '{}'::jsonb);
  v_title text;
  v_subtitle text;
  v_time text;
  v_metric text;
  v_default_value jsonb;
  v_increments jsonb := '{}'::jsonb;
  v_amount integer;
begin
  if jsonb_typeof(v_item) <> 'object' then
    v_item := '{}'::jsonb;
  end if;

  v_title := nullif(btrim(v_item ->> 'title'), '');
  v_subtitle := nullif(btrim(v_item ->> 'subtitle'), '');
  v_time := nullif(btrim(v_item ->> 'time'), '');

  v_title := left(coalesce(v_title, p_default ->> 'title'), 120);
  v_subtitle := left(coalesce(v_subtitle, p_default ->> 'subtitle'), 120);

  if v_time is null or v_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    v_time := p_default ->> 'time';
  end if;

  for v_metric, v_default_value in
    select key, value
    from jsonb_each(coalesce(p_default -> 'increments', '{}'::jsonb))
  loop
    v_amount := public.safe_daily_task_integer(
      v_item #>> array['increments', v_metric],
      (v_default_value::text)::integer
    );

    v_increments := jsonb_set(
      v_increments,
      array[v_metric],
      to_jsonb(v_amount),
      true
    );
  end loop;

  return jsonb_build_object(
    'title', v_title,
    'subtitle', v_subtitle,
    'time', v_time,
    'increments', v_increments
  );
end;
$$;

create or replace function public.normalize_daily_task_config(p_config jsonb)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = public
as $$
declare
  v_source jsonb := coalesce(p_config, '{}'::jsonb);
  v_defaults jsonb := public.daily_task_default_config();
  v_result jsonb := '{}'::jsonb;
  v_task_key text;
  v_default jsonb;
begin
  if jsonb_typeof(v_source) <> 'object' then
    v_source := '{}'::jsonb;
  end if;

  for v_task_key, v_default in
    select key, value
    from jsonb_each(v_defaults)
  loop
    v_result := jsonb_set(
      v_result,
      array[v_task_key],
      public.normalize_daily_task_item(v_source, v_task_key, v_default),
      true
    );
  end loop;

  return v_result;
end;
$$;

create or replace function public.daily_task_progress_delta(
  p_state jsonb,
  p_task_key text
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = public
as $$
declare
  v_config jsonb;
begin
  v_config := public.normalize_daily_task_config(
    coalesce(p_state, '{}'::jsonb) -> 'dailyTaskConfig'
  );

  return coalesce(v_config #> array[p_task_key, 'increments'], '{}'::jsonb);
end;
$$;

create or replace function public.apply_dashboard_progress_delta(
  p_state jsonb,
  p_delta jsonb,
  p_direction integer
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = public
as $$
declare
  v_state jsonb := coalesce(p_state, '{}'::jsonb);
  v_metrics jsonb := coalesce(v_state -> 'metrics', '{}'::jsonb);
  v_metric_key text;
  v_amount_text text;
  v_amount integer;
  v_metric jsonb;
  v_done_text text;
  v_done numeric;
  v_next numeric;
begin
  if p_direction not in (-1, 1) then
    raise exception 'Progress direction must be -1 or 1.';
  end if;

  if jsonb_typeof(coalesce(p_delta, '{}'::jsonb)) <> 'object' then
    return v_state;
  end if;

  for v_metric_key, v_amount_text in
    select key, value
    from jsonb_each_text(coalesce(p_delta, '{}'::jsonb))
  loop
    if v_metric_key not in (
      'math_h', 'math_l', 'math_p',
      'eng_w', 'eng_r',
      'pol_c', 'pol_q',
      'ctl_b', 'ctl_q'
    ) then
      continue;
    end if;

    v_amount := public.safe_daily_task_integer(v_amount_text, 0);
    v_metric := coalesce(v_metrics -> v_metric_key, '{}'::jsonb);
    v_done_text := v_metric ->> 'done';

    if v_done_text is null
       or v_done_text !~ '^-?[0-9]+([.][0-9]+)?$' then
      v_done := 0;
    else
      v_done := v_done_text::numeric;
    end if;

    v_next := greatest(0, v_done + p_direction * v_amount);
    v_metric := jsonb_set(v_metric, array['done'], to_jsonb(v_next), true);
    v_metrics := jsonb_set(v_metrics, array[v_metric_key], v_metric, true);
  end loop;

  return jsonb_set(v_state, array['metrics'], v_metrics, true);
end;
$$;

create or replace function public.prepare_task_submission_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state jsonb;
begin
  if new.task_type = 'weekly' then
    new.progress_delta := '{}'::jsonb;
    return new;
  end if;

  if new.task_type <> 'daily' then
    return new;
  end if;

  if new.status = 'pending' then
    if tg_op = 'INSERT'
       or (
         tg_op = 'UPDATE'
         and (
           old.status is distinct from new.status
           or old.task_key is distinct from new.task_key
         )
       ) then
      select state
      into v_state
      from public.study_dashboard
      where id = 'main';

      new.progress_delta := public.daily_task_progress_delta(v_state, new.task_key);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists task_submissions_prepare_progress_insert
  on public.task_submissions;
create trigger task_submissions_prepare_progress_insert
before insert on public.task_submissions
for each row execute function public.prepare_task_submission_progress();

drop trigger if exists task_submissions_prepare_progress_update
  on public.task_submissions;
create trigger task_submissions_prepare_progress_update
before update of status, task_type, task_key on public.task_submissions
for each row execute function public.prepare_task_submission_progress();

update public.task_submissions as submission
set progress_delta = public.daily_task_progress_delta(dashboard.state, submission.task_key)
from public.study_dashboard as dashboard
where dashboard.id = 'main'
  and submission.task_type = 'daily'
  and (
    submission.progress_delta = '{}'::jsonb
    or jsonb_typeof(submission.progress_delta) <> 'object'
  );

update public.task_submissions
set progress_delta = '{}'::jsonb
where task_type = 'weekly'
  and progress_delta <> '{}'::jsonb;

create or replace function public.update_daily_task_config(p_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state jsonb;
  v_normalized jsonb;
begin
  if not public.is_owner() then
    raise exception '只有管理员可以修改每日任务设置。';
  end if;

  v_normalized := public.normalize_daily_task_config(p_config);

  select state
  into v_state
  from public.study_dashboard
  where id = 'main'
  for update;

  if not found then
    raise exception '学习看板主记录不存在。';
  end if;

  v_state := jsonb_set(
    coalesce(v_state, '{}'::jsonb),
    array['dailyTaskConfig'],
    v_normalized,
    true
  );

  update public.study_dashboard
  set state = v_state,
      updated_by = auth.uid(),
      updated_at = now()
  where id = 'main';

  return v_state;
end;
$$;

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
  v_applied_group jsonb;
  v_applied_period jsonb;
  v_delta jsonb;
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
      v_delta := coalesce(v_submission.progress_delta, '{}'::jsonb);
      if jsonb_typeof(v_delta) <> 'object' or v_delta = '{}'::jsonb then
        v_delta := public.daily_task_progress_delta(v_state, v_submission.task_key);
        update public.task_submissions
        set progress_delta = v_delta
        where id = v_submission.id
        returning * into v_submission;
      end if;

      v_state := public.apply_dashboard_progress_delta(v_state, v_delta, 1);

      v_applied_group := coalesce(v_state -> 'dailyApplied', '{}'::jsonb);
      v_applied_period := coalesce(
        v_applied_group -> v_submission.period_key,
        '{}'::jsonb
      );
      v_applied_period := jsonb_set(
        v_applied_period,
        array[v_submission.task_key],
        v_delta,
        true
      );
      v_applied_group := jsonb_set(
        v_applied_group,
        array[v_submission.period_key],
        v_applied_period,
        true
      );
      v_state := jsonb_set(
        v_state,
        array['dailyApplied'],
        v_applied_group,
        true
      );
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

create or replace function public.revoke_task_completion(
  p_submission_id uuid,
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
  v_group jsonb;
  v_period jsonb;
  v_applied_group jsonb;
  v_applied_period jsonb;
  v_delta jsonb;
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
    raise exception '只能撤销已通过的任务。';
  end if;

  select state
  into v_state
  from public.study_dashboard
  where id = 'main'
  for update;

  v_state := coalesce(v_state, '{}'::jsonb);

  if v_submission.task_type = 'daily' then
    v_delta := v_state #> array[
      'dailyApplied',
      v_submission.period_key,
      v_submission.task_key
    ];

    if jsonb_typeof(coalesce(v_delta, '{}'::jsonb)) <> 'object'
       or coalesce(v_delta, '{}'::jsonb) = '{}'::jsonb then
      v_delta := coalesce(v_submission.progress_delta, '{}'::jsonb);
    end if;

    if jsonb_typeof(coalesce(v_delta, '{}'::jsonb)) <> 'object'
       or coalesce(v_delta, '{}'::jsonb) = '{}'::jsonb then
      v_delta := public.daily_task_progress_delta(v_state, v_submission.task_key);
    end if;

    v_state := public.apply_dashboard_progress_delta(v_state, v_delta, -1);

    v_group := coalesce(v_state -> 'daily', '{}'::jsonb);
    v_period := coalesce(v_group -> v_submission.period_key, '{}'::jsonb);
    v_period := jsonb_set(
      v_period,
      array[v_submission.task_key],
      'false'::jsonb,
      true
    );
    v_group := jsonb_set(
      v_group,
      array[v_submission.period_key],
      v_period,
      true
    );
    v_state := jsonb_set(v_state, array['daily'], v_group, true);

    v_applied_group := coalesce(v_state -> 'dailyApplied', '{}'::jsonb);
    v_applied_period := coalesce(
      v_applied_group -> v_submission.period_key,
      '{}'::jsonb
    ) - v_submission.task_key;
    v_applied_group := jsonb_set(
      v_applied_group,
      array[v_submission.period_key],
      v_applied_period,
      true
    );
    v_state := jsonb_set(
      v_state,
      array['dailyApplied'],
      v_applied_group,
      true
    );
  else
    v_group := coalesce(v_state -> 'weekly', '{}'::jsonb);
    v_period := coalesce(v_group -> v_submission.period_key, '{}'::jsonb);
    v_period := jsonb_set(
      v_period,
      array[v_submission.task_key],
      'false'::jsonb,
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

  update public.task_submissions
  set status = 'rejected',
      review_note = coalesce(
        nullif(btrim(coalesce(p_review_note, '')), ''),
        '管理员撤销审核'
      ),
      points_awarded = 0,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now()
  where id = p_submission_id
  returning * into v_submission;

  return v_submission;
end;
$$;

revoke all on function public.daily_task_default_config() from public;
revoke all on function public.safe_daily_task_integer(text, integer) from public;
revoke all on function public.normalize_daily_task_item(jsonb, text, jsonb) from public;
revoke all on function public.normalize_daily_task_config(jsonb) from public;
revoke all on function public.daily_task_progress_delta(jsonb, text) from public;
revoke all on function public.apply_dashboard_progress_delta(jsonb, jsonb, integer) from public;
revoke all on function public.prepare_task_submission_progress() from public;
revoke all on function public.update_daily_task_config(jsonb) from public;
revoke all on function public.review_task_completion(uuid, text, text) from public;
revoke all on function public.revoke_task_completion(uuid, text) from public;

grant execute on function public.update_daily_task_config(jsonb) to authenticated;
grant execute on function public.review_task_completion(uuid, text, text) to authenticated;
grant execute on function public.revoke_task_completion(uuid, text) to authenticated;

commit;
