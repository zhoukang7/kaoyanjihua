# 研程 · 822 共享学习看板

这是一个静态网页 + Supabase 的私人学习看板：

- `admin`：唯一最高管理员，可以勾选任务、调整进度、重置数据和导出记录。
- `user_1`、`user_2`：只读账号，只能查看学习情况。
- 登录页使用用户名，不要求查看者输入邮箱。
- 数据保存在 Supabase，管理员更新后，查看者会实时看到变化。
- 可通过 GitHub Pages 自动获得分享链接。

## 安全原则

账号密码不会写入 `index.html`、`config.js` 或 Git 仓库。账号初始化脚本只从环境变量或 GitHub Secrets 读取密码。Supabase `service_role` 只允许在服务端脚本或 GitHub Actions 中使用，绝不能放进浏览器端。

正式公开链接前，建议将查看账号密码改为至少 10 位、包含字母和数字的密码。

## 一、准备 Supabase

1. 创建 Supabase 项目。
2. 打开 **SQL Editor**，完整执行 `supabase.sql`。
3. 打开项目的 API Keys 页面，准备：
   - Project URL
   - Publishable Key
   - `service_role` Secret Key
4. 在 Authentication 设置中关闭公开注册。账号只通过管理员脚本创建。

登录名会映射成内部邮箱，例如：

```text
admin  -> admin@study822.example.com
user_1 -> user_1@study822.example.com
user_2 -> user_2@study822.example.com
```

这个邮箱仅作为 Supabase Auth 的内部标识，用户登录时仍只输入用户名。

## 二、通过 GitHub 创建账号

把项目上传至 GitHub 仓库后，进入：

**Settings → Secrets and variables → Actions**

创建以下 Repository secrets：

| Secret | 内容 |
|---|---|
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase Publishable Key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase `service_role` Secret Key |
| `STUDY_ADMIN_PASSWORD` | admin 的密码 |
| `STUDY_USER1_PASSWORD` | user_1 的密码 |
| `STUDY_USER2_PASSWORD` | user_2 的密码 |

再创建一个 Repository variable：

| Variable | 内容 |
|---|---|
| `LOGIN_EMAIL_DOMAIN` | `study822.example.com` |

随后进入 **Actions → Initialize study accounts → Run workflow**。

该工作流可以重复运行：

- 账号不存在时自动创建。
- 账号已存在时更新密码和显示名称。
- 自动把 `admin` 设置为唯一 `owner`。
- 自动把 `user_1`、`user_2` 设置为 `viewer`。

## 三、通过 GitHub Pages 发布

1. 进入仓库 **Settings → Pages**。
2. 将 Source 选择为 **GitHub Actions**。
3. 推送代码到 `main` 分支，或在 Actions 中手动运行 **Deploy study dashboard**。
4. 部署完成后，会得到类似下面的地址：

```text
https://你的GitHub用户名.github.io/仓库名称/
```

部署工作流会从 GitHub Secrets 生成线上 `config.js`，不会把真实 Supabase 配置写回仓库。

## 四、本地创建账号（可选）

安装 Node.js 20 或更高版本，然后执行：

```bash
npm install
```

复制 `.env.example` 为 `.env`，填写真实值，再把环境变量加载到终端后运行：

```bash
npm run setup:accounts
```

不要提交 `.env` 文件。

## 五、文件说明

- `index.html`：用户名登录页和共享学习看板。
- `config.js`：本地或 Vercel 部署配置模板。
- `supabase.sql`：数据表、角色、RLS 和实时同步配置。
- `scripts/setup-accounts.mjs`：服务端账号初始化脚本。
- `.github/workflows/setup-accounts.yml`：手动创建或更新三个账号。
- `.github/workflows/deploy-pages.yml`：自动部署到 GitHub Pages。

## 六、权限验证

权限由两层共同保证：

1. 前端对 `viewer` 隐藏或禁用编辑控件。
2. Supabase RLS 只允许 `owner` 更新 `study_dashboard`。

即使查看用户修改浏览器代码或直接调用 API，数据库仍会拒绝写入。
