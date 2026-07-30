import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const site = path.join(root, "_site");

function replaceExactlyOnce(source, oldText, newText, label) {
  const first = source.indexOf(oldText);
  if (first < 0 || source.indexOf(oldText, first + oldText.length) >= 0) {
    throw new Error(`${label}: expected exactly one match`);
  }
  return `${source.slice(0, first)}${newText}${source.slice(first + oldText.length)}`;
}

const oldAppTasks = "const dailyTaskDefaults=[['d_words','背诵 50 个新词并复习旧词','英语 · 单词','07:30',[['eng_w',50]]],['d_math','660题完成 25 题并标记错因','数学 · 高数','08:00',[['math_h',25]]],['d_read','精读 1 篇真题阅读','英语 · 阅读','10:15',[['eng_r',1]]],['d_ctl','学习教材 18 页并完成 5 道题','822 · 教材与习题','14:00',[['ctl_b',18],['ctl_q',5]]],['d_pol','听 1 节课程并做 20 道选择题','政治','16:00',[['pol_c',1],['pol_q',20]]],['d_review','整理错题与明日计划','复盘','20:30',[]]],dailyTasks=clone(dailyTaskDefaults)";
const newAppTasks = "const dailyTaskDefaults=[['d_words','背诵 50 个新词并复习旧词','英语 · 单词','07:30',[['eng_w',50]]],['d_math','660题完成 25 题并标记错因','数学 · 高数','08:00',[['math_h',25]]],['d_linear','线代完成 20 题并整理公式','数学 · 线代','09:00',[['math_l',20]]],['d_probability','概率论完成 20 题并总结题型','数学 · 概率论','09:45',[['math_p',20]]],['d_read','精读 1 篇真题阅读','英语 · 阅读','10:15',[['eng_r',1]]],['d_ctl','学习教材 18 页并完成 5 道题','822 · 教材与习题','14:00',[['ctl_b',18],['ctl_q',5]]],['d_pol','听 1 节课程并做 20 道选择题','政治','16:00',[['pol_c',1],['pol_q',20]]],['d_review','整理错题与明日计划','复盘','20:30',[]]],dailyTasks=clone(dailyTaskDefaults)";

const oldSettingsBlock = `    {
      key: "d_math",
      title: "660题完成 25 题并标记错因",
      subtitle: "数学 · 高数",
      time: "08:00",
      increments: [{ metric: "math_h", label: "高数题量", unit: "题", value: 25 }]
    },
    {
      key: "d_read",`;
const newSettingsBlock = `    {
      key: "d_math",
      title: "660题完成 25 题并标记错因",
      subtitle: "数学 · 高数",
      time: "08:00",
      increments: [{ metric: "math_h", label: "高数题量", unit: "题", value: 25 }]
    },
    {
      key: "d_linear",
      title: "线代完成 20 题并整理公式",
      subtitle: "数学 · 线代",
      time: "09:00",
      increments: [{ metric: "math_l", label: "线代题量", unit: "题", value: 20 }]
    },
    {
      key: "d_probability",
      title: "概率论完成 20 题并总结题型",
      subtitle: "数学 · 概率论",
      time: "09:45",
      increments: [{ metric: "math_p", label: "概率论题量", unit: "题", value: 20 }]
    },
    {
      key: "d_read",`;

const oldReviewTasks = `  const dailyTasks=[
    {key:'d_words',label:'背诵 50 个新词并复习旧词'},
    {key:'d_math',label:'660题完成 25 题并标记错因'},
    {key:'d_read',label:'精读 1 篇真题阅读'},
    {key:'d_ctl',label:'学习教材 18 页并完成 5 道题'},
    {key:'d_pol',label:'听 1 节课程并做 20 道选择题'},
    {key:'d_review',label:'整理错题与明日计划'}
  ];`;
const newReviewTasks = `  const dailyTasks=[
    {key:'d_words',label:'背诵 50 个新词并复习旧词'},
    {key:'d_math',label:'660题完成 25 题并标记错因'},
    {key:'d_linear',label:'线代完成 20 题并整理公式'},
    {key:'d_probability',label:'概率论完成 20 题并总结题型'},
    {key:'d_read',label:'精读 1 篇真题阅读'},
    {key:'d_ctl',label:'学习教材 18 页并完成 5 道题'},
    {key:'d_pol',label:'听 1 节课程并做 20 道选择题'},
    {key:'d_review',label:'整理错题与明日计划'}
  ];`;

const appPath = path.join(site, "assets", "app.js");
const settingsPath = path.join(site, "daily-task-settings.js");
const reviewPath = path.join(site, "task-review.js");

let app = await readFile(appPath, "utf8");
let settings = await readFile(settingsPath, "utf8");
let review = await readFile(reviewPath, "utf8");

app = replaceExactlyOnce(app, oldAppTasks, newAppTasks, "main dashboard daily task expansion");
settings = replaceExactlyOnce(settings, oldSettingsBlock, newSettingsBlock, "admin daily task settings expansion");
review = replaceExactlyOnce(review, oldReviewTasks, newReviewTasks, "task review daily task expansion");

for (const [label, source] of [
  ["app.js", app],
  ["daily-task-settings.js", settings],
  ["task-review.js", review]
]) {
  if (!source.includes("d_linear") || !source.includes("d_probability")) {
    throw new Error(`${label}: linear algebra or probability task is missing`);
  }
}
if (!app.includes("['math_l',20]") || !app.includes("['math_p',20]")) {
  throw new Error("app.js: math metric bindings are missing");
}
if (!settings.includes('metric: "math_l"') || !settings.includes('metric: "math_p"')) {
  throw new Error("daily-task-settings.js: editable math quantities are missing");
}

await writeFile(appPath, app);
await writeFile(settingsPath, settings);
await writeFile(reviewPath, review);

console.log("Added owner-editable linear algebra and probability daily tasks to the Pages artifact.");
