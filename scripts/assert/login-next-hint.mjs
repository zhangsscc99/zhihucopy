#!/usr/bin/env node
// Z1143 — 未登录动作零解释：登录页在「有效站内 next」时表单上方显示
// 「登录后即可继续刚才的操作」；无 next / 外站 next / next=/login 不显示。
//
// 断言（浏览器级，1440×900 与 390×844 各跑一遍）：
//   a) 干净上下文 /question/6 点「赞同」→ /login?next=%2Fquestion%2F6，
//      main 文本含「登录后即可继续刚才的操作」；
//   b) /login（无 next）→ 该文案 0 处；
//   c) /login?next=https%3A%2F%2Fevil.com → 0 处，且登录成功后不跳外站；
//   d) /login?next=%2Flogin → 0 处；
//   e) 有 next 时正常登录 → 回跳该 next 路径且页面有内容（≥1 .feed__item 或 h1）；
//   f) 无横向溢出、window.__errs 为空。
//
// Env: API_BASE 或 E2E_BASE。退出码即结论（逐项 PASS/FAIL 明细行）。

const API_ENV = (process.env.API_BASE || "").replace(/\/+$/, "");
const BASE = (
  process.env.E2E_BASE ||
  API_ENV.replace(/\/api$/, "") ||
  "http://127.0.0.1:3030/zhihucopy"
).replace(/\/+$/, "");
process.env.E2E_BASE ||= BASE;

const { launch, register } = await import("../e2e/lib.mjs");

const HINT = "登录后即可继续刚才的操作";
const QPATH = "/question/6";
const basePath = new URL(BASE).pathname.replace(/\/+$/, "");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} login-next-hint ${name}${detail ? ` — ${detail}` : ""}`);
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

const hintCount = async (page) => {
  const text = (await page.locator("main").textContent().catch(() => "")) || "";
  return text.split(HINT).length - 1;
};

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
  const acct = await register("e2e-next-hint");

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

      // a) 干净上下文点「赞同」→ 落 /login?next=%2Fquestion%2F6 且有说明。
      await page.goto(`${BASE}${QPATH}`, { waitUntil: "domcontentloaded" });
      const upBtn = page
        .locator(".answers .answerlist > li")
        .first()
        .locator("button.answer__vote--up");
      await upBtn.waitFor({ state: "visible" });
      await upBtn.click();
      await page.waitForURL(/\/login\?.*next=%2Fquestion%2F6/, { timeout: 15000 });
      const hintN = await hintCount(page);
      check(
        `${vp.name}-vote-redirect-hint`,
        hintN >= 1,
        `url=${page.url()} hintCount=${hintN}`
      );

      // b) 无 next → 0 处。
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      await page.locator("#login-email").waitFor({ state: "visible" });
      const n0 = await hintCount(page);
      check(`${vp.name}-no-next-no-hint`, n0 === 0, `hintCount=${n0}`);

      // c) 外站 next → 0 处；登录后不跳外站。
      await page.goto(`${BASE}/login?next=https%3A%2F%2Fevil.com`, {
        waitUntil: "domcontentloaded",
      });
      await page.locator("#login-email").waitFor({ state: "visible" });
      const nEvil = await hintCount(page);
      check(`${vp.name}-evil-next-no-hint`, nEvil === 0, `hintCount=${nEvil}`);
      await doLogin(page, acct.email, acct.password);
      const esc = BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      await page.waitForURL(new RegExp(`^${esc}/?([?#].*)?$`), { timeout: 15000 });
      const landed = new URL(page.url());
      check(
        `${vp.name}-evil-next-stays-internal`,
        landed.pathname === basePath || landed.pathname === `${basePath}/`,
        `landed=${page.url()}`
      );
      // 清掉登录态，继续未登录用例。
      await page.evaluate(() => localStorage.clear());
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      await page.locator("#login-email").waitFor({ state: "visible" });

      // d) next=/login → 0 处。
      await page.goto(`${BASE}/login?next=%2Flogin`, { waitUntil: "domcontentloaded" });
      await page.locator("#login-email").waitFor({ state: "visible" });
      const nSelf = await hintCount(page);
      check(`${vp.name}-self-next-no-hint`, nSelf === 0, `hintCount=${nSelf}`);

      // e) 有 next 正常登录 → 回跳 /question/6 且页面有内容。
      await page.goto(`${BASE}/login?next=%2Fquestion%2F6`, {
        waitUntil: "domcontentloaded",
      });
      await page.locator("#login-email").waitFor({ state: "visible" });
      await doLogin(page, acct.email, acct.password);
      await page.waitForURL(/\/question\/6/, { timeout: 15000 });
      await page
        .locator("main h1, li.feed__item")
        .first()
        .waitFor({ state: "visible", timeout: 15000 })
        .catch(() => {});
      const contentN = await page.evaluate(
        () =>
          document.querySelectorAll("li.feed__item").length +
          document.querySelectorAll("main h1").length
      );
      check(
        `${vp.name}-next-login-return`,
        contentN >= 1,
        `url=${page.url()} content=${contentN}`
      );
      await page.evaluate(() => localStorage.clear());

      // f) 溢出 + __errs。
      await page.goto(`${BASE}/login?next=%2Fquestion%2F6`, {
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
        await shotPage.screenshot({ path: path.join(dir, `assert-login-next-hint-${ts}.png`), fullPage: true });
      }
    } catch {}
    await browser.close().catch(() => {});
  }
  const fails = results.filter((r) => !r.ok).length;
  console.log(`[ASSERT] login-next-hint ${fails ? "FAIL" : "PASS"} — ${results.length - fails}/${results.length} checks — ${BASE}`);
  process.exit(fails ? 1 : 0);
}

main();
