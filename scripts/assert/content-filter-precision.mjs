// Z1001 — content-filter 兜底规则的精确度断言：
//   · 线上实测漏网形态（JS 判定）必须命中；
//   · 正常标题/昵称不得误杀（reviewer_zhang、英文标题、中文标题）；
//   · GET /questions?tab=new&limit=20 首屏无任何命中项（SQL 口径与 JS 同源，
//     接口侧再验一遍真实库过滤效果）。
// 跑法: API_BASE=http://127.0.0.1:3184/zhihucopy/api node scripts/assert/content-filter-precision.mjs
import { createRequire } from "node:module";

const API = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
// 与线上过滤同一判定口径（server/content-filter.js 是 CJS，用 createRequire 引入）。
const { isTestTitle, isTestNickname, isTestContent } = createRequire(import.meta.url)(
  "../../server/content-filter.js"
);

function fail(msg) {
  console.error(`[content-filter-precision] FAIL: ${msg}`);
  process.exit(1);
}

// ---- 正例：线上实测漏网形态（2026-11-15 首屏实测）必须命中 -------------------
const BAD_TITLES = [
  "第六轮巡检：通知文案去重 1794769250582",
  "关注流链路验证qmwi5d97q6w8？",
  "话题关注链路验证qmwi5d98q76cm？",
  "问题关注链路验证qmwi5d99186yg？",
  "前端性能排查记录srchmwi5d5t32510",
];
const BAD_NICKNAMES = ["用户nmwi5d93041xk", "巡检c41o"];

// ---- 反例：正常内容不得命中 ------------------------------------------------
const GOOD_TITLES = [
  "为什么 Rust 的所有权设计更安全？",
  "What is CAP theorem?",
  "2026 年你读过的书",
];
const GOOD_NICKNAMES = ["reviewer_zhang"];

for (const t of BAD_TITLES) {
  if (!isTestTitle(t)) fail(`坏样本标题未命中: ${JSON.stringify(t)}`);
}
for (const n of BAD_NICKNAMES) {
  if (!isTestNickname(n)) fail(`坏样本昵称未命中: ${JSON.stringify(n)}`);
}
for (const t of GOOD_TITLES) {
  if (isTestTitle(t)) fail(`误杀正常标题: ${JSON.stringify(t)}`);
}
for (const n of GOOD_NICKNAMES) {
  if (isTestNickname(n)) fail(`误杀正常昵称: ${JSON.stringify(n)}`);
}
if (isTestContent("What is CAP theorem?", "reviewer_zhang")) {
  fail("isTestContent 误杀正常组合");
}
console.log(
  `  形态判定: 正例 ${BAD_TITLES.length} 题 + ${BAD_NICKNAMES.length} 昵称全部命中，` +
    `反例 ${GOOD_TITLES.length} 题 + ${GOOD_NICKNAMES.length} 昵称未误伤`
);

// ---- 接口侧：?tab=new 首屏不得有命中项 --------------------------------------
const res = await fetch(`${API}/questions?tab=new&limit=20`);
if (!res.ok) fail(`GET /questions?tab=new&limit=20 -> ${res.status}`);
const items = (await res.json()).items || [];
for (const it of items) {
  if (isTestTitle(it.title)) {
    fail(`tab=new 泄漏测试标题: ${JSON.stringify(it.title)}`);
  }
  if (it.author && isTestNickname(it.author.nickname)) {
    fail(`tab=new 泄漏测试作者: ${JSON.stringify(it.author.nickname)}`);
  }
}
console.log(`[content-filter-precision] ok (feed items=${items.length})`);
