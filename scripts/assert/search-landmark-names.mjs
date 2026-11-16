// Z1061 — 结果页双 role=search 界标命名歧义（浏览器级断言）。
//
// 契约：
//   搜索结果页同时存在两个 role="search" 界标（顶栏 .topnav__search 与
//   结果页内 .msearchbar），每个界标必须有非空可访问名，且全部名字
//   互不相同；顶栏界标名须含「全站搜索」。
//
// 反向自检：未修改的基线上顶栏 form 无 aria-label → 断言 (b) FAIL。
//
// 通用守卫：body.innerText>200（防白屏假绿）、window.__errs 为空。
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

run("search-landmark-names", async ({ page }) => {
  await injectErrs(page);
  await page.goto(`${BASE}/search?q=${encodeURIComponent("代码")}`);
  await page.locator(".topnav__search").waitFor();
  await page.locator(".msearchbar").waitFor();
  // 等结果区渲染完再量 innerText（否则只含顶栏+表单文本，误判白屏）。
  await page.locator(".search-head__total").waitFor();

  // ---- 通用守卫：页面非白屏 ----
  const bodyLen = await page.evaluate(() => document.body.innerText.length);
  expect(bodyLen > 200, `页面内容过少：innerText=${bodyLen}`);

  // 收集全部 role=search 界标的可访问名：优先 aria-label；
  // 否则解析 aria-labelledby 引用文本；再否则退回可见文本（视为无名）。
  const landmarks = await page.evaluate(() => {
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
      cls: el.className,
      name: name(el),
    }));
  });

  for (const l of landmarks) {
    console.log(`[landmark] class="${l.cls}" name="${l.name}"`);
  }

  // a) 至少 2 个 role=search 界标
  expect(
    landmarks.length >= 2,
    `role=search 界标数=${landmarks.length}，期望 ≥2`
  );

  // b) 每个界标都有非空可访问名
  for (const l of landmarks) {
    expect(
      l.name.length > 0,
      `界标 "${l.cls}" 缺少可访问名（无 aria-label / aria-labelledby）`
    );
  }

  // c) 全部名字互不相同
  const names = landmarks.map((l) => l.name);
  const uniqNames = new Set(names);
  expect(
    uniqNames.size === names.length,
    `界标名重复：${JSON.stringify(names)}`
  );

  // d) 顶栏界标名含「全站搜索」
  const topnav = landmarks.find((l) => String(l.cls).includes("topnav__search"));
  expect(topnav, "未找到 .topnav__search 的 role=search 界标");
  expect(
    topnav.name.includes("全站搜索"),
    `顶栏界标名「${topnav.name}」不含「全站搜索」`
  );

  const errs = await page.evaluate(() => window.__errs || []);
  expect(errs.length === 0, `页面出现错误：${errs.join(" | ")}`);
});
