// Z974 — 404 页返修验收：区分「内容不存在」与网络错误，提供 ≥2 个出口。
//
// 断言（浏览器级，1440×900 与 390×844 各跑一遍）：
//   /question/999999（内容路由，目标不存在）与 /nonexistent（未知路径）：
//     a) main 文本匹配 /(不存在|找不到|没有找到)/ —— 语义归因为「内容不存在」；
//     b) main 文本不含「请检查网络」—— 不得把缺失归因成网络错误；
//     c) main 内可点出口（a[href] 或 button）≥2，且至少一个 href 回首页；
//     d) HTTP 状态码用 page.goto 的 response().status() 记录现状（200 不判失败）；
//     e) 该视口下无横向溢出。
//   window.__errs 为空。
//
// Env: API_BASE 或 E2E_BASE。退出码即结论（逐项 PASS/FAIL 明细行）。

const API_ENV = (process.env.API_BASE || "").replace(/\/+$/, "");
const BASE = (
  process.env.E2E_BASE ||
  API_ENV.replace(/\/api$/, "") ||
  "http://127.0.0.1:3030/zhihucopy"
).replace(/\/+$/, "");
process.env.E2E_BASE ||= BASE;

const { launch } = await import("../e2e/lib.mjs");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} notfound-page ${name}${detail ? ` — ${detail}` : ""}`);
};

const injectErrs = (page) =>
  page.addInitScript(() => {
    const w = window;
    w.__errs = [];
    w.addEventListener("error", (e) => w.__errs.push(`error:${e.message}`));
    w.addEventListener("unhandledrejection", (e) =>
      w.__errs.push(
        `rejection:${e.reason && e.reason.message ? e.reason.message : e.reason}`
      )
    );
    const origError = console.error;
    console.error = (...args) => {
      w.__errs.push(`console:${args.map(String).join(" ")}`);
      return origError.apply(console, args);
    };
  });
const pageErrs = (page) => page.evaluate(() => window.__errs || []);

const scrollWidth = (page) =>
  page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
  );

const MISSING_RE = /(不存在|找不到|没有找到)/;
const HOME_HREF_RE = /^\/(zhihucopy\/?)?$/;

const PATHS = ["/question/999999", "/nonexistent"];
const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
];

async function main() {
  const browser = await launch();
  let shotPage = null;
  try {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        locale: "zh-CN",
      });
      const page = await ctx.newPage();
      shotPage = page;
      page.setDefaultTimeout(15000);
      await injectErrs(page);

      for (const p of PATHS) {
        const tag = `${vp.name}${p}`;
        const resp = await page.goto(`${BASE}${p}`, { waitUntil: "domcontentloaded" });
        const status = resp ? resp.status() : 0;
        console.log(`[notfound-page] ${tag} http=${status}（记录现状，非判据）`);

        // 等 SPA 渲染出 404 语义（main 文本命中归因词）。
        await page
          .waitForFunction(
            (re) => {
              const m = document.querySelector("main");
              return m && new RegExp(re).test(m.textContent || "");
            },
            MISSING_RE.source,
            { timeout: 10000 }
          )
          .catch(() => {});

        const text = (await page.locator("main").textContent()) || "";
        check(`${tag}-missing-copy`, MISSING_RE.test(text), text.slice(0, 60).replace(/\s+/g, " "));
        check(`${tag}-no-network-copy`, !/请检查网络/.test(text), "归因不得为网络错误");

        const exits = await page.locator('main a[href], main button').count();
        check(`${tag}-exits>=2`, exits >= 2, `clickable=${exits}`);

        const hrefs = await page
          .locator("main a[href]")
          .evaluateAll((els) => els.map((a) => a.getAttribute("href") || ""));
        const home = hrefs.filter((h) => HOME_HREF_RE.test(h));
        check(`${tag}-exit-home`, home.length >= 1, `hrefs=${JSON.stringify(hrefs.slice(0, 5))}`);

        const sw = await scrollWidth(page);
        check(`${tag}-no-hscroll`, sw <= vp.width, `scrollWidth=${sw} > ${vp.width}`);
      }

      const errs = await pageErrs(page);
      check(`${vp.name}-errs-empty`, errs.length === 0, errs.slice(0, 3).join(" | "));
      await ctx.close();
    }
    await browser.close();
  } catch (e) {
    check("unexpected-error", false, String(e && e.message ? e.message : e).slice(0, 200));
    try {
      if (shotPage) {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const dir = process.env.E2E_SHOT_DIR || "/root/logs";
        fs.mkdirSync(dir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        await shotPage.screenshot({ path: path.join(dir, `assert-notfound-page-${ts}.png`), fullPage: true });
      }
    } catch {}
    await browser.close().catch(() => {});
  }
  const fails = results.filter((r) => !r.ok).length;
  console.log(`[ASSERT] notfound-page ${fails ? "FAIL" : "PASS"} — ${results.length - fails}/${results.length} checks — ${BASE}`);
  process.exit(fails ? 1 : 0);
}

main();
