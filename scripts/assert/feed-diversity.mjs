// Z1114 — 推荐流话题多样性（内容厚度，P2）。
//
//   API 级（API_BASE，缺省 3030）：
//     1) GET /feed/recommended?limit=20：items.length === 20；带 diversity 字段，
//        diversity.tech_ratio <= 0.5；categories 中非技术大类计数 >0 的 >= 4 个；
//        guaranteed_missing 为数组；
//     2) 前 20 条同一 topic_id 连续出现 <= 2 次；
//     3) 连续两次请求 items.map(i=>i.id) 完全一致（分页可复现）；
//     4) 以条目 topics 独立复算大类分布，与 diversity.categories 一致（口径自证，
//        不是服务端自说自话）。
//   浏览器级（E2E_BASE，缺省 API_BASE 去 /api；干净上下文、不登录）：
//     5) 1440x900 打开 /：默认「推荐」tab 首屏 20 卡内含 >=4 个非技术话题胶囊；
//        body.innerText > 500；window.__errs 为空；无横向溢出；
//     6) 390x844：首屏仍出卡、无横向溢出、__errs 为空。
//
// Env: API_BASE / E2E_BASE / CHROME。
// 反向自检：未修基线（纯时间序，无 diversity 字段；实测首屏 tech 占比 ~0.7）
// 跑本断言必须在第 1 步 FAIL。
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

async function checkApi() {
  const feed = await ok("GET", "/feed/recommended?page=1&limit=20");
  expect(Array.isArray(feed.items), "items 不是数组");
  expect(
    feed.items.length === 20,
    `items.length=${feed.items.length}（库存 111+ 题，必须满 20）`
  );
  // 独立复算（不轻信服务端字段）：按条目 topics 重新归大类。
  const recalc = {};
  for (const it of feed.items) {
    const c = itemCat(it);
    recalc[c] = (recalc[c] || 0) + 1;
  }
  const techCount = recalc.tech || 0;
  const recalcRatio = techCount / feed.items.length;
  expect(
    feed.diversity && typeof feed.diversity.tech_ratio === "number",
    `响应缺 diversity.tech_ratio（疑似未修基线；按条目复算 tech 占比 ${recalcRatio.toFixed(2)}）`
  );
  for (const [k, v] of Object.entries(feed.diversity.categories)) {
    expect(
      (recalc[k] || 0) === v,
      `diversity.categories.${k}=${v} 与按条目复算 ${recalc[k] || 0} 不一致`
    );
  }
  expect(
    feed.diversity.tech_ratio <= 0.5,
    `tech_ratio=${feed.diversity.tech_ratio} > 0.5（按条目复算 ${recalcRatio.toFixed(2)}）`
  );
  const nonTechPresent = [...NON_TECH].filter(
    (c) => (feed.diversity.categories[c] || 0) > 0
  );
  expect(
    nonTechPresent.length >= 4,
    `非技术大类仅 ${nonTechPresent.length} 个（${nonTechPresent.join("/")}），要求 >=4`
  );
  expect(
    Array.isArray(feed.diversity.guaranteed_missing),
    "guaranteed_missing 不是数组"
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
  console.log(
    `  API: tech_ratio=${feed.diversity.tech_ratio}（复算 ${recalcRatio.toFixed(2)}），` +
      `非技术大类 ${nonTechPresent.length} 个（${nonTechPresent.join("/")}），` +
      `missing=[${feed.diversity.guaranteed_missing.join(",")}]，两次请求 id 序一致`
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

async function checkHome(page, tag, pillCheck) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".feed__item, .empty, .errorbox");
  const cards = page.locator(".feed__item");
  const cardCount = await cards.count();
  expect(cardCount > 0, `${tag} 首屏无 .feed__item 卡片`);
  if (pillCheck) {
    const first20 = Math.min(20, cardCount);
    expect(first20 === 20, `${tag} 首屏卡片 ${cardCount} < 20`);
    const pillTexts = [];
    for (let i = 0; i < first20; i++) {
      pillTexts.push(...(await cards.nth(i).locator(".feed__topics .tag").allTextContents()));
    }
    const nonTechPills = pillTexts.filter((t) => {
      const c = topicCategory(t.trim());
      return c && c !== "tech";
    });
    expect(
      nonTechPills.length >= 4,
      `${tag} 首屏 20 卡非技术话题胶囊 ${nonTechPills.length} < 4（共 ${pillTexts.length} 粒）`
    );
    console.log(
      `  ${tag}: 首屏 ${first20} 卡，胶囊 ${pillTexts.length} 粒，非技术 ${nonTechPills.length} 粒（${[...new Set(nonTechPills)].join("/")}）`
    );
  }
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
  if (!pillCheck) console.log(`  ${tag}: 首屏 ${cardCount} 卡，溢出 ${overflow}px，__errs 0`);
}

run("feed-diversity", async ({ browser }) => {
  await checkApi();
  for (const [w, h, tag, pillCheck] of [
    [1440, 900, "desktop1440", true],
    [390, 844, "mobile390", false],
  ]) {
    const page = await newCleanPage(browser, w, h);
    try {
      await checkHome(page, tag, pillCheck);
    } finally {
      await page.context().close();
    }
  }
});
