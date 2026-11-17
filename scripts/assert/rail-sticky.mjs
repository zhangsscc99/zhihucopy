// rail-sticky.mjs — Z1136 首页右栏吸顶 + 顺带覆盖 Z1137 的加载更多数据行为。
//
//   浏览器级（import { run } from ../e2e/lib.mjs）：
//     桌面 1440×900 首页 `/`：
//       a) window.scrollY=1200 后 .rail 的 getBoundingClientRect().top ∈ [0,200]，
//          且其 computed position === "sticky"；
//       b) 热榜条目（.hotlist__item）视口内可见 >= 8 条；
//       c) 左栏第一张 .feed__item 已滚出视口（rect.top < 0）；
//       d) document.documentElement.scrollWidth - clientWidth === 0（无横向溢出）；
//       e) 点「加载更多」后 .feed__item 条数 20 → 40，问题 id 无重复；
//       f) window.__errs 为空。
//     移动 390×844 首页 `/`：
//       g) 作为吸顶右栏存在的元素数为 0（无 position:sticky 的 .rail），
//          无横向溢出，window.__errs 为空。
//
// Env: API_BASE（缺省 3030）、E2E_BASE（缺省 API_BASE 去掉 /api）。
// 反向自检：未修基线 .rail 非 sticky，滚 1200px 后其 top 为负且热榜全部滚出视口，
//           断言 a/b 必 FAIL。

import { expect } from "./lib.mjs";

const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
const BASE = (process.env.E2E_BASE || API_BASE.replace(/\/api$/, "")).replace(/\/+$/, "");
process.env.E2E_BASE ||= BASE;
const { run } = await import("../e2e/lib.mjs");

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
  const ctx = await browser.newContext({ viewport: { width, height }, locale: "zh-CN" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  await page.addInitScript(ERR_HOOK);
  return page;
}

async function checkErrs(page, tag) {
  const errs = await page.evaluate(() => window.__errs || []);
  expect(errs.length === 0, `${tag} window.__errs ${errs.length} 条: ${errs.slice(0, 3).join(" | ")}`);
}

// 视口内（至少部分）可见的热榜条目数。
const visibleHotItems = () =>
  [...document.querySelectorAll(".hotlist__item")].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight && r.height > 0;
  }).length;

const feedIds = () =>
  [...document.querySelectorAll(".feed__item")].map((el) => {
    const a = el.querySelector('a.feed__title, a[href*="/question/"]');
    const m = a && a.getAttribute("href").match(/\/question\/(\d+)/);
    return m ? Number(m[1]) : null;
  });

async function checkDesktop(page) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".feed__item");
  await page.waitForSelector(".rail .rail-block .hotlist__item, .rail .rail-block");

  // 热榜模块异步拉取，等其落地再滚。
  await page.locator(".hotlist__item").first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});

  await page.evaluate(() => window.scrollTo(0, 1200));
  await page.waitForFunction(() => window.scrollY >= 1199);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  );

  const rail = await page.evaluate(() => {
    const el = document.querySelector(".rail");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, position: getComputedStyle(el).position, height: r.height };
  });
  expect(rail, "桌面 1440 下找不到右栏 .rail");
  expect(
    rail.position === "sticky",
    `右栏 .rail position=${rail.position}（需 sticky，未修基线为 static）`
  );
  expect(
    rail.top >= 0 && rail.top <= 200,
    `scrollY=1200 后右栏 top=${Math.round(rail.top)}px（需 ∈ [0,200]，未修基线已滚出视口为负值）`
  );

  const hotVisible = await page.evaluate(visibleHotItems);
  expect(hotVisible >= 8, `scrollY=1200 后热榜仅 ${hotVisible} 条可见（需 >= 8）`);

  const firstTop = await page.evaluate(
    () => document.querySelector(".feed__item")?.getBoundingClientRect().top ?? 0
  );
  expect(firstTop < 0, `左栏第一张卡 top=${Math.round(firstTop)}（需 < 0 已滚出视口）`);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow === 0, `横向溢出 ${overflow}px（需 scrollWidth-clientWidth === 0）`);

  // —— Z1137 数据行为：加载更多 20 → 40 且 id 无重复 ——
  const before = await page.evaluate(feedIds);
  expect(before.length === 20, `首屏 .feed__item ${before.length} 条（需 20）`);
  await page.locator(".feed-foot button").first().click();
  await page.waitForFunction(
    () => document.querySelectorAll(".feed__item").length === 40,
    null,
    { timeout: 10000 }
  );
  const after = await page.evaluate(feedIds);
  expect(after.length === 40, `加载更多后 .feed__item ${after.length} 条（需 40）`);
  expect(after.every((id) => id !== null), "存在无法解析问题 id 的 .feed__item");
  expect(
    new Set(after).size === after.length,
    "加载更多后出现重复问题 id"
  );
  await page.evaluate(() => window.scrollTo(0, 1200));
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  );
  const overflow2 = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow2 === 0, `加载更多后横向溢出 ${overflow2}px`);

  await checkErrs(page, "desktop1440");
  console.log(
    `  desktop1440: scrollY=1200 右栏 top=${Math.round(rail.top)}px sticky，热榜可见 ${hotVisible} 条，加载更多 20→40 无重复`
  );
}

async function checkMobile(page) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".feed__item");
  // 移动端不渲染吸顶右栏：不存在 position:sticky 的 .rail。
  const stickyRails = await page.evaluate(
    () =>
      [...document.querySelectorAll(".rail")].filter(
        (el) => getComputedStyle(el).position === "sticky"
      ).length
  );
  expect(stickyRails === 0, `mobile390 下仍有 ${stickyRails} 个吸顶右栏元素（需 0）`);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow === 0, `mobile390 横向溢出 ${overflow}px`);
  await checkErrs(page, "mobile390");
  console.log("  mobile390: 无吸顶右栏元素、无横向溢出");
}

run("rail-sticky", async ({ browser }) => {
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
});
