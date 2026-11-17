// Z1134 — 回答卡「收藏」弹层退出路径（P2）：Esc / 外部点击关闭 + 焦点管理。
//
// 断言（两个视口 390x844 / 1440x900 各跑一遍）：
//  1) 打开 .answer__fav-menu 后按 Escape → 弹层数量 0；
//  2) 重开 → 在 main 空白坐标点一下（elementFromPoint 不命中任何 .answer 卡）
//     → 数量 0；
//  3) 重开 → 在弹层内部点一下 → 数量仍为 1（不误关）；
//  4) 打开时 document.activeElement 落在 .answer__fav-menu 内且为 input/button；
//  5) Esc 后 document.activeElement 是触发按钮（.answer__fav 内的
//     .answer__action）；
//  6) documentElement.scrollWidth - clientWidth === 0；window.__errs 为空；
//     body.innerText.length > 200。
//
// 登录：API 换 token 写 localStorage.zhihu_token（不在 UI 填口令）。
// Env: API_BASE / E2E_BASE / CHROME。退出码 0 PASS / 1 FAIL。

const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
const BASE = (process.env.E2E_BASE || API_BASE.replace(/\/api$/, "")).replace(/\/+$/, "");
// e2e/lib.mjs 顶层按 env 求值 BASE/API，须在动态 import 前赋值。
process.env.E2E_BASE ||= BASE;
process.env.API_BASE ||= API_BASE;
const { run, expect, apiOk, TOKEN_KEY } = await import("../e2e/lib.mjs");

const SEED = { email: "user2@zhihucopy.dev", password: "zhihu123456" };

async function loginToken() {
  const r = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(SEED),
  });
  const d = await r.json().catch(() => ({}));
  expect(r.status === 200 && d.token, `seed 登录失败 status=${r.status}`);
  return d.token;
}

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
  page.locator(".answer__fav > .answer__action", { hasText: /^收藏$/ }).first();

async function openMenu(page) {
  const btn = favBtn(page);
  await btn.click();
  const menu = page.locator(".answer__fav-menu");
  await menu.waitFor({ state: "visible" });
  // 等收藏夹列表接口回带（加载态没有可聚焦元素）。
  await page.locator(".answer__fav-input").waitFor({ state: "visible" });
  return { btn, menu };
}

const menuCount = (page) => page.locator(".answer__fav-menu").count();

async function blankPointInMain(page) {
  const pt = await page.evaluate(() => {
    const m = document.querySelector("main");
    if (!m) return null;
    const r = m.getBoundingClientRect();
    for (let y = r.top + 6; y < r.bottom - 6; y += 12) {
      for (const x of [r.left + 6, r.right - 6]) {
        const el = document.elementFromPoint(x, y);
        if (el && (el === m || !el.closest(".answer"))) return { x, y };
      }
    }
    return null;
  });
  expect(pt, "main 内找不到不命中回答卡的空白坐标");
  return pt;
}

async function checkViewport(browser, url, token, vp) {
  const context = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    locale: "zh-CN",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await inject(page, token);
  await page.goto(url);
  await page.waitForSelector(".answer__fav > .answer__action");

  // ④ 打开即聚焦弹层内 input/button。
  await openMenu(page);
  const inMenu = await page.evaluate(() => {
    const ae = document.activeElement;
    const menu = document.querySelector(".answer__fav-menu");
    return !!(
      menu &&
      ae &&
      menu.contains(ae) &&
      (ae.tagName === "INPUT" || ae.tagName === "BUTTON")
    );
  });
  expect(inMenu, `[${vp.name}] 打开弹层后 activeElement 未进入 .answer__fav-menu`);

  // ① Esc 关闭。
  await page.keyboard.press("Escape");
  expect((await menuCount(page)) === 0, `[${vp.name}] Esc 后弹层仍存在`);

  // ⑤ Esc 后焦点回到触发按钮。
  const backOnTrigger = await page.evaluate(() => {
    const ae = document.activeElement;
    return !!(
      ae &&
      ae.classList.contains("answer__action") &&
      ae.closest(".answer__fav")
    );
  });
  expect(backOnTrigger, `[${vp.name}] Esc 后焦点未回到触发按钮`);

  // ② 外部点击关闭。
  await openMenu(page);
  const pt = await blankPointInMain(page);
  await page.mouse.click(pt.x, pt.y);
  expect((await menuCount(page)) === 0, `[${vp.name}] 外部点击后弹层仍存在`);

  // ③ 弹层内部点击不误关。
  await openMenu(page);
  const empty = page.locator(".answer__fav-menu .answer__fav-empty");
  if (await empty.count()) {
    await empty.first().click();
  } else {
    await page.locator(".answer__fav-menu").click({ position: { x: 8, y: 8 } });
  }
  expect((await menuCount(page)) === 1, `[${vp.name}] 弹层内部点击被误关`);
  await page.keyboard.press("Escape");
  expect((await menuCount(page)) === 0, `[${vp.name}] 清理用 Esc 未关掉弹层`);

  // ⑥ 无横向溢出、无页面错误、正文非空。
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow === 0, `[${vp.name}] 横向溢出 ${overflow}px`);
  const errs = await page.evaluate(() => window.__errs || []);
  expect(errs.length === 0, `[${vp.name}] __errs: ${errs.slice(0, 3).join(" | ")}`);
  const textLen = await page.evaluate(() => document.body.innerText.length);
  expect(textLen > 200, `[${vp.name}] body.innerText=${textLen} <= 200`);

  await context.close();
}

run("fav-menu-dismiss", async ({ browser }) => {
  const token = await loginToken();
  const url = await questionUrl();
  for (const vp of [
    { name: "390x844", w: 390, h: 844 },
    { name: "1440x900", w: 1440, h: 900 },
  ]) {
    await checkViewport(browser, url, token, vp);
  }
});
