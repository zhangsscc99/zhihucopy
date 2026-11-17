// Z1135 — 首次收藏一键「收藏到默认收藏夹」（P3，留存）。
//
// 账号：API 现注册测试账号（跑完由 lib.mjs 自清理），天然「无收藏夹」空态。
//
// 断言：
//  ① 空收藏夹态打开 .answer__fav-menu → 层内出现「收藏到默认收藏夹」主按钮
//     （enabled 可点、打开态焦点在层内）；打开态弹层 rect.right <= innerWidth
//     且 documentElement 无横向溢出 —— 390x844 与 1440x900 各跑一次；
//  ② 点击后 1.5s 内：toast 文本含「默认收藏夹」、触发按钮变「已收藏」；
//  ③ GET /api/collections 恰有 1 个名为「默认收藏夹」的收藏夹；取消收藏后
//     再点一次一键收藏，仍只有 1 个同名收藏夹（服务端幂等复用）；
//  ④ 刷新页面后按钮仍是「已收藏」；
//  ⑤ 关层重开：此时已有收藏夹 → 「收藏到默认收藏夹」按钮不再出现，
//     列表中可见「默认收藏夹」条目；
//  ⑥ window.__errs 为空（注入 error/unhandledrejection/console.error 计数器）；
//  ⑦ 390 下弹层打开态无横向溢出（合并在 ① 的 390 趟里量）。
//
// Env: API_BASE / E2E_BASE / CHROME。退出码 0 PASS / 1 FAIL。

const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
const BASE = (process.env.E2E_BASE || API_BASE.replace(/\/api$/, "")).replace(/\/+$/, "");
// e2e/lib.mjs 顶层按 env 求值 BASE/API，须在动态 import 前赋值。
process.env.E2E_BASE ||= BASE;
process.env.API_BASE ||= API_BASE;
const { run, expect, apiOk, register, TOKEN_KEY } = await import("../e2e/lib.mjs");

async function questionUrl() {
  const list = await apiOk("GET", "/questions?tab=hot&limit=50");
  const q = (list.items || []).find((it) => it.answer_count > 0);
  expect(q, "没有找到带回答的种子问题");
  return `${BASE}/question/${q.id}`;
}

function inject(page, token) {
  return page.addInitScript(
    ([k, t]) => {
      localStorage.setItem(k, t);
      const w = window;
      w.__errs = [];
      w.addEventListener("error", (e) => w.__errs.push(`error:${e.message}`));
      w.addEventListener("unhandledrejection", (e) =>
        w.__errs.push(`unhandledrejection:${e.reason && e.reason.message ? e.reason.message : e.reason}`)
      );
      const ce = console.error.bind(console);
      console.error = (...a) => {
        w.__errs.push(`console.error:${a.map(String).join(" ")}`);
        ce(...a);
      };
    },
    [TOKEN_KEY, token]
  );
}

const favBtn = (page) =>
  page.locator(".answer__fav > .answer__action", { hasText: /^(收藏|已收藏)$/ }).first();

async function openMenu(page) {
  const btn = favBtn(page);
  await btn.click();
  const menu = page.locator(".answer__fav-menu");
  await menu.waitFor({ state: "visible" });
  // 等收藏夹列表接口回带（空态按钮/输入框都在列表到达后渲染）。
  await page.locator(".answer__fav-input").waitFor({ state: "visible" });
  return { btn, menu };
}

const defaultBtn = (page) =>
  page.locator(".answer__fav-menu button", { hasText: "收藏到默认收藏夹" });

const menuCount = (page) => page.locator(".answer__fav-menu").count();

const defaultCollectionCount = async (token) => {
  const d = await apiOk("GET", "/collections", { token });
  return (d.collections || []).filter((c) => c.name === "默认收藏夹").length;
};

