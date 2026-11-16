// Z1031 — 移动端（390×844）搜索入口 + 结果页可编辑输入框：浏览器级断言。
//
// 断言：
//  1) 390×844：header 内 a[href*="search"]、button[aria-label="打开搜索"] 或
//     button[aria-label="搜索"] 至少一个可见；点击后弹层（.msearch/[role=dialog]）内
//     出现可见 input[type=search]，层内有取消/关闭按钮与可点项（空库时降级为空态文案）。
//  1.5) Escape 关闭弹层：弹层不可见，焦点归还到搜索入口按钮。
//  2) 输入「编程」提交 → URL 含 q= 且解码为「编程」；弹层已关闭；
//     结果页有可见结果标题与可编辑输入框，且输入框值=编程。
//  3) 结果页输入框改词「职场」回车 → URL q=职场（可编辑、重新搜索生效）。
//  4) 首页与结果页 document.documentElement.scrollWidth <= 390（无横向滚动）；
//     首页底部导航不被遮挡（elementFromPoint 命中 .bottomnav）。
//  5) 桌面 1280：原顶栏搜索框仍可见，且能正常提交搜索。
//
// Env: E2E_BASE || API_BASE(-/api) || http://127.0.0.1:3030/zhihucopy
//      CHROME 可覆盖浏览器路径；截图失败现场到 /root/logs。
// 退出码即结论：0 PASS / 1 FAIL（打印具体失败点）。

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const BASE = (
  process.env.E2E_BASE ||
  process.env.API_BASE?.replace(/\/api$/, "") ||
  "http://127.0.0.1:3030/zhihucopy"
).replace(/\/+$/, "");

const SHOT_DIR = process.env.E2E_SHOT_DIR || "/root/logs";

let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  // playwright-core 装在 scripts/e2e/node_modules（e2e 套件共享依赖），按 e2e/lib.mjs 的锚点解析。
  const req = createRequire(new URL("../e2e/lib.mjs", import.meta.url));
  ({ chromium } = req("playwright-core"));
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

function expect(cond, msg) {
  if (!cond) throw new Error(`assert: ${msg}`);
}

async function isVis(loc) {
  return loc.isVisible().catch(() => false);
}

// locator 可能命中多个（隐藏的也算），返回第一个可见项。
async function firstVisible(locator, max = 8) {
  const n = Math.min(await locator.count().catch(() => 0), max);
  for (let i = 0; i < n; i++) {
    if (await isVis(locator.nth(i))) return locator.nth(i);
  }
  return null;
}

async function scrollWidth(page) {
  return page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
  );
}

async function bottomnavClickable(page) {
  return page.evaluate(() => {
    const nav = document.querySelector(".bottomnav");
    if (!nav) return false;
    const r = nav.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!(el && el.closest(".bottomnav"));
  });
}

const W1 = "编程";
const W2 = "职场";

