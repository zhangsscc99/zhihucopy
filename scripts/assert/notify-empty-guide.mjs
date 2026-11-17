// Z1138 — 新账号 /notifications 空态：文案去重 + 双出口 + 引导句（浏览器级）。
//
// 契约：
//   1) 新注册账号进 /notifications：main 不含「暂时没有新通知」，
//      含「暂时没有新消息」；
//   2) main 内可点击出口 ≥2，至少一个 href 指向 /topics、一个指向站点根；
//   3) 1440×900 与 390×844 各跑：documentElement 无横向溢出，
//      两出口按钮 getBoundingClientRect() 不相交；
//   4) window.__errs 为空（error/unhandledrejection/console.error 计数器）；
//   5) 造一条真实通知（账号A POST /questions，账号B POST /answers）→
//      刷新后列表 ≥1 行且不再显示空态文案（证明只改了空态分支）。
//
// 环境：verify.sh 透传 API_BASE；e2e/lib.mjs 的 BASE/API 在模块加载时定型，
// 故先按 API_BASE 反推 E2E_BASE/E2E_API 再动态 import。
const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
if (!process.env.E2E_API) process.env.E2E_API = API_BASE;
if (!process.env.E2E_BASE) process.env.E2E_BASE = API_BASE.replace(/\/api$/, "");

const { run, expect, BASE, register, authedPage, apiOk, uniq } = await import("../e2e/lib.mjs");

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

const pageErrs = (page) => page.evaluate(() => window.__errs || []);

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];

// 两个矩形是否相交（允许共边，不算重叠）。
const rectsIntersect = (a, b) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

run("notify-empty-guide", async ({ browser, page }) => {
  // ---- 空态：新注册账号 ---------------------------------------------------
  const fresh = await register(uniq("empty"));
  const apage = await authedPage(browser, fresh.token);
  await injectErrs(apage);
  await apage.goto(`${BASE}/notifications`, { waitUntil: "domcontentloaded" });
  await apage.waitForSelector("main .empty", { timeout: 15000 });

  const mainText = await apage.locator("main").innerText();
  expect(!/暂时没有新通知/.test(mainText), "empty-copy-dup: main 仍含「暂时没有新通知」");
  expect(/暂时没有新消息/.test(mainText), "empty-copy-new: main 缺少「暂时没有新消息」");

  // main 内可点击出口（a/button）统计与 href 分布
  const exits = apage.locator("main .empty__actions a, main .empty__actions button");
  const exitCount = await exits.count();
  expect(exitCount >= 2, `empty-exits-count: 出口仅 ${exitCount} 个`);
  const hrefs = [];
  for (let i = 0; i < exitCount; i++) hrefs.push(await exits.nth(i).getAttribute("href"));
  const rootPath = new URL(BASE).pathname.replace(/\/+$/, "") || "/"; // 站点根路径（如 /zhihucopy）
  expect(
    hrefs.some((h) => h && h.replace(/\/+$/, "").endsWith("/topics")),
    `empty-exit-topics: 无指向 /topics 的出口（hrefs=${hrefs.join(",")})`
  );
  expect(
    hrefs.some((h) => h && (h.replace(/\/+$/, "") || "/") === rootPath),
    `empty-exit-root: 无指向站点根的出口（hrefs=${hrefs.join(",")})`
  );
  expect(/关注作者后.*关注流/.test(mainText), "empty-guide-line: 缺少关注流引导句");

  // ---- 双视口：横向溢出 + 出口不重叠 + __errs ----------------------------
  for (const vp of VIEWPORTS) {
    await apage.setViewportSize(vp);
    await apage.waitForTimeout(150);
    const overflow = await apage.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow === 0, `empty-overflow-${vp.width}: 横向溢出 ${overflow}px`);
    const rects = await exits.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      })
    );
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(
          !rectsIntersect(rects[i], rects[j]),
          `empty-exit-overlap-${vp.width}: 出口 ${i} 与 ${j} 重叠`
        );
      }
    }
  }

  const errs = await pageErrs(apage);
  expect(errs.length === 0, `empty-page-errs: ${errs.join(" | ")}`);

  // ---- 非空分支回归：造一条真实通知后不再显示空态 -------------------------
  const answerer = await register(uniq("answerer"));
  const q = await apiOk("POST", "/questions", {
    token: fresh.token,
    body: { title: `[assert] ${uniq("q")} — 通知空态回归？`, detail_md: "assert probe" },
  });
  await apiOk("POST", `/questions/${q.question.id}/answers`, {
    token: answerer.token,
    body: { content_md: "assert 回答，用于触发通知。" },
  });
  await apage.goto(`${BASE}/notifications`, { waitUntil: "domcontentloaded" });
  await apage.waitForSelector("main .ntf li, main .ntf__item", { timeout: 15000 });
  const rows = await apage.locator("main .ntf li, main .ntf__item").count();
  expect(rows >= 1, `nonempty-rows: 通知列表仅 ${rows} 行`);
  const filledText = await apage.locator("main").innerText();
  expect(
    !/暂时没有新消息/.test(filledText) && !/暂时没有新通知/.test(filledText),
    "nonempty-still-empty: 有通知时仍显示空态文案"
  );
  const errs2 = await pageErrs(apage);
  expect(errs2.length === 0, `nonempty-page-errs: ${errs2.join(" | ")}`);
  await apage.close();
});
