#!/usr/bin/env node
// style-tokens.mjs — Z901 视觉仿知乎 token 断言（静态检查，不起浏览器）
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const css = readFileSync(join(root, "client/src/styles.css"), "utf8");
const design = readFileSync(join(root, "docs/DESIGN.md"), "utf8");

const fails = [];
const ok = (cond, msg) => {
  if (!cond) fails.push(msg);
};

// 提取 :root 块
const rootBlock = css.match(/:root\s*\{([\s\S]*?)\}/);
ok(rootBlock, "缺少 :root 块");
const vars = {};
if (rootBlock) {
  for (const m of rootBlock[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    vars[m[1]] = m[2].trim();
  }
}
const hexEq = (a, b) => String(a).replace(/\s/g, "").toLowerCase() === b.toLowerCase();

// 1. 核心 token
ok(hexEq(vars["paper"], "#F6F6F6"), `--paper 应为 #F6F6F6，实际 ${vars["paper"]}`);
ok(hexEq(vars["surface"], "#FFFFFF"), `--surface 应为 #FFFFFF，实际 ${vars["surface"]}`);
ok(hexEq(vars["accent"], "#0066FF"), `--accent 应为 #0066FF，实际 ${vars["accent"]}`);
ok(hexEq(vars["ink"], "#121212"), `--ink 应为 #121212，实际 ${vars["ink"]}`);
ok(hexEq(vars["line"], "#EBEBEB"), `--line 应为 #EBEBEB，实际 ${vars["line"]}`);
ok(vars["radius"] === "3px", `--radius 应为 3px，实际 ${vars["radius"]}`);

// 2. 灰阶扩展
ok(hexEq(vars["ink-2"], "#444444"), `--ink-2 应为 #444444，实际 ${vars["ink-2"]}`);
ok(hexEq(vars["ink-3"], "#8590A6"), `--ink-3 应为 #8590A6，实际 ${vars["ink-3"]}`);

// 3. 字体：--sans 不以衬线为主，body 使用 --sans
const sans = vars["sans"] || "";
ok(!/Noto Serif|Source Han Serif|Songti|SimSun/i.test(sans), `--sans 不应包含衬线字体：${sans}`);
const firstFont = sans.split(",")[0].trim();
ok(!/serif$/i.test(firstFont) && !/[^-]serif\b/i.test(firstFont), `--sans 主字体不应为衬线：${firstFont}`);
const bodyBlock = css.match(/(?:^|\})[\s\S]*?body\s*\{([\s\S]*?)\}/m) || css.match(/body\s*\{([\s\S]*?)\}/);
ok(bodyBlock && /font-family\s*:\s*var\(--sans\)/.test(bodyBlock[1]),
  "body 的 font-family 应使用 var(--sans)");

// 4. .topnav fixed/sticky 且白底
const topnavBlock = css.match(/\.topnav\s*\{([\s\S]*?)\}/);
ok(topnavBlock && /position\s*:\s*(fixed|sticky)/.test(topnavBlock[1]),
  ".topnav 应 position: fixed 或 sticky");
ok(topnavBlock && /background\s*:\s*(var\(--surface\)|#fff(?:fff)?\b|white\b)/i.test(topnavBlock[1]),
  ".topnav 背景应为白色");

// 5. 两行截断
ok(/(-webkit-)?line-clamp\s*:\s*2/.test(css), "缺少 line-clamp: 2（摘要两行截断）");

// 6. 无重阴影：box-shadow 的 y 偏移不得 ≥8px
for (const m of css.matchAll(/box-shadow\s*:\s*([^;]+);/g)) {
  const nums = m[1].match(/-?\d+(?:\.\d+)?px/g) || [];
  const y = parseFloat(nums[1] ?? "0");
  ok(Math.abs(y) < 8, `box-shadow 重阴影（y 偏移 ${nums[1]}）：${m[1].trim()}`);
}

// 7. DESIGN.md token 表
ok(/#0066FF/i.test(design), "docs/DESIGN.md 缺少 #0066FF");
ok(/#F6F6F6/i.test(design), "docs/DESIGN.md 缺少 #F6F6F6");

if (fails.length) {
  for (const f of fails) console.error(`[style-tokens] FAIL ${f}`);
  process.exit(1);
}
console.log("[style-tokens] ok");
