// Brand assertions: 全站品牌统一为「知乎（仿）」，不得出现「知海」。
// Usage: node scripts/assert/brand.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const BRAND = "知乎（仿）";
const OLD = "知海";

function fail(msg) {
  console.error(`[brand] FAIL: ${msg}`);
  process.exit(1);
}

function walk(dir, exts, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (e === "node_modules" || e.startsWith(".")) continue;
      walk(p, exts, out);
    } else if (exts.some((x) => e.endsWith(x))) {
      out.push(p);
    }
  }
  return out;
}

const indexHtml = readFileSync(join(ROOT, "client/index.html"), "utf8");

// 1. <title> 含品牌名
const title = indexHtml.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
if (!title.includes(BRAND)) fail(`client/index.html <title> missing "${BRAND}": ${title}`);

// 2. meta description 含品牌名
const meta = indexHtml.match(/<meta\s+[^>]*name="description"[^>]*>/i)?.[0];
if (!meta) fail(`client/index.html missing <meta name="description">`);
if (!meta.includes(BRAND)) fail(`client/index.html meta description missing "${BRAND}": ${meta}`);

// 3. TopNav brand__name 文本必须是品牌名
const topNav = readFileSync(join(ROOT, "client/src/components/TopNav.tsx"), "utf8");
const brandName = topNav.match(/className="brand__name"[^>]*>([^<]*)</)?.[1] ?? "";
if (brandName !== BRAND) fail(`TopNav.tsx brand__name text is "${brandName}", expected "${BRAND}"`);

// 4. 扫描范围内不得出现「知海」（docs/runs 与 docs/FEATURES.md 不在范围内）
const targets = [
  ...walk(join(ROOT, "client/src"), [".ts", ".tsx", ".css"]),
  join(ROOT, "client/index.html"),
  ...walk(join(ROOT, "server"), [".js"]),
  join(ROOT, "README.md"),
];
let bad = 0;
for (const f of targets) {
  let lines;
  try {
    lines = readFileSync(f, "utf8").split("\n");
  } catch {
    continue; // 文件不存在则跳过（如 README.md）
  }
  lines.forEach((line, i) => {
    if (line.includes(OLD)) {
      console.error(`[brand] ${relative(ROOT, f)}:${i + 1}: ${line.trim()}`);
      bad++;
    }
  });
}
if (bad) fail(`found "${OLD}" in ${bad} line(s)`);

console.log("[brand] ok");
process.exit(0);
