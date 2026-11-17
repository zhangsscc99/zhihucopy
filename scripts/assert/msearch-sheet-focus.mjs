// Z1070 — 移动端搜索弹层 .msearch__input 焦点环（WCAG 2.4.11）：浏览器级断言。
//
// 断言：
//  1) 390×844：打开首页 → 点 header 搜索入口 → .msearch__input 可见且
//     document.activeElement 是其本身（autoFocus 生效）。
//  2) getComputedStyle(el)：outlineStyle !== "none"、outlineWidth >= 2px、
//     outlineColor === rgb(0, 102, 255)（--accent #0066FF）。
//  3) el.matches(":focus-visible") === true（autoFocus 属键盘/程序聚焦态）。
//  4) 反向守卫：blur() 后 outlineStyle === "none"（焦点环不常驻）。
//  5) 桌面 1440：.topnav__search input 聚焦后 outline 可见或 border-color
//     相对基线变化（既有焦点样式不回归）。
//  6) console error == 0；无横向溢出。
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

function injectErrs(page) {
  return page.addInitScript(() => {
    const w = window;
    w.__errs = [];
    w.addEventListener("error", (e) => w.__errs.push(`error:${e.message}`));
    w.addEventListener("unhandledrejection", (e) =>
      w.__errs.push(`rejection:${e.reason && e.reason.message ? e.reason.message : e.reason}`)
    );
    const origError = console.error;
    console.error = (...args) => {
      w.__errs.push(`console:${args.map(String).join(" ")}`);
      return origError.apply(console, args);
    };
  });
}

const pageErrs = (page) => page.evaluate(() => window.__errs || []);

async function firstVisible(locator, max = 8) {
  const n = Math.min(await locator.count().catch(() => 0), max);
  for (let i = 0; i < n; i++) {
    if (await locator.nth(i).isVisible().catch(() => false)) return locator.nth(i);
  }
  return null;
}

function snapSheet() {
  const el = document.querySelector(".msearch__input");
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    outlineStyle: cs.outlineStyle,
    outlineWidth: cs.outlineWidth,
    outlineColor: cs.outlineColor,
    outlineOffset: cs.outlineOffset,
    borderColor: cs.borderColor,
    focused: document.activeElement === el,
    focusVisible: el.matches(":focus-visible"),
  };
}

function snapTopnav() {
  const el = document.querySelector(".topnav__search input");
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    outlineStyle: cs.outlineStyle,
    outlineWidth: cs.outlineWidth,
    outlineColor: cs.outlineColor,
    borderColor: cs.borderColor,
    background: cs.background,
    focused: document.activeElement === el,
  };
}

async function scrollWidth(page) {
  return page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
  );
}

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
    await injectErrs(page);

    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });

    const entry = await firstVisible(
      page.locator(
        'header a[href*="search"], header button[aria-label="打开搜索"], header button[aria-label="搜索"]'
      )
    );
    expect(entry, "390×844：header 无可见搜索入口");
    await entry.click();

    const input = page.locator(".msearch__input");
    await input.waitFor({ state: "visible", timeout: 8000 });
    await page.waitForTimeout(200);

    const focused = await page.evaluate(snapSheet);
    console.log(`[ASSERT] msearch-sheet focused=${JSON.stringify(focused)}`);
    expect(focused.focused, "autoFocus 后 activeElement 不是 .msearch__input");
    expect(focused.focusVisible, ".msearch__input 未匹配 :focus-visible");
    const w = parseFloat(focused.outlineWidth) || 0;
    expect(
      focused.outlineStyle !== "none" && w >= 2,
      `焦点环不可见：style=${focused.outlineStyle} width=${focused.outlineWidth}（需 !=none 且 >=2px）`
    );
    expect(
      focused.outlineColor === "rgb(0, 102, 255)",
      `outline-color 不是主色令牌：实际=${focused.outlineColor}，期望 rgb(0, 102, 255)`
    );

    // 反向守卫：blur 后焦点环必须消失
    await page.evaluate(() => document.querySelector(".msearch__input").blur());
    await page.waitForTimeout(200);
    const blurred = await page.evaluate(snapSheet);
    console.log(`[ASSERT] msearch-sheet blurred=${JSON.stringify(blurred)}`);
    expect(
      blurred.outlineStyle === "none",
      `blur 后 outline 未恢复 none：style=${blurred.outlineStyle} width=${blurred.outlineWidth}（焦点环常驻）`
    );

    const sw = await scrollWidth(page);
    expect(sw <= 390, `移动端横向溢出：scrollWidth=${sw}`);

    const errs = await pageErrs(page);
    expect(errs.length === 0, `页面错误：${errs.join(" | ")}`);
    await mctx.close();

    // ---------- 桌面 1440：顶栏搜索框既有焦点样式不回归 ----------
    const dctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
    });
    const dpage = await dctx.newPage();
    shotPage = dpage;
    dpage.setDefaultTimeout(15000);
    await injectErrs(dpage);

    await dpage.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    const dinput = dpage.locator(".topnav__search input").first();
    await dinput.waitFor({ state: "visible", timeout: 8000 });

    const dBefore = await dpage.evaluate(snapTopnav);
    await dinput.focus();
    await dpage.waitForTimeout(200);
    const dAfter = await dpage.evaluate(snapTopnav);
    console.log(
      `[ASSERT] topnav before=${JSON.stringify(dBefore)} after=${JSON.stringify(dAfter)}`
    );
    expect(dAfter.focused, "桌面 .topnav__search input focus() 未生效");
    const dw = parseFloat(dAfter.outlineWidth) || 0;
    const dOutlineVis = dAfter.outlineStyle !== "none" && dw >= 1;
    const dChanged =
      dAfter.borderColor !== dBefore.borderColor ||
      dAfter.background !== dBefore.background;
    expect(
      dOutlineVis || dChanged,
      `桌面搜索框焦点样式回归：outline ${dAfter.outlineStyle}/${dAfter.outlineWidth}，` +
        `border ${dBefore.borderColor} -> ${dAfter.borderColor}`
    );

    const dsw = await scrollWidth(dpage);
    expect(dsw <= 1440, `桌面横向溢出：scrollWidth=${dsw}`);

    const derrs = await pageErrs(dpage);
    expect(derrs.length === 0, `桌面页面错误：${derrs.join(" | ")}`);

    await browser.close();
    console.log(`[ASSERT] msearch-sheet-focus PASS — ${BASE}`);
    process.exit(0);
  } catch (e) {
    try {
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      if (shotPage) {
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const p = path.join(SHOT_DIR, `assert-msearch-sheet-focus-${ts}.png`);
        await shotPage.screenshot({ path: p, fullPage: true });
        console.error(`[ASSERT] screenshot: ${p}`);
      }
    } catch {}
    try {
      await browser.close();
    } catch {}
    console.error(`[ASSERT] msearch-sheet-focus FAIL — ${BASE}`);
    console.error(`  ${e.message || e}`);
    process.exit(1);
  }
}

main();
