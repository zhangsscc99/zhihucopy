#!/usr/bin/env node
// Z1094 — 登录后浏览器「后退/回到页面」，顶栏不得停在未登录态。
// 覆盖两条陈旧路径（同一 React 树复用时 user 必须按当前 token 重新推导）：
//   A) 真实链路：/question/6(未登录文档 D1) → /login?next=/question/6(新文档 D2)
//      登录 → replace 回 /question/6 → goBack() 落回 D1（bfcache 复活的冻结树）
//      → 顶栏 1 秒内必须是已登录态；刷新后不变。
//   B) 同文档 popstate：未登录文档内注入有效 token（等价于他标签页登录/bfcache
//      冻结期间的会话变化）→ pushState + goBack 触发 popstate → 顶栏按新 token
//      重渲染；反向：删掉 token 后 popstate → 立即回到未登录态（不保留旧值）。
//   C) 注入无效 token 重载 → 顶栏回到未登录态、无 console error、不半登录。
// 每个视口（1440 / 390）各跑一遍：window.__errs 为空、无横向溢出、
// body.innerText.length > 200。
import { run, expect, BASE, api, TOKEN_KEY } from "../e2e/lib.mjs";

const EMAIL = "user2@zhihucopy.dev";
const PASS = "zhihu123456";
const NICK = "林间有风";
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];

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

// 顶栏三态快照：已登录 = .usermenu__trigger（aria-label=昵称）；未登录 = 登录/注册链接。
async function headerState(page) {
  return page.evaluate(() => {
    const nav = document.querySelector(".topnav");
    const trigger = nav?.querySelector(".usermenu__trigger");
    return {
      usermenu: !!trigger,
      label: trigger?.getAttribute("aria-label") || "",
      loginLink: !!nav?.querySelector('a[href$="/login"]'),
      registerLink: !!nav?.querySelector('a[href$="/register"]'),
      url: location.href,
    };
  });
}

async function expectLoggedIn(page, tag) {
  const h = await headerState(page);
  expect(h.usermenu, `${tag}: 顶栏未见 .usermenu__trigger（url=${h.url}）`);
  expect(
    h.label === NICK || h.label.length > 0,
    `${tag}: 用户菜单 aria-label 异常「${h.label}」`
  );
  expect(!h.loginLink && !h.registerLink, `${tag}: 顶栏仍含「登录/注册」链接（url=${h.url}）`);
}

async function expectLoggedOut(page, tag) {
  const h = await headerState(page);
  expect(!h.usermenu, `${tag}: 顶栏仍是已登录态 .usermenu__trigger（url=${h.url}）`);
  expect(h.loginLink, `${tag}: 未登录态缺「登录」链接（url=${h.url}）`);
}

async function expectClean(page, tag) {
  const errs = await page.evaluate(() => window.__errs || []);
  expect(errs.length === 0, `${tag}: window.__errs 非空 -> ${JSON.stringify(errs).slice(0, 300)}`);
  const pageInfo = await page.evaluate(() => ({
    textLen: document.body.innerText.length,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(pageInfo.overflow <= 1, `${tag}: 横向溢出 ${pageInfo.overflow}px`);
  expect(pageInfo.textLen > 200, `${tag}: body.innerText=${pageInfo.textLen} <= 200`);
}

async function newViewedPage(browser, vp) {
  const ctx = await browser.newContext({ viewport: vp, locale: "zh-CN" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  await watchErrs(page);
  return page;
}

// A) UI 登录 → /question/6 → goBack → 顶栏必须是已登录态
async function scenarioBackAfterLogin(browser, vp) {
  const page = await newViewedPage(browser, vp);
  const tag = `A@v${vp.width}`;
  // 先落一个「未登录文档」进历史栈（真实链路里它被 bfcache 冻结、登录在另一文档完成）。
  await page.goto(`${BASE}/question/6`);
  await page.waitForSelector('.topnav a[href$="/login"]');
  await page.goto(`${BASE}/login?next=%2Fquestion%2F6`);
  await page.getByLabel("邮箱").fill(EMAIL);
  await page.getByLabel("密码").fill(PASS);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL(/\/question\/6(\?|#|$)/);
  await page.waitForSelector(".usermenu__trigger");
  await page.goBack();
  await page.waitForSelector(".usermenu__trigger", { timeout: 3000 });
  await expectLoggedIn(page, `${tag} 后退后`);
  await expectClean(page, `${tag} 后退后`);
  // 刷新后状态不变。
  await page.reload();
  await page.waitForSelector(".usermenu__trigger");
  await expectLoggedIn(page, `${tag} 刷新后`);
  await expectClean(page, `${tag} 刷新后`);
  await page.context().close();
}

// B) 同文档 popstate：注入有效 token（他页登录）→ 后退 → 顶栏翻成已登录；
//    反向删 token → 后退 → 立即清成未登录。
async function scenarioPopstateResync(browser, vp) {
  const page = await newViewedPage(browser, vp);
  const tag = `B@v${vp.width}`;
  await page.goto(`${BASE}/question/6`);
  await page.waitForSelector('.topnav a[href$="/login"]');
  // 文档已落定未登录态（React user=null），此刻注入有效 token —— 与 bfcache
  // 冻结期间他页登录等价：本树未重跑 auth 校验。
  const r = await api("POST", "/auth/login", { body: { email: EMAIL, password: PASS } });
  expect(r.status === 200, `api login -> ${r.status}`);
  await page.evaluate(
    ([k, t]) => localStorage.setItem(k, t),
    [TOKEN_KEY, r.data.token]
  );
  await page.evaluate(() => history.pushState({}, "", `${location.pathname}?z1094=a`));
  await page.goBack();
  await page.waitForSelector(".usermenu__trigger", { timeout: 3000 });
  await expectLoggedIn(page, `${tag} 注入 token 后退`);
  await expectClean(page, `${tag} 注入 token 后退`);
  // 刷新后状态不变。
  await page.reload();
  await page.waitForSelector(".usermenu__trigger");
  await expectLoggedIn(page, `${tag} 刷新后`);
  // 反向：token 被清（他页登出）→ 后退 → 不得保留旧 user。
  await page.evaluate((k) => localStorage.removeItem(k), TOKEN_KEY);
  await page.evaluate(() => history.pushState({}, "", `${location.pathname}?z1094=b`));
  await page.goBack();
  await page.waitForSelector('.topnav a[href$="/login"]', { timeout: 3000 });
  await expectLoggedOut(page, `${tag} 删 token 后退`);
  await expectClean(page, `${tag} 删 token 后退`);
  await page.context().close();
}

// C) 无效 token 重载 → 顶栏回到未登录态、不卡半登录、无 console error。
async function scenarioBadToken(browser, vp) {
  const page = await newViewedPage(browser, vp);
  const tag = `C@v${vp.width}`;
  await page.goto(`${BASE}/question/6`);
  await page.evaluate((k) => localStorage.setItem(k, "z1094.invalid.token"), TOKEN_KEY);
  await page.reload();
  await page.waitForSelector('.topnav a[href$="/login"]', { timeout: 15000 });
  await expectLoggedOut(page, `${tag} 无效 token 重载`);
  await expectClean(page, `${tag} 无效 token 重载`);
  await page.context().close();
}

run("back-auth-state", async ({ browser }) => {
  for (const vp of VIEWPORTS) {
    await scenarioBackAfterLogin(browser, vp);
    await scenarioPopstateResync(browser, vp);
    await scenarioBadToken(browser, vp);
  }
});
