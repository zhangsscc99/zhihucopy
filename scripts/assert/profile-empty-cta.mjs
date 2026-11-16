// Z1037 — 个人主页空态补下一步入口（浏览器级验收，playwright-core + chromium）：
//   a) 新注册用户（0 回答 0 提问）打开自己的 /u/<id>：
//      - main 内可点元素（a,button）≥ 2；
//      - 回答空态块里有指向 /unanswered 的「写回答」与指向 /ask 的「去提问」；
//      - 点「写回答」真实到达 /unanswered 且该页有内容或合理空态；
//      - 切到「提问」tab，空态块里同样有 ≥1 出口（/ask、/unanswered）。
//   b) 未登录访问他人空主页：不出现「写回答」文案（避免登录入口错位），
//      但有「浏览 TA 的提问」（?tab=questions）与回首页的出口；点它真实切到提问 tab。
//   基线（空态只有纯文本、0 链接）在首个链接 waitFor 即超时 FAIL。
//
// 跑法: env API_BASE=http://127.0.0.1:3163/zhihucopy/api \
//       [E2E_BASE=http://127.0.0.1:3163/zhihucopy] [DB_PATH=<db>] \
//       node scripts/assert/profile-empty-cta.mjs
const API_ENV = (process.env.API_BASE || "").replace(/\/+$/, "");
const BASE = (
  process.env.E2E_BASE ||
  API_ENV.replace(/\/api$/, "") ||
  "http://127.0.0.1:3030/zhihucopy"
).replace(/\/+$/, "");
process.env.E2E_BASE ||= BASE;

const { run, expect, register, authedPage, newPage, uniq } = await import(
  "../e2e/lib.mjs"
);

run("profile-empty-cta", async ({ browser, page }) => {
  const me = await register(uniq("pe"));
  const other = await register(uniq("peo"));

  // ---- a) 自己主页，回答 tab 空态 ------------------------------------------
  const p = await authedPage(browser, me.token);
  await p.goto(`${BASE}/u/${me.user.id}`);
  await p.locator("main .empty").waitFor();

  // 只统计空态容器内可点元素：main 级计数会被两个 tab 按钮撑到恒 ≥2（假断言）。
  const clickables = await p
    .locator("main .empty a, main .empty button")
    .count();
  expect(clickables >= 2, `空态容器内可点元素仅 ${clickables} 个（要求 ≥ 2）`);

  const emptyHrefs = await p
    .locator("main .empty a")
    .evaluateAll((els) => els.map((e) => e.getAttribute("href") || ""));
  expect(
    emptyHrefs.some((h) => h.endsWith("/unanswered")),
    `空态缺指向 /unanswered 的入口，实际 hrefs=${emptyHrefs.join(",")}`
  );
  expect(
    emptyHrefs.some((h) => h.endsWith("/ask")),
    `空态缺指向 /ask 的入口，实际 hrefs=${emptyHrefs.join(",")}`
  );

  const writeBtn = p.locator('main .empty a[href$="/unanswered"]');
  const askBtn = p.locator('main .empty a[href$="/ask"]');
  await writeBtn.waitFor();
  await askBtn.waitFor();
  expect(
    (await writeBtn.textContent()).includes("写回答"),
    `写回答入口文案异常：${await writeBtn.textContent()}`
  );
  expect(
    (await askBtn.textContent()).includes("去提问"),
    `去提问入口文案异常：${await askBtn.textContent()}`
  );

  // 点击「写回答」→ 真实到达 /unanswered，且页面有内容或合理空态。
  await writeBtn.click();
  await p.waitForURL(/\/unanswered(\?|$)/);
  await p.locator("main").waitFor();
  const unAnsweredBody = (await p.locator("main").textContent()) || "";
  const unAnsweredLinks = await p.locator("main a, main button").count();
  expect(
    unAnsweredBody.trim().length > 0 && unAnsweredLinks >= 1,
    "到达 /unanswered 但页面既无内容也无可用出口"
  );

  // ---- 提问 tab 空态也有出口 ------------------------------------------------
  await p.goto(`${BASE}/u/${me.user.id}?tab=questions`);
  await p.locator("main .empty").waitFor();
  const qLinks = p.locator("main .empty a");
  expect((await qLinks.count()) >= 1, "提问 tab 空态没有任何出口链接");
  const qAsk = p.locator('main .empty a[href$="/ask"]');
  await qAsk.waitFor();
  await qAsk.click();
  await p.waitForURL(/\/ask(\?|$)/);

  // ---- b) 未登录访问他人空主页 ---------------------------------------------
  const anon = await newPage(browser);
  await anon.goto(`${BASE}/u/${other.user.id}`);
  await anon.locator("main .empty").waitFor();
  const emptyText = (await anon.locator("main .empty").textContent()) || "";
  expect(
    !emptyText.includes("写回答"),
    "未登录访问他人主页出现「写回答」入口文案"
  );
  const tabLink = anon.locator('main .empty a[href*="tab=questions"]');
  await tabLink.waitFor();
  const homeLink = anon.locator('main .empty a:has-text("去逛逛推荐")');
  await homeLink.waitFor();

  // 「浏览 TA 的提问」真实切到提问 tab（URL ?tab=questions + 列表切换）。
  await tabLink.click();
  await anon.waitForURL(/[?&]tab=questions/);
  await anon
    .locator('main .tabs__tab--active', { hasText: "提问" })
    .waitFor();
  const qEmpty = await anon.locator("main .empty a").count();
  expect(qEmpty >= 1, "他人主页提问 tab 空态没有任何出口链接");

  // ---- c) 同 URL 死链回归：URL 已是 ?tab=questions 时先点「回答」tab，
  //        再点空态 CTA，仍须真实切回提问 tab（URL 必须发生变化）。
  await anon.goto(`${BASE}/u/${other.user.id}?tab=questions`);
  await anon.locator("main .empty").waitFor();
  await anon.locator("main .tabs__tab", { hasText: "回答" }).click();
  await anon
    .locator("main .tabs__tab--active", { hasText: "回答" })
    .waitFor();
  const beforeCta = anon.url();
  const tabLink2 = anon.locator('main .empty a[href*="tab=questions"]');
  await tabLink2.waitFor();
  await tabLink2.click();
  await anon.waitForFunction(
    (u) => window.location.href !== u,
    beforeCta
  );
  await anon
    .locator("main .tabs__tab--active", { hasText: "提问" })
    .waitFor();
});
