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
import { register, req, cleanupOwned } from "./lib.mjs";

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
        // 取可见短文案节点的 innerText（视觉裁切不影响 meta 整体 innerText，会恒真）
        const viewsText = (await m.locator(".feed__views-short").innerText()).trim();
        expect(/浏览/.test(viewsText), `390px：第 ${i + 1} 卡 .feed__views-short 缺「浏览」：「${viewsText}」`);
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

    // ---------- Z1133 — 长昵称（12 汉字）溢出保护：昵称省略、元信息仍单行 ----------
    // API 造一个 12 个汉字昵称的账号（register()+PATCH /users/me，退出由 lib 自清理），
    // 把昵称注入首屏第一张卡的 .feed__author-name，真实测量省略与溢出。
    const LONG_NICK = "长昵称用户甲乙丙丁戊己"; // 12 个汉字
    {
      const { token } = await register();
      const pr = await req("PATCH", "/users/me", {
        token,
        body: { nickname: LONG_NICK },
      });
      expect(
        pr.status === 200 && pr.data.user && pr.data.user.nickname === LONG_NICK,
        `PATCH /users/me 长昵称 -> ${pr.status} ${JSON.stringify(pr.data).slice(0, 160)}`
      );

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

      // CSS 契约：作者节点的 max-width 必须是百分比且 ≤40%（旧构建是 none → FAIL），
      // 省略约束落在昵称文本节点 .feed__author-name 上（text-overflow: ellipsis）。
      const cssContract = await page.evaluate(() => {
        const author = document.querySelector(
          "li.feed__item .feed__meta .feed__author"
        );
        const name = author && author.querySelector(".feed__author-name");
        if (!author || !name) return { ok: false };
        return {
          ok: true,
          mw: getComputedStyle(author).maxWidth,
          to: getComputedStyle(name).textOverflow,
        };
      });
      expect(cssContract.ok, "390px CSS 契约：首屏卡片缺 .feed__author/.feed__author-name");
      expect(
        /%$/.test(cssContract.mw) && parseFloat(cssContract.mw) <= 40,
        `390px CSS 契约：.feed__author max-width=${cssContract.mw}（应为 ≤40% 百分比）`
      );
      expect(
        cssContract.to === "ellipsis",
        `390px CSS 契约：.feed__author-name text-overflow=${cssContract.to} !== ellipsis`
      );

      const injected = await page.evaluate((nick) => {
        const el = document.querySelector(
          "li.feed__item .feed__meta .feed__author-name"
        );
        if (!el) return false;
        el.textContent = nick;
        return true;
      }, LONG_NICK);
      expect(injected, "首屏卡片没有 .feed__author-name");
      await page.waitForTimeout(100);

      const m = await page.evaluate(() => {
        const meta = document.querySelector("li.feed__item .feed__meta");
        const name = meta.querySelector(".feed__author-name");
        const card = meta.closest("li.feed__item");
        return {
          metaH: meta.scrollHeight,
          nameSW: name.scrollWidth,
          nameCW: name.clientWidth,
          textOverflow: getComputedStyle(name).textOverflow,
          cardDiff: card.scrollWidth - card.clientWidth,
          metaText: meta.innerText.replace(/\s+/g, " "),
          bodyLen: document.body.innerText.length,
        };
      });
      expect(m.metaH <= 24, `390px 长昵称：meta scrollHeight ${m.metaH} > 24（折行）`);
      expect(
        m.nameSW > m.nameCW,
        `390px 长昵称：昵称未省略 scrollWidth=${m.nameSW} <= clientWidth=${m.nameCW}`
      );
      expect(
        m.textOverflow === "ellipsis",
        `390px 长昵称：textOverflow=${m.textOverflow} !== ellipsis`
      );
      expect(m.cardDiff === 0, `390px 长昵称：卡片横向溢出 ${m.cardDiff}`);
      const vs = await page.evaluate(() => {
        const el = document.querySelector(
          "li.feed__item .feed__meta .feed__views-short"
        );
        return el ? el.innerText.trim() : "";
      });
      expect(/浏览/.test(vs), `390px 长昵称：「浏览」被挤出可视文本：「${vs}」`);
      expect(m.bodyLen > 200, `390px 长昵称：body.innerText=${m.bodyLen} <= 200`);
      await checkOverflow(page, "390px 长昵称首页");
      const errs = await pageErrs(page);
      expect(errs.length === 0, `390px 长昵称：页面错误：${errs.join(" | ")}`);
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

      // Z1133 — 桌面端同样注入 12 字昵称：长文案不变、无横向溢出。
      const injected0 = await page.evaluate((nick) => {
        const el = document.querySelector(
          "li.feed__item .feed__meta .feed__author-name"
        );
        if (!el) return false;
        el.textContent = nick;
        return true;
      }, LONG_NICK);
      expect(injected0, "1440px：首屏卡片没有 .feed__author-name");
      await page.waitForTimeout(100);
      const t0 = (await metas.nth(0).innerText()).replace(/\s+/g, " ");
      expect(/\d+\s*个回答/.test(t0), `1440px 长昵称：桌面文案变化：「${t0}」`);
      expect(/\d+\s*次浏览/.test(t0), `1440px 长昵称：桌面文案变化：「${t0}」`);
      const d0 = await page.evaluate(() => {
        const meta = document.querySelector("li.feed__item .feed__meta");
        const card = meta.closest("li.feed__item");
        return card.scrollWidth - card.clientWidth;
      });
      expect(d0 === 0, `1440px 长昵称：卡片横向溢出 ${d0}`);
      await checkOverflow(page, "1440px 长昵称首页");
      const errs2 = await pageErrs(page);
      expect(errs2.length === 0, `1440px 长昵称：页面错误：${errs2.join(" | ")}`);
      await ctx.close();
    }

    await browser.close();
    cleanupOwned(); // 显式清理 register() 产物（exit 钩子兜底，这里在 finally 语义上先跑）
    console.log(`[ASSERT] mobile-feed-meta PASS — ${BASE}`);
    process.exit(0);
  } catch (e) {
    cleanupOwned();
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
