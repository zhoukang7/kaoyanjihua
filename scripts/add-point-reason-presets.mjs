import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const site = path.join(root, "_site");
const scriptName = "points-reason-presets.js";
const stylesheetName = "points-reason-presets.css";

const scriptSource = await readFile(path.join(root, scriptName), "utf8");
const stylesheetSource = await readFile(path.join(root, stylesheetName), "utf8");
const deployedConfig = await readFile(path.join(site, "config.js"), "utf8");

if (/\.innerHTML\s*=/.test(scriptSource)) {
  throw new Error(`${scriptName}: dynamic HTML assignment is not allowed`);
}
if (/\.style(?:\.|\s*=)/.test(scriptSource)) {
  throw new Error(`${scriptName}: dynamic inline styles are not allowed`);
}
if (!scriptSource.includes("每日任务完成") || !scriptSource.includes("每日学习量等效")) {
  throw new Error(`${scriptName}: required point reason presets are missing`);
}
if (!scriptSource.includes('q("manualGrantNote")')) {
  throw new Error(`${scriptName}: point grant note input integration is missing`);
}
if (!deployedConfig.includes(scriptName) || !deployedConfig.includes(stylesheetName)) {
  throw new Error("config.js: point reason preset assets are not loaded");
}
if (!stylesheetSource.includes(".points-reason-presets")) {
  throw new Error(`${stylesheetName}: preset layout class is missing`);
}

await copyFile(path.join(root, scriptName), path.join(site, scriptName));
await copyFile(path.join(root, stylesheetName), path.join(site, stylesheetName));

console.log("Added two safe point grant reason presets to the Pages artifact.");
