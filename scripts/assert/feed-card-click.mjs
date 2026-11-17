// feed-card-click.mjs — Z1090 信息流整卡可点击断言（真实鼠标/触屏点击）。
//
// 断言：
//  桌面 1440×900
//   1) 第 2 张 .feed__item 空白坐标（getBoundingClientRect 右下内侧 8px）：
//      elementFromPoint 命中 .feed__item 本体且不是 <a>；真实鼠标点击 →
//      2s 内 URL 变 /question/<id>，h1.question__title 文案与卡内标题一致，
//      document.body.innerText.length > 200。
//   2) 卡内作者链接 → /u/<id>（不是 /question/）；话题胶囊 → /topic/。
//   3) 卡片 computed cursor === 'pointer'；
//      hover 前后 border-color 必须变化（before !== after）。
//   4) 键盘：focus 卡片本体按 Enter → 跳 /question/<id>（role=link + tabindex）。
//  移动 390×844（同页 setViewportSize）
//   5) 空白坐标 elementFromPoint 命中卡片本体；真实 tap → 2s 内跳 /question/<id>。
//  全程
//   6) window.__errs（error/unhandledrejection/console.error）为空；
//      无横向溢出（scrollWidth - clientWidth === 0）。
//
// Env: API_BASE（默认 http://127.0.0.1:3030/zhihucopy/api）
//      E2E_BASE 覆盖页面地址（默认 API_BASE 去掉 /api）
//      CHROME 可覆盖浏览器路径；截图失败现场到 /root/logs。

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { API, expect, main } from "./lib.mjs";

const BASE = (
  process.env.E2E_BASE || API.replace(/\/api$/, "")
).replace(/\/+$/, "");
const SHOT_DIR = process.env.E2E_SHOT_DIR || "/root/logs";

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

// 每个新 document 先装错误收集器（SPA 客户端跳转不换 document，__errs 持续累积）。
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
    () => document.querySelectorAll(".feed__item").length >= 2,
    { timeout: 20000 }
  );
}

// 卡片右下内侧 8px（落在 <li> 自身 padding 区，必为空白），返回坐标 + 命中信息。
async function blankPoint(card) {
  await card.scrollIntoViewIfNeeded();
  return card.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const x = r.right - 8;
    const y = r.bottom - 8;
    const hit = document.elementFromPoint(x, y);
    return {
      x: Math.round(x),
      y: Math.round(y),
      hitTag: hit ? hit.tagName : "null",
      isCard: hit === el,
      isLink: hit ? !!hit.closest("a") : false,
      title: ((el.querySelector(".feed__title") || {}).textContent || "").trim(),
    };
  });
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

