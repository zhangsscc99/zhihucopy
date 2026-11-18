#!/usr/bin/env node
// Z1164 — 顶栏「注册」入口丢 next：/login、/register 两页的顶栏导航链接
// 在 URL 有合法 next 时统一透传（沿用 startsWith("/") && !startsWith("//") 校验），
// 非法值不透传；走顶栏注册完成后落回 next 页。
//
// 断言（浏览器级，1440×900 与 390×844 各跑一遍）：
//   a) /login?next=%2Fquestion%2F6：顶栏「注册」与表单内「注册一个」href 均含
//      next=%2Fquestion%2F6；
//   b) /register?next=%2Fquestion%2F6：顶栏「登录」与表单内「直接登录」href 均带 next；
//   c) /login?next=https%3A%2F%2Fevil.com：顶栏登录/注册与表单注册链接均不带 next；
//   d) /login?next=%2Fquestion%2F6 点顶栏「注册」→ 填表注册成功 → 落 /question/6；
//   e) 1440/390 无横向溢出、window.__errs 为空。
//
// Env: API_BASE 或 E2E_BASE。退出码即结论（逐项 PASS/FAIL 明细行）。

const API_ENV = (process.env.API_BASE || "").replace(/\/+$/, "");
const BASE = (
  process.env.E2E_BASE ||
  API_ENV.replace(/\/api$/, "") ||
  "http://127.0.0.1:3030/zhihucopy"
).replace(/\/+$/, "");
process.env.E2E_BASE ||= BASE;

const { launch, uniq } = await import("../e2e/lib.mjs");

const NEXT = "%2Fquestion%2F6";
const NEXT_ENC = `next=${NEXT}`;

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} register-nav-next ${name}${detail ? ` — ${detail}` : ""}`);
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

const navRegister = (page) => page.locator(".topnav__actions a.btn--outline");
const navLogin = (page) => page.locator(".topnav__actions a.btn--ghost");
const formLink = (page) => page.locator(".authcard__alt a");

const hrefOf = async (loc) => (await loc.getAttribute("href")) || "";

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

      // a) /login?next=/question/6 → 顶栏 + 表单注册链接均透传。
      await page.goto(`${BASE}/login?${NEXT_ENC}`, {
        waitUntil: "domcontentloaded",
      });
      await page.locator("#login-email").waitFor({ state: "visible" });
      const navRegHref = await hrefOf(navRegister(page));
      const formRegHref = await hrefOf(formLink(page));
      check(
        `${vp.name}-login-nav-register-next`,
        navRegHref.includes(NEXT_ENC),
        `href=${navRegHref}`
      );
      check(
        `${vp.name}-login-form-register-next`,
        formRegHref.includes(NEXT_ENC),
        `href=${formRegHref}`
      );

      // b) /register?next=/question/6 → 顶栏 + 表单登录链接均透传。
      await page.goto(`${BASE}/register?${NEXT_ENC}`, {
        waitUntil: "domcontentloaded",
      });
      await page.locator("#reg-nickname").waitFor({ state: "visible" });
      const navLoginHref = await hrefOf(navLogin(page));
      const formLoginHref = await hrefOf(formLink(page));
      check(
        `${vp.name}-register-nav-login-next`,
        navLoginHref.includes(NEXT_ENC),
        `href=${navLoginHref}`
      );
      check(
        `${vp.name}-register-form-login-next`,
        formLoginHref.includes(NEXT_ENC),
        `href=${formLoginHref}`
      );

      // c) 外站 next → 顶栏登录/注册与表单注册链接均不透传。
      await page.goto(`${BASE}/login?next=https%3A%2F%2Fevil.com`, {
        waitUntil: "domcontentloaded",
      });
      await page.locator("#login-email").waitFor({ state: "visible" });
      const evilNavLogin = await hrefOf(navLogin(page));
      const evilNavReg = await hrefOf(navRegister(page));
      const evilFormReg = await hrefOf(formLink(page));
      check(
        `${vp.name}-evil-next-no-leak`,
        ![evilNavLogin, evilNavReg, evilFormReg].some((h) => h.includes("next=")),
        `navLogin=${evilNavLogin} navReg=${evilNavReg} formReg=${evilFormReg}`
      );

      // d) 顶栏注册 → 注册成功落回 /question/6。
      const nick = uniq("e2e-navreg");
      await page.goto(`${BASE}/login?${NEXT_ENC}`, {
        waitUntil: "domcontentloaded",
      });
      await page.locator("#login-email").waitFor({ state: "visible" });
      await navRegister(page).click();
      await page.waitForURL(/\/register\?.*next=%2Fquestion%2F6/, { timeout: 15000 });
      await page.locator("#reg-nickname").fill(nick);
      await page.locator("#reg-email").fill(`${nick}@test.dev`);
      await page.locator("#reg-password").fill("e2e-pass-123456");
      await page.locator(".authform button[type=submit]").click();
      await page.waitForURL(/\/question\/6/, { timeout: 15000 });
      await page
        .locator("main h1")
        .first()
        .waitFor({ state: "visible", timeout: 15000 })
        .catch(() => {});
      const landedOk = /\/question\/6/.test(new URL(page.url()).pathname);
      check(`${vp.name}-nav-register-lands-next`, landedOk, `url=${page.url()}`);
      await page.evaluate(() => localStorage.clear());

      // e) 溢出 + __errs。
      await page.goto(`${BASE}/login?${NEXT_ENC}`, {
        waitUntil: "domcontentloaded",
      });
      await page.locator("#login-email").waitFor({ state: "visible" });
      const sw = await scrollWidth(page);
      check(`${vp.name}-no-hscroll`, sw <= vp.width, `scrollWidth=${sw} > ${vp.width}`);
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
        await shotPage.screenshot({ path: path.join(dir, `assert-register-nav-next-${ts}.png`), fullPage: true });
      }
    } catch {}
    await browser.close().catch(() => {});
  }
  const fails = results.filter((r) => !r.ok).length;
  console.log(`[ASSERT] register-nav-next ${fails ? "FAIL" : "PASS"} — ${results.length - fails}/${results.length} checks — ${BASE}`);
  process.exit(fails ? 1 : 0);
}

main();
