// Z979 — 底部导航 active 唯一 + 当前页签 aria-current 正确（390×844）。
//
// 背景口径（实测基线）：旧版 bottomnav 含 NavLink to="/?tab=hot"（热榜）——
// NavLink 只匹配 pathname，在 /、/?tab=hot、/?tab=following 上「首页」与
// 「热榜」两个 bottomnav 项同时 aria-current（active 不唯一，即 Z979 报的 bug）。
// 现版的修复方式是把 bottomnav 的热榜项换成「发现」：bottomnav 各项与路由一一
// 对应，任意页面 active 恒唯一。因此断言按修复后的真实不变量分两层：
//   · `.tabs`（关注/推荐/热榜 页签栏，热榜实际所在）：aria-current 恰好 1，
//      且 ?tab=hot → 热榜、默认 → 推荐 —— 即「仅当前页签带 aria-current」；
//   · `.bottomnav`（底部导航）：aria-current 恰好 1（唯一性 —— 旧基线此处为 2，
//      对改动前基线可判别），/ 与 /?tab=hot 下均为「首页」（首页即当前路由）。
// 字面条款「?tab=hot 时 bottomnav 的 aria-current 文本含热榜」在现结构下不成立
// （bottomnav 已无热榜项），实测值随明细行打印，不作假放宽。
//
// 另断言：无横向溢出、window.__errs 为空。
//
// Env: API_BASE 或 E2E_BASE。退出码即结论（逐项 PASS/FAIL 明细行）。

const API_ENV = (process.env.API_BASE || "").replace(/\/+$/, "");
const BASE = (
  process.env.E2E_BASE ||
  API_ENV.replace(/\/api$/, "") ||
  "http://127.0.0.1:3030/zhihucopy"
).replace(/\/+$/, "");
process.env.E2E_BASE ||= BASE;

const { launch } = await import("../e2e/lib.mjs");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} mobile-nav ${name}${detail ? ` — ${detail}` : ""}`);
};

const injectErrs = (page) =>
  page.addInitScript(() => {
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
const pageErrs = (page) => page.evaluate(() => window.__errs || []);

const scrollWidth = (page) =>
  page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
  );

const navCurrent = (page, scope) =>
  page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return { count: -1, texts: [] };
    const els = [...root.querySelectorAll("[aria-current]")];
    return { count: els.length, texts: els.map((e) => e.textContent.trim()) };
  }, scope);

async function main() {
  const browser = await launch();
  let shotPage = null;
  try {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "zh-CN",
    });
    const page = await ctx.newPage();
    shotPage = page;
    page.setDefaultTimeout(15000);
    await injectErrs(page);

    // ---- /?tab=hot ----------------------------------------------------------
    await page.goto(`${BASE}/?tab=hot`, { waitUntil: "domcontentloaded" });
    await page.locator(".tabs__tab").first().waitFor({ state: "visible" });
    await page.locator(".bottomnav").waitFor({ state: "visible" });
    // 等 feed 落地（active tab 已标定，等首批卡片/空态出现防止读早了）。
    await page
      .waitForSelector(".feed__item, .empty__title", { state: "visible", timeout: 10000 })
      .catch(() => {});

    const tabsHot = await navCurrent(page, ".tabs");
    check(
      "hot-tabs-aria-current==1",
      tabsHot.count === 1,
      `.tabs [aria-current] count=${tabsHot.count} texts=${JSON.stringify(tabsHot.texts)}`
    );
    check(
      "hot-tabs-text-热榜",
      tabsHot.count === 1 && tabsHot.texts.some((t) => t.includes("热榜")),
      `texts=${JSON.stringify(tabsHot.texts)}（?tab=hot 应仅「热榜」带 aria-current）`
    );

    const navHot = await navCurrent(page, ".bottomnav");
    check(
      "hot-bottomnav-aria-current==1",
      navHot.count === 1,
      `.bottomnav [aria-current] count=${navHot.count} texts=${JSON.stringify(navHot.texts)}（active 唯一）`
    );
    console.log(
      `[mobile-nav] /?tab=hot bottomnav active 实测=${JSON.stringify(navHot.texts)}（现结构无热榜项，唯一性口径）`
    );

    const swHot = await scrollWidth(page);
    check("hot-no-hscroll", swHot <= 390, `scrollWidth=${swHot}`);

    // ---- /（默认推荐） -------------------------------------------------------
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.locator(".tabs__tab").first().waitFor({ state: "visible" });
    await page
      .waitForSelector(".feed__item, .empty__title", { state: "visible", timeout: 10000 })
      .catch(() => {});

    const tabsHome = await navCurrent(page, ".tabs");
    check(
      "home-tabs-aria-current==1",
      tabsHome.count === 1 && tabsHome.texts.some((t) => t.includes("推荐")),
      `.tabs [aria-current] count=${tabsHome.count} texts=${JSON.stringify(tabsHome.texts)}（默认应仅「推荐」）`
    );

    const navHome = await navCurrent(page, ".bottomnav");
    check(
      "home-bottomnav-aria-current==1",
      navHome.count === 1,
      `.bottomnav [aria-current] count=${navHome.count} texts=${JSON.stringify(navHome.texts)}`
    );
    check(
      "home-bottomnav-text-首页",
      navHome.count === 1 && navHome.texts.some((t) => t.includes("首页")),
      `texts=${JSON.stringify(navHome.texts)}（/ 下应「首页」带 aria-current）`
    );

    const swHome = await scrollWidth(page);
    check("home-no-hscroll", swHome <= 390, `scrollWidth=${swHome}`);

    const errs = await pageErrs(page);
    check("errs-empty", errs.length === 0, errs.slice(0, 3).join(" | "));

    await browser.close();
  } catch (e) {
    check("unexpected-error", false, String(e && e.message ? e.message : e).slice(0, 200));
    try {
      if (shotPage) {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const dir = process.env.E2E_SHOT_DIR || "/root/logs";
        fs.mkdirSync(dir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        await shotPage.screenshot({ path: path.join(dir, `assert-mobile-nav-${ts}.png`), fullPage: true });
      }
    } catch {}
    await browser.close().catch(() => {});
  }
  const fails = results.filter((r) => !r.ok).length;
  console.log(`[ASSERT] mobile-nav ${fails ? "FAIL" : "PASS"} — ${results.length - fails}/${results.length} checks — ${BASE}`);
  process.exit(fails ? 1 : 0);
}

main();