main("feed-card-click", async () => {
  const browser = await chromium.launch({
    executablePath: chromePath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  let shotPage = null;
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
      hasTouch: true, // 供移动段 touchscreen.tap 使用
    });
    await ctx.addInitScript(ERR_HOOK);
    const page = await ctx.newPage();
    shotPage = page;
    page.setDefaultTimeout(15000);

    // ---------- 桌面 1440 ----------
    await openFeed(page);
    const card = page.locator(".feed__item").nth(1);

    // 3) cursor + hover 变化（先取基线再 hover，after !== before）
    const cursor = await card.evaluate((el) => getComputedStyle(el).cursor);
    expect(cursor === "pointer", `卡片空白区 cursor=${cursor}，应为 pointer`);
    const borderBefore = await card.evaluate(
      (el) => getComputedStyle(el).borderColor
    );
    await card.hover();
    const borderAfter = await card.evaluate(
      (el) => getComputedStyle(el).borderColor
    );
    expect(
      borderAfter !== borderBefore,
      `hover 前后 border-color 未变化（${borderBefore}），卡片无可见 hover 态`
    );

    // 1) 空白坐标 elementFromPoint 断言 + 真实鼠标点击 → /question/<id>
    const pt = await blankPoint(card);
    expect(
      pt.isCard && !pt.isLink,
      `空白点 elementFromPoint 命中 ${pt.hitTag}（应命中 .feed__item 本体且非 <a>）`
    );
    expect(pt.title.length > 0, "第 2 张卡片标题为空，无法比对落页标题");
    let navP = page.waitForURL(/\/question\/\d+/, { timeout: 2000 });
    await page.mouse.click(pt.x, pt.y);
    await navP.catch(() => {
      throw new Error(`桌面点卡片空白区未跳转，URL=${page.url()}`);
    });
    const qTitle = (
      await page.locator("h1.question__title").innerText()
    ).trim();
    expect(
      qTitle === pt.title,
      `落页标题「${qTitle}」与卡片标题「${pt.title}」不一致`
    );
    const bodyLen = await page.evaluate(
      () => document.body.innerText.length
    );
    expect(bodyLen > 200, `问题页正文 ${bodyLen} 字 ≤ 200`);

    // 2) 作者链接 → /u/<id>（整卡跳转不得抢链接的目标）
    await openFeed(page);
    const author = page.locator(".feed__item .feed__author").first();
    const ahref = await author.getAttribute("href");
    expect(ahref && /\/u\/\d+/.test(ahref), `作者链接 href=${ahref} 异常`);
    navP = page.waitForURL(/\/u\/\d+/, { timeout: 5000 });
    await author.click();
    await navP.catch(() => {
      throw new Error(`点作者链接未跳 /u/，URL=${page.url()}`);
    });
    const apath = new URL(page.url()).pathname;
    expect(
      apath === ahref && !/\/question\//.test(apath),
      `作者链接落点 ${apath} ≠ ${ahref}（或误跳 /question/）`
    );

    // 话题胶囊 → /topic/
    await openFeed(page);
    const tag = page.locator(".feed__item .feed__topics .tag").first();
    expect((await tag.count()) > 0, "信息流卡片无话题胶囊可点");
    const thref = await tag.getAttribute("href");
    expect(thref && /\/topic\//.test(thref), `话题胶囊 href=${thref} 异常`);
    navP = page.waitForURL(/\/topic\//, { timeout: 5000 });
    await tag.click();
    await navP.catch(() => {
      throw new Error(`点话题胶囊未跳 /topic/，URL=${page.url()}`);
    });
    expect(
      new URL(page.url()).pathname === thref,
      `话题胶囊落点 ${new URL(page.url()).pathname} ≠ ${thref}`
    );

    // 4) 键盘：Tab 序可达卡片本体（tabindex）且 Enter 触发整卡跳转
    await openFeed(page);
    const kbCard = page.locator(".feed__item").nth(1);
    await kbCard.focus();
    const focused = await page.evaluate(
      () => document.activeElement && document.activeElement.className
    );
    expect(
      typeof focused === "string" && focused.includes("feed__item"),
      `卡片不可聚焦（activeElement=${focused}），缺 tabindex/可点击语义`
    );
    navP = page.waitForURL(/\/question\/\d+/, { timeout: 2000 });
    await page.keyboard.press("Enter");
    await navP.catch(() => {
      throw new Error(`卡片聚焦后 Enter 未跳转，URL=${page.url()}`);
    });

    await checkErrs(page, "桌面1440");

    // ---------- 移动 390 ----------
    await page.setViewportSize({ width: 390, height: 844 });
    await openFeed(page);
    const mCard = page.locator(".feed__item").nth(1);
    const mpt = await blankPoint(mCard);
    expect(
      mpt.isCard && !mpt.isLink,
      `移动空白点 elementFromPoint 命中 ${mpt.hitTag}（应命中 .feed__item 本体且非 <a>）`
    );
    navP = page.waitForURL(/\/question\/\d+/, { timeout: 2000 });
    await page.touchscreen.tap(mpt.x, mpt.y);
    await navP.catch(() => {
      throw new Error(`移动 tap 卡片空白区未跳转，URL=${page.url()}`);
    });
    const mTitle = (
      await page.locator("h1.question__title").innerText()
    ).trim();
    expect(
      mTitle === mpt.title,
      `移动落页标题「${mTitle}」与卡片标题「${mpt.title}」不一致`
    );

    await checkErrs(page, "移动390");
    await ctx.close();
  } catch (e) {
    if (shotPage) {
      try {
        fs.mkdirSync(SHOT_DIR, { recursive: true });
        const p = path.join(SHOT_DIR, `feed-card-click-${Date.now()}.png`);
        await shotPage.screenshot({ path: p, fullPage: true });
        console.error(`[feed-card-click] screenshot: ${p}`);
      } catch {}
    }
    throw e;
  } finally {
    await browser.close();
  }
});
