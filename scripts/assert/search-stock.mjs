// Z1116 — 热词搜索语料厚度断言（API 级 + 浏览器级）。
//
// 背景：线上 /api/search?q=React 只命中 2 条问题、useEffect 2 条——召回逻辑
// 没问题，是语料库命中太少。本断言验证 seed-data 扩充 + append-stories.js
// 追加后的存量厚度。在「旧代码/旧数据」（未追加的库副本）上必须 FAIL。
//
// API 级（经 scripts/e2e/lib.mjs 的 apiOk，命中 API_BASE/E2E_BASE 推导的 API）：
//   1) GET /search?q=React|useEffect|TypeScript&type=question&limit=50：
//      total >= 5 且本页 items 中标题含该词（大小写不敏感）的比例 >= 60%。
//   2) GET /questions?tab=recommended&limit=15 首屏 >= 15 条；
//      GET /feed/recommended?limit=15（推荐 tab 真实数据源）首屏 >= 15 条
//      且至少 3 个不同大类话题出现（推荐流不许被技术题灌满）。
// 浏览器级（system chromium，/search?q=React）：
//   3) document.body.innerText.length > 400；无横向溢出；
//      window.__errs（注入 error/unhandledrejection/console.error 收集）为空；
//      可见结果条目（.feed__item）>= 5。
//
// Env: E2E_BASE || API_BASE(-/api) || http://127.0.0.1:3030/zhihucopy
//      CHROME 可覆盖浏览器路径；失败截图到 /root/logs。
// 退出码即结论：0 PASS / 1 FAIL。

import { createRequire } from "node:module";
import { run, apiOk, BASE, expect } from "../e2e/lib.mjs";

const reqScripts = createRequire(new URL("./search-stock.mjs", import.meta.url));
const { TOPICS } = reqScripts("../seed.js");
const TOPIC_CAT = new Map(TOPICS.map((t) => [t.name, t.cat]));

const KEYWORDS = ["React", "useEffect", "TypeScript"];

function injectErrs(page) {
  return page.addInitScript(() => {
    const w = window;
    w.__errs = [];
    w.addEventListener("error", (e) => w.__errs.push(`error:${e.message}`));
    w.addEventListener("unhandledrejection", (e) =>
      w.__errs.push(
        `rejection:${e.reason && e.reason.message ? e.reason.message : e.reason}`
      )
    );
    const origError = console.error;
    console.error = (...args) => {
      w.__errs.push(`console:${args.map(String).join(" ")}`);
      return origError.apply(console, args);
    };
  });
}

await run("search-stock", async ({ page }) => {
  // ---------- API 级：热词问题命中 ----------
  for (const kw of KEYWORDS) {
    const res = await apiOk(
      "GET",
      `/search?q=${encodeURIComponent(kw)}&type=question&limit=50`
    );
    const items = res.items || [];
    expect(
      res.total >= 5 && items.length >= 5,
      `search「${kw}」问题命中 total=${res.total} items=${items.length}，期望 >=5`
    );
    const titled = items.filter((it) =>
      String(it.title || "").toLowerCase().includes(kw.toLowerCase())
    ).length;
    const ratio = items.length ? titled / items.length : 0;
    expect(
      ratio >= 0.6,
      `search「${kw}」标题含词占比 ${titled}/${items.length}=${(ratio * 100).toFixed(0)}%，期望 >=60%`
    );
    console.log(`  [ok] q=${kw} total=${res.total} titled=${titled}/${items.length}`);
  }

  // ---------- API 级：推荐流多样性不回归 ----------
  // /questions?tab=recommended 兜底为 new 序（存量契约）；推荐 tab 的真实
  // 数据源是 /feed/recommended（服务端大类配额重排，响应带 diversity 字段）。
  // 两条都查：前者保证首屏量，后者保证「不许全变技术题」。
  {
    const res = await apiOk("GET", "/questions?tab=recommended&limit=15");
    const items = res.items || [];
    expect(items.length >= 15, `推荐流首屏 ${items.length} 条，期望 >=15`);

    const feed = await apiOk("GET", "/feed/recommended?limit=15");
    const feedItems = feed.items || [];
    expect(
      feedItems.length >= 15,
      `/feed/recommended 首屏 ${feedItems.length} 条，期望 >=15`
    );
    // 优先用响应自带 diversity.categories（服务端口径）；缺失时退回话题映射。
    const cats = new Set();
    const div = feed.diversity && feed.diversity.categories;
    if (div && typeof div === "object") {
      for (const [k, v] of Object.entries(div)) if (v > 0) cats.add(k);
    } else {
      for (const it of feedItems) {
        for (const t of it.topics || []) {
          const c = TOPIC_CAT.get(t.name);
          if (c) cats.add(c);
        }
      }
    }
    expect(
      cats.size >= 3,
      `推荐流首屏大类数=${cats.size}（${[...cats].join("/")}），期望 >=3`
    );
    console.log(
      `  [ok] recommended items=${items.length} feed_items=${feedItems.length} cats=${[...cats].join("/")}`
    );
  }

  // ---------- 浏览器级：/search?q=React ----------
  await injectErrs(page);
  await page.goto(`${BASE}/search?q=${encodeURIComponent("React")}`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator(".feed__item").first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(400);

  const textLen = await page.evaluate(() => document.body.innerText.length);
  expect(textLen > 400, `/search?q=React innerText.length=${textLen}，期望 >400`);

  const overflow = await page.evaluate(() => {
    const sw = Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth
    );
    return { sw, iw: window.innerWidth };
  });
  expect(
    overflow.sw <= overflow.iw,
    `/search?q=React 横向溢出 scrollWidth=${overflow.sw} > innerWidth=${overflow.iw}`
  );

  const visibleItems = await page.locator(".feed__item:visible").count();
  expect(
    visibleItems >= 5,
    `/search?q=React 可见结果条目=${visibleItems}，期望 >=5`
  );

  const errs = await page.evaluate(() => window.__errs || []);
  expect(errs.length === 0, `/search?q=React 页面错误：${errs.join(" | ")}`);
  console.log(
    `  [ok] /search?q=React innerText=${textLen} items=${visibleItems} errs=0`
  );
});
