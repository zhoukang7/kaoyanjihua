import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const outputDir = path.join(root, "_site");
const vendorSource = path.join(root, ".vendor-cache", "package", "dist", "umd", "supabase.js");

const requiredFiles = [
  "index.html",
  "config.js",
  "favicon.svg",
  "comments.js",
  "comments.css",
  "task-review.js",
  "task-review.css",
  "points-control.js",
  "points-control.css",
  "points-deduction.js",
  "points-deduction.css",
  "reward-presets.js",
  "reward-presets.css",
  "learning-communication.js",
  "reward-presets-stability.js",
  "daily-task-settings.js",
  "daily-task-settings.css"
];

const copiedAssets = requiredFiles.filter((file) => !["index.html", "config.js"].includes(file));
const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();
const supabasePublishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || "").trim();
const loginEmailDomain = String(process.env.LOGIN_EMAIL_DOMAIN || "study822.example.com").trim();

function fail(message) {
  throw new Error(message);
}

function replaceExactlyOnce(input, pattern, replacement, label) {
  const matches = input.match(pattern);
  if (!matches || matches.length !== 1) {
    fail(`${label}: expected exactly one match, found ${matches?.length || 0}`);
  }
  return input.replace(pattern, replacement);
}

function replaceLiteralExactlyOnce(input, literal, replacement, label) {
  const firstIndex = input.indexOf(literal);
  if (firstIndex < 0 || input.indexOf(literal, firstIndex + literal.length) >= 0) {
    fail(`${label}: expected exactly one literal match`);
  }
  return `${input.slice(0, firstIndex)}${replacement}${input.slice(firstIndex + literal.length)}`;
}

