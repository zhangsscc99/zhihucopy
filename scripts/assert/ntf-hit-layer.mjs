#!/usr/bin/env node
// Z1053 — 通知行单链接命中层：每行 .ntf__item 内 <a> 必须恰好 1 个
// （整行覆盖链接 .ntf__hit，昵称/标题为普通文本），覆盖层 rect 与行宽差 ≤2px；
// row.click()（中心点、不 force）2 秒内跳到该行 href 目标且页面有内容；
// window.__errs 为空、无横向溢出。1280 与 390 视口各跑一遍。
// 旧代码（.ntf__hit + .ntf__title + .ntf__name 多链接叠放）在
// 「a 数量 === 1 / 覆盖层命中」处 FAIL。
import { run, expect, BASE, api, TOKEN_KEY } from "../e2e/lib.mjs";

const EMAIL = "user2@zhihucopy.dev";
const PASS = "zhihu123456";
const VIEWPORTS = [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
];

async function watchErrs(page) {
  await page.addInitScript(() => {
    window.__errs = [];
    window.addEventListener("error", (e) =>
      window.__errs.push(String(e.message || e))
    );
    window.addEventListener("unhandledrejection", (e) =>
      window.__errs.push(String(e.reason))
    );
    const ce = console.error.bind(console);
    console.error = (...a) => {
      window.__errs.push(a.map(String).join(" "));
      ce(...a);
    };
  });
}

async function checkRowGeometry(page, tag) {
  const rows = page.locator(".ntf .ntf__item");
  const count = await rows.count();
  expect(count > 0, `${tag}: /notifications 没有 .ntf__item 行`);
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const anchors = await row.locator("a").count();
    expect(
      anchors === 1,
      `${tag}: 第 ${i} 行含 ${anchors} 个 <a>（应为 1，双链接命中歧义）`
    );
    const geo = await row.evaluate((el) => {
      const a = el.querySelector("a");
      const r = el.getBoundingClientRect();
      const ar = a.getBoundingClientRect();
      return {
        rowW: r.width,
        aW: ar.width,
        rowH: r.height,
        aH: ar.height,
        abs: getComputedStyle(a).position,
      };
    });
    expect(
      geo.abs === "absolute",
      `${tag}: 第 ${i} 行链接 position=${geo.abs}，不是撑满覆盖层`
    );
    expect(
      Math.abs(geo.aW - geo.rowW) <= 2,
      `${tag}: 第 ${i} 行覆盖层宽 ${geo.aW}px 与行宽 ${geo.rowW}px 差 >2px`
    );
    expect(
      Math.abs(geo.aH - geo.rowH) <= 2,
      `${tag}: 第 ${i} 行覆盖层高 ${geo.aH}px 与行高 ${geo.rowH}px 差 >2px`
    );
  }
  return count;
}

async function checkClickNavigates(page, tag) {
  const row = page.locator(".ntf .ntf__item").first();
  const href = await row.locator("a").getAttribute("href");
  expect(href, `${tag}: 首行链接无 href`);
  const before = page.url();
  await row.click(); // 默认中心点、非 force：中心必须命中唯一链接
  await page.waitForFunction(
    (h) => location.href.includes(h),
    href,
    { timeout: 2000 }
  );
  expect(
    page.url() !== before,
    `${tag}: 点击后 URL 未变化（仍 ${before}）`
  );
  const textLen = await page.evaluate(
    () => document.body.innerText.length
  );
  expect(
    textLen > 200,
    `${tag}: 跳转目标页 body.innerText=${textLen} <= 200（${page.url()}）`
  );
}

async function checkClean(page, tag) {
  const errs = await page.evaluate(() => window.__errs || []);
  expect(
    errs.length === 0,
    `${tag}: window.__errs 非空 -> ${JSON.stringify(errs).slice(0, 300)}`
  );
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  );
  expect(overflow <= 1, `${tag}: 横向溢出 ${overflow}px`);
}

run("ntf-hit-layer", async ({ browser }) => {
  const login = await api("POST", "/auth/login", {
    body: { email: EMAIL, password: PASS },
  });
  expect(login.status === 200, `种子号登录失败 -> ${login.status}`);
  const token = login.data.token;
  expect(token, "登录响应无 token");

  for (const vp of VIEWPORTS) {
    const tag = `${vp.width}px`;
    const ctx = await browser.newContext({ viewport: vp, locale: "zh-CN" });
    const page = await ctx.newPage();
    await watchErrs(page);
    await page.addInitScript(
      ([k, t]) => localStorage.setItem(k, t),
      [TOKEN_KEY, token]
    );
    await page.goto(`${BASE}/notifications`);
    await page.locator(".ntf .ntf__item").first().waitFor();

    const n = await checkRowGeometry(page, tag);
    console.log(`  ${tag}: ${n} 行均为单链接撑满覆盖层`);
    await checkClickNavigates(page, tag);
    console.log(`  ${tag}: row.click() 2s 内跳转目标页且正文 >200 字`);
    await page.goBack();
    await page.locator(".ntf .ntf__item").first().waitFor();
    await checkClean(page, tag);
    console.log(`  ${tag}: __errs=0 且无横向溢出`);
    await ctx.close();
  }
});
