// Z1124 — 移动端（≤767px）信息流卡片元信息补回紧凑热度信号。
//
// 断言（首页 / 前 3 张 li.feed__item）：
//  1) 390×844：每张卡 .feed__meta 可见文本含「浏览」（紧凑写法「N 浏览 / N 万浏览」），
//     且含「答」短文案；行高 getBoundingClientRect().height <= 24（单行不折行）。
//  2) 1440×900：同 3 张卡 meta 仍是「N 个回答」+「N 次浏览」原文（桌面回归保护）。
//  3) 双端 documentElement.scrollWidth - clientWidth === 0（无横向溢出）；
//     window.__errs 为空。
//  4) 由调度器/人工连跑 3 次应全部通过（脚本内部不做重试放大）。
//
// Env: E2E_BASE || API_BASE(-/api) || http://127.0.0.1:3030/zhihucopy
//      CHROME 可覆盖浏览器路径；失败截图到 /root/logs。
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

async function checkOverflow(page, tag) {
  const diff = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(diff === 0, `${tag}：横向溢出 scrollWidth-clientWidth=${diff}`);
}

async function main() {
  const browser = await chromium.launch({
    executablePath: chromePath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  let shotPage = null;
  try {
    // ---------- 移动端 390×844：紧凑「N 答 · N 浏览」 ----------
    {
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        locale: "zh-CN",
      });
      const page = await ctx.newPage();
      shotPage = page;
      page.setDefaultTimeout(15000);
      await injectErrs(page);
      await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      await page.locator("li.feed__item").first().waitFor({ state: "visible" });
      await page.waitForTimeout(300);

      const metas = page.locator("li.feed__item .feed__meta");
      const n = await metas.count();
      expect(n >= 3, `390px：信息流卡片 ${n} < 3`);
      for (let i = 0; i < 3; i++) {
        const m = metas.nth(i);
        const text = (await m.innerText()).replace(/\s+/g, " ");
        expect(/\d+\s*答/.test(text), `390px：第 ${i + 1} 卡 meta 缺「N 答」：「${text}」`);
        expect(/浏览/.test(text), `390px：第 ${i + 1} 卡 meta 缺「浏览」：「${text}」`);
        expect(
          !/个回答|次浏览/.test(text),
          `390px：第 ${i + 1} 卡 meta 仍是桌面长文案：「${text}」`
        );
        const h = await m.evaluate((el) => el.getBoundingClientRect().height);
        expect(h <= 24, `390px：第 ${i + 1} 卡 meta 行高 ${h}px > 24（折行）`);
        // 万级紧凑写法自洽：>10000 必须是「N[.N] 万浏览」
        if (/万浏览/.test(text)) {
          expect(
            /\d+(\.\d)?\s*万浏览/.test(text),
            `390px：第 ${i + 1} 卡「万浏览」写法不紧凑：「${text}」`
          );
        }
      }
      await checkOverflow(page, "390px 首页");
      const errs = await pageErrs(page);
      expect(errs.length === 0, `390px：页面错误：${errs.join(" | ")}`);
      await ctx.close();
    }

    // ---------- 桌面 1440×900：原文回归保护 ----------
    {
      const ctx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        locale: "zh-CN",
      });
      const page = await ctx.newPage();
      shotPage = page;
      page.setDefaultTimeout(15000);
      await injectErrs(page);
      await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      await page.locator("li.feed__item").first().waitFor({ state: "visible" });
      await page.waitForTimeout(300);

      const metas = page.locator("li.feed__item .feed__meta");
      const n = await metas.count();
      expect(n >= 3, `1440px：信息流卡片 ${n} < 3`);
      for (let i = 0; i < 3; i++) {
        const text = (await metas.nth(i).innerText()).replace(/\s+/g, " ");
        expect(
          /\d+\s*个回答/.test(text),
          `1440px：第 ${i + 1} 卡 meta 缺「N 个回答」：「${text}」`
        );
        expect(
          /\d+\s*次浏览/.test(text),
          `1440px：第 ${i + 1} 卡 meta 缺「N 次浏览」：「${text}」`
        );
      }
      await checkOverflow(page, "1440px 首页");
      const errs = await pageErrs(page);
      expect(errs.length === 0, `1440px：页面错误：${errs.join(" | ")}`);
      await ctx.close();
    }

    await browser.close();
    console.log(`[ASSERT] mobile-feed-meta PASS — ${BASE}`);
    process.exit(0);
  } catch (e) {
    try {
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      if (shotPage) {
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const p = path.join(SHOT_DIR, `assert-mobile-feed-meta-${ts}.png`);
        await shotPage.screenshot({ path: p, fullPage: true });
        console.error(`[ASSERT] screenshot: ${p}`);
      }
    } catch {}
    try {
      await browser.close();
    } catch {}
    console.error(`[ASSERT] mobile-feed-meta FAIL — ${BASE}`);
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
  }
}

main();