function assertSafeJavaScript(source, label) {
  const forbiddenPatterns = [
    [/\beval\s*\(/, "eval(...)"],
    [/\bnew\s+Function\s*\(/, "new Function(...)"],
    [/\bdocument\.write\s*\(/, "document.write(...)"],
    [/\bsetTimeout\s*\(\s*["'`]/, "string-based setTimeout(...)"],
    [/\bsetInterval\s*\(\s*["'`]/, "string-based setInterval(...)"]
  ];

  for (const [pattern, description] of forbiddenPatterns) {
    if (pattern.test(source)) {
      fail(`${label}: forbidden JavaScript construct detected: ${description}`);
    }
  }
}

function assertSafeCommentRendering(source) {
  const innerHtmlAssignments = (source.match(/\.innerHTML\s*=/g) || []).length;
  if (innerHtmlAssignments !== 1) {
    fail(`comments.js must keep exactly one static mount template; found ${innerHtmlAssignments} innerHTML assignments`);
  }

  const staticMount = source.match(/section\.innerHTML\s*=\s*`([\s\S]*?)`;/);
  if (!staticMount) fail("comments.js static mount template was not found");
  if (staticMount[1].includes("${")) {
    fail("comments.js static mount template must not interpolate runtime values");
  }
  if (/\bescapeHtml\b/.test(source)) {
    fail("comments.js must render database values with textContent instead of HTML escaping helpers");
  }
  if (/\.style(?:\.|\s*=)/.test(source)) {
    fail("comments.js must not create dynamic inline styles");
  }
}

function transformTaskReview(source) {
  const oldLabelFunction = `  function taskLabel(type,key){
    const tasks=type==='daily'?dailyTasks:weeklyTasks;
    return tasks.find(task=>task.key===key)?.label||key;
  }`;
  const newLabelFunction = `  function taskLabel(type,key){
    if(type==='daily'&&Array.isArray(window.STUDY_DAILY_TASKS)){
      const configured=window.STUDY_DAILY_TASKS.find(task=>task.key===key);
      if(configured?.label)return configured.label;
    }
    const tasks=type==='daily'?dailyTasks:weeklyTasks;
    return tasks.find(task=>task.key===key)?.label||key;
  }`;
  const transformed = replaceLiteralExactlyOnce(
    source,
    oldLabelFunction,
    newLabelFunction,
    "Task review dynamic daily label"
  );
  if (!transformed.includes("window.STUDY_DAILY_TASKS")) {
    fail("task-review.js dynamic task label integration is missing");
  }
  return transformed;
}

for (const relativePath of requiredFiles) {
  await readFile(path.join(root, relativePath), "utf8").catch(() => {
    fail(`Missing required file: ${relativePath}`);
  });
}

if (!supabaseUrl) fail("Missing SUPABASE_URL");
if (!supabasePublishableKey) fail("Missing SUPABASE_PUBLISHABLE_KEY");

let supabaseOrigin;
try {
  supabaseOrigin = new URL(supabaseUrl).origin;
} catch {
  fail("SUPABASE_URL must be an absolute HTTPS URL");
}
if (!supabaseOrigin.startsWith("https://")) fail("SUPABASE_URL must use HTTPS");
const realtimeOrigin = supabaseOrigin.replace(/^https:/, "wss:");

await readFile(vendorSource).catch(() => fail("Pinned Supabase UMD bundle was not extracted"));

await rm(outputDir, { recursive: true, force: true });
await mkdir(path.join(outputDir, "assets"), { recursive: true });
await mkdir(path.join(outputDir, "vendor"), { recursive: true });

for (const relativePath of copiedAssets) {
  await cp(path.join(root, relativePath), path.join(outputDir, relativePath));
}
await cp(vendorSource, path.join(outputDir, "vendor", "supabase.js"));

let html = await readFile(path.join(root, "index.html"), "utf8");

const styleMatches = [...html.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi)];
if (styleMatches.length !== 1) {
  fail(`index.html must contain exactly one inline <style>; found ${styleMatches.length}`);
}
const appCss = styleMatches[0][1].trim() + "\n";
html = html.replace(styleMatches[0][0], '<link rel="stylesheet" href="./assets/app.css">');

const inlineScriptMatches = [...html.matchAll(/<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)];
if (inlineScriptMatches.length !== 1) {
  fail(`index.html must contain exactly one inline application script; found ${inlineScriptMatches.length}`);
}
let appJs = inlineScriptMatches[0][1].trim() + "\n";
html = html.replace(inlineScriptMatches[0][0], '<script src="./assets/app.js"></script>');

const oldDailyTasks = "const dailyTasks=[['d_words','背诵 50 个新词并复习旧词','英语 · 单词','07:30',[['eng_w',50]]],['d_math','660题完成 25 题并标记错因','数学 · 高数','08:00',[['math_h',25]]],['d_read','精读 1 篇真题阅读','英语 · 阅读','10:15',[['eng_r',1]]],['d_ctl','学习教材 18 页并完成 5 道题','822 · 教材与习题','14:00',[['ctl_b',18],['ctl_q',5]]],['d_pol','听 1 节课程并做 20 道选择题','政治','16:00',[['pol_c',1],['pol_q',20]]],['d_review','整理错题与明日计划','复盘','20:30',[]]]";
const newDailyTasks = "const dailyTaskDefaults=[['d_words','背诵 50 个新词并复习旧词','英语 · 单词','07:30',[['eng_w',50]]],['d_math','660题完成 25 题并标记错因','数学 · 高数','08:00',[['math_h',25]]],['d_read','精读 1 篇真题阅读','英语 · 阅读','10:15',[['eng_r',1]]],['d_ctl','学习教材 18 页并完成 5 道题','822 · 教材与习题','14:00',[['ctl_b',18],['ctl_q',5]]],['d_pol','听 1 节课程并做 20 道选择题','政治','16:00',[['pol_c',1],['pol_q',20]]],['d_review','整理错题与明日计划','复盘','20:30',[]]],dailyTasks=clone(dailyTaskDefaults)";
appJs = replaceLiteralExactlyOnce(appJs, oldDailyTasks, newDailyTasks, "Editable daily task defaults");

const unsafeDashboardMerge = "const merge=x=>{let z=clone(defs);if(x&&typeof x==='object'){z.daily=x.daily||{};z.weekly=x.weekly||{};Object.keys(z.metrics).forEach(k=>z.metrics[k]={...z.metrics[k],...(x.metrics?.[k]||{})})}return z}";
const safeDashboardMerge = "const cleanNumber=(value,fallback,min,max=100000)=>{const number=Number(value);return Number.isFinite(number)?Math.min(max,Math.max(min,Math.round(number))):fallback},cleanTaskState=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{},cleanText=(value,fallback,max=120)=>{const text=typeof value==='string'?value.trim():'';return text?text.slice(0,max):fallback},cleanTime=(value,fallback)=>typeof value==='string'&&/^(?:[01]\\d|2[0-3]):[0-5]\\d$/.test(value)?value:fallback,cleanDailyTaskConfig=value=>{const source=cleanTaskState(value),result={};dailyTaskDefaults.forEach(([id,title,subtitle,time,increments])=>{const item=cleanTaskState(source[id]),savedIncrements=cleanTaskState(item.increments),nextIncrements={};increments.forEach(([metric,amount])=>nextIncrements[metric]=cleanNumber(savedIncrements[metric],amount,0));result[id]={title:cleanText(item.title,title),subtitle:cleanText(item.subtitle,subtitle),time:cleanTime(item.time,time),increments:nextIncrements}});return result},cleanProgress=value=>{const source=cleanTaskState(value),result={};Object.entries(source).forEach(([metric,amount])=>{if(Object.hasOwn(defs.metrics,metric))result[metric]=cleanNumber(amount,0,0)});return result},cleanDailyApplied=value=>{const source=cleanTaskState(value),result={};Object.entries(source).forEach(([date,tasks])=>{if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(date))return;const cleanTasks={};Object.entries(cleanTaskState(tasks)).forEach(([id,delta])=>{if(dailyTaskDefaults.some(task=>task[0]===id))cleanTasks[id]=cleanProgress(delta)});result[date]=cleanTasks});return result},merge=x=>{let z=clone(defs);z.dailyTaskConfig=cleanDailyTaskConfig({});z.dailyApplied={};if(x&&typeof x==='object'){z.daily=cleanTaskState(x.daily);z.weekly=cleanTaskState(x.weekly);z.dailyTaskConfig=cleanDailyTaskConfig(x.dailyTaskConfig);z.dailyApplied=cleanDailyApplied(x.dailyApplied);Object.keys(z.metrics).forEach(k=>{const source=x.metrics?.[k];if(!source||typeof source!=='object'||Array.isArray(source))return;z.metrics[k].done=cleanNumber(source.done,z.metrics[k].done,0);z.metrics[k].goal=cleanNumber(source.goal,z.metrics[k].goal,1)})}return z},taskProgressObject=task=>Object.fromEntries(task[4].map(([metric,amount])=>[metric,cleanNumber(amount,0,0)])),defaultTaskProgress=id=>{const task=dailyTaskDefaults.find(item=>item[0]===id);return task?taskProgressObject(task):{}},applyTaskProgress=(delta,direction)=>Object.entries(cleanProgress(delta)).forEach(([metric,amount])=>state.metrics[metric].done=Math.max(0,Number(state.metrics[metric].done)+direction*amount)),syncDailyTasks=()=>{dailyTaskDefaults.forEach((base,index)=>{const [id,title,subtitle,time,increments]=base,item=state.dailyTaskConfig?.[id]||{};dailyTasks[index]=[id,cleanText(item.title,title),cleanText(item.subtitle,subtitle),cleanTime(item.time,time),increments.map(([metric,amount])=>[metric,cleanNumber(item.increments?.[metric],amount,0)])]});window.STUDY_DAILY_TASKS=dailyTasks.map(([key,label,subtitle,time,increments])=>({key,label,subtitle,time,increments:Object.fromEntries(increments)}));document.dispatchEvent(new CustomEvent('study:daily-task-config',{detail:window.STUDY_DAILY_TASKS}))}";
appJs = replaceLiteralExactlyOnce(appJs, unsafeDashboardMerge, safeDashboardMerge, "Dashboard state and daily task sanitizer");

appJs = replaceLiteralExactlyOnce(
  appJs,
  "function render(){const ro=",
  "function render(){syncDailyTasks();const ro=",
  "Daily task configuration render sync"
);

const oldToggle = "function toggleDaily(id,on){let dk=today(),t=dailyTasks.find(x=>x[0]===id);state.daily[dk][id]=on;t[4].forEach(([k,n])=>state.metrics[k].done=Math.max(0,Number(state.metrics[k].done)+(on?n:-n)));render();save()}";
const newToggle = "function toggleDaily(id,on){let dk=today(),t=dailyTasks.find(x=>x[0]===id);if(!t)return;state.daily[dk]??={};state.dailyApplied[dk]??={};state.daily[dk][id]=on;if(on){const delta=taskProgressObject(t);applyTaskProgress(delta,1);state.dailyApplied[dk][id]=delta}else{const delta=state.dailyApplied[dk]?.[id]||defaultTaskProgress(id);applyTaskProgress(delta,-1);delete state.dailyApplied[dk][id]}render();save()}";
appJs = replaceLiteralExactlyOnce(appJs, oldToggle, newToggle, "Daily task progress snapshots");

const oldReset = "$('#resetBtn').onclick=()=>{if(!confirm('确认重置今天和本周任务？已完成的每日任务增量也会撤销。'))return;let dk=today();Object.entries(state.daily[dk]||{}).forEach(([id,on])=>{if(on){let t=dailyTasks.find(x=>x[0]===id);t?.[4].forEach(([k,n])=>state.metrics[k].done=Math.max(0,state.metrics[k].done-n))}});state.daily[dk]={};state.weekly[week()]={};render();save()};";
const newReset = "$('#resetBtn').onclick=()=>{if(!confirm('确认重置今天和本周任务？已完成的每日任务增量也会撤销。'))return;let dk=today();Object.entries(state.daily[dk]||{}).forEach(([id,on])=>{if(on)applyTaskProgress(state.dailyApplied[dk]?.[id]||defaultTaskProgress(id),-1)});state.daily[dk]={};state.dailyApplied[dk]={};state.weekly[week()]={};render();save()};";
appJs = replaceLiteralExactlyOnce(appJs, oldReset, newReset, "Daily task reset snapshots");

html = replaceExactlyOnce(
  html,
  /https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2/g,
  "./vendor/supabase.js",
  "Supabase CDN replacement"
);

const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseOrigin} ${realtimeOrigin}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "manifest-src 'self'"
].join("; ");
const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
html = replaceExactlyOnce(
  html,
  /<meta name="theme-color"/g,
  `${cspMeta}\n<link rel="icon" type="image/svg+xml" href="./favicon.svg">\n<meta name="theme-color"`,
  "CSP and favicon insertion"
);

if (/<script(?![^>]*\bsrc\s*=)[^>]*>/i.test(html)) fail("Deployed index.html still contains inline JavaScript");
if (/<style(?:\s|>)/i.test(html)) fail("Deployed index.html still contains an inline <style> block");
if (/https:\/\/(?:cdn\.jsdelivr\.net|unpkg\.com)\/.*supabase-js/i.test(html)) {
  fail("Deployed index.html still references a remote Supabase JS CDN");
}
if (/<script[^>]+src=["']https?:\/\//i.test(html)) fail("Deployed index.html contains a remote script source");
if (!html.includes('src="./vendor/supabase.js"')) fail("Local Supabase JS reference is missing");
if (!html.includes('href="./assets/app.css"')) fail("Extracted application stylesheet reference is missing");
if (!html.includes('src="./assets/app.js"')) fail("Extracted application script reference is missing");
if (!html.includes('href="./favicon.svg"')) fail("Local favicon reference is missing");
if (!html.includes('http-equiv="Content-Security-Policy"')) fail("CSP meta tag is missing");

assertSafeJavaScript(appJs, "assets/app.js");
if (appJs.includes("...(x.metrics?.[k]||{})")) fail("Dashboard still spreads untrusted metric fields into rendering state");
if (!appJs.includes("const cleanNumber=") || !appJs.includes("const cleanTaskState=")) {
  fail("Dashboard state sanitizer is missing");
}
if (!appJs.includes("dailyTaskConfig") || !appJs.includes("dailyApplied")) {
  fail("Editable daily task configuration or progress snapshots are missing");
}
if (!appJs.includes("window.STUDY_DAILY_TASKS")) {
  fail("Shared daily task configuration is missing");
}
const coreInnerHtmlAssignments = (appJs.match(/\.innerHTML\s*=/g) || []).length;
if (coreInnerHtmlAssignments > 4) {
  fail(`Core innerHTML assignment budget exceeded: ${coreInnerHtmlAssignments} > 4`);
}

let configTemplate = await readFile(path.join(root, "config.js"), "utf8");
configTemplate = replaceExactlyOnce(
  configTemplate,
  /supabaseUrl:\s*""/g,
  `supabaseUrl: ${JSON.stringify(supabaseUrl)}`,
  "config supabaseUrl"
);
configTemplate = replaceExactlyOnce(
  configTemplate,
  /supabasePublishableKey:\s*""/g,
  `supabasePublishableKey: ${JSON.stringify(supabasePublishableKey)}`,
  "config publishable key"
);
configTemplate = replaceExactlyOnce(
  configTemplate,
  /loginEmailDomain:\s*"study822\.example\.com"/g,
  `loginEmailDomain: ${JSON.stringify(loginEmailDomain || "study822.example.com")}`,
  "config login domain"
);
if (!configTemplate.includes("window.getStudySupabaseClient")) fail("Shared Supabase client bootstrap is missing");
if (!configTemplate.includes("window.STUDY_SUPABASE_CLIENT")) fail("Shared Supabase client handle is missing");
if (!configTemplate.includes("daily-task-settings.js")) fail("Daily task settings script loader is missing");
if (!configTemplate.includes("daily-task-settings.css")) fail("Daily task settings stylesheet loader is missing");
assertSafeJavaScript(configTemplate, "config.js");

const javascriptSources = new Map();
for (const relativePath of copiedAssets.filter((file) => file.endsWith(".js"))) {
  let source = await readFile(path.join(root, relativePath), "utf8");
  if (relativePath === "task-review.js") {
    source = transformTaskReview(source);
    await writeFile(path.join(outputDir, relativePath), source);
  }
  javascriptSources.set(relativePath, source);
  assertSafeJavaScript(source, relativePath);
}
assertSafeCommentRendering(javascriptSources.get("comments.js") || "");

const dailySettingsSource = javascriptSources.get("daily-task-settings.js") || "";
if (/\.innerHTML\s*=/.test(dailySettingsSource)) {
  fail("daily-task-settings.js must render with DOM nodes instead of innerHTML");
}
if (/\.style(?:\.|\s*=)/.test(dailySettingsSource)) {
  fail("daily-task-settings.js must not create dynamic inline styles");
}
if (!dailySettingsSource.includes("update_daily_task_config")) {
  fail("daily-task-settings.js must save through the owner-only RPC");
}

const commentsCss = await readFile(path.join(root, "comments.css"), "utf8");
if (!commentsCss.includes(".comment-admin-reply-body")) fail("Safe admin reply CSS class is missing");
if (!commentsCss.includes(".comment-actions-inline")) fail("Inline action layout CSS class is missing");

await writeFile(path.join(outputDir, "index.html"), html);
await writeFile(path.join(outputDir, "assets", "app.css"), appCss);
await writeFile(path.join(outputDir, "assets", "app.js"), appJs);
await writeFile(path.join(outputDir, "config.js"), configTemplate);
await writeFile(path.join(outputDir, ".nojekyll"), "");

console.log(`Prepared CSP-protected static site for ${supabaseOrigin}.`);
console.log(`Extracted ${appCss.length} bytes of CSS and ${appJs.length} bytes of JavaScript.`);
console.log(`Core innerHTML assignment count: ${coreInnerHtmlAssignments}/4.`);
console.log("Comment rendering uses textContent/DOM nodes with one static mount template.");
console.log("Dashboard state accepts only validated numeric progress fields from Supabase.");
console.log("Daily task titles, times and metric increments are owner-editable with completion snapshots.");
