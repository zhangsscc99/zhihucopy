// Z972 — 移动端搜索入口：390×844 下顶栏放大镜 → 全屏 .msearch 搜索层。
//
// 断言（浏览器级，playwright-core + chromium）：
//   1) 反向控制：未点击前 .msearch 节点数 === 0（弹层不是常驻节点，证明
//      「出现后断言可见」不是恒真）。
//   2) 390×844 首页：header 内 input 不可见或宽 0（桌面搜索框已隐藏，记录现状）。
//   3) 点 button.topnav__search-btn / button[aria-label="打开搜索"] →
//      .msearch 弹层 1.5s 内可见，层内有可见 input。
//   4) 输入「职场」回车 → URL 含 q=、结果行 ≥1、页面无横向溢出、__errs 为空。
//
// Env: API_BASE 或 E2E_BASE（同其它 assert 脚本）。
// 退出码即结论：0 PASS / 1 FAIL（逐项 PASS/FAIL 明细行）。

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
  console.log(`${cond ? "PASS" : "FAIL"} mobile-search ${name}${detail ? ` — ${detail}` : ""}`);
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

const isVis = (loc) => loc.isVisible().catch(() => false);

const KW = "职场";

async function main() {
  const browser = await launch();
  let shotPage = null;
  try {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "zh-CN",
    });
    const page = await ctx.newPage();
    shotPage = page;
    page.setDefaultTimeout(15000);
    await injectErrs(page);
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.locator(".bottomnav").waitFor({ state: "visible" });

    // 反向控制：点击前 .msearch 节点数 === 0（弹层按需挂载，不是常驻 DOM）。
    const msearchBefore = await page.locator(".msearch").count();
    check("pre-click-msearch-absent", msearchBefore === 0, `.msearch count=${msearchBefore}`);

    // header input 现状：桌面搜索框在 390 下应不可见或宽 0（记录，不断言具体形态）。
    const headerInput = page.locator("header input").first();
    const inputState = await page.evaluate(() => {
      const el = document.querySelector("header input");
      if (!el) return { exists: false, visible: false, width: 0 };
      const r = el.getBoundingClientRect();
      return {
        exists: true,
        visible: !!(el.offsetParent || r.width || r.height),
        width: Math.round(r.width),
      };
    });
    check(
      "header-input-hidden-or-zero",
      !inputState.exists || !inputState.visible || inputState.width === 0,
      `exists=${inputState.exists} visible=${inputState.visible} width=${inputState.width}`
    );

    // 顶栏搜索入口：放大镜按钮。
    const entry = page
      .locator('button.topnav__search-btn, button[aria-label="打开搜索"]')
      .first();
    check("search-entry-visible", await isVis(entry), "390 顶栏放大镜");

    await entry.click();

    // 弹层 1.5s 内出现 + 层内有可见输入框。
    const dlg = page.locator(".msearch").first();
    const t0 = Date.now();
    let dlgOk = false;
    try {
      await dlg.waitFor({ state: "visible", timeout: 1500 });
      dlgOk = true;
    } catch {}
    check("msearch-opens-in-1500ms", dlgOk, `elapsed=${Date.now() - t0}ms`);

    const dlgInput = dlg.locator("input:visible").first();
    check("msearch-input-visible", await isVis(dlgInput), ".msearch input:visible");

    // 输入「职场」回车 → /search?q=职场。
    await dlgInput.fill(KW);
    await dlgInput.press("Enter");
    await page.waitForFunction(
      (w) => new URL(location.href).searchParams.get("q") === w,
      KW,
      { timeout: 8000 }
    );
    check("search-url-q", page.url().includes("q="), page.url());

    // 结果行 ≥1。
    await page.waitForSelector(".feed__item", { state: "visible", timeout: 8000 }).catch(() => {});
    const rows = await page.locator(".feed__item").count();
    check("search-results>=1", rows >= 1, `feed__item=${rows}`);

    // 无横向溢出（首页 + 结果页）。
    const swRes = await scrollWidth(page);
    check("no-hscroll-result", swRes <= 390, `scrollWidth=${swRes}`);
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.locator(".bottomnav").waitFor({ state: "visible" });
    const swHome = await scrollWidth(page);
    check("no-hscroll-home", swHome <= 390, `scrollWidth=${swHome}`);

    const errs = await pageErrs(page);
    check("errs-empty", errs.length === 0, errs.slice(0, 3).join(" | "));

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
        await shotPage.screenshot({ path: path.join(dir, `assert-mobile-search-${ts}.png`), fullPage: true });
      }
    } catch {}
    await browser.close().catch(() => {});
  }
  const fails = results.filter((r) => !r.ok).length;
  console.log(`[ASSERT] mobile-search ${fails ? "FAIL" : "PASS"} — ${results.length - fails}/${results.length} checks — ${BASE}`);
  process.exit(fails ? 1 : 0);
}

main();
