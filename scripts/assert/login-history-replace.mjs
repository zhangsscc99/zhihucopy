#!/usr/bin/env node
// Z1093 — 登录/注册成功跳转为 replace：后退不得再回到 .authform。
// 覆盖：a) next=/question/6；b) 无 next 回 /；c) 已登录直访 /login 重定向；
//       d) UI 注册成功后后退无注册表单；全程 window.__errs 为空。
import { run, newPage, expect, BASE, uniq } from "../e2e/lib.mjs";

const SEED_EMAIL = "user2@zhihucopy.dev";
const SEED_PASS = "zhihu123456";

async function watchErrs(page) {
  await page.addInitScript(() => {
    window.__errs = [];
    window.addEventListener("error", (e) => window.__errs.push(String(e.message || e)));
    window.addEventListener("unhandledrejection", (e) => window.__errs.push(String(e.reason)));
    const ce = console.error.bind(console);
    console.error = (...a) => {
      window.__errs.push(a.map(String).join(" "));
      ce(...a);
    };
  });
}

async function expectNoAuthForm(page, tag) {
  const state = await page.evaluate(() => ({
    forms: document.querySelectorAll(".authform").length,
    email: document.querySelectorAll('input[type="email"]').length,
    password: document.querySelectorAll('input[type="password"]').length,
    hasLoginTitle: document.body.innerText.includes("登录知乎（仿）"),
    url: location.href,
  }));
  expect(state.forms === 0, `${tag}: 后退后仍见 .authform（url=${state.url}）`);
  expect(state.email === 0 && state.password === 0, `${tag}: 后退后仍见邮箱/密码输入框（url=${state.url}）`);
  expect(!state.hasLoginTitle, `${tag}: 后退后正文仍含「登录知乎（仿）」（url=${state.url}）`);
}

async function expectErrsEmpty(page, tag) {
  const errs = await page.evaluate(() => window.__errs || []);
  expect(errs.length === 0, `${tag}: window.__errs 非空 -> ${JSON.stringify(errs).slice(0, 300)}`);
}

run("login-history-replace", async ({ browser }) => {
  // ---- 1+2: next=/question/6，登录后后退不见登录表单 ----
  {
    const page = await newPage(browser);
    await watchErrs(page);
    await page.goto(`${BASE}/login?next=%2Fquestion%2F6`);
    await page.getByLabel("邮箱").fill(SEED_EMAIL);
    await page.getByLabel("密码").fill(SEED_PASS);
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL(/\/question\/6(\?|#|$)/, { timeout: 15000 });
    await page.waitForFunction(() => document.body.innerText.length > 200, null, { timeout: 15000 });
    await page.goBack();
    await page.waitForTimeout(500);
    await expectNoAuthForm(page, "next=/question/6");
    await expectErrsEmpty(page, "next=/question/6");
    await page.context().close();
  }

  // ---- 3: 无 next，登录回 /，后退不见登录表单 ----
  {
    const page = await newPage(browser);
    await watchErrs(page);
    await page.goto(`${BASE}/login`);
    await page.getByLabel("邮箱").fill(SEED_EMAIL);
    await page.getByLabel("密码").fill(SEED_PASS);
    await page.getByRole("button", { name: "登录" }).click();
    const esc = BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    await page.waitForURL(new RegExp(`^${esc}/?([?#].*)?$`), { timeout: 15000 });
    await page.goBack();
    await page.waitForTimeout(500);
    await expectNoAuthForm(page, "无 next");
    await expectErrsEmpty(page, "无 next");
    // ---- 4: 已登录直访 /login 被重定向走 ----
    await page.goto(`${BASE}/login`);
    await page.waitForFunction(
      (base) => !location.pathname.endsWith("/login") || !document.querySelector(".authform"),
      BASE,
      { timeout: 15000 }
    );
    await expectNoAuthForm(page, "已登录直访 /login");
    expect(
      !(await page.evaluate(() => location.pathname.endsWith("/login") && !!document.querySelector(".authform"))),
      "已登录直访 /login 仍停留在登录表单"
    );
    await expectErrsEmpty(page, "已登录直访 /login");
    await page.context().close();
  }

  // ---- 5: UI 注册成功后后退不见注册表单 ----
  {
    const page = await newPage(browser);
    await watchErrs(page);
    const nickname = uniq("e2e");
    const email = `${uniq("e2e")}@test.dev`;
    await page.goto(`${BASE}/register`);
    await page.getByLabel("昵称").fill(nickname);
    await page.getByLabel("邮箱").fill(email);
    await page.getByLabel("密码").fill("e2e-pass-123456");
    await page.getByRole("button", { name: "注册" }).click();
    const esc = BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    await page.waitForURL(new RegExp(`^${esc}/?([?#].*)?$`), { timeout: 15000 });
    await page.goBack();
    await page.waitForTimeout(500);
    await expectNoAuthForm(page, "注册后退");
    await expectErrsEmpty(page, "注册后退");
    await page.context().close();
  }
});
