// Z1274 — 手机详情页顶栏「返回」入口（浏览器级断言）。
//
// 契约：
//   /question/*、/u/*、/topic/* 在 <=767px 视口顶栏左侧渲染 [aria-label="返回"]
//   按钮：触控区 >=44x44，与 Logo（.brand）矩形不相交；点击后回到来源页并
//   恢复来源页滚动位置（误差 <=8px）；无 history 时回首页。
//
// 反向自检：基线详情页顶栏无返回按钮 → [aria-label="返回"] 不存在 → FAIL。
//
// 通用守卫：body.innerText>200（防白屏假绿）、window.__errs 为空、
//   390 视口下 documentElement.scrollWidth === 390（无横向溢出）。
//
// 环境：verify.sh 透传 API_BASE；e2e/lib.mjs 的 BASE/API 在模块加载时定型，
// 故先按 API_BASE 反推 E2E_BASE/E2E_API 再动态 import。
const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
if (!process.env.E2E_API) process.env.E2E_API = API_BASE;
if (!process.env.E2E_BASE) process.env.E2E_BASE = API_BASE.replace(/\/api$/, "");

const { run, expect, BASE } = await import("../e2e/lib.mjs");

async function injectErrs(page) {
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
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 取 [aria-label="返回"] 与 Logo（.brand）的矩形；返回 null 表示按钮不存在。
function rectInfo() {
  const btn = document.querySelector('[aria-label="返回"]');
  if (!btn) return null;
  const logo = document.querySelector(".brand");
  const b = btn.getBoundingClientRect();
  const l = logo ? logo.getBoundingClientRect() : null;
  const intersect =
    l && l.width > 0 && !(b.right <= l.left || l.right <= b.left || b.bottom <= l.top || l.bottom <= b.top);
  const style = getComputedStyle(btn);
  const ask = document.querySelector(".topnav__ask");
  const ar = ask ? ask.getBoundingClientRect() : null;
  return {
    w: b.width,
    h: b.height,
    display: style.display,
    intersect: !!intersect,
    hasLogo: !!logo,
    logoHidden: !logo || logo.offsetParent === null || (l && l.width === 0),
    askVisible: !!(ask && ar && ar.width > 0 && ar.height > 0),
  };
}

async function guards(page, { mobile }) {
  const bodyLen = await page.evaluate(() => document.body.innerText.length);
  expect(bodyLen > 200, `页面内容过少：innerText=${bodyLen}`);
  const errs = await page.evaluate(() => window.__errs || []);
  expect(errs.length === 0, `页面出现错误：${errs.join(" | ")}`);
  if (mobile) {
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(sw === 390, `横向溢出：scrollWidth=${sw}`);
  }
}

// 390 视口：详情页返回按钮存在、>=44x44、不与 Logo 相交。
async function checkBackBtn(page, path) {
  await page.goto(`${BASE}${path}`);
  await page.locator(".topnav").waitFor();
  await page.locator(".feed__item, .qdetail, .profile, main .empty, .errorbox, main").first().waitFor({ timeout: 15000 });
  await sleep(150);
  const info = await page.evaluate(rectInfo);
  console.log(`[390 ${path}] nav-back=${JSON.stringify(info)}`);
  expect(info, `[aria-label="返回"] 不存在（${path}）`);
  expect(info.display !== "none", `返回按钮未显示（${path}）display=${info.display}`);
  expect(info.w >= 44 && info.h >= 44, `触控区不足 44x44：${info.w}x${info.h}`);
  expect(info.hasLogo, "未找到 Logo（.brand）");
  expect(!info.intersect, `返回按钮与 Logo 矩形相交（${path}）`);
  expect(info.askVisible, `「提问」按钮不可见（${path}）`);
  if (path === "/question/6") {
    expect(info.logoHidden, "390 详情页 Logo（.brand）应被返回按钮替换隐藏");
  }
  await guards(page, { mobile: true });
}

// 390 视口：首页滚动到 900 → 点 feed 卡进详情 → 点返回 → 回 `/` 且 scrollY≈900。
async function checkScrollRestore(page) {
  await page.goto(`${BASE}/`);
  await page.locator(".feed__item").first().waitFor({ timeout: 15000 });
  await page.evaluate(() => window.scrollTo(0, 900));
  await sleep(150); // 等 rAF 节流把 scrollY 落进 sessionStorage/history.state
  const before = await page.evaluate(() => ({
    y: window.scrollY,
    stored: window.sessionStorage.getItem("zhScroll:/"),
  }));
  console.log(`[scroll] 首页基线 scrollY=${before.y} sessionStorage[zhScroll:/]=${before.stored}`);
  expect(Math.abs(before.y - 900) <= 8, `基线 scrollY=${before.y} 未到 900`);

  // 点「当前视口内完整可见」的第一张卡：.click() 会先 scrollIntoView，
  // 若点在视口外的卡会把刚存的 900 覆盖掉，基线就废了。
  const idx = await page.evaluate(() =>
    [...document.querySelectorAll(".feed__item")].findIndex((el) => {
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.top >= 60 && r.bottom <= window.innerHeight;
    })
  );
  expect(idx >= 0, "视口内没有完整可见的 .feed__item");
  await page.locator(".feed__item").nth(idx).click();
  await page.waitForURL(/\/question\/\d+/, { timeout: 15000 });
  await page.locator('[aria-label="返回"]').waitFor();
  console.log(`[scroll] 进入详情 ${page.url()}`);

  await page.locator('[aria-label="返回"]').click();
  const basePath = new URL(BASE).pathname.replace(/\/+$/, "") || "/";
  await page.waitForFunction(
    (p) => window.location.pathname === p || window.location.pathname === `${p}/`,
    basePath,
    { timeout: 15000 }
  );
  // 恢复是间歇 scrollTo 重试（数据回流前会被钳制），轮询到收敛。
  await page.waitForFunction(
    (y) => Math.abs(window.scrollY - y) <= 8,
    before.y,
    { timeout: 10000 }
  );
  const after = await page.evaluate(() => window.scrollY);
  console.log(`[scroll] 返回后 scrollY=${after}（期望 ≈${before.y}）`);
  expect(Math.abs(after - before.y) <= 8, `scrollY 恢复误差超限：${after} vs ${before.y}`);
  await guards(page, { mobile: true });
}

run("mobile-detail-back", async ({ browser }) => {
  // ---- 390x844：关键项连跑 2 次一致 ----
  for (let round = 1; round <= 2; round++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-CN" });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    await injectErrs(page);
    console.log(`[round ${round}] 390x844`);
    await checkBackBtn(page, "/question/6");
    await checkBackBtn(page, "/u/6800");
    if (round === 1) await checkScrollRestore(page);
    await ctx.close();
  }

  // ---- 1440x900：桌面顶栏不被破坏 ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    await injectErrs(page);
    console.log("[desktop] 1440x900 /question/6");
    await page.goto(`${BASE}/question/6`);
    await page.locator(".topnav").waitFor();
    await page.locator(".feed__item, .qdetail, main").first().waitFor({ timeout: 15000 });
    const info = await page.evaluate(rectInfo);
    const logoVisible = await page.evaluate(() => {
      const l = document.querySelector(".brand");
      if (!l) return false;
      const r = l.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    console.log(`[desktop] nav-back=${JSON.stringify(info)} logoVisible=${logoVisible}`);
    expect(logoVisible, "桌面 Logo 不可见，顶栏被破坏");
    if (info) {
      expect(info.w === 0 || info.display === "none", "桌面返回按钮应不可见");
      expect(!info.intersect, "桌面返回按钮与 Logo 相交");
      expect(info.askVisible, "桌面「提问」按钮不可见");
    } else {
      const askVisible = await page.evaluate(() => {
        const a = document.querySelector(".topnav__ask");
        const r = a && a.getBoundingClientRect();
        return !!(r && r.width > 0 && r.height > 0);
      });
      expect(askVisible, "桌面「提问」按钮不可见");
    }
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(sw <= 1440, `桌面横向溢出：scrollWidth=${sw}`);
    await guards(page, { mobile: false });
    await ctx.close();
  }
});
