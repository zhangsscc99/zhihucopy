#!/usr/bin/env node
// nav-targets.mjs — Z980「发现」「等你来答」真实页面验收。
// 1) GET /questions?tab=unanswered：每条 answer_count === 0、按 created_at DESC、
//    且不含测试内容（复用 server/content-filter.js 的 isTestContent 口径）。
// 2) GET /topics：话题列表接口可用（items 为数组、每条含 id/name）。
// 3) 静态读 client/src 源码：TopNav「发现」→ /topics、「等你来答」→ /unanswered，
//    全 src 中不存在 to="/?tab=hot" 这类指向首页 tab 的假链接。
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { ok, expect, main } from "./lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const requireFromServer = createRequire(new URL("../../server/package.json", import.meta.url));
const { isTestContent } = requireFromServer("./content-filter.js");

function srcFiles(dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...srcFiles(p));
    else if (/\.(tsx?|jsx?)$/.test(ent.name)) out.push(p);
  }
  return out;
}

// 导航/跳转目标写死成首页 tab 的假链接形态；API 路径（"/questions?tab=hot"）不算。
const FAKE_LINK = [
  /\bto\s*=\s*["'`]\/\?tab=/, // to="/?tab=hot" / to='...' / to=`...`
  /\bto\s*=\s*\{\s*["'`]\/\?tab=/, // to={"/?tab=hot"}
  /\bhref\s*=\s*["'`]\/\?tab=/, // href="/?tab=hot"
  /\bnavigate\(\s*["'`]\/\?tab=/, // navigate("/?tab=hot")
];

main("nav-targets", async () => {
  // 1) unanswered 流
  const un = await ok("GET", "/questions?tab=unanswered&limit=50");
  expect(Array.isArray(un.items), "unanswered: items 不是数组");
  for (const q of un.items) {
    expect(
      q.answer_count === 0,
      `unanswered: #${q.id}「${String(q.title).slice(0, 24)}」answer_count=${q.answer_count}`
    );
    expect(
      !isTestContent(q.title, q.author?.nickname),
      `unanswered: #${q.id} 疑似测试内容（${String(q.title).slice(0, 24)} / ${q.author?.nickname}）`
    );
  }
  for (let i = 1; i < un.items.length; i++) {
    expect(
      un.items[i - 1].created_at >= un.items[i].created_at,
      "unanswered: 未按 created_at DESC 排序"
    );
  }

  // 2) 话题列表接口
  const topics = await ok("GET", "/topics?limit=50");
  expect(Array.isArray(topics.items), "topics: items 不是数组");
  for (const t of topics.items) {
    expect(
      Number.isInteger(t.id) && typeof t.name === "string" && t.name.length > 0,
      `topics: 条目缺 id/name（${JSON.stringify(t).slice(0, 120)}）`
    );
  }

  // 3) 前端源码：真实路由 + 无假链接
  const topNav = readFileSync(join(root, "client/src/components/TopNav.tsx"), "utf8");
  expect(/to="\/topics"/.test(topNav), "TopNav.tsx 缺少指向 /topics 的「发现」链接");
  expect(/to="\/unanswered"/.test(topNav), "TopNav.tsx 缺少指向 /unanswered 的「等你来答」链接");

  const app = readFileSync(join(root, "client/src/App.tsx"), "utf8");
  expect(/path="\/unanswered"/.test(app), "App.tsx 未注册 /unanswered 路由");
  expect(/path="\/topics"/.test(app), "App.tsx 未注册 /topics 路由");
  expect(existsSync(join(root, "client/src/pages/Unanswered.tsx")), "缺少 pages/Unanswered.tsx");
  expect(existsSync(join(root, "client/src/pages/Topics.tsx")), "缺少 pages/Topics.tsx");

  const srcDir = join(root, "client", "src");
  for (const file of srcFiles(srcDir)) {
    const src = readFileSync(file, "utf8");
    for (const re of FAKE_LINK) {
      const m = src.match(re);
      expect(!m, `${file.replace(root + "/", "")} 存在指向首页 tab 的假链接：${m?.[0]}`);
    }
  }
});
