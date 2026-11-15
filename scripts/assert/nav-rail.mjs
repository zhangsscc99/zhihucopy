#!/usr/bin/env node
// nav-rail.mjs — Z905 顶部导航 + 右侧热榜 静态断言（读源文件 + 正则，不起浏览器）
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const topNav = readFileSync(join(root, "client/src/components/TopNav.tsx"), "utf8");
const hotRail = readFileSync(join(root, "client/src/components/HotRail.tsx"), "utf8");
const css = readFileSync(join(root, "client/src/styles.css"), "utf8");

const fails = [];
const ok = (cond, msg) => {
  if (!cond) fails.push(msg);
};
const block = (src, selector) => {
  const m = src.match(new RegExp(selector.replace(/[.*]/g, (c) => `\\${c}`) + "\\s*\\{([^}]*)\\}"));
  return m ? m[1] : "";
};

// 1. TopNav 含「知乎（仿）」且不含「知海」
ok(topNav.includes("知乎（仿）"), "TopNav.tsx 缺少「知乎（仿）」");
ok(!topNav.includes("知海"), "TopNav.tsx 出现旧品牌「知海」");

// 2. 三个导航项 + 提问按钮
for (const label of ["首页", "发现", "等你来答", "提问"]) {
  ok(topNav.includes(label), `TopNav.tsx 缺少「${label}」`);
}

// 3. 搜索框在 DOM 上位于导航与右侧动作之间
const iLinks = topNav.indexOf("topnav__links");
const iSearch = topNav.indexOf('className="topnav__search"');
const iActions = topNav.indexOf("topnav__actions");
ok(
  iLinks > -1 && iSearch > -1 && iActions > -1 && iLinks < iSearch && iSearch < iActions,
  "TopNav.tsx DOM 顺序应为 导航链接 → 搜索框 → 右侧动作",
);

// 4. .topnav sticky/fixed + 白底
const topnavBlock = block(css, ".topnav");
ok(/position\s*:\s*(sticky|fixed)/.test(topnavBlock), ".topnav 应 position: sticky 或 fixed");
ok(
  /background\s*:\s*(var\(--surface\)|#fff(fff)?\b|white\b)/i.test(topnavBlock),
  ".topnav 背景应为白色",
);

// 5. 搜索框 #f6f6f6 灰底 + border-radius: var(--radius)
const searchBlock = block(css, ".field--search");
ok(
  /background\s*:\s*(#f6f6f6\b|var\(--paper\))/i.test(searchBlock),
  ".field--search 背景应为 #f6f6f6",
);
ok(/border-radius\s*:\s*var\(--radius\)/.test(searchBlock), ".field--search 应 border-radius: var(--radius)");

// 6. HotRail limit=10 + 前三名差异化 class，颜色 #ff5a5f / #ff7a45
ok(/limit=10/.test(hotRail), "HotRail.tsx 应请求 limit=10");
ok(/hotlist__rank--top1/.test(hotRail), "HotRail.tsx 序号缺少 top1 差异化 class");
ok(/hotlist__rank--top23/.test(hotRail), "HotRail.tsx 序号缺少 top23 差异化 class");
ok(
  /color\s*:\s*(#ff5a5f\b|var\(--hot-1\))/i.test(block(css, ".hotlist__rank--top1")),
  ".hotlist__rank--top1 颜色应为 #ff5a5f",
);
ok(
  /color\s*:\s*(#ff7a45\b|var\(--hot-23\))/i.test(block(css, ".hotlist__rank--top23")),
  ".hotlist__rank--top23 颜色应为 #ff7a45",
);

// 7. .rail-block 无重阴影（box-shadow 缺失或 y 偏移 < 8px）
const railBlock = block(css, ".rail-block");
const shadow = railBlock.match(/box-shadow\s*:\s*([^;]+);/);
if (shadow) {
  const nums = shadow[1].match(/-?\d+(?:\.\d+)?px/g) || [];
  const y = parseFloat(nums[1] ?? "0");
  ok(Math.abs(y) < 8, `.rail-block 存在重阴影：${shadow[1].trim()}`);
}

if (fails.length) {
  for (const f of fails) console.error(`[nav-rail] FAIL ${f}`);
  process.exit(1);
}
console.log("[nav-rail] ok");
