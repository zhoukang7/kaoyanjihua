import { cp, readFile, writeFile } from "node:fs/promises";
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

await cp(
  path.join(root, "weekly-task-settings.js"),
  path.join(site, "weekly-task-settings.js")
);
await cp(
  path.join(root, "weekly-task-settings.css"),
  path.join(site, "weekly-task-settings.css")
);

const reviewPath = path.join(site, "task-review.js");
let review = await readFile(reviewPath, "utf8");

const oldLabelFunction = `  function taskLabel(type,key){
    if(type==='daily'&&Array.isArray(window.STUDY_DAILY_TASKS)){
      const configured=window.STUDY_DAILY_TASKS.find(task=>task.key===key);
      if(configured?.label)return configured.label;
    }
    const tasks=type==='daily'?dailyTasks:weeklyTasks;
    return tasks.find(task=>task.key===key)?.label||key;
  }`;
const newLabelFunction = `  function taskLabel(type,key){
    if(type==='daily'&&Array.isArray(window.STUDY_DAILY_TASKS)){
      const configured=window.STUDY_DAILY_TASKS.find(task=>task.key===key);
      if(configured?.label)return configured.label;
    }
    if(type==='weekly'&&Array.isArray(window.STUDY_WEEKLY_TASKS)){
      const configured=window.STUDY_WEEKLY_TASKS.find(task=>task.key===key);
      if(configured?.label)return configured.label;
    }
    const tasks=type==='daily'?dailyTasks:weeklyTasks;
    return tasks.find(task=>task.key===key)?.label||key;
  }`;
review = replaceExactlyOnce(
  review,
  oldLabelFunction,
  newLabelFunction,
  "task review weekly label integration"
);

const oldStart = `  function start(){
    client.auth.getSession().then(({data})=>initialize(data.session));`;
const newStart = `  function start(){
    document.addEventListener('study:weekly-task-config',()=>renderPanel());
    client.auth.getSession().then(({data})=>initialize(data.session));`;
review = replaceExactlyOnce(
  review,
  oldStart,
  newStart,
  "task review weekly configuration refresh"
);

if (!review.includes("window.STUDY_WEEKLY_TASKS")) {
  throw new Error("task-review.js: weekly task configuration integration is missing");
}
if (!review.includes("study:weekly-task-config")) {
  throw new Error("task-review.js: weekly task refresh listener is missing");
}

const app = await readFile(path.join(site, "assets", "app.js"), "utf8");
const expectedWeeklyToggle = "document.querySelectorAll('[data-w]').forEach(x=>x.onchange=()=>{state.weekly[wk][x.dataset.w]=x.checked;save()})";
if (!app.includes(expectedWeeklyToggle)) {
  throw new Error("app.js: weekly tasks must remain completion-only without progress increments");
}
if (/data-w[^\n]{0,500}metrics\[/.test(app)) {
  throw new Error("app.js: weekly task completion must not modify learning metrics");
}

await writeFile(reviewPath, review);
console.log("Added owner-editable weekly task labels without learning-progress side effects.");
