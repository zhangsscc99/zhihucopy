#!/usr/bin/env node
// Z1131 — 登录回跳后「后退一次」必须离开目标页。
// 场景：信息流 → 问题页 → 未登录点「赞同」→ /login?next=<本页> → 登录成功回本页。
// 旧实现 navigate(dest,{replace:true}) 把登录条目换成与上一项相同的 URL，
// 栈变 [/ , /q, /q]，后退第一步原地踏步。修复后栈保持 [/ , /q, /login]
// 且指针落在 /q，一次后退即回信息流。
// 覆盖 1440×900 / 390×844 双端；只点未登录赞同（直接跳登录，不产生投票），无残留。
import { run, expect, BASE } from "../e2e/lib.mjs";

const SEED_EMAIL = "user2@zhihucopy.dev";
const SEED_PASS = "zhihu123456";
const VIEWPORTS = [
  { width: 1440, height: 900, tag: "desktop" },
  { width: 390, height: 844, tag: "mobile" },
];

const basePath = new URL(BASE).pathname.replace(/\/+$/, "");

function isFeedUrl(pathname) {
  return pathname === basePath || pathname === `${basePath}/`;
}

async function flow(browser, { width, height, tag }) {
  const context = await browser.newContext({
    viewport: { width, height },
    locale: "zh-CN",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  try {
    // 1. 信息流 → 首个问题卡标题。
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    const firstCard = page.locator("li.feed__item").first();
    await firstCard.waitFor({ state: "visible" });
    await firstCard.locator("a.feed__title").first().click();
    await page.waitForURL(/\/question\/\d+/, { timeout: 15000 });

    // 2. 未登录点首条回答的「赞同」→ 跳 /login?next=<当前页>。
    const upBtn = page
      .locator(".answers .answerlist > li")
      .first()
      .locator("button.answer__vote--up");
    await upBtn.waitFor({ state: "visible" });
    await upBtn.click();
    await page.waitForURL(/\/login\?.*next=/, { timeout: 15000 });

    // 3. 登录 → 回跳问题页。
    await page.locator("#login-email").fill(SEED_EMAIL);
    await page.locator("#login-password").fill(SEED_PASS);
    await page.locator(".authform button[type=submit]").click();
    await page.waitForURL(/\/question\/\d+/, { timeout: 15000 });
    await page
      .locator(".answers .answerlist > li")
      .first()
      .waitFor({ state: "visible" });

    // 4. 后退一次：必须落在信息流，且至少一张 feed 卡。
    await page.goBack();
    await page.waitForTimeout(800);
    const probe = await page.evaluate(() => ({
      url: location.href,
      pathname: location.pathname,
      histLen: history.length,
      feedItems: document.querySelectorAll("li.feed__item").length,
    }));
    expect(
      isFeedUrl(probe.pathname) && probe.feedItems >= 1,
      `${tag}: 后退一次未回信息流 -> url=${probe.url} history.length=${probe.histLen} feedItems=${probe.feedItems}`
    );
  } finally {
    await context.close();
  }
}

run("login-back-history", async ({ browser }) => {
  for (const vp of VIEWPORTS) {
    await flow(browser, vp);
  }
});
