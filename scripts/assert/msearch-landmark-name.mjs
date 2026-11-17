// Z1072 — 移动搜索弹层 `role=search` 界标匿名（浏览器级断言）。
//
// 契约：
//   移动端 390×844 打开搜索弹层后，页面上所有 role="search" 界标
//   （顶栏 .topnav__search 与弹层 .msearch__form）都必须有非空可访问名
//   （aria-label 或 aria-labelledby 解析结果），且两两不同；
//   弹层界标名须与「全站搜索」「在结果中搜索」区分（期望「移动端搜索」）。
//   桌面 1440 下首页与搜索结果页的 search 界标命名不回归 Z1061。
//
// 反向自检：未修改的基线上 .msearch__form 无 aria-label → 断言 (b) FAIL。
//
// 通用守卫：console error == 0、无横向溢出、main 文本长度 > 0（防白屏假绿）。
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

// 收集页面全部 role=search 界标的可访问名：优先 aria-label；
// 否则解析 aria-labelledby 引用文本；再否则返回空串（视为无名）。
async function collectLandmarks(page) {
  return page.evaluate(() => {
    const name = (el) => {
      const label = el.getAttribute("aria-label");
      if (label && label.trim()) return label.trim();
      const ids = (el.getAttribute("aria-labelledby") || "").trim();
      if (ids) {
        const text = ids
          .split(/\s+/)
          .map((id) => document.getElementById(id))
          .filter(Boolean)
          .map((n) => n.textContent || "")
          .join(" ")
          .trim();
        if (text) return text;
      }
      return "";
    };
    return Array.from(document.querySelectorAll('[role="search"]')).map((el) => ({
      cls: String(el.className),
      name: name(el),
    }));
  });
}

function assertNamedUnique(landmarks, min, tag) {
  for (const l of landmarks) {
    console.log(`[${tag}][landmark] class="${l.cls}" name="${l.name}"`);
  }
  expect(
    landmarks.length >= min,
    `${tag}: role=search 界标数=${landmarks.length}，期望 ≥${min}`
  );
  for (const l of landmarks) {
    expect(
      l.name.length > 0,
      `${tag}: 界标 "${l.cls}" 缺少可访问名（无 aria-label / aria-labelledby）`
    );
  }
  const names = landmarks.map((l) => l.name);
  expect(
    new Set(names).size === names.length,
    `${tag}: 界标名重复：${JSON.stringify(names)}`
  );
  return names;
}

run("msearch-landmark-name", async ({ page }) => {
  await injectErrs(page);
  page.setDefaultTimeout(15000);

  // ---------- 移动端 390×844 ----------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.locator("header").waitFor();

  const swHome = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
  );
  expect(swHome <= 390, `首页横向溢出：scrollWidth=${swHome} > 390`);

  const mainLen = await page.evaluate(
    () => (document.querySelector("main")?.innerText || "").length
  );
  expect(mainLen > 0, `首页 main 为空（innerText=${mainLen}），疑似白屏`);

  // 点搜索入口展开弹层
  const entry = page
    .locator(
      'header a[href*="search"], header button[aria-label="打开搜索"], header button[aria-label="搜索"]'
    )
    .first();
  await entry.click();
  await page.locator(".msearch__form").waitFor({ state: "visible" });

  const mobile = await collectLandmarks(page);
  const mobileNames = assertNamedUnique(mobile, 2, "mobile");

  // a) 弹层界标有名且语义区分
  const sheet = mobile.find((l) => l.cls.includes("msearch__form"));
  expect(sheet, "未找到 .msearch__form 的 role=search 界标");
  expect(
    !sheet.name.includes("全站搜索") && !sheet.name.includes("在结果中搜索"),
    `弹层界标名「${sheet.name}」未与顶栏/结果页界标区分`
  );

  // b) 顶栏界标名含「全站搜索」
  const topnavM = mobile.find((l) => l.cls.includes("topnav__search"));
  expect(topnavM, "移动端未找到 .topnav__search 的 role=search 界标");
  expect(
    topnavM.name.includes("全站搜索"),
    `移动端顶栏界标名「${topnavM.name}」不含「全站搜索」`
  );

  // ---------- 桌面 1440：首页（不回归 Z1061） ----------
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.locator(".topnav__search").waitFor();
  const desktopHome = await collectLandmarks(page);
  assertNamedUnique(desktopHome, 1, "desktop-home");
  expect(
    desktopHome.some((l) => l.cls.includes("topnav__search") && l.name.includes("全站搜索")),
    "桌面首页顶栏界标缺失或不含「全站搜索」"
  );

  // ---------- 桌面 1440：搜索结果页 ----------
  await page.goto(`${BASE}/search?q=${encodeURIComponent("代码")}`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator(".topnav__search").waitFor();
  await page.locator(".msearchbar").waitFor();
  await page.locator(".search-head__total").waitFor();
  const desktopSearch = await collectLandmarks(page);
  assertNamedUnique(desktopSearch, 2, "desktop-search");

  const errs = await page.evaluate(() => window.__errs || []);
  expect(errs.length === 0, `页面出现错误：${errs.join(" | ")}`);
});
