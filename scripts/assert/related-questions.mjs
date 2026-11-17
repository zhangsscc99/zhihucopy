// Z1146 — 问题页底部「相关问题」区块（P2）。
//
// 覆盖：
//  1) API：GET /questions/6/related → {items:[…]}（≤6 条、不含自身 id=6、每项
//     id/title/answer_count/view_count/topics[:{id,name}] 齐备）；不存在 → 404；
//  2) 浏览器 1440x900 /question/6：.related 出现且标题「相关问题」，.related__item
//     ≥3，每条标题链接 href 匹配 /question/\d+ 且不含 /question/6，每行含
//     「个回答」；documentElement 无横向溢出、区块 rect.right ≤ innerWidth；
//  3) 无话题问题（本脚本注册账号 + POST /questions 不带 topic_ids，退出自清理）：
//     related 接口应答后 .related 整块 0 个；
//  4) 点第一条标题链接 → URL 变 /question/<id>、main h1 文案变化、__errs 为空；
//  5) 390x844 同 2) 的溢出/边界断言。
//
// Env: API_BASE / E2E_BASE / CHROME / DB_PATH。退出码 0 PASS / 1 FAIL。

const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
const BASE = (process.env.E2E_BASE || API_BASE.replace(/\/api$/, "")).replace(/\/+$/, "");
// e2e/lib.mjs 顶层按 env 求值 BASE/API，须在动态 import 前赋值。
process.env.E2E_BASE ||= BASE;
process.env.API_BASE ||= API_BASE;
const { run, expect, api, apiOk, register, TOKEN_KEY } = await import("../e2e/lib.mjs");

function inject(page) {
  return page.addInitScript(() => {
    const w = window;
    w.__errs = [];
    w.addEventListener("error", (e) => w.__errs.push(`error:${e.message}`));
    w.addEventListener("unhandledrejection", (e) =>
      w.__errs.push(`unhandledrejection:${e.reason && e.reason.message ? e.reason.message : e.reason}`)
    );
    const ce = console.error.bind(console);
    console.error = (...a) => {
      w.__errs.push(`console.error:${a.map(String).join(" ")}`);
      ce(...a);
    };
  });
}

const pageErrs = (page) => page.evaluate(() => window.__errs || []);

// 「相关问题」区块：出现、条目数、行形态、横向溢出与视口边界。
async function checkRelatedBlock(page, tag, selfId) {
  await page
    .locator(".related")
    .waitFor({ state: "visible" })
    .catch(() => {
      throw new Error(`[${tag}] /question/${selfId} 未渲染「相关问题」区块`);
    });
  const title = await page.locator(".related__title").innerText();
  expect(title.includes("相关问题"), `[${tag}] 区块标题不含「相关问题」：${title}`);
  const items = page.locator(".related__item");
  const n = await items.count();
  expect(n >= 3, `[${tag}] 相关问题条目 ${n} < 3`);
  for (let i = 0; i < n; i++) {
    const item = items.nth(i);
    const link = item.locator('a[href*="/question/"]').first();
    const href = await link.getAttribute("href");
    expect(
      href && /\/question\/\d+/.test(href),
      `[${tag}] 第 ${i + 1} 条标题链接 href 非 /question/<id>：${href}`
    );
    const m = href.match(/\/question\/(\d+)/);
    expect(m && Number(m[1]) !== selfId, `[${tag}] 第 ${i + 1} 条指向自身 /question/${selfId}`);
    const text = await item.innerText();
    expect(text.includes("个回答"), `[${tag}] 第 ${i + 1} 条缺「N 个回答」：${text}`);
  }
  const m = await page.evaluate(() => {
    const el = document.querySelector(".related");
    const r = el ? el.getBoundingClientRect() : null;
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      right: r && r.right,
      vw: window.innerWidth,
    };
  });
  expect(m.overflow === 0, `[${tag}] 横向溢出 ${m.overflow}px`);
  expect(
    m.right !== null && m.right <= m.vw,
    `[${tag}] 区块右缘越界 right=${m.right} vw=${m.vw}`
  );
  return n;
}

