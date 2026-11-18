// notify-rail-hidden.mjs — Z1211 通知/搜索/个人主页在 ≤767px 下不渲染右栏「热榜」。
//
//   浏览器级（import { run, register } from ../e2e/lib.mjs）：
//     移动 390×844，登录态（注册新号、localStorage 预置 token），连跑 2 遍：
//       a) /notifications 上 aside.rail 不存在或 offsetWidth === 0；
//       b) 页面内 /question/* 链接数 === 0（[data-notify-item] 内通知行链接除外）；
//       c) document.body.scrollWidth === 390（无横向溢出）；
//       d) window.__errs 为空；
//       e) /search 与 /u/<uid>（个人主页）同样 rail 不可见。
//     桌面 1440×900 登录态 /notifications：
//       f) aside.rail 存在且 offsetWidth > 0（桌面右栏不回归）。
//     两遍结果一致（同实例复用 browser，逐遍新建 context）。
//
// Env: API_BASE（缺省 3030）、E2E_BASE（缺省 API_BASE 去掉 /api）。
//      可用 `--baseline <url>` 或 E2E_BASE 指向未修基线做反向自检：
//        node scripts/assert/notify-rail-hidden.mjs --baseline https://openfolio.uk/zhihucopy
//      未修基线 390 下 .rail 可见（offsetWidth>0、含 ~15 条 /question/* 链接），断言 a/b 必 FAIL。

import { expect } from "./lib.mjs";

const argv = process.argv.slice(2);
const bi = argv.indexOf("--baseline");
if (bi !== -1 && argv[bi + 1]) process.env.E2E_BASE = argv[bi + 1];

const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
const BASE = (process.env.E2E_BASE || API_BASE.replace(/\/api$/, "")).replace(/\/+$/, "");
process.env.E2E_BASE ||= BASE;
const { run, register, TOKEN_KEY } = await import("../e2e/lib.mjs");

const ERR_HOOK = ([k, t]) => {
  try {
    localStorage.setItem(k, t);
  } catch {}
  window.__errs = [];
  const push = (m) => {
    try {
      window.__errs.push(String(m && m.message ? m.message : m));
    } catch {}
  };
  window.addEventListener("error", (e) => push(e.message || e.error));
  window.addEventListener("unhandledrejection", (e) => push(e.reason));
  const orig = console.error.bind(console);
  console.error = (...a) => {
    push(a.map((x) => String(x)).join(" "));
    orig(...a);
  };
};

async function newAuthedPage(browser, token, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: "zh-CN" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  await page.addInitScript(ERR_HOOK, [TOKEN_KEY, token]);
  return page;
}

async function checkErrs(page, tag) {
  const errs = await page.evaluate(() => window.__errs || []);
  expect(errs.length === 0, `${tag} window.__errs ${errs.length} 条: ${errs.slice(0, 3).join(" | ")}`);
}

async function checkRailHidden(page, path, tag, { checkQLinks = true } = {}) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  // /search 无 q 参数会重定向回首页（首页右栏保留属正常），必须等 SPA 落定。
  const want = path.split("?")[0];
  await page.waitForFunction((w) => location.pathname.endsWith(w), want, { timeout: 10000 });
  const m = await page.evaluate(() => {
    const rail = document.querySelector("aside.rail");
    // 通知行（[data-notify-item]）内的问题链接属正常落点，统计时排除。
    const qLinks = [...document.querySelectorAll('a[href*="/question/"]')].filter(
      (a) => !a.closest("[data-notify-item]")
    );
    return {
      railPresent: !!rail,
      railWidth: rail ? rail.offsetWidth : 0,
      railDisplay: rail ? getComputedStyle(rail).display : "(absent)",
      qLinkCount: qLinks.length,
      qLinkSample: qLinks.slice(0, 3).map((a) => a.getAttribute("href")),
      bodyScrollW: document.body.scrollWidth,
      innerW: window.innerWidth,
    };
  });
  expect(
    !m.railPresent || m.railWidth === 0,
    `${tag} aside.rail 仍可见 width=${m.railWidth} display=${m.railDisplay}（需不存在或 offsetWidth===0）`
  );
  if (checkQLinks) {
    expect(
      m.qLinkCount === 0,
      `${tag} 页面混入 ${m.qLinkCount} 条 /question/* 链接（通知行外应≤0）: ${m.qLinkSample.join(", ")}`
    );
  }
  expect(
    m.bodyScrollW === 390,
    `${tag} body.scrollWidth=${m.bodyScrollW}（需 ===390；未修基线 rail 挤出溢出）`
  );
  await checkErrs(page, tag);
  console.log(
    `  ${tag}: rail=${m.railDisplay}/${m.railWidth}px 非通知 /question 链接=${m.qLinkCount} scrollW=${m.bodyScrollW}`
  );
  return m;
}

async function checkNotifyMobile(browser, token, passNo, uid) {
  const page = await newAuthedPage(browser, token, 390, 844);
  try {
    const tag = `pass${passNo} 390 /notifications`;
    const r = await checkRailHidden(page, "/notifications", tag);
    // /search 与 /u/<uid> 只断言 rail 隐藏：结果列表/用户提问本身可能带 /question/* 链接。
    await checkRailHidden(page, "/search?q=GIL", `pass${passNo} 390 /search`, {
      checkQLinks: false,
    });
    await checkRailHidden(page, `/u/${uid}`, `pass${passNo} 390 /u/${uid}`, {
      checkQLinks: false,
    });
    return r;
  } finally {
    await page.context().close();
  }
}

async function checkNotifyDesktop(browser, token) {
  const page = await newAuthedPage(browser, token, 1440, 900);
  try {
    await page.goto(`${BASE}/notifications`, { waitUntil: "networkidle" });
    const m = await page.evaluate(() => {
      const rail = document.querySelector("aside.rail");
      return rail
        ? { width: rail.offsetWidth, display: getComputedStyle(rail).display }
        : null;
    });
    expect(m, "desktop1440 /notifications 找不到 aside.rail（桌面右栏不得隐藏）");
    expect(
      m.width > 0 && m.display !== "none",
      `desktop1440 /notifications .rail width=${m.width} display=${m.display}（桌面端需可见）`
    );
    await checkErrs(page, "desktop1440 /notifications");
    console.log(`  desktop1440 /notifications: rail display=${m.display} width=${m.width}px`);
  } finally {
    await page.context().close();
  }
}

run("notify-rail-hidden", async ({ browser }) => {
  const { token, user } = await register();
  const first = await checkNotifyMobile(browser, token, 1, user.id);
  const second = await checkNotifyMobile(browser, token, 2, user.id);
  expect(
    JSON.stringify(first) === JSON.stringify(second),
    `两遍结果不一致: ${JSON.stringify(first)} vs ${JSON.stringify(second)}`
  );
  await checkNotifyDesktop(browser, token);
});
