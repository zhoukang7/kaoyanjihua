-- 新增线代、概率论每日任务
-- 执行前必须先执行 supabase-daily-task-settings.sql。
-- 本脚本可重复执行，不会清空学习进度、评论或审核记录。

begin;

do $$
begin
  if to_regprocedure('public.normalize_daily_task_config(jsonb)') is null
     or to_regprocedure('public.daily_task_progress_delta(jsonb,text)') is null then
    raise exception '请先完整执行 supabase-daily-task-settings.sql，再执行本脚本。';
  end if;
end
$$;

alter table public.task_submissions
  drop constraint if exists task_submissions_valid_task;

alter table public.task_submissions
  add constraint task_submissions_valid_task check (
    (task_type = 'daily' and task_key in (
      'd_words',
      'd_math',
      'd_linear',
      'd_probability',
      'd_read',
      'd_ctl',
      'd_pol',
      'd_review'
    ))
    or
    (task_type = 'weekly' and task_key in (
      'w_math', 'w_eng', 'w_pol', 'w_ctl', 'w_review'
    ))
  );

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
    'd_linear', jsonb_build_object(
      'title', '线代完成 20 题并整理公式',
      'subtitle', '数学 · 线代',
      'time', '09:00',
      'increments', jsonb_build_object('math_l', 20)
    ),
    'd_probability', jsonb_build_object(
      'title', '概率论完成 20 题并总结题型',
      'subtitle', '数学 · 概率论',
      'time', '09:45',
      'increments', jsonb_build_object('math_p', 20)
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

update public.study_dashboard
set state = jsonb_set(
      coalesce(state, '{}'::jsonb),
      array['dailyTaskConfig'],
      public.normalize_daily_task_config(
        coalesce(state -> 'dailyTaskConfig', '{}'::jsonb)
      ),
      true
    ),
    updated_at = now()
where id = 'main';

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
       'd_words',
       'd_math',
       'd_linear',
       'd_probability',
       'd_read',
       'd_ctl',
       'd_pol',
       'd_review'
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

revoke all on function public.daily_task_default_config() from public;
revoke all on function public.submit_task_completion(text, text, text) from public;
grant execute on function public.submit_task_completion(text, text, text) to authenticated;

commit;
