-- 研程 · 822 数据安全备份导出
--
-- 使用位置：Supabase Dashboard -> SQL Editor -> New query
-- 使用方法：完整运行本文件。结果只返回一行，不会修改数据库。
-- 运行后，在结果表右上角选择 Download CSV，文件建议命名为：
--   kaoyanjihua-backup-YYYY-MM-DD.csv
--
-- 重要安全提示：
-- 1. 导出文件包含学习记录、评论、任务、积分和用户 UUID，属于私密数据。
-- 2. 不要把真实导出文件提交到公开 GitHub 仓库，也不要发送给无关人员。
-- 3. 本备份不包含 auth.users 中的密码、密码哈希、登录令牌或 Supabase 密钥。
-- 4. 该备份主要用于当前项目的数据核对、离线保存和同项目恢复准备。

with backup_payload as (
  select jsonb_build_object(
    'format_version', 1,
    'generated_at', now(),
    'project_ref', 'eqmbaniswzugtusytjvc',
    'notice', 'Private study dashboard backup. Do not publish.',
    'tables', jsonb_build_object(
      'profiles', coalesce(
        (
          select jsonb_agg(to_jsonb(t) order by t.created_at, t.id)
          from public.profiles as t
        ),
        '[]'::jsonb
      ),
      'study_dashboard', coalesce(
        (
          select jsonb_agg(to_jsonb(t) order by t.updated_at, t.id)
          from public.study_dashboard as t
        ),
        '[]'::jsonb
      ),
      'comments', coalesce(
        (
          select jsonb_agg(to_jsonb(t) order by t.created_at, t.id)
          from public.comments as t
        ),
        '[]'::jsonb
      ),
      'task_submissions', coalesce(
        (
          select jsonb_agg(to_jsonb(t) order by t.submitted_at, t.id)
          from public.task_submissions as t
        ),
        '[]'::jsonb
      ),
      'point_ledger', coalesce(
        (
          select jsonb_agg(to_jsonb(t) order by t.created_at, t.id)
          from public.point_ledger as t
        ),
        '[]'::jsonb
      ),
      'point_redemptions', coalesce(
        (
          select jsonb_agg(to_jsonb(t) order by t.submitted_at, t.id)
          from public.point_redemptions as t
        ),
        '[]'::jsonb
      )
    )
  ) as payload
),
backup_result as (
  select
    payload,
    jsonb_build_object(
      'profiles', jsonb_array_length(payload #> '{tables,profiles}'),
      'study_dashboard', jsonb_array_length(payload #> '{tables,study_dashboard}'),
      'comments', jsonb_array_length(payload #> '{tables,comments}'),
      'task_submissions', jsonb_array_length(payload #> '{tables,task_submissions}'),
      'point_ledger', jsonb_array_length(payload #> '{tables,point_ledger}'),
      'point_redemptions', jsonb_array_length(payload #> '{tables,point_redemptions}')
    ) as row_counts
  from backup_payload
)
select
  payload as backup_json,
  encode(digest(payload::text, 'sha256'), 'hex') as sha256,
  row_counts
from backup_result;
