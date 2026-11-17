// feed-card-avatar.mjs — Z1113 信息流卡作者头像断言（浏览器级）。
//
// 断言：
//  桌面 1440×900 首页「推荐」tab
//   1) 前 10 张 .feed__item 每张卡内命中 `img, .avatar` ≥1（.feed__avatar）；
//      头像 getBoundingClientRect 宽高在 18–32px，border-radius ≥ 40%。
//   2) 点头像（在第 1 张卡）→ 2s 内 URL 变 /u/<id>；然后退回首页。
//  移动 390×844
//   3) 前 10 张卡 .feed__meta 高度 ≤ 28px（单行），无横向溢出。
//  全程
//   4) window.__errs（error/unhandledrejection/console.error）为空；
//      document.body.innerText.length > 200。
//
// Env: API_BASE / E2E_BASE / CHROME，同 scripts/e2e/lib.mjs。

import { run, expect, BASE } from "../e2e/lib.mjs";

const ERR_HOOK = `(() => {
  window.__errs = [];
  window.addEventListener("error", (e) => window.__errs.push("error: " + e.message));
  window.addEventListener("unhandledrejection", (e) => window.__errs.push("rejection: " + e.reason));
  const orig = console.error;
  console.error = function (...args) {
    window.__errs.push("console.error: " + args.join(" "));
    return orig.apply(console, args);
  };
})()`;

async function openFeed(page) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => document.querySelectorAll(".feed__item").length >= 1,
    { timeout: 20000 }
  );
}

async function checkErrs(page, label) {
  const errs = await page.evaluate(() => window.__errs || []);
  expect(
    errs.length === 0,
    `${label}：页面报错 __errs=${errs.slice(0, 3).join(" | ")}`
  );
  const gap = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  );
  expect(gap === 0, `${label}：横向溢出 scrollWidth-clientWidth=${gap}`);
}

// 每张卡头像命中 + 几何断言（在浏览器里一次性算完）。
function auditCards() {
  const cards = [...document.querySelectorAll(".feed__item")].slice(0, 10);
  return cards.map((el, i) => {
    const av = el.querySelector(".feed__meta .feed__avatar, .feed__meta .avatar");
    const hits = el.querySelectorAll("img, .avatar").length;
    if (!av) return { i, hits, ok: false, why: "no avatar element" };
    const r = av.getBoundingClientRect();
    const br = parseFloat(getComputedStyle(av).borderRadius) || 0;
    const pct = Math.min(r.width, r.height) > 0 ? (br / Math.min(r.width, r.height)) * 100 : 0;
    const sizeOk = r.width >= 18 && r.width <= 32 && r.height >= 18 && r.height <= 32;
    return {
      i, hits,
      ok: hits >= 1 && sizeOk && (pct >= 40 || getComputedStyle(av).borderRadius.includes("%")),
      w: Math.round(r.width), h: Math.round(r.height),
      br: getComputedStyle(av).borderRadius,
    };
  });
}

run("feed-card-avatar", async ({ browser }) => {
  // ---------- 桌面 1440 ----------
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
  });
  await ctx.addInitScript(ERR_HOOK);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  await openFeed(page);

  const rows = await page.evaluate(auditCards);
  expect(rows.length >= 1, "首页无 .feed__item");
  for (const r of rows) {
    expect(
      r.ok,
      `第 ${r.i + 1} 张卡头像不合格：${JSON.stringify(r)}（需 img/.avatar≥1、宽高18–32、radius≥40%）`
    );
  }
  const bodyLen = await page.evaluate(() => document.body.innerText.length);
  expect(bodyLen > 200, `首页正文 ${bodyLen} 字 ≤ 200`);

  // 头像可点 → /u/<id>（点完退回首页）
  const av = page.locator(".feed__item").first().locator(".feed__author .feed__avatar");
  expect((await av.count()) === 1, "第 1 张卡无 .feed__author .feed__avatar 可点");
  const navP = page.waitForURL(/\/u\/\d+/, { timeout: 5000 });
  await av.click();
  await navP.catch(() => {
    throw new Error(`点头像未跳 /u/，URL=${page.url()}`);
  });
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await checkErrs(page, "桌面1440");

  // ---------- 移动 390 ----------
  await page.setViewportSize({ width: 390, height: 844 });
  await openFeed(page);
  const metas = await page.evaluate(() =>
    [...document.querySelectorAll(".feed__item .feed__meta")]
      .slice(0, 10)
      .map((el) => Math.round(el.getBoundingClientRect().height * 10) / 10)
  );
  expect(metas.length >= 1, "移动首页无 .feed__meta");
  for (const [i, h] of metas.entries()) {
    expect(h <= 28, `移动第 ${i + 1} 张卡 .feed__meta 高 ${h}px > 28（元信息行折行）`);
  }
  // 昵称未被截到只剩省略号/空串
  const name = await page.evaluate(() => {
    const el = document.querySelector(".feed__item .feed__author-name");
    return el ? el.textContent.trim() : "";
  });
  expect(name.length >= 1, "移动首页作者昵称为空");
  await checkErrs(page, "移动390");
  await ctx.close();
});
