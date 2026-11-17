// Z1099 — 通知入口/未读角标断言（浏览器级）。
//
// 契约：
//   1) 1440×900 与 390×844 两种视口下，顶栏各有一个指向 /notifications 的
//      入口（a.topnav__bell），aria-label 含「通知」；
//   2) 有未读时 .topnav__bell .badge 存在且数字 ≥1；
//   3) 进 /notifications 后角标消失（前端进页自动 markRead），刷新后仍为 0；
//   4) 无 console error、非白屏（innerText>200）、无横向溢出。
//
// 造数：纯 API —— B 建问题/回答，A 评论 B 的回答 → B 得 1 条未读
//   comment 通知。unread-count 只剔除 巡检/走查 残留昵称的 actor，
//   @test.dev 注册号的通知仍计入（造不出来直接 FAIL，不伪造）。
//
// 通用守卫：body.innerText>200（防白屏假绿）、window.__errs 为空。
//
// 环境：verify.sh 透传 API_BASE；e2e/lib.mjs 的 BASE/API 在模块加载时定型，
// 故先按 API_BASE 反推 E2E_BASE/E2E_API 再动态 import。
const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
if (!process.env.E2E_API) process.env.E2E_API = API_BASE;
if (!process.env.E2E_BASE) process.env.E2E_BASE = API_BASE.replace(/\/api$/, "");

const { run, expect, BASE, register, authedPage, apiOk, uniq } = await import(
  "../e2e/lib.mjs"
);

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

run("notify-entry", async ({ browser }) => {
  // ---- 造数：B 是收件人（建问题+回答），A 是 actor（评论 B 的回答）----
  const B = await register(uniq("bellB"));
  const A = await register(uniq("bellA"));

  const { question } = await apiOk("POST", "/questions", {
    token: B.token,
    body: { title: `[e2e] ${uniq("q")} — 通知角标断言`, detail_md: "通知角标验收用问题。" },
  });
  const { answer } = await apiOk("POST", `/questions/${question.id}/answers`, {
    token: B.token,
    body: { content_md: "回答正文：通知角标断言挂点。" },
  });
  await apiOk("POST", "/comments", {
    token: A.token,
    body: {
      target_type: "answer",
      target_id: answer.id,
      body: `通知角标断言 ${Date.now()}`,
    },
  });

  // 造数前置校验：B 至少 1 条未读，否则后面角标断言无意义。
  const unread0 = await apiOk("GET", "/notifications/unread-count", { token: B.token });
  expect(
    typeof unread0.count === "number" && unread0.count >= 1,
    `造数失败：B 未读数=${JSON.stringify(unread0)}，期望 >=1`
  );

  const page = await authedPage(browser, B.token);
  await injectErrs(page);

  // ---- 两种视口：入口存在 + 角标数字 >=1 + 无横向溢出 ----
  for (const vp of VIEWPORTS) {
    await page.setViewportSize(vp);
    await page.goto(`${BASE}/`);
    const bell = page.locator("a.topnav__bell");
    await bell.waitFor();

    expect(
      (await bell.count()) === 1,
      `${vp.width}px 视口 topnav 通知入口数=${await bell.count()}，期望恰 1`
    );
    const href = await bell.getAttribute("href");
    expect(
      href && href.endsWith("/notifications"),
      `${vp.width}px 视口入口 href=${href}，期望以 /notifications 结尾`
    );
    const label = (await bell.getAttribute("aria-label")) || "";
    expect(
      label.includes("通知"),
      `${vp.width}px 视口入口 aria-label=「${label}」，期望含「通知」`
    );

    const badge = page.locator(".topnav__bell .badge");
    await badge.waitFor();
    const badgeText = (await badge.innerText()).trim();
    const n = parseInt(badgeText, 10);
    expect(
      Number.isInteger(n) && n >= 1,
      `${vp.width}px 视口角标数字=「${badgeText}」，期望 >=1`
    );

    const bodyLen = await page.evaluate(() => document.body.innerText.length);
    expect(bodyLen > 200, `${vp.width}px 视口页面内容过少：innerText=${bodyLen}`);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    );
    expect(!overflow, `${vp.width}px 视口出现横向溢出`);
  }

  // ---- 进 /notifications：角标消失，刷新后仍为 0 ----
  await page.click("a.topnav__bell");
  await page.waitForURL(/\/notifications$/);
  // 通知页加载成功后前端自动 markReadMany，角标随 unread→0 消失。
  await page.waitForFunction(
    () => !document.querySelector(".topnav__bell .badge"),
    null,
    { timeout: 15000 }
  );
  expect(
    (await page.locator(".bottomnav .badge").count()) === 0,
    "进通知页后底部导航角标仍未消失"
  );

  // 刷新：未读数重新拉取后角标不得回弹。等 unread-count 响应落地再判，
  // 避免「请求未回」造成的恒真空判。
  const unreadFetch = page.waitForResponse(
    (r) => r.url().includes("/notifications/unread-count"),
    { timeout: 15000 }
  );
  await page.reload();
  await unreadFetch;
  expect(
    (await page.locator(".topnav__bell .badge").count()) === 0,
    "刷新后 .topnav__bell .badge 回弹"
  );
  expect(
    (await page.locator(".bottomnav .badge").count()) === 0,
    "刷新后底部导航角标回弹"
  );

  const bodyLen = await page.evaluate(() => document.body.innerText.length);
  expect(bodyLen > 200, `通知页内容过少：innerText=${bodyLen}`);
  const errs = await pageErrs(page);
  expect(errs.length === 0, `通知入口流程出现页面错误：${errs.join(" | ")}`);

  console.log("[notify-entry] 两视口入口/角标/已读清空链路全部通过");
});
