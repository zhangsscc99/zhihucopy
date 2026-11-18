// Z1201 — 站内路由切换不复位滚动（390×844）。
//
// 断言口径（FEATURES.md Z1201）：
//   · /question/<id>（默认 54，缺 author 链接时回退到列表首个有作者链接的问题）
//     滚到 scrollY≈2000 后点击首个 a[href*='/u/'] → 导航完成 window.scrollY === 0，
//     且落地页昵称元素（.profile__name）getBoundingClientRect().top >= 0；
//   · page.goBack() → window.scrollY > 1000（浏览器返回保留原滚动位置）;
//   · 由问题页分别站内跳 /topics、/notifications、/search?q=react，落地 scrollY === 0；
//   · window.__errs 为空；逐项 PASS/FAIL 明细行，退出码即结论。
//
// 基线（改动前构建，client/dist 不含滚动策略，PORT=3181 + /tmp/zh1201.db）实测：
//   [route-scroll-reset] question page = /question/54
//   FAIL route-scroll-reset profile-scrollY===0 — scrollY=199（跳转前 2000）
//   FAIL route-scroll-reset profile-nickname-in-viewport — top=-119
//   FAIL route-scroll-reset goback-scrollY>1000 — scrollY=199
//   FAIL route-scroll-reset topics-scrollY===0 — scrollY=2000
//   FAIL route-scroll-reset notifications-scrollY===0 — scrollY=235
//   FAIL route-scroll-reset search-scrollY===0 — scrollY=833
//   PASS route-scroll-reset errs-empty
//   [route-scroll-reset] 1/7 checks passed  RC=1
//
// Env: E2E_BASE（默认 http://127.0.0.1:3030/zhihucopy）。退出码即结论。

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:3030/zhihucopy").replace(/\/+$/, "");
process.env.E2E_BASE ||= BASE;

