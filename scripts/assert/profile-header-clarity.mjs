// profile-header-clarity.mjs — Z1117 个人主页头部措辞与重复计数（浏览器级断言）。
//
// 契约：
//   1. /u/:id 头部（main）文本不含「被关注」；
//   2. 统计区 .profile__stats 恰好 3 个计数，文案依次为 获赞 / 关注 / 粉丝；
//   3. 「回答」「提问」只在 tab 区（.profile__tabs）出现（各 ≥1），
//      统计容器内文本不含这两个词；
//   4. 关注按钮存在且可点：点击后文案在「关注」↔「已关注」间切换，
//      刷新后保持（注册测试号 A 关注注册测试号 B，双方走 owned 自清理）；
//   5. window.__errs 为空、无横向溢出（scrollWidth-clientWidth===0），
//      1440 与 390 各验一次。
//
// 反向自检：打未修的线上代码 FAIL——统计区 5 格且含「回答/提问」，
// 头部文本含「被关注」徽章名。
//
// Env: API_BASE（默认 http://127.0.0.1:3030/zhihucopy/api）
//      E2E_BASE 覆盖页面地址（默认 API_BASE 去掉 /api）
//      CHROME 可覆盖浏览器路径；截图失败现场到 /root/logs。

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { API, expect, main, register, uniq } from "./lib.mjs";

const BASE = (process.env.E2E_BASE || API.replace(/\/api$/, "")).replace(/\/+$/, "");
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

async function gotoProfile(page, uid) {
  await page.goto(`${BASE}/u/${uid}`, { waitUntil: "domcontentloaded" });
  await page.locator("main .profile__stats").waitFor({ timeout: 20000 });
}

// 头部措辞 + 计数结构断言（anon / authed 共用）。
async function checkHead(page, label) {
  const headText = await page.locator("main").innerText();
  expect(
    !headText.includes("被关注"),
    `${label}: 头部文本仍含「被关注」`
  );

  const stats = page.locator("main .profile__stats");
  const cells = stats.locator(":scope > div");
  const n = await cells.count();
  expect(n === 3, `${label}: 统计区计数 ${n} 个，要求恰好 3`);

  const dts = await stats.locator("dt").allInnerTexts();
  expect(
    dts.join(",") === "获赞,关注,粉丝",
    `${label}: 统计区标签为 ${dts.join(",")}，要求 获赞,关注,粉丝`
  );

  const statsText = await stats.innerText();
  for (const w of ["回答", "提问"]) {
    expect(
      !statsText.includes(w),
      `${label}: 统计区仍重复「${w}」（${statsText.replace(/\s+/g, " ")}）`
    );
    const tabHits = await page
      .locator("main .profile__tabs .tabs__tab", { hasText: w })
      .count();
    expect(tabHits >= 1, `${label}: tab 区缺少「${w}」tab`);
  }

  const errs = await page.evaluate(() => window.__errs || []);
  expect(
    errs.length === 0,
    `${label}: __errs 非空 ${errs.slice(0, 3).join(" | ")}`
  );
  const gap = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  );
  expect(gap === 0, `${label}: 横向溢出 scrollWidth-clientWidth=${gap}`);
}

main("profile-header-clarity", async () => {
  // 页主 B 与访问者 A 都用注册测试号，走 owned 自清理。
  const target = await register(uniq("phc-target"));
  const viewer = await register(uniq("phc-viewer"));
  const uid = target.user.id;

  const browser = await chromium.launch({
    executablePath: chromePath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  let shotPage = null;
  try {
    // ---------- 未登录，桌面 1440 ----------
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
    });
    await ctx.addInitScript(ERR_HOOK);
    const page = await ctx.newPage();
    shotPage = page;
    page.setDefaultTimeout(15000);
    await gotoProfile(page, uid);
    await checkHead(page, "anon1440");

    // ---------- 未登录，移动 390 ----------
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await checkHead(page, "anon390");
    await ctx.close();

    // ---------- 登录：关注按钮两态切换 + 刷新保持 ----------
    const ctx2 = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
    });
    await ctx2.addInitScript(ERR_HOOK);
    await ctx2.addInitScript(
      ([k, t]) => localStorage.setItem(k, t),
      [TOKEN_KEY, viewer.token]
    );
    const apage = await ctx2.newPage();
    shotPage = apage;
    apage.setDefaultTimeout(15000);
    await gotoProfile(apage, uid);
    await checkHead(apage, "authed1440");

    const btn = apage.locator("main .profile__follow");
    await btn.waitFor({ timeout: 15000 });
    expect(
      (await btn.innerText()).trim() === "关注",
      `按钮初态应为「关注」，实际 ${await btn.innerText()}`
    );

    // 关注 → 已关注，刷新保持
    await btn.click();
    await apage.waitForFunction(
      () =>
        document
          .querySelector("main .profile__follow")
          ?.textContent?.trim() === "已关注",
      { timeout: 10000 }
    );
    await gotoProfile(apage, uid);
    expect(
      (await apage.locator("main .profile__follow").innerText()).trim() ===
        "已关注",
      "关注后刷新按钮未保持「已关注」"
    );
    await checkHead(apage, "authed1440-followed");

    // 取关 → 关注，刷新保持
    await apage.locator("main .profile__follow").click();
    await apage.waitForFunction(
      () =>
        document
          .querySelector("main .profile__follow")
          ?.textContent?.trim() === "关注",
      { timeout: 10000 }
    );
    await gotoProfile(apage, uid);
    expect(
      (await apage.locator("main .profile__follow").innerText()).trim() ===
        "关注",
      "取关后刷新按钮未回到「关注」"
    );
    await checkHead(apage, "authed1440-unfollowed");

    // 390 下复验一次登录态头部
    await apage.setViewportSize({ width: 390, height: 844 });
    await apage.waitForTimeout(300);
    await checkHead(apage, "authed390");

    await ctx2.close();
  } catch (e) {
    if (shotPage) {
      try {
        fs.mkdirSync(SHOT_DIR, { recursive: true });
        const p = path.join(
          SHOT_DIR,
          `profile-header-clarity-${Date.now()}.png`
        );
        await shotPage.screenshot({ path: p, fullPage: true });
        console.error(`[profile-header-clarity] screenshot: ${p}`);
      } catch {}
    }
    throw e;
  } finally {
    await browser.close();
  }
});