run("related-questions", async ({ browser }) => {
  // ---- 浏览器 1440x900：/question/6 区块 + 点击跳转 ------------------------
  // 先于任何写操作跑这一段：反向自检（线上）在「区块不存在」处即 FAIL，
  // 不会触到后面的 register/POST。
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await inject(page);
    await page.goto(`${BASE}/question/6`);
    await page.waitForSelector("main h1");
    const h1Before = (await page.locator("main h1").innerText()).trim();
    await checkRelatedBlock(page, "1440", 6);

    // 点第一条 → 站内跳到对应问题页，h1 变化。
    const firstHref = await page
      .locator(".related__item")
      .first()
      .locator('a[href*="/question/"]')
      .first()
      .getAttribute("href");
    const targetId = Number(firstHref.match(/\/question\/(\d+)/)[1]);
    await page.locator(".related__item").first().locator('a[href*="/question/"]').first().click();
    await page.waitForURL(new RegExp(`/question/${targetId}(\\?|#|$)`), { timeout: 10000 });
    await page.waitForSelector("main h1");
    await page.waitForFunction(
      (prev) => document.querySelector("main h1")?.textContent.trim() !== prev,
      h1Before
    );
    const errs = await pageErrs(page);
    expect(errs.length === 0, `[1440] __errs: ${errs.slice(0, 3).join(" | ")}`);
    await context.close();
  }

  // ---- API 侧 -----------------------------------------------------------
  const rel = await apiOk("GET", "/questions/6/related");
  expect(Array.isArray(rel.items), "[api] /questions/6/related 缺 items 数组");
  expect(rel.items.length >= 3 && rel.items.length <= 6, `[api] items=${rel.items.length} 不在 3..6`);
  for (const it of rel.items) {
    expect(Number.isInteger(it.id) && it.id !== 6, `[api] 含自身/坏 id：${JSON.stringify(it)}`);
    expect(typeof it.title === "string" && it.title, "[api] 缺 title");
    expect(Number.isInteger(it.answer_count), "[api] 缺 answer_count");
    expect(Number.isInteger(it.view_count), "[api] 缺 view_count");
    expect(
      Array.isArray(it.topics) && it.topics.every((t) => Number.isInteger(t.id) && t.name),
      `[api] topics 形态错：${JSON.stringify(it.topics)}`
    );
  }
  const missing = await api("GET", "/questions/99999999/related");
  expect(missing.status === 404 && missing.data.error === "问题不存在",
    `[api] 不存在问题非 404：${missing.status} ${JSON.stringify(missing.data)}`);

  // ---- 无话题问题：区块整块不渲染 -----------------------------------------
  {
    const { token } = await register("e2e-related");
    const created = await apiOk("POST", "/questions", {
      token,
      body: { title: "没有绑定话题的提问会显示相关问题吗" },
    });
    const qid = created.question.id;

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await inject(page);
    // 等 related 接口应答完再判缺席，避免「还没拉到」误报。
    const relResp = page.waitForResponse(
      (r) => new RegExp(`/api/questions/${qid}/related`).test(r.url()),
      { timeout: 15000 }
    );
    await page.goto(`${BASE}/question/${qid}`);
    await page.waitForSelector("main h1");
    const resp = await relResp;
    expect(resp.status() === 200, `[no-topic] related 应答 ${resp.status()}`);
    const body = await resp.json();
    expect(Array.isArray(body.items) && body.items.length === 0,
      `[no-topic] items 非空：${JSON.stringify(body.items).slice(0, 200)}`);
    expect((await page.locator(".related").count()) === 0, "[no-topic] .related 仍被渲染");
    const errs = await pageErrs(page);
    expect(errs.length === 0, `[no-topic] __errs: ${errs.slice(0, 3).join(" | ")}`);
    await context.close();
  }

  // ---- 浏览器 390x844：区块存在 + 无横向溢出 -------------------------------
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-CN" });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await inject(page);
    await page.goto(`${BASE}/question/6`);
    await page.waitForSelector("main h1");
    await checkRelatedBlock(page, "390", 6);
    const errs = await pageErrs(page);
    expect(errs.length === 0, `[390] __errs: ${errs.slice(0, 3).join(" | ")}`);
    await context.close();
  }
});
