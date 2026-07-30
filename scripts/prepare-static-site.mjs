// Canonical GitHub Pages build entrypoint.
// Keep deployment workflows calling this stable filename while implementation lives in build-site.mjs.
import { readFile, rm, writeFile } from "node:fs/promises";

const implementationUrl = new URL("./build-site.mjs", import.meta.url);
const runtimeUrl = new URL("./.build-site-runtime.mjs", import.meta.url);
const oldAssertion = '!appJs.includes("const cleanTaskState=")';
const newAssertion = '!appJs.includes("cleanTaskState=")';
const oldTextSanitizer = "const text=typeof value==='string'?value.trim():'';return text?text.slice(0,max):fallback";
const newTextSanitizer = "const text=typeof value==='string'?value.trim().replaceAll('\\u003c','\\uff1c').replaceAll('\\u003e','\\uff1e'):'';return text?text.slice(0,max):fallback";

let source = await readFile(implementationUrl, "utf8");
if (!source.includes(oldAssertion)) {
  throw new Error("Expected dashboard sanitizer assertion was not found");
}
if (!source.includes(oldTextSanitizer)) {
  throw new Error("Expected editable task text sanitizer was not found");
}
source = source.replace(oldAssertion, newAssertion);
source = source.replace(oldTextSanitizer, newTextSanitizer);

await writeFile(runtimeUrl, source);
try {
  await import(`${runtimeUrl.href}?build=${Date.now()}`);
} finally {
  await rm(runtimeUrl, { force: true });
}
