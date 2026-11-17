// feed-topic-pills.mjs — Z1076 列表接口 topics + 信息流卡片话题胶囊断言。
//
// 断言：
//  API 层
//   1) GET /questions?limit=30 -> 200，带非空 topics 的条目 >= 20；
//      每个 topic 元素含整数 id 与非空 name；每题 topics.length <= 3。
//   2) /feed/hot 与 /feed/recommended 同样返回非空 topics（口径一致）。
//  UI 层（playwright-core + 系统 chromium）
//   3) 桌面 1440×900 与移动 390×844 各一遍：首页信息流（推荐 tab，未登录）
//      可见 .feed__item .feed__topics .tag >= 8；胶囊文案非空；
//      background-color 非 transparent；胶囊字号 < 同卡标题字号。
//   4) DOM 顺序：同一 .feed__item 内 标题(.feed__title) → 摘要(.feed__excerpt)
//      → 元信息(.feed__meta) → 胶囊(.feed__topics)。
//   5) 登录态（API 注册后注入 localStorage token）信息流同样渲染胶囊；
//      console error == 0；无横向溢出。
//
// Env: API_BASE（默认 http://127.0.0.1:3030/zhihucopy/api）
//      E2E_BASE 覆盖页面地址（默认 API_BASE 去掉 /api）
//      CHROME 可覆盖浏览器路径；截图失败现场到 /root/logs。

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { API, req, register, expect, main } from "./lib.mjs";

const BASE = (
  process.env.E2E_BASE || API.replace(/\/api$/, "")
).replace(/\/+$/, "");
const SHOT_DIR = process.env.E2E_SHOT_DIR || "/root/logs";
const TOKEN_KEY = "zhihu_token";

let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  const req2 = createRequire(new URL("../e2e/lib.mjs", import.meta.url));
  ({ chromium } = req2("playwright-core"));
}

function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = "/root/.cache/ms-playwright";
  for (const d of fs
    .readdirSync(root)
    .filter((d) => d.startsWith("chromium-"))
    .sort()
    .reverse()) {
    const p = path.join(root, d, "chrome-linux", "chrome");
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`no chromium under ${root}`);
}

// ---------- API 层 ----------

async function assertApi() {
  const r = await req("GET", "/questions?limit=30");
  expect(r.status === 200, `GET /questions?limit=30 -> ${r.status}`);
  const items = r.data.items || [];
  expect(items.length > 0, "列表为空，无法断言 topics");
  let withTopics = 0;
  for (const q of items) {
    expect(Array.isArray(q.topics), `问题 ${q.id} 缺 topics 数组字段`);
    expect(q.topics.length <= 3, `问题 ${q.id} topics=${q.topics.length} > 3（应截断）`);
    for (const t of q.topics) {
      expect(Number.isInteger(t.id), `问题 ${q.id} topic 缺整数 id: ${JSON.stringify(t)}`);
      expect(typeof t.name === "string" && t.name.trim(), `问题 ${q.id} topic name 为空`);
    }
    if (q.topics.length) withTopics++;
  }
  expect(
    withTopics >= 20,
    `GET /questions?limit=30 带非空 topics 的条目 ${withTopics}/${items.length} < 20`
  );
  console.log(`[feed-topic-pills] /questions: withTopics=${withTopics}/${items.length}`);

  // 同口径：热榜与推荐流也应返回非空 topics。
  const hot = await req("GET", "/feed/hot");
  expect(hot.status === 200, `GET /feed/hot -> ${hot.status}`);
  const hotItems = hot.data.items || [];
  const hotWith = hotItems.filter((q) => Array.isArray(q.topics) && q.topics.length).length;
  expect(hotItems.length === 0 || hotWith >= Math.ceil(hotItems.length / 2),
    `/feed/hot 带 topics 的条目 ${hotWith}/${hotItems.length} 过少`);

  const rec = await req("GET", "/feed/recommended?limit=20");
  expect(rec.status === 200, `GET /feed/recommended -> ${rec.status}`);
  const recItems = rec.data.items || [];
  const recWith = recItems.filter((q) => Array.isArray(q.topics) && q.topics.length).length;
  expect(recItems.length === 0 || recWith >= 10,
    `/feed/recommended 带 topics 的条目 ${recWith}/${recItems.length} < 10`);
  console.log(`[feed-topic-pills] hot=${hotWith}/${hotItems.length} rec=${recWith}/${recItems.length}`);
}

// ---------- UI 层 ----------