const { launch, apiOk } = await import("../e2e/lib.mjs");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} route-scroll-reset ${name}${detail ? ` — ${detail}` : ""}`);
};

const injectErrs = (page) =>
  page.addInitScript(() => {
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

const scrollY = (page) => page.evaluate(() => window.scrollY);

// 选一个确实渲染出作者链接的问题页：优先 54，否则热榜里逐个点名。
async function pickQuestionPath(page) {
  const candidate = async (id) => {
    await page.goto(`${BASE}/question/${id}`, { waitUntil: "domcontentloaded" });
    return page
      .waitForSelector("a[href*='/u/']", { state: "visible", timeout: 6000 })
      .then(() => true)
      .catch(() => false);
  };
  if (await candidate(54)) return "/question/54";
  const list = await apiOk("GET", "/questions?tab=hot&limit=50");
  for (const it of list.items || []) {
    if (it.author && (await candidate(it.id))) return `/question/${it.id}`;
  }
  throw new Error("no question page exposes an author link");
}

// 站内（SPA）导航到目标路径：优先点击匹配的真实锚点，找不到时返回 false。
async function spaNav(page, hrefRe, urlRe) {
  const ok = await page.evaluate((reSrc) => {
    const re = new RegExp(reSrc);
    const a = [...document.querySelectorAll("a[href]")].find((x) =>
      re.test(x.getAttribute("href") || "")
    );
    if (!a) return false;
    a.click();
    return true;
  }, hrefRe.source);
  if (!ok) return false;
  await page.waitForURL(urlRe, { timeout: 10000 });
  return true;
}

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
    await injectErrs(page);

    const qpath = await pickQuestionPath(page);
    console.log(`[route-scroll-reset] question page = ${qpath}`);

    // ---- 滚到 ≈2000 → 点首个作者链接 → /u/:id -------------------------------
    await page.evaluate(() => window.scrollTo(0, 2000));
    await page.waitForFunction(() => window.scrollY > 1500);
    const before = await scrollY(page);

    // DOM click 而非 page.click()：后者会先把链接 scroll-into-view（一次真实滚动），
    // 离开时记录的滚动位置就不再是 2000，goBack 断言失去意义。
    await Promise.all([
      page.waitForURL(/\/u\/\d+/, { timeout: 10000 }),
      page.evaluate(() => document.querySelector("a[href*='/u/']").click()),
    ]);
    await page.waitForSelector(".profile__name", { state: "visible" });
    // 等一帧让滚动策略落地。
    await page.waitForTimeout(120);

    const landed = await scrollY(page);
    check("profile-scrollY===0", landed === 0, `scrollY=${landed}（跳转前 ${before}）`);

    const nickTop = await page.evaluate(() => {
      const el = document.querySelector(".profile__name");
      return el ? el.getBoundingClientRect().top : null;
    });
    check(
      "profile-nickname-in-viewport",
      nickTop !== null && nickTop >= 0,
      `top=${nickTop}`
    );

    // ---- goBack：返回问题页应恢复滚动位置 ----------------------------------
    await page.goBack({ waitUntil: "domcontentloaded" });
    await page.waitForURL(new RegExp(qpath.replace(/\//g, "\\/")));
    const restored = await page
      .waitForFunction(() => window.scrollY > 1000, null, { timeout: 8000 })
      .then(() => scrollY(page))
      .catch(() => scrollY(page));
    check("goback-scrollY>1000", restored > 1000, `scrollY=${restored}`);

    // ---- /topics、/notifications、/search?q=react 站内跳 → scrollY === 0 ----
    const targets = [
      { name: "topics", href: /^\/zhihucopy\/topics$|^\/topics$/, url: /\/topics$/ },
      { name: "notifications", href: /^\/zhihucopy\/notifications$|^\/notifications$/, url: /\/notifications$/ },
    ];
    for (const t of targets) {
      if ((await scrollY(page)) < 1500) {
        await page.evaluate(() => window.scrollTo(0, 2000));
        await page.waitForFunction(() => window.scrollY > 1500).catch(() => {});
      }
      const ok = await spaNav(page, t.href, t.url);
      if (!ok) {
        check(`${t.name}-scrollY===0`, false, "no in-app anchor found for SPA nav");
        continue;
      }
      await page.waitForTimeout(120);
      const y = await scrollY(page);
      check(`${t.name}-scrollY===0`, y === 0, `scrollY=${y}`);
      // 回问题页，准备下一轮
      await page.goto(`${BASE}${qpath}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("a[href*='/u/']", { state: "visible" }).catch(() => {});
    }

    // /search?q=react：移动搜索浮层提交 = navigate() SPA 跳转。
    {
      if ((await scrollY(page)) < 1500) {
        await page.evaluate(() => window.scrollTo(0, 2000));
        await page.waitForFunction(() => window.scrollY > 1500).catch(() => {});
      }
      await page.locator(".topnav__search-btn").click();
      const input = page.locator(".msearch__input");
      await input.waitFor({ state: "visible" });
      await input.fill("react");
      await Promise.all([
        page.waitForURL(/\/search\?q=react/, { timeout: 10000 }),
        page.locator(".msearch__form").evaluate((f) => f.requestSubmit()),
      ]);
      await page.waitForTimeout(120);
      const y = await scrollY(page);
      check("search-scrollY===0", y === 0, `scrollY=${y}`);
    }

    const errs = await page.evaluate(() => window.__errs || []);
    check("errs-empty", errs.length === 0, errs.slice(0, 3).join(" | "));

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
        await shotPage.screenshot({
          path: path.join(dir, `assert-route-scroll-reset-${ts}.png`),
          fullPage: true,
        });
      }
    } catch {}
    await browser.close().catch(() => {});
  }
  const fails = results.filter((r) => !r.ok).length;
  console.log(`[route-scroll-reset] ${results.length - fails}/${results.length} checks passed`);
  process.exit(fails ? 1 : 0);
}

await main();
