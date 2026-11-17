// Z1120 — 推荐流首屏空壳题降权（P1）。
//
//   API 级（API_BASE，缺省 3030）：
//     1) GET /feed/recommended?page=1&limit=20：items.length === 20；按条目
//        复算 answer_count===0 的条数 <= 1（不轻信服务端字段）；服务端
//        diversity.zero_answer_in_page 与复算一致（字段存在且口径正确）；
//     2) 既有 Z1114 配额不回归（全部按条目 topics 独立复算）：tech 占比
//        <= 0.5、非技术大类 >= 4、同 topic_id 连续 <= 2 次；
//     3) 连续两次请求 items.map(i=>i.id) 完全一致（重排可复现）；
//     4) 降权而非排除：/feed/recommended 第 2+3 页合计仍取到 >=3 条
//        answer_count===0；且 /questions?tab=unanswered（「等你来答」）
//        >=3 条空壳（库存 10 条，137 题）。
//   浏览器级（E2E_BASE，缺省 API_BASE 去 /api；干净上下文、不登录）：
//     5) 1440x900 打开 /（默认「推荐」tab）：首屏 .feed__item 中
//        「0 个回答」卡 <= 1；body.innerText > 500；__errs 空；无横向溢出；
//     6) 390x844：同一组断言（移动首屏卡数少，仍要求零壳 <=1、无溢出）。
//
// Env: API_BASE / E2E_BASE / CHROME。
// 反向自检：未修基线（线上 :3030，实测首屏 0 回答题 7 条、无
// zero_answer_in_page 字段）跑本断言必须在第 1 步 FAIL。
import { createRequire } from "node:module";
import { ok, expect } from "./lib.mjs";

const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
const BASE = (process.env.E2E_BASE || API_BASE.replace(/\/api$/, "")).replace(/\/+$/, "");
process.env.E2E_BASE ||= BASE;
// e2e/lib.mjs 顶层按 env 求值 BASE，须在赋值后动态引入。
const { run } = await import("../e2e/lib.mjs");

// 与服务端同一口径的大类映射（server/feed-diversity.js 是 CJS）。
const { topicCategory } = createRequire(import.meta.url)(
  "../../server/feed-diversity.js"
);
const NON_TECH = new Set(["life", "psy", "work", "edu", "health", "money", "sci"]);

// 单卡展示大类 = 话题映射里第一个非 tech 类（与 server questionCategory 同规则）。
function itemCat(item) {
  const cats = (item.topics || []).map((t) => topicCategory(t.name)).filter(Boolean);
  return cats.find((c) => c !== "tech") || (cats.length ? "tech" : "other");
}

const zeroCount = (items) => items.filter((i) => i.answer_count === 0).length;