async function assertFeedPills(page, label) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  // 等首屏信息流卡片渲染出来（推荐 tab 默认，无需登录）。登录态下 auth
  // 解析会触发一次 refetch，列表有短暂清空期，必须等胶囊数稳定到位而非首枚可见。
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".feed__item .feed__topics .tag")].filter(
        (el) => el.offsetParent !== null
      ).length >= 8,
    { timeout: 20000 }
  );

  // 单次 evaluate 原子收集可见胶囊信息；若撞上 auth refetch 的清空窗口，
  // 等下一轮列表回稳再采（最多 5 次）。
  let infos = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    infos = await page.evaluate(() =>
      [...document.querySelectorAll(".feed__item .feed__topics .tag")]
        .filter((el) => el.offsetParent !== null)
        .map((el) => {
          const cs = getComputedStyle(el);
          const card = el.closest(".feed__item");
          const title = card && card.querySelector(".feed__title");
          return {
            text: (el.textContent || "").trim(),
            bg: cs.backgroundColor,
            font: parseFloat(cs.fontSize),
            titleFont: title ? parseFloat(getComputedStyle(title).fontSize) : 0,
          };
        })
    );
    if (infos.length >= 8) break;
    await page.waitForTimeout(500);
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".feed__item .feed__topics .tag")].filter(
          (el) => el.offsetParent !== null
        ).length >= 8,
      { timeout: 20000 }
    );
  }
  expect(infos.length >= 8, `${label}：首屏可见话题胶囊 ${infos.length} < 8`);

  // 每个可见胶囊：文案非空、浅灰底（非透明）、字号 < 同卡标题字号。
  infos.forEach((info, i) => {
    expect(info.text.length > 0, `${label}：第 ${i + 1} 个胶囊文案为空`);
    expect(
      info.bg !== "transparent" && info.bg !== "rgba(0, 0, 0, 0)",
      `${label}：胶囊「${info.text}」背景为透明（应浅灰底）`
    );
    expect(
      info.titleFont === 0 || info.font < info.titleFont,
      `${label}：胶囊字号 ${info.font}px 不小于标题字号 ${info.titleFont}px`
    );
  });

  // DOM 顺序：同卡内 标题 → 摘要 → 元信息 → 胶囊。
  const orderBad = await page.evaluate(() => {
    const AFTER = Node.DOCUMENT_POSITION_FOLLOWING;
    const bad = [];
    document.querySelectorAll(".feed__item").forEach((card, idx) => {
      const topics = card.querySelector(".feed__topics");
      if (!topics) return;
      const seq = [".feed__title", ".feed__excerpt", ".feed__meta", ".feed__topics"];
      const els = seq.map((s) => card.querySelector(s));
      for (let i = 0; i + 1 < els.length; i++) {
        if (!els[i] || !els[i + 1]) continue;
        if (!(els[i].compareDocumentPosition(els[i + 1]) & AFTER)) {
          bad.push(`card#${idx} ${seq[i]} 不在 ${seq[i + 1]} 之前`);
        }
      }
    });
    return bad;
  });
  expect(orderBad.length === 0, `${label}：卡片结构顺序错误 ${orderBad.join("; ")}`);

  // 无横向溢出。
  const sw = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
  );
  const vw = page.viewportSize().width;
  expect(sw <= vw, `${label}：横向溢出 scrollWidth=${sw} > ${vw}`);
}

async function assertUi() {
  const browser = await chromium.launch({
    executablePath: chromePath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  let shotPage = null;
  try {
    // ---- 桌面 1440，未登录 ----
    const dctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
    });
    let page = await dctx.newPage();
    shotPage = page;
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    await assertFeedPills(page, "桌面1440/未登录");
    expect(errors.length === 0, `桌面未登录 console error: ${errors.slice(0, 3).join(" | ")}`);

    // ---- 桌面 1440，登录态（API 注册 → 注入 token）----
    const { token } = await register("pills-assert");
    await page.evaluate(
      ([k, t]) => localStorage.setItem(k, t),
      [TOKEN_KEY, token]
    );
    errors.length = 0;
    await assertFeedPills(page, "桌面1440/登录");
    expect(errors.length === 0, `桌面登录 console error: ${errors.slice(0, 3).join(" | ")}`);
    await dctx.close();

    // ---- 移动 390，未登录 ----
    const mctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "zh-CN",
      isMobile: true,
      hasTouch: true,
    });
    page = await mctx.newPage();
    shotPage = page;
    page.setDefaultTimeout(15000);
    errors.length = 0;
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    await assertFeedPills(page, "移动390/未登录");
    expect(errors.length === 0, `移动未登录 console error: ${errors.slice(0, 3).join(" | ")}`);
    await mctx.close();
  } catch (e) {
    if (shotPage) {
      try {
        fs.mkdirSync(SHOT_DIR, { recursive: true });
        const p = path.join(SHOT_DIR, `feed-topic-pills-${Date.now()}.png`);
        await shotPage.screenshot({ path: p, fullPage: true });
        console.error(`[feed-topic-pills] screenshot: ${p}`);
      } catch {}
    }
    throw e;
  } finally {
    await browser.close();
  }
}

main("feed-topic-pills", async () => {
  await assertApi();
  await assertUi();
});
