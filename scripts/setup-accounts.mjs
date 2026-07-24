import { createClient } from "@supabase/supabase-js";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量：${name}`);
  return value;
};

const url = required("SUPABASE_URL");
const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
const domain = (process.env.LOGIN_EMAIL_DOMAIN || "study822.example.com").trim().toLowerCase();

const accounts = [
  {
    username: "admin",
    password: required("STUDY_ADMIN_PASSWORD"),
    role: "owner",
    displayName: "最高管理员"
  },
  {
    username: "user_1",
    password: required("STUDY_USER1_PASSWORD"),
    role: "viewer",
    displayName: "查看用户 1"
  },
  {
    username: "user_2",
    password: required("STUDY_USER2_PASSWORD"),
    role: "viewer",
    displayName: "查看用户 2"
  }
];

const supabase = createClient(url, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false
  }
});

async function findUserByEmail(email) {
  let page = 1;
  while (page <= 100) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (data.users.length < 1000) return null;
    page += 1;
  }
  throw new Error("用户数量过多，未能完成账号检索。");
}

async function upsertAuthUser(account) {
  const email = `${account.username}@${domain}`;
  let user = await findUserByEmail(email);

  if (!user) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: account.password,
      email_confirm: true,
      user_metadata: {
        username: account.username,
        display_name: account.displayName
      }
    });
    if (error) throw error;
    user = data.user;
    console.log(`已创建账号：${account.username}`);
  } else {
    const { data, error } = await supabase.auth.admin.updateUserById(user.id, {
      password: account.password,
      user_metadata: {
        ...(user.user_metadata || {}),
        username: account.username,
        display_name: account.displayName
      }
    });
    if (error) throw error;
    user = data.user;
    console.log(`已更新账号：${account.username}`);
  }

  return user;
}

async function setProfile(user, account) {
  const { error } = await supabase.from("profiles").upsert({
    id: user.id,
    role: account.role,
    username: account.username,
    display_name: account.displayName
  });
  if (error) throw error;
}

async function main() {
  const resolved = [];
  for (const account of accounts) {
    const user = await upsertAuthUser(account);
    resolved.push({ user, account });
  }

  const admin = resolved.find(({ account }) => account.role === "owner");
  const { error: downgradeError } = await supabase
    .from("profiles")
    .update({ role: "viewer" })
    .eq("role", "owner")
    .neq("id", admin.user.id);
  if (downgradeError) throw downgradeError;

  for (const item of resolved) await setProfile(item.user, item.account);

  console.log("\n账号初始化完成：");
  for (const { account } of resolved) {
    console.log(`- ${account.username}: ${account.role}`);
  }
  console.log("密码仅从环境变量读取，未写入仓库文件。");
}

main().catch((error) => {
  console.error("账号初始化失败：", error.message || error);
  process.exitCode = 1;
});
