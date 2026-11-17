// load-more-feedback.mjs — Z1137 首页「加载更多」加载反馈。
//
//   浏览器级（import { run } from ../e2e/lib.mjs），1440×900 `/?tab=hot`：
//     a) 延迟放行 /api/questions 时点击「加载更多」，300ms 内按钮文本含「加载中」、
//        disabled === true、aria-busy === "true"，且存在 3px 高的加载进度条；
//     b) 请求完成后按钮恢复「加载更多」、disabled === false、aria-busy === "false"，
//        .feed__item 条数 20 → 40、问题 id 无重复；
//     c) page.route 把 **/api/questions* 拦成 500 后点击 → 出现「重试」按钮
//        （保留原 feed-foot--error 文案结构）；解除拦截点「重试」→ 条数增加；
//     d) 全程 window.__errs 为空。
//
// Env: API_BASE（缺省 3030）、E2E_BASE（缺省 API_BASE 去掉 /api）。
// 反向自检：未修基线点击后按钮文案/禁用态不变（换骨架屏），断言 a 必 FAIL。

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const feedIds = () =>
  [...document.querySelectorAll(".feed__item")].map((el) => {
    const a = el.querySelector('a.feed__title, a[href*="/question/"]');
    const m = a && a.getAttribute("href").match(/\/question\/(\d+)/);
    return m ? Number(m[1]) : null;
  });

const feedCount = (page) => page.locator(".feed__item").count();

const btnState = () => {
  const b = document.querySelector(".feed-foot button");
  if (!b) return null;
  return {
    text: (b.innerText || b.textContent || "").trim(),
    disabled: b.disabled,
    busy: b.getAttribute("aria-busy"),
  };
};

run("load-more-feedback", async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  await page.addInitScript(ERR_HOOK);

  try {
    // 首个 page2 请求延迟 800ms 放行，留出稳定观察加载态的窗口。
    let delayed = true;
    await page.route("**/api/questions*", async (route) => {
      if (delayed && route.request().url().includes("page=2")) {
        await sleep(800);
      }
      await route.continue();
    });

    await page.goto(`${BASE}/?tab=hot`, { waitUntil: "networkidle" });
    await page.waitForSelector(".feed__item");
    const n0 = await feedCount(page);
    expect(n0 === 20, `首屏 .feed__item ${n0} 条（需 20）`);

    const btn = page.locator(".feed-foot button").first();
    expect((await btn.innerText()).trim() === "加载更多", "点击前按钮文案不是「加载更多」");

    const t0 = Date.now();
    await btn.click();
    // 点击后尽快读按钮状态；延迟路由保证仍在加载窗口内。
    const s = await page.evaluate(btnState);
    const elapsed = Date.now() - t0;
    expect(s, "点击后找不到 .feed-foot 按钮（未修基线会整块换成骨架屏）");
    expect(
      elapsed < 300,
      `点击后 ${elapsed}ms 才读到状态（需 < 300ms 内进入加载态）`
    );
    expect(s.text.includes("加载中"), `加载态文案 ${JSON.stringify(s.text)}（需含「加载中」）`);
    expect(s.disabled === true, `加载态 disabled=${s.disabled}（需 true）`);
    expect(s.busy === "true", `加载态 aria-busy=${s.busy}（需 "true"）`);
    const bar = await page.evaluate(() => {
      const b = document.querySelector(".feed-foot__bar");
      if (!b) return null;
      return { h: b.getBoundingClientRect().height };
    });
    expect(bar && Math.round(bar.h) === 3, `加载进度条高度 ${bar && bar.h}px（需 3px）`);

    await page.waitForFunction(
      () => document.querySelectorAll(".feed__item").length === 40,
      null,
      { timeout: 10000 }
    );
    const s2 = await page.evaluate(btnState);
    expect(s2.text === "加载更多", `完成后文案 ${JSON.stringify(s2.text)}（需「加载更多」）`);
    expect(s2.disabled === false, `完成后 disabled=${s2.disabled}（需 false）`);
    expect(s2.busy === "false", `完成后 aria-busy=${s2.busy}（需 "false"）`);
    const ids = await page.evaluate(feedIds);
    expect(ids.length === 40, `加载更多后 ${ids.length} 条（需 40）`);
    expect(ids.every((x) => x !== null), "存在无法解析 id 的 .feed__item");
    expect(new Set(ids).size === ids.length, "加载更多后出现重复问题 id");
    console.log(`  加载态: ${elapsed}ms 内进入「加载中」+ disabled + aria-busy + 3px 条；20→40 无重复`);

    // —— 失败路径：/api/questions 拦成 500 ——
    delayed = false;
    await page.unroute("**/api/questions*");
    await page.route("**/api/questions*", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "服务器开小差了" }),
      })
    );
    await page.locator(".feed-foot button").first().click();
    await page.waitForSelector(".feed-foot--error", { timeout: 10000 });
    const errText = await page.locator(".feed-foot--error .feed-foot__text").innerText();
    expect(errText.includes("失败"), `错误态文案 ${JSON.stringify(errText)}（需含「失败」）`);
    const retryBtn = page.locator(".feed-foot--error button", { hasText: "重试" });
    await retryBtn.waitFor({ state: "visible" });

    // 解除拦截，点「重试」恢复并继续追加。
    await page.unroute("**/api/questions*");
    const n1 = await feedCount(page);
    await retryBtn.click();
    await page.waitForFunction(
      (n) => document.querySelectorAll(".feed__item").length > n,
      n1,
      { timeout: 10000 }
    );
    const n2 = await feedCount(page);
    expect(n2 > n1, `重试后条数 ${n2} 未超过 ${n1}`);
    const s3 = await page.evaluate(btnState);
    expect(s3 && s3.text === "加载更多" && s3.disabled === false, "重试成功后按钮未恢复「加载更多」");
    console.log(`  失败路径: 500 → 「重试」可见，解除拦截重试后 ${n1}→${n2} 条`);

    const errs = await page.evaluate(() => window.__errs || []);
    expect(errs.length === 0, `window.__errs ${errs.length} 条: ${errs.slice(0, 3).join(" | ")}`);
  } finally {
    await ctx.close();
  }
});
