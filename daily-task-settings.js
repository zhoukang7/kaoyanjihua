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
    {
      key: "d_words",
      title: "背诵 50 个新词并复习旧词",
      subtitle: "英语 · 单词",
      time: "07:30",
      increments: [{ metric: "eng_w", label: "单词数量", unit: "词", value: 50 }]
    },
    {
      key: "d_math",
      title: "660题完成 25 题并标记错因",
      subtitle: "数学 · 高数",
      time: "08:00",
      increments: [{ metric: "math_h", label: "高数题量", unit: "题", value: 25 }]
    },
    {
      key: "d_read",
      title: "精读 1 篇真题阅读",
      subtitle: "英语 · 阅读",
      time: "10:15",
      increments: [{ metric: "eng_r", label: "阅读篇数", unit: "篇", value: 1 }]
    },
    {
      key: "d_ctl",
      title: "学习教材 18 页并完成 5 道题",
      subtitle: "822 · 教材与习题",
      time: "14:00",
      increments: [
        { metric: "ctl_b", label: "教材页数", unit: "页", value: 18 },
        { metric: "ctl_q", label: "习题数量", unit: "题", value: 5 }
      ]
    },
    {
      key: "d_pol",
      title: "听 1 节课程并做 20 道选择题",
      subtitle: "政治",
      time: "16:00",
      increments: [
        { metric: "pol_c", label: "课程节数", unit: "节", value: 1 },
        { metric: "pol_q", label: "选择题数量", unit: "题", value: 20 }
      ]
    },
    {
      key: "d_review",
      title: "整理错题与明日计划",
      subtitle: "复盘",
      time: "20:30",
      increments: []
    }
  ];

  let profile = null;
  let state = {};
  let realtimeChannel = null;
  let toastTimer = null;
  let saving = false;

  const q = (id) => document.getElementById(id);
  const isOwner = () => profile?.role === "owner";
  const clampInteger = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.min(100000, Math.max(0, Math.round(number)))
      : fallback;
  };
  const cleanText = (value, fallback, max = 120) => {
    const text = typeof value === "string" ? value.trim() : "";
    return text ? text.slice(0, max) : fallback;
  };
  const cleanTime = (value, fallback) =>
    typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
      ? value
      : fallback;

  function makeNode(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function notify(message, kind = "info") {
    let toast = q("dailyTaskSettingsToast");
    if (!toast) {
      toast = makeNode("div", "daily-task-settings-toast");
      toast.id = "dailyTaskSettingsToast";
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
      state?.dailyTaskConfig &&
      typeof state.dailyTaskConfig === "object" &&
      !Array.isArray(state.dailyTaskConfig)
        ? state.dailyTaskConfig[task.key] || {}
        : {};
    const savedIncrements =
      item.increments && typeof item.increments === "object" && !Array.isArray(item.increments)
        ? item.increments
        : {};

    return {
      key: task.key,
      title: cleanText(item.title, task.title),
      subtitle: cleanText(item.subtitle, task.subtitle),
      time: cleanTime(item.time, task.time),
      increments: task.increments.map((increment) => ({
        ...increment,
        value: clampInteger(savedIncrements[increment.metric], increment.value)
      }))
    };
  }

  function createLabeledInput(labelText, input) {
    const label = makeNode("label", "daily-task-settings-field");
    const labelName = makeNode("span", "", labelText);
    label.append(labelName, input);
    return label;
  }

  function createTextInput(taskKey, field, value, maxLength) {
    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    input.maxLength = maxLength;
    input.dataset.taskKey = taskKey;
    input.dataset.field = field;
    return input;
  }

  function createTaskCard(task) {
    const configured = configuredTask(task);
    const card = makeNode("article", "daily-task-settings-card");
    card.dataset.taskKey = task.key;

    const heading = makeNode("div", "daily-task-settings-card-head");
    const headingText = makeNode("div");
    headingText.append(
      makeNode("strong", "", configured.title),
      makeNode("small", "", `固定编号：${task.key}`)
    );
    heading.appendChild(headingText);

    const titleInput = createTextInput(task.key, "title", configured.title, 120);
    const subtitleInput = createTextInput(task.key, "subtitle", configured.subtitle, 120);
    const timeInput = document.createElement("input");
    timeInput.type = "time";
    timeInput.value = configured.time;
    timeInput.dataset.taskKey = task.key;
    timeInput.dataset.field = "time";

    const fields = makeNode("div", "daily-task-settings-fields");
    fields.append(
      createLabeledInput("任务文字", titleInput),
      createLabeledInput("分类说明", subtitleInput),
      createLabeledInput("计划时间", timeInput)
    );

    if (configured.increments.length) {
      const quantityGroup = makeNode("div", "daily-task-settings-quantities");
      quantityGroup.appendChild(makeNode("span", "daily-task-settings-quantity-title", "完成后增加进度"));

      configured.increments.forEach((increment) => {
        const row = makeNode("label", "daily-task-settings-quantity");
        const label = makeNode("span", "", increment.label);
        const control = makeNode("span", "daily-task-settings-number");
        const input = document.createElement("input");
        input.type = "number";
        input.min = "0";
        input.max = "100000";
        input.step = "1";
        input.value = String(increment.value);
        input.dataset.taskKey = task.key;
        input.dataset.metric = increment.metric;
        const unit = makeNode("b", "", increment.unit);
        control.append(input, unit);
        row.append(label, control);
        quantityGroup.appendChild(row);
      });

      fields.appendChild(quantityGroup);
    } else {
      fields.appendChild(
        makeNode(
          "p",
          "daily-task-settings-no-progress",
          "该任务只记录完成状态，不增加四科进度。"
        )
      );
    }

    card.append(heading, fields);
    return card;
  }

  function mount() {
    if (q("dailyTaskSettingsSection")) return;

    const section = makeNode("section", "daily-task-settings-section hidden");
    section.id = "dailyTaskSettingsSection";

    const head = makeNode("div", "daily-task-settings-head");
    const intro = makeNode("div");
    intro.append(
      makeNode("h2", "", "每日任务设置"),
      makeNode(
        "p",
        "",
        "管理员可修改任务文字、时间和完成后增加的具体进度。已完成任务撤销时按完成当时的数量回退。"
      )
    );
    const badge = makeNode("span", "daily-task-settings-badge", "管理员专用");
    badge.id = "dailyTaskSettingsBadge";
    head.append(intro, badge);

    const notice = makeNode(
      "div",
      "daily-task-settings-notice",
      "保存后会同步到所有设备。user_1 的任务审核需要先执行仓库中的 Supabase SQL 升级脚本。"
    );
    notice.id = "dailyTaskSettingsNotice";

    const grid = makeNode("div", "daily-task-settings-grid");
    grid.id = "dailyTaskSettingsGrid";

    const actions = makeNode("div", "daily-task-settings-actions");
    const resetButton = makeNode("button", "daily-task-settings-ghost", "恢复默认");
    resetButton.id = "resetDailyTaskSettings";
    resetButton.type = "button";
    const saveButton = makeNode("button", "daily-task-settings-primary", "保存每日任务设置");
    saveButton.id = "saveDailyTaskSettings";
    saveButton.type = "button";
    actions.append(resetButton, saveButton);

    section.append(head, notice, grid, actions);

    const taskContainer = q("daily")?.closest(".section");
    const taskReviewSection = q("taskReviewSection");
    if (taskReviewSection?.parentElement) {
      taskReviewSection.parentElement.insertBefore(section, taskReviewSection);
    } else if (taskContainer) {
      taskContainer.insertAdjacentElement("afterend", section);
    } else {
      q("app")?.appendChild(section);
    }

    saveButton.addEventListener("click", saveSettings);
    resetButton.addEventListener("click", resetSettings);
  }

  function render() {
    mount();
    const section = q("dailyTaskSettingsSection");
    const grid = q("dailyTaskSettingsGrid");
    if (!section || !grid) return;

    section.classList.toggle("hidden", !isOwner());
    if (!isOwner()) {
      grid.replaceChildren();
      return;
    }

    grid.replaceChildren(...defaults.map(createTaskCard));
  }

  function collectSettings(useDefaults = false) {
    const result = {};

    defaults.forEach((task) => {
      if (useDefaults) {
        result[task.key] = {
          title: task.title,
          subtitle: task.subtitle,
          time: task.time,
          increments: Object.fromEntries(
            task.increments.map((increment) => [increment.metric, increment.value])
          )
        };
        return;
      }

      const card = document.querySelector(
        `.daily-task-settings-card[data-task-key="${task.key}"]`
      );
      if (!card) return;

      const title = card.querySelector('[data-field="title"]')?.value;
      const subtitle = card.querySelector('[data-field="subtitle"]')?.value;
      const time = card.querySelector('[data-field="time"]')?.value;
      const increments = {};

      task.increments.forEach((increment) => {
        const input = card.querySelector(`[data-metric="${increment.metric}"]`);
        increments[increment.metric] = clampInteger(input?.value, increment.value);
      });

      result[task.key] = {
        title: cleanText(title, task.title),
        subtitle: cleanText(subtitle, task.subtitle),
        time: cleanTime(time, task.time),
        increments
      };
    });

    return result;
  }

  async function persistSettings(nextConfig) {
    if (!isOwner() || saving) return;

    saving = true;
    const saveButton = q("saveDailyTaskSettings");
    const resetButton = q("resetDailyTaskSettings");
    if (saveButton) saveButton.disabled = true;
    if (resetButton) resetButton.disabled = true;

    const { data, error } = await client.rpc("update_daily_task_config", {
      p_config: nextConfig
    });

    saving = false;
    if (saveButton) saveButton.disabled = false;
    if (resetButton) resetButton.disabled = false;

    if (error) {
      const message = String(error.message || "");
      if (
        message.includes("Could not find the function") ||
        message.includes("update_daily_task_config")
      ) {
        notify("请先在 Supabase SQL Editor 执行 supabase-daily-task-settings.sql", "error");
      } else {
        notify(message || "每日任务设置保存失败", "error");
      }
      return;
    }

    if (data && typeof data === "object") state = data;
    notify("每日任务设置已保存并同步", "success");
    render();
  }

  async function saveSettings() {
    await persistSettings(collectSettings(false));
  }

  async function resetSettings() {
    if (!window.confirm("确认恢复所有每日任务的默认文字、时间和进度数量？")) return;
    await persistSettings(collectSettings(true));
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
    render();
  }

  async function initialize(session) {
    profile = null;
    state = {};
    if (realtimeChannel) {
      client.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }

    if (!session) {
      q("dailyTaskSettingsSection")?.classList.add("hidden");
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
      .channel("daily-task-settings-ui")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "study_dashboard", filter: "id=eq.main" },
        (payload) => {
          state =
            payload.new?.state && typeof payload.new.state === "object"
              ? payload.new.state
              : {};
          render();
        }
      )
      .subscribe();
  }

  function start() {
    mount();
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
