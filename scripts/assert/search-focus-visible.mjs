// Z1065 — .msearchbar__input 焦点可见性（WCAG 2.4.11）：浏览器级断言。
//
// 断言：
//  1) 打开 /search?q=<真实关键词>，取聚焦前基线：
//     输入框 outline-style/outline-width/outline-color + 容器 border-color；
//  2) 聚焦 .msearchbar__input 后打印并断言（合取的「至少一个真实变化」）：
//     a) 输入框 outline-style !== "none" 且 outline-width 解析 px >= 2；或
//     b) 容器 :focus-within border-color 相对基线变化；
//     —— 两条都打印实际值；
//  3) 反向守卫：焦点移走后 outline-style 恢复 none（证明是焦点态非恒常量）；
//  4) 守卫 window.__errs 为空。
//
// 真实关键词取自 GET /api/questions?tab=hot&limit=10，不硬编码。
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
const API = process.env.API_BASE || `${BASE}/api`;

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

async function apiGet(p) {
  const res = await fetch(`${API}${p}`);
  if (!res.ok) throw new Error(`api ${p} -> ${res.status}`);
  return res.json();
}

async function realKeyword() {
  const list = await apiGet("/questions?tab=hot&limit=10");
  for (const it of list.items || []) {
    const words = String(it.title || "")
      .replace(/[？?。！!，,、：:；;「」“”"'（）()\s]/g, " ")
      .split(" ")
      .filter((w) => w.length >= 2 && w.length <= 12);
    for (const w of words) {
      const res = await apiGet(`/search?q=${encodeURIComponent(w)}`).catch(() => null);
      if (res && (res.counts?.question ?? res.total ?? 0) > 0) return w;
    }
  }
  throw new Error("无法从热榜取到有效关键词");
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

function snapshot() {
  const bar = document.querySelector(".msearchbar");
  const inp = document.querySelector(".msearchbar__input");
  const is = getComputedStyle(inp);
  const bs = getComputedStyle(bar);
  return {
    outlineStyle: is.outlineStyle,
    outlineWidth: is.outlineWidth,
    outlineColor: is.outlineColor,
    barBorderColor: bs.borderColor,
    barBoxShadow: bs.boxShadow,
    focused: document.activeElement === inp,
  };
}

async function main() {
  const W = await realKeyword();
  const browser = await chromium.launch({
    executablePath: chromePath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  let shotPage = null;
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      locale: "zh-CN",
    });
    const page = await ctx.newPage();
    shotPage = page;
    page.setDefaultTimeout(15000);
    await injectErrs(page);

    await page.goto(`${BASE}/search?q=${encodeURIComponent(W)}`, {
      waitUntil: "domcontentloaded",
    });
    const input = page.locator(".msearchbar__input").first();
    await input.waitFor({ state: "visible", timeout: 8000 });

    const before = await page.evaluate(snapshot);
    console.log(`[ASSERT] focus-vis before=${JSON.stringify(before)}`);

    await input.focus();
    await page.waitForTimeout(200);
    const after = await page.evaluate(snapshot);
    console.log(`[ASSERT] focus-vis after=${JSON.stringify(after)}`);
    expect(after.focused, "input.focus() 后 activeElement 不是 .msearchbar__input");

    const widthPx = parseFloat(after.outlineWidth) || 0;
    const outlineVis = after.outlineStyle !== "none" && widthPx >= 2;
    const barChanged =
      after.barBorderColor !== before.barBorderColor ||
      after.barBoxShadow !== before.barBoxShadow;
    console.log(
      `[ASSERT] focus-vis outlineVis=${outlineVis} (style=${after.outlineStyle} width=${widthPx}px color=${after.outlineColor}) barChanged=${barChanged} (before=${before.barBorderColor}/${before.barBoxShadow} after=${after.barBorderColor}/${after.barBoxShadow})`
    );
    // 容器 :focus-within 1px 边框不达 WCAG 2.4.11 的 2px perimeter——必须输入框自身有可见 outline。
    expect(
      outlineVis,
      `输入框自身无可见 outline：style=${after.outlineStyle} width=${after.outlineWidth}（需 style!=none 且 >=2px）；` +
        `容器 border before=${before.barBorderColor} after=${after.barBorderColor}（容器变色不足以达标）`
    );

    // 反向守卫：移走焦点 → outline 必须恢复 none（证明是焦点态而非恒常量）
    await page.evaluate(() => {
      document.querySelector(".msearchbar__input").blur();
      document.body.focus && document.body.focus();
    });
    await page.waitForTimeout(200);
    const blurred = await page.evaluate(snapshot);
    console.log(`[ASSERT] focus-vis blurred=${JSON.stringify(blurred)}`);
    expect(
      blurred.outlineStyle === "none",
      `焦点移走后 outline 未恢复 none：style=${blurred.outlineStyle} width=${blurred.outlineWidth}（疑似恒常量假焦点态）`
    );

    const errs = await pageErrs(page);
    expect(errs.length === 0, `页面错误：${errs.join(" | ")}`);

    await browser.close();
    console.log(`[ASSERT] search-focus-visible PASS — ${BASE} (W=${W})`);
    process.exit(0);
  } catch (e) {
    try {
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      if (shotPage) {
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const p = path.join(SHOT_DIR, `assert-search-focus-visible-${ts}.png`);
        await shotPage.screenshot({ path: p, fullPage: true });
        console.error(`[ASSERT] screenshot: ${p}`);
      }
    } catch {}
    try {
      await browser.close();
    } catch {}
    console.error(`[ASSERT] search-focus-visible FAIL — ${BASE}`);
    console.error(`  ${e.message || e}`);
    process.exit(1);
  }
}

main();
