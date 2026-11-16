// Z1041 — 结果页内嵌可编辑搜索框（原地续搜）：浏览器级断言。
//
// 断言：
//  1) 桌面 1366×900 打开 /search?q=<真实关键词>：.msearchbar 可见、input 值==q、可编辑。
//  2) 输入新词 + 回车：URL q= 变成新词、结果标题跟着变、body.innerText>200、__errs 空。
//  3) 零结果关键词点「换个关键词」：URL 不变（仍带原 q）、内嵌 input 获得焦点且
//     selectionStart===0 && selectionEnd===value.length。
//  4) 点「取消搜索」：URL 为首页，document.activeElement 在 header 内且是 search input。
//  5) 390×844：.msearchbar 可见、改词回车生效、scrollWidth<=390。
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

async function apiGet(p) {
  const res = await fetch(`${API}${p}`);
  if (!res.ok) throw new Error(`api ${p} -> ${res.status}`);
  return res.json();
}

// 从热榜标题里取两个不同的真实搜索词（都需在 question scope 有命中）。
async function realKeywords() {
  const list = await apiGet("/questions?tab=hot&limit=10");
  const cands = [];
  for (const it of list.items || []) {
    const words = String(it.title || "")
      .replace(/[？?。！!，,、：:；;「」“”"'（）()\s]/g, " ")
      .split(" ")
      .filter((w) => w.length >= 2 && w.length <= 12);
    cands.push(...words);
    if (it.title && it.title.length >= 2) cands.push(it.title.slice(0, 6));
  }
  const picked = [];
  for (const w of [...new Set(cands)]) {
    if (picked.length >= 2) break;
    const res = await apiGet(`/search?q=${encodeURIComponent(w)}`).catch(() => null);
    if (res && (res.counts?.question ?? res.total ?? 0) > 0) picked.push(w);
  }
  if (picked.length < 2) throw new Error(`无法从热榜取到 2 个有效关键词：${JSON.stringify(picked)}`);
  return picked;
}

// 找一个零结果关键词。
async function zeroKeyword() {
  const stamp = Date.now().toString(36);
  for (const w of [`zzq${stamp}`, `qxz${stamp}w`, "zxcvbnmqwerty"]) {
    const res = await apiGet(`/search?q=${encodeURIComponent(w)}`).catch(() => null);
    if (res && (res.counts?.question ?? res.total ?? 1) === 0) return w;
  }
  throw new Error(`无法构造零结果关键词：三个候选词均有命中（环境/数据问题，非产品失败）`);
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

async function main() {
  const [W1, W2] = await realKeywords();
  const ZERO = await zeroKeyword();
  const browser = await chromium.launch({
    executablePath: chromePath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  let shotPage = null;
  try {
    // ---------- 桌面 1366×900 ----------
    const dctx = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      locale: "zh-CN",
    });
    const page = await dctx.newPage();
    shotPage = page;
    page.setDefaultTimeout(15000);
    await injectErrs(page);

    // (1) 结果页内嵌搜索框桌面可见、预填 q、可编辑
    await page.goto(`${BASE}/search?q=${encodeURIComponent(W1)}`, {
      waitUntil: "domcontentloaded",
    });
    const bar = page.locator(".msearchbar").first();
    await bar.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    expect(await isVis(bar), "1366×900：.msearchbar 不可见（桌面端仍 display:none？）");
    const input = bar.locator('input[type="search"]').first();
    expect(await isVis(input), ".msearchbar 内无可见 input[type=search]");
    expect(
      (await input.inputValue()) === W1,
      `内嵌输入框未预填 q：值=${await input.inputValue()}，期望 ${W1}`
    );
    expect(await input.isEditable(), ".msearchbar input 不可编辑");

    // (1b) 焦点可见性（收紧，Z1065）：容器边框/阴影必须「相对聚焦前变化」且非 transparent；
    //      输入框自身须满足 outline 可见 或 border-color 相对基线变化（至少一个真实变化）。
    const before = await page.evaluate(() => {
      const barEl = document.querySelector(".msearchbar");
      const inpEl = barEl.querySelector('input[type="search"]');
      const bs = getComputedStyle(barEl);
      const is = getComputedStyle(inpEl);
      return {
        barColor: bs.borderColor,
        barShadow: bs.boxShadow,
        inpColor: is.borderColor,
      };
    });
    await input.focus();
    await page.waitForTimeout(150);
    const focusVis = await page.evaluate(() => {
      const barEl = document.querySelector(".msearchbar");
      const inpEl = barEl.querySelector('input[type="search"]');
      const bs = getComputedStyle(barEl);
      const is = getComputedStyle(inpEl);
      return {
        barColor: bs.borderColor,
        barShadow: bs.boxShadow,
        inpColor: is.borderColor,
        inpOutline: is.outlineStyle,
        inpOutlineWidth: is.outlineWidth,
        focused: document.activeElement === inpEl,
      };
    });
    console.log(
      `[ASSERT] focus-vis before=${JSON.stringify(before)} after=${JSON.stringify(focusVis)}`
    );
    expect(focusVis.focused, "input.focus() 后 activeElement 不是内嵌输入框");
    const isTransparent = (c) => !c || c === "transparent" || c === "rgba(0, 0, 0, 0)";
    const barChanged =
      focusVis.barColor !== before.barColor || focusVis.barShadow !== before.barShadow;
    expect(
      barChanged && !isTransparent(focusVis.barColor),
      `焦点态不可见：容器 borderColor/boxShadow 未真实变化 before=${before.barColor}/${before.barShadow} after=${focusVis.barColor}/${focusVis.barShadow}`
    );
    const inpOutlineVis =
      focusVis.inpOutline !== "none" && focusVis.inpOutlineWidth !== "0px";
    const inpBorderChanged = focusVis.inpColor !== before.inpColor;
    expect(
      inpOutlineVis || inpBorderChanged,
      `输入框自身无真实焦点态变化：outline=${focusVis.inpOutline} ${focusVis.inpOutlineWidth}，borderColor before=${before.inpColor} after=${focusVis.inpColor}`
    );

    // (2) 改词回车 → URL q=新词、标题跟变、页面非空、无页面错误
    await input.fill(W2);
    await input.press("Enter");
    await page.waitForFunction(
      (w) => new URL(location.href).searchParams.get("q") === w,
      W2,
      { timeout: 8000 }
    );
    await page
      .waitForSelector(".search-head__title", { state: "visible", timeout: 8000 })
      .catch(() => {});
    const headText = await page
      .locator(".search-head__title")
      .first()
      .innerText()
      .catch(() => "");
    expect(headText.includes(W2), `结果标题未跟新词：「${headText}」不含 ${W2}`);
    const bodyLen = await page.evaluate(() => document.body.innerText.length);
    expect(bodyLen > 200, `改词后页面内容过少：innerText=${bodyLen}`);
    const errs = await pageErrs(page);
    expect(errs.length === 0, `改词续搜出现页面错误：${errs.join(" | ")}`);

    // (2b) type=answer 下换词：分类 tab 必须保留（URL 仍带 type=answer，「回答」仍选中）
    await page.goto(`${BASE}/search?q=${encodeURIComponent(W1)}&type=answer`, {
      waitUntil: "domcontentloaded",
    });
    const ansTab = page.locator('.stabs [role="tab"]:has-text("回答")').first();
    await ansTab.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    expect(
      (await ansTab.getAttribute("aria-selected")) === "true",
      "打开 ?type=answer 后「回答」tab 未选中"
    );
    const ainput = page.locator('.msearchbar input[type="search"]').first();
    await ainput.fill(W2);
    await ainput.press("Enter");
    await page.waitForFunction(
      (w) =>
        new URL(location.href).searchParams.get("q") === w &&
        new URL(location.href).searchParams.get("type") === "answer",
      W2,
      { timeout: 8000 }
    );
    await page.waitForTimeout(300);
    expect(
      (await ansTab.getAttribute("aria-selected")) === "true",
      "换词后「回答」tab 丢失选中态（type=answer 被丢掉？）"
    );
    const abodyLen = await page.evaluate(() => document.body.innerText.length);
    expect(abodyLen > 200, `type=answer 换词后页面内容过少：innerText=${abodyLen}`);
    const aerrs = await pageErrs(page);
    expect(aerrs.length === 0, `type=answer 换词出现页面错误：${aerrs.join(" | ")}`);

    // (3) 零结果 → 「换个关键词」原地聚焦+全选，URL 不变
    await page.goto(`${BASE}/search?q=${encodeURIComponent(ZERO)}`, {
      waitUntil: "domcontentloaded",
    });
    const retryBtn = page.locator('button:has-text("换个关键词")').first();
    await retryBtn.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    expect(await isVis(retryBtn), `零结果页无「换个关键词」按钮（q=${ZERO}）`);
    const urlBefore = page.url();
    await retryBtn.click();
    await page.waitForTimeout(300);
    expect(
      page.url() === urlBefore,
      `「换个关键词」改变了 URL：${urlBefore} -> ${page.url()}`
    );
    const focusState = await page.evaluate(() => {
      const el = document.querySelector('.msearchbar input[type="search"]');
      const ae = document.activeElement;
      return {
        focused: ae === el,
        selStart: el ? el.selectionStart : -1,
        selEnd: el ? el.selectionEnd : -1,
        len: el ? el.value.length : -1,
        val: el ? el.value : null,
      };
    });
    expect(focusState.focused, "「换个关键词」后焦点未落在内嵌输入框");
    expect(
      focusState.selStart === 0 && focusState.selEnd === focusState.len && focusState.len > 0,
      `内嵌输入框未全选：sel=${focusState.selStart}..${focusState.selEnd} len=${focusState.len}`
    );
    const errs3 = await pageErrs(page);
    expect(errs3.length === 0, `「换个关键词」后出现页面错误：${errs3.join(" | ")}`);

    // (4) 「取消搜索」→ 回首页，焦点落在 header 内搜索输入框（不落到 BODY）
    const exitBtn = page.locator('.search-head__exit, button:has-text("取消搜索")').first();
    await exitBtn.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    expect(await isVis(exitBtn), "结果页无「取消搜索」按钮");
    await exitBtn.click();
    await page.waitForFunction(
      () => new URL(location.href).searchParams.get("q") === null && !location.pathname.endsWith("/search"),
      null,
      { timeout: 8000 }
    );
    await page.waitForTimeout(300);
    const land = await page.evaluate(() => {
      const ae = document.activeElement;
      return {
        url: location.href,
        tag: ae ? ae.tagName : "",
        inHeader: !!(ae && ae.closest("header")),
        isSearchInput: !!(ae && ae.matches('.topnav__search input, header input[aria-label="搜索"]')),
      };
    });
    expect(
      !land.url.includes("q="),
      `「取消搜索」后 URL 仍带 q：${land.url}`
    );
    expect(
      land.inHeader && land.isSearchInput,
      `落地焦点不在 header 搜索框：tag=${land.tag} inHeader=${land.inHeader}`
    );
    const homeLen = await page.evaluate(() => document.body.innerText.length);
    expect(homeLen > 200, `取消搜索回首页后内容过少：innerText=${homeLen}`);
    const errs4 = await pageErrs(page);
    expect(errs4.length === 0, `「取消搜索」后出现页面错误：${errs4.join(" | ")}`);

    // ---------- 移动端 390×844 ----------
    const mctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "zh-CN",
    });
    const mpage = await mctx.newPage();
    shotPage = mpage;
    mpage.setDefaultTimeout(15000);
    await injectErrs(mpage);
    await mpage.goto(`${BASE}/search?q=${encodeURIComponent(W1)}`, {
      waitUntil: "domcontentloaded",
    });
    const mbar = mpage.locator(".msearchbar").first();
    await mbar.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    expect(await isVis(mbar), "390×844：.msearchbar 不可见");
    const minput = mbar.locator('input[type="search"]').first();
    expect((await minput.inputValue()) === W1, "移动端内嵌输入框未预填 q");
    await minput.fill(W2);
    await minput.press("Enter");
    await mpage.waitForFunction(
      (w) => new URL(location.href).searchParams.get("q") === w,
      W2,
      { timeout: 8000 }
    );
    const sw = await mpage.evaluate(() =>
      Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
    );
    expect(sw <= 390, `390 结果页横向溢出：scrollWidth=${sw}`);
    const merrs = await pageErrs(mpage);
    expect(merrs.length === 0, `移动端续搜出现页面错误：${merrs.join(" | ")}`);

    await browser.close();
    console.log(`[ASSERT] search-inline-input PASS — ${BASE} (W1=${W1} W2=${W2} ZERO=${ZERO})`);
    process.exit(0);
  } catch (e) {
    try {
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      if (shotPage) {
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const p = path.join(SHOT_DIR, `assert-search-inline-input-${ts}.png`);
        await shotPage.screenshot({ path: p, fullPage: true });
        console.error(`[ASSERT] screenshot: ${p}`);
      }
    } catch {}
    try {
      await browser.close();
    } catch {}
    console.error(`[ASSERT] search-inline-input FAIL — ${BASE}`);
    console.error(`  ${e.message || e}`);
    process.exit(1);
  }
}

main();
