#!/usr/bin/env node
// Z1148 — 未登录点「反对」与其它写操作同路径：toast + 跳
// /login?next=<当前问题路径>，登录成功后回原问题页，反对落 is-active/aria-pressed。
//
// 断言（浏览器级，1440×900 与 390×844 各跑一遍）：
//   a) 干净上下文 /question/6 点 .answer__vote--down →
//      /login?next=%2Fquestion%2F6，main 文本含「登录后即可继续」；
//   b) 在该登录页用 register() 账号登录 → 回 /question/6，
//      点反对 → 按钮 aria-pressed=true 或 class 含 is-active；
//   c) 1440 与 390 无横向溢出、window.__errs 为空；
//   d) register() 造号由 lib.mjs 退出钩子统一清理（API 会话口径）。
//
// Env: E2E_BASE / E2E_API。退出码即结论（逐项 PASS/FAIL 明细行）。

const API_ENV = (process.env.API_BASE || process.env.E2E_API || "").replace(/\/+$/, "");
const BASE = (
  process.env.E2E_BASE ||
  API_ENV.replace(/\/api$/, "") ||
  "http://127.0.0.1:3030/zhihucopy"
).replace(/\/+$/, "");
process.env.E2E_BASE ||= BASE;

const { launch, register } = await import("../e2e/lib.mjs");

const HINT = "登录后即可继续";
const QPATH = "/question/6";

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} vote-down-login ${name}${detail ? ` — ${detail}` : ""}`);
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

const doLogin = async (page, email, password) => {
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill(password);
  await page.locator(".authform button[type=submit]").click();
};

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
];

async function main() {
  const acct = await register("e2e-vote-down");

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

      // a) 未登录点「反对」→ /login?next=%2Fquestion%2F6 + 说明文案。
      await page.goto(`${BASE}${QPATH}`, { waitUntil: "domcontentloaded" });
      const downBtn = page
        .locator(".answers .answerlist > li")
        .first()
        .locator("button.answer__vote--down");
      await downBtn.waitFor({ state: "visible" });
      await downBtn.click();
      const landedLogin = await page
        .waitForURL(/\/login\?.*next=%2Fquestion%2F6/, { timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      const mainText =
        (await page.locator("main").textContent().catch(() => "")) || "";
      check(
        `${vp.name}-down-redirect`,
        landedLogin && mainText.includes(HINT),
        `url=${page.url()} hint=${mainText.includes(HINT)}`
      );

      // b) 登录 → 回原问题页 → 点反对 → is-active / aria-pressed。
      if (landedLogin) {
        await doLogin(page, acct.email, acct.password);
        const backToQ = await page
          .waitForURL(/\/question\/6/, { timeout: 15000 })
          .then(() => true)
          .catch(() => false);
        check(`${vp.name}-login-return`, backToQ, `url=${page.url()}`);
        // 同一账号在上一视口可能已投过反对：选第一个未激活的反对键，避免点成取消；
        // 断言按「激活键数量 +1」判，绕开元素句柄在列表重渲染后失效的问题。
        const activeSel =
          ".answers .answerlist button.answer__vote--down.is-active, .answers .answerlist button.answer__vote--down[aria-pressed=true]";
        const n0 = await page.locator(activeSel).count();
        const btn2 = page
          .locator(".answers .answerlist button.answer__vote--down:not(.is-active)")
          .first();
        await btn2.waitFor({ state: "visible" });
        await btn2.click();
        const active = await page
          .waitForFunction(
            ([sel, n]) => document.querySelectorAll(sel).length > n,
            [activeSel, n0],
            { timeout: 8000 }
          )
          .then(() => true)
          .catch(() => false);
        check(`${vp.name}-down-active`, active, `activeBefore=${n0} after=${await page.locator(activeSel).count()}`);
      }

      // c) 溢出 + __errs。
      const sw = await scrollWidth(page);
      check(`${vp.name}-no-hscroll`, sw <= vp.width, `scrollWidth=${sw} > ${vp.width}`);
      const errs = await pageErrs(page);
      check(`${vp.name}-errs-empty`, errs.length === 0, errs.slice(0, 3).join(" | "));
      await ctx.close();
    }

    // d) 陈旧会话（页面残留 user 态但 token 已失效）：点「反对」同样
    //    走登录回跳而不是只弹 toast。仅桌面视口。
    {
      const ctx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        locale: "zh-CN",
      });
      const page = await ctx.newPage();
      shotPage = page;
      page.setDefaultTimeout(15000);
      await injectErrs(page);
      await page.addInitScript(
        ([k, t]) => localStorage.setItem(k, t),
        ["zhihu_token", acct.token]
      );
      await page.goto(`${BASE}${QPATH}`, { waitUntil: "domcontentloaded" });
      // 等 user 解析完成（顶栏出现用户菜单），再撤掉 token 模拟会话失效。
      await page.locator(".usermenu__trigger").waitFor({ state: "visible" });
      await page.evaluate((k) => localStorage.removeItem(k), "zhihu_token");
      const btn = page
        .locator(".answers .answerlist > li")
        .first()
        .locator("button.answer__vote--down");
      await btn.waitFor({ state: "visible" });
      await btn.click();
      const landed = await page
        .waitForURL(/\/login\?.*next=%2Fquestion%2F6/, { timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      check("1440-stale-session-down-redirect", landed, `url=${page.url()}`);
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
        await shotPage.screenshot({ path: path.join(dir, `assert-vote-down-login-${ts}.png`), fullPage: true });
      }
    } catch {}
    await browser.close().catch(() => {});
  }
  const fails = results.filter((r) => !r.ok).length;
  console.log(`[ASSERT] vote-down-login ${fails ? "FAIL" : "PASS"} — ${results.length - fails}/${results.length} checks — ${BASE}`);
  process.exit(fails ? 1 : 0);
}

main();