// ①/⑦：弹层打开态 —— 一键按钮在、可点、焦点在层内、无横向溢出、弹层不出右边界。
async function checkOpenState(browser, url, token, vp) {
  const tag = vp.name;
  const context = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    locale: "zh-CN",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await inject(page, token);
  await page.goto(url);
  await page.waitForSelector(".answer__fav > .answer__action");
  await openMenu(page);

  const dbtn = defaultBtn(page);
  await dbtn.waitFor({ state: "visible" });
  expect(await dbtn.isEnabled(), `[${tag}] 「收藏到默认收藏夹」按钮不可点`);

  const inMenu = await page.evaluate(() => {
    const ae = document.activeElement;
    const menu = document.querySelector(".answer__fav-menu");
    return !!(menu && ae && menu.contains(ae));
  });
  expect(inMenu, `[${tag}] 打开弹层后 activeElement 未进入 .answer__fav-menu`);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow === 0, `[${tag}] 弹层打开态横向溢出 ${overflow}px`);

  const overRight = await page.evaluate(() => {
    const m = document.querySelector(".answer__fav-menu");
    if (!m) return Infinity;
    return m.getBoundingClientRect().right - window.innerWidth;
  });
  expect(overRight <= 0, `[${tag}] 弹层右缘超出视口 ${overRight}px`);

  const errs = await page.evaluate(() => window.__errs || []);
  expect(errs.length === 0, `[${tag}] 打开态 __errs: ${errs.slice(0, 3).join(" | ")}`);

  await context.close();
}

run("fav-default-collection", async ({ browser }) => {
  const { token } = await register("e2e-favdef");
  const url = await questionUrl();

  // ①/⑦：两个视口的打开态几何 + 一键按钮存在性（此趟不点，保持空收藏夹态）。
  await checkOpenState(browser, url, token, { name: "390x844", w: 390, h: 844 });
  await checkOpenState(browser, url, token, { name: "1440x900", w: 1440, h: 900 });

  // ---- ②~⑥：1440 下完整闭环 ----
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await inject(page, token);
  await page.goto(url);
  await page.waitForSelector(".answer__fav > .answer__action");

  const { btn } = await openMenu(page);
  const dbtn = defaultBtn(page);
  await dbtn.waitFor({ state: "visible" });
  await dbtn.click();

  // ② 1.5s 内 toast 含「默认收藏夹」+ 按钮变「已收藏」。
  await page.locator(".toast", { hasText: "默认收藏夹" }).waitFor({ timeout: 1500 });
  await page
    .locator(".answer__fav > .answer__action", { hasText: "已收藏" })
    .first()
    .waitFor({ timeout: 1500 });

  // ③a 恰 1 个「默认收藏夹」。
  expect(
    (await defaultCollectionCount(token)) === 1,
    `「默认收藏夹」数量 != 1（实际 ${await defaultCollectionCount(token)}）`
  );

  // ③b 取消收藏 → 重开弹层点「默认收藏夹」条目再收藏 → 仍只有 1 个同名收藏夹；
  //     再直接 API 重发 POST /collections {name:"默认收藏夹"} → 服务端幂等复用。
  await btn.click(); // 「已收藏」再点 = 取消收藏
  await page
    .locator(".answer__fav > .answer__action", { hasText: /^收藏$/ })
    .first()
    .waitFor({ state: "visible" });
  await openMenu(page);
  const item = page.locator(".answer__fav-item", { hasText: "默认收藏夹" });
  await item.waitFor({ state: "visible" });
  await item.click();
  await page.locator(".toast", { hasText: "默认收藏夹" }).waitFor({ timeout: 1500 });
  await apiOk("POST", "/collections", {
    token,
    body: { name: "默认收藏夹", is_public: false },
  });
  expect(
    (await defaultCollectionCount(token)) === 1,
    `重复收藏后「默认收藏夹」数量 != 1（实际 ${await defaultCollectionCount(token)}）`
  );

  // ④ 刷新后仍是「已收藏」。
  await page.reload();
  await page.waitForSelector(".answer__fav > .answer__action");
  const collected = page
    .locator(".answer__fav > .answer__action", { hasText: "已收藏" })
    .first();
  await collected.waitFor({ state: "visible" });

  // ⑤ 已有收藏夹态重开弹层：一键按钮不出现，列表含「默认收藏夹」条目。
  await collected.click(); // 「已收藏」= 取消，恢复可收藏态
  await page
    .locator(".answer__fav > .answer__action", { hasText: /^收藏$/ })
    .first()
    .waitFor({ state: "visible" });
  await openMenu(page);
  expect(
    (await defaultBtn(page).count()) === 0,
    "已有收藏夹时仍出现「收藏到默认收藏夹」按钮"
  );
  expect(
    (await page.locator(".answer__fav-item", { hasText: "默认收藏夹" }).count()) === 1,
    "已有收藏夹态列表中没有「默认收藏夹」条目"
  );
  await page.keyboard.press("Escape");
  expect((await menuCount(page)) === 0, "清理用 Esc 未关掉弹层");

  // ⑥ 全程无页面错误。
  const errs = await page.evaluate(() => window.__errs || []);
  expect(errs.length === 0, `__errs: ${errs.slice(0, 3).join(" | ")}`);

  await context.close();
});
