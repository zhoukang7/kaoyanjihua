(() => {
  const config = window.STUDY_APP_CONFIG || {};
  if (!window.supabase || !config.supabaseUrl || !config.supabasePublishableKey) return;

  const client = window.getStudySupabaseClient
    ? window.getStudySupabaseClient()
    : window.supabase.createClient(
        config.supabaseUrl,
        config.supabasePublishableKey,
        { auth: { persistSession: true, autoRefreshToken: true } }
      );

  const defaults = [
    { key: "w_math", title: "数学完成 150 道强化题", subtitle: "高数、线代、概率论" },
    { key: "w_eng", title: "精读 6 篇英语真题阅读", subtitle: "翻译、错因、生词" },
    { key: "w_pol", title: "完成马原第一章及配套题", subtitle: "周日复盘" },
    { key: "w_ctl", title: "完成 822 教材第一、二章", subtitle: "建立公式框架" },
    { key: "w_review", title: "完成一次全科周复盘", subtitle: "制定下周计划" }
  ];

  let profile = null;
  let state = {};
  let realtimeChannel = null;
  let observer = null;
  let observerTimer = null;
  let toastTimer = null;
  let saving = false;

  const q = (id) => document.getElementById(id);
  const isOwner = () => profile?.role === "owner";
  const cleanText = (value, fallback, max = 120) => {
    const text = typeof value === "string" ? value.trim() : "";
    return (text || fallback)
      .replaceAll("<", "＜")
      .replaceAll(">", "＞")
      .slice(0, max);
  };

  function makeNode(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function notify(message, kind = "info") {
    let toast = q("weeklyTaskSettingsToast");
    if (!toast) {
      toast = makeNode("div", "weekly-task-settings-toast");
      toast.id = "weeklyTaskSettingsToast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.appendChild(toast);
    }
    clearTimeout(toastTimer);
    toast.dataset.kind = kind;
    toast.textContent = message;
    toast.classList.add("show");
    toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
  }

  function configuredTask(task) {
    const item =
      state?.weeklyTaskConfig &&
      typeof state.weeklyTaskConfig === "object" &&
      !Array.isArray(state.weeklyTaskConfig)
        ? state.weeklyTaskConfig[task.key] || {}
        : {};
    return {
      key: task.key,
      title: cleanText(item.title, task.title),
      subtitle: cleanText(item.subtitle, task.subtitle)
    };
  }

  function currentTasks() {
    return defaults.map(configuredTask);
  }

  function publishTasks() {
    const tasks = currentTasks();
    window.STUDY_WEEKLY_TASKS = tasks.map((task) => ({
      key: task.key,
      label: task.title,
      subtitle: task.subtitle
    }));
    document.dispatchEvent(
      new CustomEvent("study:weekly-task-config", { detail: window.STUDY_WEEKLY_TASKS })
    );
    applyDashboardLabels(tasks);
  }

  function applyDashboardLabels(tasks = currentTasks()) {
    const byKey = new Map(tasks.map((task) => [task.key, task]));
    document.querySelectorAll("#weekly .task").forEach((row) => {
      const input = row.querySelector('input[data-w]');
      const task = input ? byKey.get(input.dataset.w) : null;
      if (!task) return;
      const title = row.querySelector("strong");
      const subtitle = row.querySelector("small");
      if (title && title.textContent !== task.title) title.textContent = task.title;
      if (subtitle && subtitle.textContent !== task.subtitle) subtitle.textContent = task.subtitle;
    });
  }

  function createField(labelText, taskKey, field, value) {
    const label = makeNode("label", "weekly-task-settings-field");
    const name = makeNode("span", "", labelText);
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 120;
    input.value = value;
    input.dataset.taskKey = taskKey;
    input.dataset.field = field;
    label.append(name, input);
    return label;
  }

  function createTaskCard(task) {
    const configured = configuredTask(task);
    const card = makeNode("article", "weekly-task-settings-card");
    card.dataset.taskKey = task.key;

    const head = makeNode("div", "weekly-task-settings-card-head");
    head.append(
      makeNode("strong", "", configured.title),
      makeNode("small", "", `固定编号：${task.key}`)
    );

    const fields = makeNode("div", "weekly-task-settings-fields");
    fields.append(
      createField("任务文字", task.key, "title", configured.title),
      createField("任务说明", task.key, "subtitle", configured.subtitle)
    );

    card.append(head, fields);
    return card;
  }

  function mount() {
    if (q("weeklyTaskSettingsSection")) return;

    const section = makeNode("section", "weekly-task-settings-section hidden");
    section.id = "weeklyTaskSettingsSection";

    const head = makeNode("div", "weekly-task-settings-head");
    const intro = makeNode("div");
    intro.append(
      makeNode("h2", "", "每周任务设置"),
      makeNode(
        "p",
        "",
        "管理员只修改每周任务的文字与说明；完成每周任务不会增加四科学习总量，也不会自动发放积分。"
      )
    );
    head.append(intro, makeNode("span", "weekly-task-settings-badge", "管理员专用"));

    const notice = makeNode(
      "div",
      "weekly-task-settings-notice",
      "每周任务用于记录完成情况和作为积分发放参考。修改文字不会改变历史完成状态或审核记录。"
    );

    const grid = makeNode("div", "weekly-task-settings-grid");
    grid.id = "weeklyTaskSettingsGrid";

    const actions = makeNode("div", "weekly-task-settings-actions");
    const saveButton = makeNode("button", "weekly-task-settings-primary", "保存每周任务设置");
    saveButton.id = "saveWeeklyTaskSettings";
    saveButton.type = "button";
    saveButton.addEventListener("click", saveSettings);
    actions.appendChild(saveButton);

    section.append(head, notice, grid, actions);

    const dailySettings = q("dailyTaskSettingsSection");
    const reviewSection = q("taskReviewSection");
    const taskSection = q("weekly")?.closest(".section");
    if (dailySettings?.parentElement) {
      dailySettings.insertAdjacentElement("afterend", section);
    } else if (reviewSection?.parentElement) {
      reviewSection.parentElement.insertBefore(section, reviewSection);
    } else if (taskSection) {
      taskSection.insertAdjacentElement("afterend", section);
    } else {
      q("app")?.appendChild(section);
    }
  }

  function renderSettings() {
    mount();
    const section = q("weeklyTaskSettingsSection");
    const grid = q("weeklyTaskSettingsGrid");
    if (!section || !grid) return;
    section.classList.toggle("hidden", !isOwner());
    if (!isOwner()) {
      grid.replaceChildren();
      return;
    }
    grid.replaceChildren(...defaults.map(createTaskCard));
  }

  function collectSettings() {
    const result = {};
    defaults.forEach((task) => {
      const card = document.querySelector(
        `.weekly-task-settings-card[data-task-key="${task.key}"]`
      );
      if (!card) return;
      const title = card.querySelector('[data-field="title"]')?.value;
      const subtitle = card.querySelector('[data-field="subtitle"]')?.value;
      result[task.key] = {
        title: cleanText(title, task.title),
        subtitle: cleanText(subtitle, task.subtitle)
      };
    });
    return result;
  }

  async function saveSettings() {
    if (!isOwner() || saving) return;
    saving = true;
    const button = q("saveWeeklyTaskSettings");
    if (button) button.disabled = true;

    const { data, error } = await client.rpc("update_weekly_task_config", {
      p_config: collectSettings()
    });

    saving = false;
    if (button) button.disabled = false;

    if (error) {
      const message = String(error.message || "");
      if (
        message.includes("Could not find the function") ||
        message.includes("update_weekly_task_config")
      ) {
        notify("请先在 Supabase SQL Editor 执行 supabase-weekly-task-settings.sql", "error");
      } else {
        notify(message || "每周任务设置保存失败", "error");
      }
      return;
    }

    if (data && typeof data === "object") state = data;
    publishTasks();
    renderSettings();
    notify("每周任务设置已保存并同步", "success");
  }

  async function loadState() {
    const { data, error } = await client
      .from("study_dashboard")
      .select("state")
      .eq("id", "main")
      .single();
    if (error) {
      notify(error.message, "error");
      return;
    }
    state = data?.state && typeof data.state === "object" ? data.state : {};
    publishTasks();
    renderSettings();
  }

  function observeDashboard() {
    if (!observer) {
      observer = new MutationObserver(() => {
        clearTimeout(observerTimer);
        observerTimer = setTimeout(() => applyDashboardLabels(), 40);
      });
    }
    observer.disconnect();
    observer.observe(document.body, { childList: true, subtree: true });
  }

  async function initialize(session) {
    profile = null;
    state = {};
    if (realtimeChannel) {
      client.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }

    if (!session) {
      q("weeklyTaskSettingsSection")?.classList.add("hidden");
      return;
    }

    const { data, error } = await client
      .from("profiles")
      .select("role,username")
      .eq("id", session.user.id)
      .single();
    if (error) {
      notify(error.message, "error");
      return;
    }

    profile = data;
    await loadState();

    realtimeChannel = client
      .channel("weekly-task-settings-ui")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "study_dashboard", filter: "id=eq.main" },
        (payload) => {
          state =
            payload.new?.state && typeof payload.new.state === "object"
              ? payload.new.state
              : {};
          publishTasks();
          renderSettings();
        }
      )
      .subscribe();
  }

  function start() {
    mount();
    observeDashboard();
    client.auth.getSession().then(({ data }) => initialize(data.session));
    client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        setTimeout(() => initialize(session), 0);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
