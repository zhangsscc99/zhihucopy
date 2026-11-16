// Z1063 — 「回答/用户」tab 零结果页「换个关键词」出口：浏览器级断言。
//
// 断言：
//  1) 造一个零结果关键词（纯数字随机），分别在 question / answer / user 三个
//     scope（?q=<zero>、&type=answer、&type=user）打开结果页；
//  2) 每个空态容器（.empty）内都有 ≥1 个可见的「换个关键词」按钮；
//     且 answer scope 仍保留「去提问」、user scope 仍保留「去首页」；
//  3) 点击「换个关键词」：document.activeElement 落在 .msearchbar__input、
//     输入框值仍是原关键词（未清空）、URL 未跳走；
//  4) 守卫：document.body.innerText.length > 200、window.__errs 为空。
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

async function isVis(loc) {
  return loc.isVisible().catch(() => false);
}

async function apiGet(p) {
  const res = await fetch(`${API}${p}`);
  if (!res.ok) throw new Error(`api ${p} -> ${res.status}`);
  return res.json();
}

// 纯数字随机的零结果关键词（"zz" + 时间戳尾 6 位），API 确认 0 命中再用。
async function zeroKeyword() {
  const w = `zz${String(Date.now()).slice(-6)}`;
  const res = await apiGet(`/search?q=${encodeURIComponent(w)}`);
  const total = res.counts
    ? (res.counts.question ?? 0) + (res.counts.answer ?? 0) + (res.counts.user ?? 0)
    : (res.total ?? 1);
  if (total !== 0) throw new Error(`零结果词 ${w} 实际有 ${total} 命中（数据问题，非产品失败）`);
  return w;
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
  const ZERO = await zeroKeyword();
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

    const SCOPES = [
      { key: "question", url: `${BASE}/search?q=${ZERO}`, keepCta: null },
      { key: "answer", url: `${BASE}/search?q=${ZERO}&type=answer`, keepCta: "去提问" },
      { key: "user", url: `${BASE}/search?q=${ZERO}&type=user`, keepCta: "去首页" },
    ];

    const hits = {};
    for (const sc of SCOPES) {
      await page.goto(sc.url, { waitUntil: "domcontentloaded" });
      const empty = page.locator(".empty").first();
      await empty.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
      expect(await isVis(empty), `${sc.key} 零结果页无 .empty 空态容器（q=${ZERO}）`);

      const btn = empty.locator('button:has-text("换个关键词")');
      const n = await btn.count();
      hits[sc.key] = n;
      expect(n >= 1, `${sc.key} 空态缺「换个关键词」按钮（命中 ${n} 个）`);
      expect(await isVis(btn.first()), `${sc.key}「换个关键词」按钮不可见`);

      if (sc.keepCta) {
        const keep = empty.locator(`a:has-text("${sc.keepCta}")`).first();
        expect(
          await isVis(keep),
          `${sc.key} 空态原有出口「${sc.keepCta}」丢失`
        );
      }

      const bodyLen = await page.evaluate(() => document.body.innerText.length);
      expect(bodyLen > 200, `${sc.key} 页面内容过少：innerText=${bodyLen}`);

      const urlBefore = page.url();
      await btn.first().click();
      await page.waitForTimeout(300);
      const st = await page.evaluate(() => {
        const el = document.querySelector(".msearchbar__input");
        return {
          focused: document.activeElement === el,
          val: el ? el.value : null,
          url: location.href,
        };
      });
      expect(st.focused, `${sc.key} 点「换个关键词」后焦点未落在 .msearchbar__input`);
      expect(
        st.val === ZERO,
        `${sc.key} 输入框值被改动：值=${JSON.stringify(st.val)}，期望 ${ZERO}`
      );
      expect(
        st.url === urlBefore,
        `${sc.key} 点「换个关键词」后 URL 跳走：${urlBefore} -> ${st.url}`
      );
    }

    const errs = await pageErrs(page);
    expect(errs.length === 0, `页面错误：${errs.join(" | ")}`);

    await browser.close();
    console.log(
      `[ASSERT] search-empty-cta PASS — ${BASE} (ZERO=${ZERO} hits=${JSON.stringify(hits)})`
    );
    process.exit(0);
  } catch (e) {
    try {
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      if (shotPage) {
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const p = path.join(SHOT_DIR, `assert-search-empty-cta-${ts}.png`);
        await shotPage.screenshot({ path: p, fullPage: true });
        console.error(`[ASSERT] screenshot: ${p}`);
      }
    } catch {}
    try {
      await browser.close();
    } catch {}
    console.error(`[ASSERT] search-empty-cta FAIL — ${BASE}`);
    console.error(`  ${e.message || e}`);
    process.exit(1);
  }
}

main();
