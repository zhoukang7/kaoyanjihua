-- 管理员可编辑每周任务文字与说明
-- 每周任务只记录完成状态，不增加四科学习进度，也不自动发放积分。
-- 本脚本可重复执行，不会清空已有任务、积分、评论或学习进度。

begin;

do $$
begin
  if to_regprocedure('public.is_owner()') is null then
    raise exception '请先执行最新版 supabase.sql，再执行本脚本。';
  end if;
end
$$;

create or replace function public.weekly_task_default_config()
returns jsonb
language sql
immutable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'w_math', jsonb_build_object(
      'title', '数学完成 150 道强化题',
      'subtitle', '高数、线代、概率论'
    ),
    'w_eng', jsonb_build_object(
      'title', '精读 6 篇英语真题阅读',
      'subtitle', '翻译、错因、生词'
    ),
    'w_pol', jsonb_build_object(
      'title', '完成马原第一章及配套题',
      'subtitle', '周日复盘'
    ),
    'w_ctl', jsonb_build_object(
      'title', '完成 822 教材第一、二章',
      'subtitle', '建立公式框架'
    ),
    'w_review', jsonb_build_object(
      'title', '完成一次全科周复盘',
      'subtitle', '制定下周计划'
    )
  );
$$;

create or replace function public.normalize_weekly_task_config(p_config jsonb)
returns jsonb
language sql
immutable
security invoker
set search_path = public
as $$
  with source as (
    select case
      when jsonb_typeof(coalesce(p_config, '{}'::jsonb)) = 'object'
        then coalesce(p_config, '{}'::jsonb)
      else '{}'::jsonb
    end as value
  ),
  defaults as (
    select public.weekly_task_default_config() as value
  )
  select jsonb_build_object(
    'w_math', jsonb_build_object(
      'title', left(replace(replace(coalesce(nullif(btrim(source.value #>> '{w_math,title}'), ''), defaults.value #>> '{w_math,title}'), '<', '＜'), '>', '＞'), 120),
      'subtitle', left(replace(replace(coalesce(nullif(btrim(source.value #>> '{w_math,subtitle}'), ''), defaults.value #>> '{w_math,subtitle}'), '<', '＜'), '>', '＞'), 120)
    ),
    'w_eng', jsonb_build_object(
      'title', left(replace(replace(coalesce(nullif(btrim(source.value #>> '{w_eng,title}'), ''), defaults.value #>> '{w_eng,title}'), '<', '＜'), '>', '＞'), 120),
      'subtitle', left(replace(replace(coalesce(nullif(btrim(source.value #>> '{w_eng,subtitle}'), ''), defaults.value #>> '{w_eng,subtitle}'), '<', '＜'), '>', '＞'), 120)
    ),
    'w_pol', jsonb_build_object(
      'title', left(replace(replace(coalesce(nullif(btrim(source.value #>> '{w_pol,title}'), ''), defaults.value #>> '{w_pol,title}'), '<', '＜'), '>', '＞'), 120),
      'subtitle', left(replace(replace(coalesce(nullif(btrim(source.value #>> '{w_pol,subtitle}'), ''), defaults.value #>> '{w_pol,subtitle}'), '<', '＜'), '>', '＞'), 120)
    ),
    'w_ctl', jsonb_build_object(
      'title', left(replace(replace(coalesce(nullif(btrim(source.value #>> '{w_ctl,title}'), ''), defaults.value #>> '{w_ctl,title}'), '<', '＜'), '>', '＞'), 120),
      'subtitle', left(replace(replace(coalesce(nullif(btrim(source.value #>> '{w_ctl,subtitle}'), ''), defaults.value #>> '{w_ctl,subtitle}'), '<', '＜'), '>', '＞'), 120)
    ),
    'w_review', jsonb_build_object(
      'title', left(replace(replace(coalesce(nullif(btrim(source.value #>> '{w_review,title}'), ''), defaults.value #>> '{w_review,title}'), '<', '＜'), '>', '＞'), 120),
      'subtitle', left(replace(replace(coalesce(nullif(btrim(source.value #>> '{w_review,subtitle}'), ''), defaults.value #>> '{w_review,subtitle}'), '<', '＜'), '>', '＞'), 120)
    )
  )
  from source, defaults;
$$;

update public.study_dashboard
set state = jsonb_set(
      coalesce(state, '{}'::jsonb),
      array['weeklyTaskConfig'],
      public.normalize_weekly_task_config(
        coalesce(state -> 'weeklyTaskConfig', '{}'::jsonb)
      ),
      true
    )
where id = 'main';

create or replace function public.update_weekly_task_config(p_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config jsonb;
  v_state jsonb;
begin
  if not public.is_owner() then
    raise exception '只有管理员可以修改每周任务设置。';
  end if;

  v_config := public.normalize_weekly_task_config(p_config);

  update public.study_dashboard
  set state = jsonb_set(
        coalesce(state, '{}'::jsonb),
        array['weeklyTaskConfig'],
        v_config,
        true
      ),
      updated_by = auth.uid()
  where id = 'main'
  returning state into v_state;

  if not found then
    raise exception '未找到主学习看板数据。';
  end if;

  return v_state;
end;
$$;

revoke all on function public.weekly_task_default_config() from public;
revoke all on function public.normalize_weekly_task_config(jsonb) from public;
revoke all on function public.update_weekly_task_config(jsonb) from public;

grant execute on function public.weekly_task_default_config() to authenticated;
grant execute on function public.normalize_weekly_task_config(jsonb) to authenticated;
grant execute on function public.update_weekly_task_config(jsonb) to authenticated;

commit;
