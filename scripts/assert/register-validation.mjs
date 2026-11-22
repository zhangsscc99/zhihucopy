#!/usr/bin/env node
// Z1192 — 注册表单内联校验反馈（浏览器级，390×844 未登录）。
//
// 断言：
//   a) 昵称 1 字 / 邮箱 not-an-email / 密码 123 提交 →
//      .field-error 可见数 ≥2，文案含「邮箱」「密码」（至少一处含「昵称」），
//      URL 仍 /register，「注册」按钮不 disabled，window.__errs 为空；
//   b) 改正为合法数据提交 → 3s 内离开 /register，顶栏出现昵称；
//   c) 测试账号经由 lib 自带 trackSessionUsers + cleanupOwned 退出清理。
//
// Env: API_BASE 或 E2E_BASE。退出码 0=PASS / 1=FAIL，逐项打印明细。

const API_ENV = (process.env.API_BASE || "").replace(/\/+$/, "");
const BASE = (
  process.env.E2E_BASE ||
  API_ENV.replace(/\/api$/, "") ||
  "http://127.0.0.1:3030/zhihucopy"
).replace(/\/+$/, "");
process.env.E2E_BASE ||= BASE;

const { launch, trackSessionUsers } = await import("../e2e/lib.mjs");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} register-validation ${name}${detail ? ` — ${detail}` : ""}`);
};

const digits = String(Date.now()).slice(-6);
const NICK = `回归校验${digits}`;
const EMAIL = `${digits}@test.dev`;
const PASS = "zhihu123456";

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
    await page.addInitScript(() => {
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

    // a) 非法输入 → 内联错误，不发请求，留在 /register。
    await page.goto(`${BASE}/register`, { waitUntil: "domcontentloaded" });
    await page.locator("#reg-nickname").waitFor({ state: "visible" });
    await page.locator("#reg-nickname").fill("短");
    await page.locator("#reg-email").fill("not-an-email");
    await page.locator("#reg-password").fill("123");
    await page.locator(".authform button[type=submit]").click();
    await page.waitForTimeout(500);

    const errs = page.locator(".field-error:visible");
    const errCount = await errs.count();
    const errTexts = await errs.allTextContents();
    const joined = errTexts.join(" | ");
    check("field-error-count", errCount >= 2, `count=${errCount} texts=${joined}`);
    check("field-error-email", /邮箱/.test(joined), joined);
    check("field-error-password", /密码/.test(joined), joined);
    check("field-error-nickname", /昵称/.test(joined), joined);
    check(
      "stays-on-register",
      /\/register/.test(new URL(page.url()).pathname),
      `url=${page.url()}`
    );
    const btnDisabled = await page
      .locator(".authform button[type=submit]")
      .isDisabled();
    check("button-not-disabled", !btnDisabled, `disabled=${btnDisabled}`);
    const jsErrs = await page.evaluate(() => window.__errs || []);
    check("errs-empty", jsErrs.length === 0, jsErrs.slice(0, 3).join(" | "));

    // b) 合法数据 → 3s 内离开 /register，顶栏出现昵称。
    await page.locator("#reg-nickname").fill(NICK);
    await page.locator("#reg-email").fill(EMAIL);
    await page.locator("#reg-password").fill(PASS);
    await page.locator(".authform button[type=submit]").click();
    let left = false;
    try {
      await page.waitForURL((u) => !/\/register/.test(u.pathname), { timeout: 3000 });
      left = true;
    } catch {}
    check("navigates-away", left, `url=${page.url()}`);
    const navLabel =
      (await page.locator(".usermenu__trigger").getAttribute("aria-label").catch(() => "")) ||
      (await page.locator(".topnav").innerText().catch(() => ""));
    check("topnav-shows-nickname", navLabel.includes(NICK), String(navLabel).slice(0, 80));

    await trackSessionUsers(browser);
    await ctx.close();
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
        await shotPage.screenshot({ path: path.join(dir, `assert-register-validation-${ts}.png`), fullPage: true });
      }
    } catch {}
    await browser.close().catch(() => {});
  }
  const fails = results.filter((r) => !r.ok).length;
  console.log(`[ASSERT] register-validation ${fails ? "FAIL" : "PASS"} — ${results.length - fails}/${results.length} checks — ${BASE}`);
  process.exit(fails ? 1 : 0);
}

main();
