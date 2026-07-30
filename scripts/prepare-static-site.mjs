// Canonical GitHub Pages build entrypoint.
// Keep deployment workflows calling this stable filename while implementation lives in build-site.mjs.
import { readFile, rm, writeFile } from "node:fs/promises";

const implementationUrl = new URL("./build-site.mjs", import.meta.url);
const runtimeUrl = new URL("./.build-site-runtime.mjs", import.meta.url);
const oldAssertion = '!appJs.includes("const cleanTaskState=")';
const newAssertion = '!appJs.includes("cleanTaskState=")';

let source = await readFile(implementationUrl, "utf8");
if (!source.includes(oldAssertion)) {
  throw new Error("Expected dashboard sanitizer assertion was not found");
}
source = source.replace(oldAssertion, newAssertion);

await writeFile(runtimeUrl, source);
try {
  await import(`${runtimeUrl.href}?build=${Date.now()}`);
} finally {
  await rm(runtimeUrl, { force: true });
}
