// Z1162 — 搜索空态跨分类引导一致性：浏览器级断言。
//
// 断言：
//  1) `?q=租约`（问题 0 / 回答 1 / 用户 0）：headline 数字 ≥1（三类合计口径）、
//     空态含「回答中有 1 条」引导文案；点引导按钮 → URL 落到 type=answer、
//     .feed 列表 ≥1 条，且 headline 数字与列表条数一致；
//  2) `?q=zzzzqqq`（真零命中）：headline 为「0 条」、空态保留
//     「换个关键词 / 去提问」双出口、不出现「中有 N 条」引导；
//  3) `?q=useEffect 清理`（问题有命中）：页面不出现「回答中有」引导；
//  4) 1440/390 两档视口无横向溢出（scrollWidth <= clientWidth+1）、
//     每档 window.__errs 为空、body 内容量 >200。
//
// 反向自检：对未修基线（线上 https://openfolio.uk/zhihucopy 或旧 dist）
// 必须 FAIL——headline 写 0 且无「回答中有」引导。
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

async function headlineTotal(page) {
  const t = await page
    .locator(".search-head__total")
    .first()
    .innerText()
    .catch(() => "");
  const m = t.match(/(\d+)\s*条/);
  return m ? Number(m[1]) : null;
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

async function checkViewport(page, width, tag) {
  const st = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
    bodyLen: document.body.innerText.length,
  }));
  expect(
    st.sw <= st.cw + 1,
    `${tag} 横向溢出：scrollWidth=${st.sw} > clientWidth=${st.cw}（视口 ${width}）`
  );
  expect(st.bodyLen > 200, `${tag} 页面内容过少：innerText=${st.bodyLen}`);
  const errs = await pageErrs(page);
  expect(errs.length === 0, `${tag} 页面错误：${errs.join(" | ")}`);
}

async function main() {
  const browser = await chromium.launch({
    executablePath: chromePath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  let shotPage = null;
  try {
    const ctx = await browser.newContext({ locale: "zh-CN" });
    const page = await ctx.newPage();
    shotPage = page;
    page.setDefaultTimeout(15000);
    await injectErrs(page);

    // ---- 场景 1：?q=租约 —— 问题 0 / 回答 1，headline 用合计口径 + 跨分类引导
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/search?q=${encodeURIComponent("租约")}`, {
      waitUntil: "domcontentloaded",
    });
    const empty = page.locator(".empty").first();
    await empty.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    const h1 = await headlineTotal(page);
    expect(h1 !== null, "?q=租约 headline 未出现「· N 条」");
    expect(h1 >= 1, `?q=租约 headline=${h1}，期望 ≥1（合计口径；未修基线写 0）`);
    const guideText = await empty.innerText().catch(() => "");
    expect(
      guideText.includes("回答中有 1 条"),
      `?q=租约 空态缺「回答中有 1 条」引导，实际：${guideText.slice(0, 80)}`
    );
    const guideBtn = empty.locator("button").first();
    expect(
      await guideBtn.isVisible().catch(() => false),
      "?q=租约 空态缺可点击的切分类按钮"
    );
    await guideBtn.click();
    await page.waitForURL(/type=answer/, { timeout: 8000 }).catch(() => {});
    expect(
      /[?&]type=answer/.test(page.url()),
      `点引导后未落到 type=answer：${page.url()}`
    );
    await page
      .locator(".feed > *")
      .first()
      .waitFor({ state: "visible", timeout: 8000 })
      .catch(() => {});
    const feedN = await page.locator(".feed > *").count();
    expect(feedN >= 1, `type=answer 列表为空（feed 子节点 ${feedN}）`);
    const h2 = await headlineTotal(page);
    expect(
      h2 === feedN,
      `headline(${h2}) 与列表条数(${feedN}) 不一致`
    );
    await checkViewport(page, 1440, "租约/answer");

    // ---- 场景 2：?q=zzzzqqq —— 真零命中：headline 0 + 双出口保留
    await page.goto(`${BASE}/search?q=zzzzqqq`, { waitUntil: "domcontentloaded" });
    const empty0 = page.locator(".empty").first();
    await empty0.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    const h0 = await headlineTotal(page);
    expect(h0 === 0, `?q=zzzzqqq headline=${h0}，期望 0`);
    const e0text = await empty0.innerText().catch(() => "");
    expect(
      !e0text.includes("中有"),
      `?q=zzzzqqq 零命中页不应出现跨分类引导，实际：${e0text.slice(0, 80)}`
    );
    expect(
      await empty0.locator('button:has-text("换个关键词")').first().isVisible().catch(() => false),
      "?q=zzzzqqq 空态缺「换个关键词」出口"
    );
    expect(
      await empty0.locator('a:has-text("去提问")').first().isVisible().catch(() => false),
      "?q=zzzzqqq 空态缺「去提问」出口"
    );
    await checkViewport(page, 1440, "zzzzqqq");

    // ---- 场景 3：?q=useEffect 清理 —— 问题有命中，不出现「回答中有」引导
    await page.goto(`${BASE}/search?q=${encodeURIComponent("useEffect 清理")}`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator(".feed > *")
      .first()
      .waitFor({ state: "visible", timeout: 8000 })
      .catch(() => {});
    const body3 = await page.evaluate(() => document.body.innerText);
    expect(
      !body3.includes("回答中有"),
      "?q=useEffect 清理 问题有命中页不应出现「回答中有」引导"
    );
    await checkViewport(page, 1440, "useEffect");

    // ---- 场景 4：390 视口复查场景 1（移动宽度不溢出、引导仍在）
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/search?q=${encodeURIComponent("租约")}`, {
      waitUntil: "domcontentloaded",
    });
    const empty4 = page.locator(".empty").first();
    await empty4.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    const t4 = await empty4.innerText().catch(() => "");
    expect(
      t4.includes("回答中有 1 条"),
      `390 视口 ?q=租约 空态缺「回答中有 1 条」`
    );
    await checkViewport(page, 390, "租约/390");

    await browser.close();
    console.log(`[ASSERT] search-empty-consistency PASS — ${BASE}`);
    process.exit(0);
  } catch (e) {
    try {
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      if (shotPage) {
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const p = path.join(SHOT_DIR, `assert-search-empty-consistency-${ts}.png`);
        await shotPage.screenshot({ path: p, fullPage: true });
        console.error(`[ASSERT] screenshot: ${p}`);
      }
    } catch {}
    try {
      await browser.close();
    } catch {}
    console.error(`[ASSERT] search-empty-consistency FAIL — ${BASE}`);
    console.error(`  ${e.message || e}`);
    process.exit(1);
  }
}

main();
