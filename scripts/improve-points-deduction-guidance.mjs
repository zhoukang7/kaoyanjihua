import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const deductionPath = path.join(process.cwd(), "_site", "points-deduction.js");
const oldBlock = `    if(error){notify(error.message);return;}
    q('manualDeductionAmount').value='1';`;
const newBlock = `    if(error){
      const message=String(error.message||'');
      if(message.includes('Could not find the function')||message.includes('deduct_user_points')){
        notify('请先在 Supabase SQL Editor 执行 supabase-manual-deductions.sql');
      }else{
        notify(message||'扣除积分失败');
      }
      return;
    }
    q('manualDeductionAmount').value='1';`;

let source = await readFile(deductionPath, "utf8");
const first = source.indexOf(oldBlock);
if (first < 0 || source.indexOf(oldBlock, first + oldBlock.length) >= 0) {
  throw new Error("Expected exactly one deduction RPC error block");
}
source = `${source.slice(0, first)}${newBlock}${source.slice(first + oldBlock.length)}`;

if (!source.includes("supabase-manual-deductions.sql")) {
  throw new Error("Deduction SQL guidance was not added");
}
if (!source.includes("deduct_user_points")) {
  throw new Error("Deduction RPC call is missing");
}

await writeFile(deductionPath, source);
console.log("Added explicit Supabase migration guidance for missing deduction RPC.");