async function checkApi() {
  const feed = await ok("GET", "/feed/recommended?page=1&limit=20");
  expect(Array.isArray(feed.items), "items 不是数组");
  expect(
    feed.items.length === 20,
    `items.length=${feed.items.length}（库存 137 题，必须满 20）`
  );
  const zeros = zeroCount(feed.items);
  expect(
    feed.diversity && typeof feed.diversity.zero_answer_in_page === "number",
    `响应缺 diversity.zero_answer_in_page（疑似未修基线；按条目复算空壳 ${zeros} 条）`
  );
  expect(
    feed.diversity.zero_answer_in_page === zeros,
    `diversity.zero_answer_in_page=${feed.diversity.zero_answer_in_page} 与按条目复算 ${zeros} 不一致`
  );
  expect(
    zeros <= 1,
    `首屏 0 回答题 ${zeros} 条 > 1（未修基线实测 7）：` +
      feed.items
        .filter((i) => i.answer_count === 0)
        .map((i) => `#${i.id}`)
        .join(",")
  );
  // 既有配额不回归：按条目 topics 独立复算大类分布。
  const recalc = {};
  for (const it of feed.items) {
    const c = itemCat(it);
    recalc[c] = (recalc[c] || 0) + 1;
  }
  const recalcRatio = (recalc.tech || 0) / feed.items.length;
  expect(
    recalcRatio <= 0.5,
    `按条目复算 tech 占比 ${recalcRatio.toFixed(2)} > 0.5`
  );
  const nonTechPresent = [...NON_TECH].filter((c) => (recalc[c] || 0) > 0);
  expect(
    nonTechPresent.length >= 4,
    `非技术大类仅 ${nonTechPresent.length} 个（${nonTechPresent.join("/")}），要求 >=4`
  );
  // 同一 topic_id 连续出现 <= 2 次。
  for (let i = 2; i < feed.items.length; i++) {
    const t2 = new Set((feed.items[i].topics || []).map((t) => t.id));
    const share = (x) => (x.topics || []).some((t) => t2.has(t.id));
    expect(
      !(share(feed.items[i - 1]) && share(feed.items[i - 2])),
      `第 ${i - 1}~${i + 1} 条同一 topic 三连（ids=${feed.items
        .slice(i - 2, i + 1)
        .map((x) => x.id)
        .join(",")}）`
    );
  }
  // 可复现：同参再发一次，id 序完全一致。
  const again = await ok("GET", "/feed/recommended?page=1&limit=20");
  expect(
    JSON.stringify(again.items.map((i) => i.id)) ===
      JSON.stringify(feed.items.map((i) => i.id)),
    "连续两次 /feed/recommended?limit=20 返回的 id 序不一致"
  );
  // 降权而非排除：后续页与「等你来答」仍能取到空壳。
  const p2 = await ok("GET", "/feed/recommended?page=2&limit=20");
  const p3 = await ok("GET", "/feed/recommended?page=3&limit=20");
  const laterZeros = zeroCount(p2.items) + zeroCount(p3.items);
  expect(
    laterZeros >= 3,
    `推荐流第 2+3 页 0 回答题合计 ${laterZeros} < 3（空壳被排除了？）`
  );
  const un = await ok("GET", "/questions?tab=unanswered&limit=20");
  const unZeros = zeroCount(un.items || []);
  expect(
    unZeros >= 3,
    `/questions?tab=unanswered 仅 ${unZeros} 条 0 回答题（要求 >=3）`
  );
  console.log(
    `  API: 首屏空壳 ${zeros}（zero_answer_in_page=${feed.diversity.zero_answer_in_page}），` +
      `tech 占比复算 ${recalcRatio.toFixed(2)}，非技术大类 ${nonTechPresent.length} 个，` +
      `第2+3页空壳 ${laterZeros}，unanswered ${unZeros}，两次请求 id 序一致`
  );
}

const ERR_HOOK = () => {
  window.__errs = [];
  const push = (m) => {
    try {
      window.__errs.push(String(m && m.message ? m.message : m));
    } catch {}
  };
  window.addEventListener("error", (e) => push(e.message || e.error));
  window.addEventListener("unhandledrejection", (e) => push(e.reason));
  const orig = console.error.bind(console);
  console.error = (...a) => {
    push(a.map((x) => String(x)).join(" "));
    orig(...a);
  };
};

async function newCleanPage(browser, width, height) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    locale: "zh-CN",
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  await page.addInitScript(ERR_HOOK);
  return page;
}

async function checkHome(page, tag) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".feed__item, .empty, .errorbox");
  const cards = page.locator(".feed__item");
  const cardCount = await cards.count();
  expect(cardCount > 0, `${tag} 首屏无 .feed__item 卡片`);
  // 「0 个回答」卡：元信息行 span 文本精确匹配（避免误中「10 个回答」）。
  const zeroCards = await page
    .locator(".feed__item .feed__meta span", { hasText: /^0 个回答$/ })
    .count();
  expect(
    zeroCards <= 1,
    `${tag} 首屏「0 个回答」卡 ${zeroCards} > 1（共 ${cardCount} 卡）`
  );
  const bodyLen = await page.evaluate(() => (document.body.innerText || "").length);
  expect(bodyLen > 500, `${tag} body 文本仅 ${bodyLen} 字符（疑似白屏）`);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow <= 1, `${tag} 横向溢出 ${overflow}px`);
  const errs = await page.evaluate(() => window.__errs || []);
  expect(
    errs.length === 0,
    `${tag} window.__errs ${errs.length} 条: ${errs.slice(0, 3).join(" | ")}`
  );
  console.log(`  ${tag}: 首屏 ${cardCount} 卡，「0 个回答」卡 ${zeroCards}，溢出 ${overflow}px，__errs 0`);
}

run("feed-answer-floor", async ({ browser }) => {
  await checkApi();
  for (const [w, h, tag] of [
    [1440, 900, "desktop1440"],
    [390, 844, "mobile390"],
  ]) {
    const page = await newCleanPage(browser, w, h);
    try {
      await checkHome(page, tag);
    } finally {
      await page.context().close();
    }
  }
});
