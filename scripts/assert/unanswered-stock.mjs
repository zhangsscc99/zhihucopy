// unanswered-stock.mjs — Z1102 零回答问题存量 + 右栏「等你来答」渲染。
//
//   API 级（import { ok, expect } from ./lib.mjs）：
//     GET /questions?tab=unanswered 返回 >= 5 条；
//     每条 answer_count === 0 且 topics 非空（右栏条目与话题胶囊都靠它）。
//
//   浏览器级（import { run } from ../e2e/lib.mjs，结构照抄 rail-second-block.mjs）：
//     桌面 1440×900 首页：.rail-block 恰好 2 块；第二块标题含「等你来答」、
//       >= 3 条指向 /question/<id> 的链接；body 文本 > 200；
//       window.__errs 为空；documentElement.scrollWidth - clientWidth === 0。
//     移动 390×844：「等你来答」块不渲染（.rail-block <= 1 或该块不可见）；
//       同样无 __errs、无横向溢出。
//
// 数据前提：库内已有 >= 5 条零回答问题（由 scripts/seed-unanswered.js 补库）。
// 本断言只读不写、不建夹具，退出时 cleanupOwned() 为空操作，不往库里留产物。
//
// Env: API_BASE（缺省 3030）、E2E_BASE（缺省 API_BASE 去掉 /api）。
// 反向自检：补库前 /questions?tab=unanswered 为 0 条，API 断言即 FAIL。

import { ok, expect } from "./lib.mjs";

const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
const BASE = (process.env.E2E_BASE || API_BASE.replace(/\/api$/, "")).replace(/\/+$/, "");
process.env.E2E_BASE ||= BASE;
// e2e/lib.mjs 顶层按 env 求值 BASE，须在赋值后动态引入。
const { run, cleanupOwned } = await import("../e2e/lib.mjs");

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

async function checkStock() {
  const page = await ok("GET", "/questions?tab=unanswered&page=1&limit=20");
  const items = page.items || [];
  expect(
    items.length >= 5,
    `/questions?tab=unanswered 仅 ${items.length} 条（需 >= 5，右栏存量不足）`
  );
  const bad = items.filter((q) => q.answer_count !== 0);
  expect(bad.length === 0, `unanswered 列表混入已答题：${bad.map((q) => q.id).join(",")}`);
  const noTopic = items.filter((q) => !Array.isArray(q.topics) || q.topics.length === 0);
  expect(noTopic.length === 0, `unanswered 条目不挂话题：${noTopic.map((q) => q.id).join(",")}`);
  console.log(
    `  api: unanswered ${page.total} 条（本页 ${items.length}），全部 answer_count=0 且挂话题`
  );
}

async function newCleanPage(browser, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: "zh-CN" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  await page.addInitScript(ERR_HOOK);
  return page;
}

async function checkCommon(page, tag) {
  const bodyLen = await page.evaluate(() => (document.body.innerText || "").length);
  expect(bodyLen > 200, `${tag} body 文本仅 ${bodyLen} 字符（疑似白屏）`);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow === 0, `${tag} 横向溢出 ${overflow}px（需 === 0）`);
  const errs = await page.evaluate(() => window.__errs || []);
  expect(errs.length === 0, `${tag} window.__errs ${errs.length} 条: ${errs.slice(0, 3).join(" | ")}`);
}

async function checkDesktop(page) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".rail-block");
  // 等异步拉取落地；存量为 0 时第二块永不出现，等满 5s 后给出更直白的块数报错。
  await page
    .locator(".rail-block--unanswered")
    .first()
    .waitFor({ state: "visible", timeout: 5000 })
    .catch(() => {});

  const blocks = await page.locator(".rail-block").count();
  expect(blocks === 2, `桌面右栏 .rail-block 为 ${blocks} 块（需 === 2：热榜 + 等你来答）`);

  const second = page.locator(".rail-block").nth(1);
  const headText = await second.locator(".rail-block__title").innerText();
  expect(headText.includes("等你来答"), `第二块标题为 ${JSON.stringify(headText)}（需含「等你来答」）`);

  const qLinks = await second.locator('a[href*="/question/"]').count();
  expect(qLinks >= 3, `第二块仅 ${qLinks} 条问题链接（需 >= 3）`);

  await checkCommon(page, "desktop1440");
  console.log(`  desktop1440: ${blocks} 块 .rail-block，第二块 ${qLinks} 条问题链接`);
}

async function checkMobile(page) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".rail-block").catch(() => {});
  const blocks = await page.locator(".rail-block").count();
  const visible = await page
    .locator(".rail-block--unanswered")
    .isVisible()
    .catch(() => false);
  expect(
    blocks <= 1 || !visible,
    `mobile390 右栏仍渲染「等你来答」：${blocks} 块 .rail-block，unanswered 可见=${visible}`
  );
  await checkCommon(page, "mobile390");
  console.log(`  mobile390: ${blocks} 块 .rail-block，「等你来答」不可见`);
}

run("unanswered-stock", async ({ browser }) => {
  await checkStock();
  const desktop = await newCleanPage(browser, 1440, 900);
  try {
    await checkDesktop(desktop);
  } finally {
    await desktop.context().close();
  }
  const mobile = await newCleanPage(browser, 390, 844);
  try {
    await checkMobile(mobile);
  } finally {
    await mobile.context().close();
  }
  // 本断言无自建产物；cleanupOwned 在 owned 为空时直接返回。
  cleanupOwned();
});
