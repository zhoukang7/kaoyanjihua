import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const outputDir = path.join(root, "_site");
const vendorSource = path.join(root, ".vendor-cache", "package", "dist", "umd", "supabase.js");

const requiredFiles = [
  "index.html",
  "config.js",
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
  "reward-presets-stability.js"
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

const unsafeDashboardMerge = "const merge=x=>{let z=clone(defs);if(x&&typeof x==='object'){z.daily=x.daily||{};z.weekly=x.weekly||{};Object.keys(z.metrics).forEach(k=>z.metrics[k]={...z.metrics[k],...(x.metrics?.[k]||{})})}return z}";
const safeDashboardMerge = "const cleanNumber=(value,fallback,min)=>{const number=Number(value);return Number.isFinite(number)?Math.max(min,number):fallback};const cleanTaskState=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};const merge=x=>{let z=clone(defs);if(x&&typeof x==='object'){z.daily=cleanTaskState(x.daily);z.weekly=cleanTaskState(x.weekly);Object.keys(z.metrics).forEach(k=>{const source=x.metrics?.[k];if(!source||typeof source!=='object'||Array.isArray(source))return;z.metrics[k].done=cleanNumber(source.done,z.metrics[k].done,0);z.metrics[k].goal=cleanNumber(source.goal,z.metrics[k].goal,1)})}return z}";
appJs = replaceLiteralExactlyOnce(appJs, unsafeDashboardMerge, safeDashboardMerge, "Dashboard metric state sanitizer");

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
  `${cspMeta}\n<meta name="theme-color"`,
  "CSP insertion"
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
if (!html.includes('http-equiv="Content-Security-Policy"')) fail("CSP meta tag is missing");

assertSafeJavaScript(appJs, "assets/app.js");
if (appJs.includes("...(x.metrics?.[k]||{})")) fail("Dashboard still spreads untrusted metric fields into rendering state");
if (!appJs.includes("const cleanNumber=") || !appJs.includes("const cleanTaskState=")) {
  fail("Dashboard state sanitizer is missing");
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
assertSafeJavaScript(configTemplate, "config.js");

const javascriptSources = new Map();
for (const relativePath of copiedAssets.filter((file) => file.endsWith(".js"))) {
  const source = await readFile(path.join(root, relativePath), "utf8");
  javascriptSources.set(relativePath, source);
  assertSafeJavaScript(source, relativePath);
}
assertSafeCommentRendering(javascriptSources.get("comments.js") || "");

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
