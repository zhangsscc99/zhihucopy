#!/usr/bin/env node
// mobile-tabbar-icons.mjs — Z1157 移动端底栏「图标 + 文字」验收（浏览器级）。
//
// 契约：
//   1) 390×844：.bottomnav a 恰好 5 个，每个含 1 个 svg，
//      svg 的 getBoundingClientRect() 宽高在 16–24px；
//   2) aria-current="page" 的 tab 其 svg 计算色为 rgb(0, 102, 255)，
//      未选中 tab 的 svg 不是蓝色；
//   3) 5 项 getBoundingClientRect().y 相同（±1）且 height 在 48–64px；
//      document.documentElement.scrollWidth - innerWidth === 0；
//   4) 滚到页面底部时最后一张卡的下边缘不被底栏遮住
//      （.feed__item:last-child 的 bottom ≤ .bottomnav 的 top + 4）；
//   5) 360 / 414 宽同样无溢出、单行；
//   6) 1440×900：.bottomnav 不可见（display:none 或高度 ≤ 1）；
//   7) window.__errs 为空；
//   8) 反向自检：对未修基线 /www/zhihucopy（3176 端口上若跑的是旧构建）
//      跑本断言必须 FAIL —— 无 svg 时在第 1 条折。
//
// Env: API_BASE / E2E_BASE / E2E_API / CHROME / DB_PATH。
const apiBaseEnv = (process.env.API_BASE || "").replace(/\/+$/, "");
const derivedBase = apiBaseEnv.replace(/\/api$/, "");
process.env.E2E_BASE =
  process.env.E2E_BASE || derivedBase || "http://127.0.0.1:3030/zhihucopy";
process.env.E2E_API =
  process.env.E2E_API || apiBaseEnv || `${process.env.E2E_BASE}/api`;

const { run, expect, BASE } = await import("../e2e/lib.mjs");

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

async function mobilePage(browser, width, height) {
  const context = await browser.newContext({
    viewport: { width, height },
    locale: "zh-CN",
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.addInitScript(ERR_HOOK);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".bottomnav a", { timeout: 15000 });
  return { context, page };
}

// 返回每个 tab 的 { hasSvg, svgW, svgH, y, h, color, current }
const tabInfo = (page) =>
  page.$$eval(".bottomnav a", (as) =>
    as.map((a) => {
      const svg = a.querySelector("svg");
      const r = a.getBoundingClientRect();
      const sr = svg ? svg.getBoundingClientRect() : null;
      return {
        hasSvg: !!svg,
        svgCount: a.querySelectorAll("svg").length,
        svgW: sr ? sr.width : 0,
        svgH: sr ? sr.height : 0,
        y: r.y,
        h: r.height,
        color: svg ? getComputedStyle(svg).color : "",
        current: a.getAttribute("aria-current") === "page",
      };
    })
  );

async function checkMobile(browser, width, height, tag) {
  const { context, page } = await mobilePage(browser, width, height);
  try {
    const tabs = await tabInfo(page);
    expect(tabs.length === 5, `${tag}: .bottomnav a 应 5 个，实际 ${tabs.length}`);
    for (const [i, t] of tabs.entries()) {
      expect(
        t.svgCount === 1 && t.hasSvg,
        `${tag}: tab#${i} 应恰好含 1 个 svg（实际 ${t.svgCount}）`
      );
      expect(
        t.svgW >= 16 && t.svgW <= 24 && t.svgH >= 16 && t.svgH <= 24,
        `${tag}: tab#${i} svg 尺寸 ${t.svgW}x${t.svgH} 不在 16–24px`
      );
    }

    // 选中态颜色
    const active = tabs.filter((t) => t.current);
    expect(active.length === 1, `${tag}: 应有 1 个 aria-current=page（实际 ${active.length}）`);
    expect(
      active[0].color === "rgb(0, 102, 255)",
      `${tag}: 选中 svg 颜色应为 rgb(0, 102, 255)，实际 ${active[0].color}`
    );
    for (const [i, t] of tabs.entries()) {
      if (!t.current) {
        expect(
          t.color !== "rgb(0, 102, 255)",
          `${tag}: 未选中 tab#${i} svg 不应为蓝色，实际 ${t.color}`
        );
      }
    }

    // 单行 & 高度
    const ys = tabs.map((t) => t.y);
    expect(
      Math.max(...ys) - Math.min(...ys) <= 1,
      `${tag}: 5 项 y 不齐（${ys.join(",")}），疑似换行`
    );
    for (const [i, t] of tabs.entries()) {
      expect(
        t.h >= 48 && t.h <= 64,
        `${tag}: tab#${i} 高度 ${t.h} 不在 48–64px`
      );
    }

    // 横向溢出
    const xdiff = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(xdiff === 0, `${tag}: 横向溢出 ${xdiff}px`);

    // __errs
    const errs = await page.evaluate(() => window.__errs || []);
    expect(errs.length === 0, `${tag}: __errs 非空 ${errs.join(" | ")}`);
  } finally {
    await context.close();
  }
}

run("mobile-tabbar-icons", async ({ browser }) => {
  // ---- 390×844 全量检查 ----
  const { context, page } = await mobilePage(browser, 390, 844);
  try {
    const tabs = await tabInfo(page);
    expect(tabs.length === 5, `390: .bottomnav a 应 5 个，实际 ${tabs.length}`);
    for (const [i, t] of tabs.entries()) {
      expect(t.svgCount === 1, `390: tab#${i} svg 数 ${t.svgCount} ≠ 1`);
      expect(
        t.svgW >= 16 && t.svgW <= 24 && t.svgH >= 16 && t.svgH <= 24,
        `390: tab#${i} svg ${t.svgW}x${t.svgH} 不在 16–24px`
      );
    }

    // 滚到页面底部：最后一张卡不被底栏遮住
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(400);
    const cover = await page.evaluate(() => {
      const nav = document.querySelector(".bottomnav");
      const last = document.querySelector(".feed__item:last-child");
      if (!nav || !last) return { navTop: nav ? nav.getBoundingClientRect().top : null, cardBottom: null, hasLast: !!last };
      return {
        navTop: nav.getBoundingClientRect().top,
        cardBottom: last.getBoundingClientRect().bottom,
        hasLast: true,
      };
    });
    expect(cover.hasLast, "390: 找不到 .feed__item:last-child");
    expect(
      cover.cardBottom <= cover.navTop + 4,
      `390: 最后一张卡 bottom=${cover.cardBottom} 被底栏 top=${cover.navTop} 遮住`
    );

    const errs = await page.evaluate(() => window.__errs || []);
    expect(errs.length === 0, `390: __errs 非空 ${errs.join(" | ")}`);
  } finally {
    await context.close();
  }

  // ---- 360 / 414 ----
  await checkMobile(browser, 360, 800, "360");
  await checkMobile(browser, 414, 896, "414");

  // ---- 1440×900：底栏不可见 ----
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.addInitScript(ERR_HOOK);
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const nav = await page.evaluate(() => {
      const el = document.querySelector(".bottomnav");
      if (!el) return { exists: false };
      const cs = getComputedStyle(el);
      return { exists: true, display: cs.display, h: el.getBoundingClientRect().height };
    });
    expect(
      !nav.exists || nav.display === "none" || nav.h <= 1,
      `1440: .bottomnav 应不可见，实际 display=${nav.display} h=${nav.h}`
    );
    const errs = await page.evaluate(() => window.__errs || []);
    expect(errs.length === 0, `1440: __errs 非空 ${errs.join(" | ")}`);
    await context.close();
  }
});