async function main() {
  const browser = await chromium.launch({
    executablePath: chromePath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  let shotPage = null;
  try {
    // ---------- 移动端 390×844 ----------
    const mctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "zh-CN",
    });
    const page = await mctx.newPage();
    shotPage = page;
    page.setDefaultTimeout(15000);
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });

    // (1) 顶栏搜索入口可见
    const entry = await firstVisible(
      page.locator(
        'header a[href*="search"], header button[aria-label="打开搜索"], header button[aria-label="搜索"]'
      )
    );
    expect(
      entry,
      '390×844：header 无可见搜索入口（选择器 a[href*="search"] / button[aria-label="打开搜索"] / button[aria-label="搜索"]）'
    );

    // 首页无横向溢出 + 底部导航未被遮挡
    const swHome = await scrollWidth(page);
    expect(swHome <= 390, `首页横向溢出：scrollWidth=${swHome} > 390`);
    expect(await bottomnavClickable(page), "首页 .bottomnav 不可见或被遮挡");

    // 点击入口 → 全屏搜索层；控件一律限定在弹层容器内查找，不命中页面其他搜索框
    await entry.click();
    const dlg = page.locator('.msearch, [role="dialog"]').first();
    await dlg.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    expect(
      await isVis(dlg),
      "点击搜索入口后未出现可见搜索弹层（.msearch / [role=dialog]）"
    );
    const overlayInput = dlg.locator('input[type="search"]:visible').first();
    expect(await isVis(overlayInput), "搜索弹层内无可见 input[type=search]");

    const cancelBtn = await firstVisible(
      dlg.locator('button:has-text("取消"), button:has-text("关闭"), [aria-label="关闭搜索"], [aria-label="取消搜索"]')
    );
    expect(cancelBtn, "搜索层缺少可见的取消/关闭按钮");

    await page
      .waitForSelector(".msearch__chip, .msearch__hotlink", {
        state: "visible",
        timeout: 8000,
      })
      .catch(() => {});
    const clickableItem = await firstVisible(
      dlg.locator(".msearch__chip, .msearch__hotlink"),
      20
    );
    if (!clickableItem) {
      // 冷启动/空库时层内无可点项：降级为断言空态文案，不因环境数据缺失误报
      const emptyState = await firstVisible(
        dlg.locator('.msearch__empty, .empty, :text("暂无"), :text("还没有")')
      );
      expect(emptyState, "搜索层内无可点项，且未见空态文案");
    }

    // (1.5) Escape 关闭弹层：弹层不可见，焦点归还搜索入口按钮
    await page.keyboard.press("Escape");
    await page
      .waitForSelector('.msearch, [role="dialog"]', {
        state: "hidden",
        timeout: 3000,
      })
      .catch(() => {});
    expect(
      (await page
        .locator('.msearch:visible, [role="dialog"]:visible')
        .count()) === 0,
      "Escape 后搜索弹层仍可见"
    );
    expect(
      await entry.evaluate((el) => el === document.activeElement),
      "Escape 关闭后焦点未归还到搜索入口按钮"
    );

    // 重新打开弹层，走提交路径
    await entry.click();
    await overlayInput
      .waitFor({ state: "visible", timeout: 5000 })
      .catch(() => {});
    expect(await isVis(overlayInput), "重新打开后搜索弹层内输入框不可见");

    // (2) 输入「编程」提交 → URL 带 q=编程；弹层关闭；结果页有结果标题与可编辑输入框且值=编程
    await overlayInput.fill(W1);
    await overlayInput.press("Enter");
    await page.waitForFunction(
      (w) => new URL(location.href).searchParams.get("q") === w,
      W1,
      { timeout: 8000 }
    );
    expect(page.url().includes("q="), `提交后 URL 不含 q=：${page.url()}`);

    await page
      .waitForSelector('.msearch, [role="dialog"]', {
        state: "hidden",
        timeout: 3000,
      })
      .catch(() => {});
    expect(
      (await page
        .locator('.msearch:visible, [role="dialog"]:visible')
        .count()) === 0,
      "提交跳转后搜索弹层未关闭"
    );

    await page
      .waitForSelector(".search-head__title", {
        state: "visible",
        timeout: 5000,
      })
      .catch(() => {});
    const resTitle = await firstVisible(
      page.locator(".search-head__title, h1")
    );
    expect(resTitle, "搜索结果页无可见结果标题");

    const resultInput = page.locator('input[type="search"]:visible').first();
    await resultInput.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    expect(await isVis(resultInput), "搜索结果页（移动端）无可见输入框");
    expect(
      (await resultInput.inputValue()) === W1,
      `结果页输入框值=${await resultInput.inputValue()}，期望 ${W1}`
    );

    // (3) 改词重新搜索
    await resultInput.fill(W2);
    await resultInput.press("Enter");
    await page.waitForFunction(
      (w) => new URL(location.href).searchParams.get("q") === w,
      W2,
      { timeout: 8000 }
    );
    expect(
      (await resultInput.inputValue()) === W2,
      `改词后结果页输入框值=${await resultInput.inputValue()}，期望 ${W2}`
    );

    // (4) 结果页无横向溢出
    const swRes = await scrollWidth(page);
    expect(swRes <= 390, `搜索结果页横向溢出：scrollWidth=${swRes} > 390`);

    // ---------- 桌面端 1280：原居中搜索框不变 ----------
    const dctx = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: "zh-CN",
    });
    const dpage = await dctx.newPage();
    shotPage = dpage;
    dpage.setDefaultTimeout(15000);
    await dpage.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    const deskInput = dpage.locator("header .topnav__search input");
    expect(await isVis(deskInput), "1280：顶栏原搜索框不可见");
    await deskInput.fill(W1);
    await deskInput.press("Enter");
    await dpage.waitForFunction(
      (w) => new URL(location.href).searchParams.get("q") === w,
      W1,
      { timeout: 8000 }
    );

    await browser.close();
    console.log(`[ASSERT] mobile-search-entry PASS — ${BASE}`);
    process.exit(0);
  } catch (e) {
    try {
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      if (shotPage) {
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const p = path.join(SHOT_DIR, `assert-mobile-search-entry-${ts}.png`);
        await shotPage.screenshot({ path: p, fullPage: true });
        console.error(`[ASSERT] screenshot: ${p}`);
      }
    } catch {}
    try {
      await browser.close();
    } catch {}
    console.error(`[ASSERT] mobile-search-entry FAIL — ${BASE}`);
    console.error(`  ${e.message || e}`);
    process.exit(1);
  }
}

main();
