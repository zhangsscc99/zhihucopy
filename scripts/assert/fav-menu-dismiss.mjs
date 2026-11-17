// Z1134 — 回答卡「收藏」弹层退出路径（P2）：Esc / 外部点击关闭 + 焦点管理。
//
// 账号：API 现注册测试账号（跑完由 lib.mjs 自清理），先以「无收藏夹（空态）」
// 跑全量断言，再 API 建一个收藏夹后以「已有收藏夹」态复跑 —— 两种状态下都须
// 稳定，不依赖种子账号当前收藏数据。
//
// 断言（两个视口 390x844 / 1440x900 x 两种收藏夹状态各跑一遍）：
//  1) 打开 .answer__fav-menu 后按 Escape → 弹层数量 0；
//  2) 重开 → 在 main 空白坐标点一下（elementFromPoint 不命中任何 .answer 卡）
//     → 数量 0，且焦点不被拉回触发按钮（外部关层不抢焦点）；
//  3) 重开 → 点弹层顶部 padding 区 {x:8,y:3}（<6px，不命中任何条目）→
//     数量仍 1，且 aria-pressed/按钮文案不变（未发生收藏/取消收藏）；
//  4) 打开时 document.activeElement 落在 .answer__fav-menu 内且为
//     input/button（含兜底：加载态聚焦容器自身也算在层内）；
//  5) Esc 后 document.activeElement 是触发按钮（.answer__fav 内的
//     .answer__action）；
//  6) 弹层打开态 documentElement.scrollWidth - clientWidth === 0；
//     关层后再测一次；window.__errs 为空；body.innerText.length > 200。
//
// 登录：register() 拿 token 写 localStorage.zhihu_token（不在 UI 填口令）。
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
  // 等收藏夹列表接口回带（加载态没有可聚焦元素）。
  await page.locator(".answer__fav-input").waitFor({ state: "visible" });
  return { btn, menu };
}

const menuCount = (page) => page.locator(".answer__fav-menu").count();

// 触发按钮收藏状态快照：aria-pressed + 文案（收藏/已收藏）。
const triggerState = (btn) =>
  btn.evaluate(
    (el) => `${el.getAttribute("aria-pressed")}|${(el.textContent || "").trim()}`
  );

const focusOnTrigger = (page) =>
  page.evaluate(() => {
    const ae = document.activeElement;
    return !!(
      ae &&
      ae.classList.contains("answer__action") &&
      ae.closest(".answer__fav")
    );
  });

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

async function checkViewport(browser, url, token, vp, phase) {
  const tag = `${vp.name}/${phase}`;
  const context = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    locale: "zh-CN",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await inject(page, token);
  await page.goto(url);
  await page.waitForSelector(".answer__fav > .answer__action");

  // ④ 打开即聚焦弹层内（input/button，或兜底容器自身）。
  const { btn } = await openMenu(page);
  const inMenu = await page.evaluate(() => {
    const ae = document.activeElement;
    const menu = document.querySelector(".answer__fav-menu");
    return !!(menu && ae && menu.contains(ae));
  });
  expect(inMenu, `[${tag}] 打开弹层后 activeElement 未进入 .answer__fav-menu`);

  // ⑥a 弹层打开态横向溢出 + 页面错误（重点 390x844，两视口都测）。
  const openOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(openOverflow === 0, `[${tag}] 弹层打开态横向溢出 ${openOverflow}px`);
  const openErrs = await page.evaluate(() => window.__errs || []);
  expect(openErrs.length === 0, `[${tag}] 打开态 __errs: ${openErrs.slice(0, 3).join(" | ")}`);

  // ① Esc 关闭。
  await page.keyboard.press("Escape");
  expect((await menuCount(page)) === 0, `[${tag}] Esc 后弹层仍存在`);

  // ⑤ Esc 后焦点回到触发按钮。
  expect(await focusOnTrigger(page), `[${tag}] Esc 后焦点未回到触发按钮`);

  // ② 外部点击关闭，且不抢焦点（焦点不被拉回触发按钮）。
  await openMenu(page);
  const pt = await blankPointInMain(page);
  await page.mouse.click(pt.x, pt.y);
  expect((await menuCount(page)) === 0, `[${tag}] 外部点击后弹层仍存在`);
  expect(
    !(await focusOnTrigger(page)),
    `[${tag}] 外部点击关层后焦点被拉回触发按钮`
  );

  // ③ 点弹层顶部 padding 区（y=3 < 6px padding，不命中任何 .answer__fav-item）：
  //    弹层不关 + 收藏状态不变。
  await openMenu(page);
  const before = await triggerState(btn);
  await page.locator(".answer__fav-menu").click({ position: { x: 8, y: 3 } });
  expect((await menuCount(page)) === 1, `[${tag}] 弹层内边距点击被误关`);
  expect(
    (await triggerState(btn)) === before,
    `[${tag}] 弹层内边距点击改动了收藏状态（${before} -> ${await triggerState(btn)}）`
  );
  await page.keyboard.press("Escape");
  expect((await menuCount(page)) === 0, `[${tag}] 清理用 Esc 未关掉弹层`);

  // ⑥b 关层后无横向溢出、无页面错误、正文非空。
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow === 0, `[${tag}] 横向溢出 ${overflow}px`);
  const errs = await page.evaluate(() => window.__errs || []);
  expect(errs.length === 0, `[${tag}] __errs: ${errs.slice(0, 3).join(" | ")}`);
  const textLen = await page.evaluate(() => document.body.innerText.length);
  expect(textLen > 200, `[${tag}] body.innerText=${textLen} <= 200`);

  await context.close();
}

const VIEWPORTS = [
  { name: "390x844", w: 390, h: 844 },
  { name: "1440x900", w: 1440, h: 900 },
];

run("fav-menu-dismiss", async ({ browser }) => {
  // 新注册测试账号：天然「无收藏夹」空态；产物由 lib.mjs 退出清理。
  const { token } = await register("e2e-favmenu");
  const url = await questionUrl();
  for (const vp of VIEWPORTS) await checkViewport(browser, url, token, vp, "empty");

  // 同账号造一个收藏夹后复跑「已有收藏夹」态（③ 覆盖有条目时的 padding 点击）。
  await apiOk("POST", "/collections", {
    token,
    body: { name: "e2e 收藏夹", is_public: false },
  });
  for (const vp of VIEWPORTS) await checkViewport(browser, url, token, vp, "has-col");
});
