// Z1026 — 首页「关注」tab 验收（浏览器级 Playwright 断言，替代旧版恒真断言）。
//
// 跑法：env API_BASE=http://127.0.0.1:<port>/zhihucopy/api node scripts/assert/following-tab.mjs
//   · 页面 base 推导：E2E_BASE > API_BASE 去结尾 /api > http://127.0.0.1:3030/zhihucopy；
//     API 由 e2e/lib.mjs 解析（E2E_API > API_BASE > <base>/api）。
//   · 复用 scripts/e2e/lib.mjs：chromium 已带 --no-sandbox；注册号经 owned 跟踪，
//     进程退出时 cleanup-artifacts 级联删除账号及其 follows 记录，无产物残留。
//
// 断言内容（全部真实浏览器断言，基线未修代码上必须 FAIL）：
//   a. 登录用户关注 2 个有回答的问题 → /?tab=following 真实发出
//      /api/feed/following 请求、首屏卡片 ≥1、卡片标题集合 ⊆ 关注问题标题集合
//      （证明不是推荐流兜底）；对照 /?tab=recommended 首屏含关注集合之外的标题。
//   b. 新注册 0 关注账号 → /?tab=following 渲染空态文案 + ≥1 个可执行 CTA
//      （指向 /topics|/login|/ask，或文案含「关注/登录」），且不渲染推荐卡（≤2）；
//      未登录访问 → 空态 + 去登录类 CTA。
//   c. 三个 tab 的 aria-selected="true" 有且仅有 1 个且指向当前 tab，
//      aria-current="page" 同步唯一；非法 tab 参数回落「推荐」。
import {
  run,
  expect,
  apiOk,
  register,
  authedPage,
} from "../e2e/lib.mjs";

const E2E_BASE = (
  process.env.E2E_BASE ||
  (process.env.API_BASE || "").replace(/\/api\/?$/, "") ||
  "http://127.0.0.1:3030/zhihucopy"
).replace(/\/+$/, "");

const tabUrl = (t) => `${E2E_BASE}/?tab=${t}`;

async function cardTitles(page) {
  const all = await page.locator(".feed__item .feed__title").allTextContents();
  return all.map((t) => t.trim());
}

// 首屏加载结束后要么渲染卡片要么渲染空态，二者必居其一（轮询等待，不固定 sleep）。
async function waitSettled(page) {
  await page.waitForSelector(".feed__item, .empty", { timeout: 15000 });
}

async function emptyCtas(page) {
  return page.locator(".empty a[href]").evaluateAll((els) =>
    els.map((a) => ({ href: a.getAttribute("href") || "", text: (a.textContent || "").trim() }))
  );
}

// 可执行 CTA：去关注话题/问题（/topics、/ask）、去登录（/login），或文案明示 关注/登录。
const QUALIFY_CTA = (c) =>
  /\/(topics|topic|login|ask|questions)([/?#]|$)/.test(c.href) || /关注|登录/.test(c.text);

async function expectTabs(page, url, wantLabel, ctx) {
  await page.goto(url);
  await page.waitForFunction(
    () => document.querySelectorAll('[role="tab"]').length === 3,
    null,
    { timeout: 15000 }
  );
  const selected = (await page.locator('[role="tab"][aria-selected="true"]').allTextContents())
    .map((t) => t.trim());
  expect(
    selected.length === 1,
    `${ctx}: aria-selected="true" 应有且仅有 1 个，实得 ${selected.length} 个` +
      (selected.length ? ` (${selected.join("/")})` : "")
  );
  expect(
    selected[0] === wantLabel,
    `${ctx}: 选中 tab 应为「${wantLabel}」，实得「${selected[0] || "<none>"}」`
  );
  const current = (await page.locator('[role="tab"][aria-current="page"]').allTextContents())
    .map((t) => t.trim());
  expect(
    current.length === 1 && current[0] === wantLabel,
    `${ctx}: aria-current="page" 应唯一指向「${wantLabel}」，实得 ${current.length} 个` +
      (current.length ? ` (${current.join("/")})` : "")
  );
}

run("following-tab", async ({ browser, page }) => {
  // ---------- a. 有关注的登录用户：真实关注流，非推荐兜底 ----------
  const hot = await apiOk("GET", "/questions?tab=hot&limit=50");
  const pool = (hot.items || []).filter((q) => q.answer_count > 0 && Number.isInteger(q.id));
  expect(pool.length >= 1, "题库中没有带回答的问题可供关注");

  const u = await register();
  const followedTitles = new Set();
  for (const q of pool.slice(0, 2)) {
    await apiOk("POST", `/questions/${q.id}/follow`, { token: u.token });
    followedTitles.add(q.title.trim());
  }
  console.log(`  [a] 临时账号关注 ${followedTitles.size} 个带回答问题`);

  const p1 = await authedPage(browser, u.token);
  const feedRes = p1.waitForResponse((r) => r.url().includes("/api/feed/following"), {
    timeout: 15000,
  });
  await p1.goto(tabUrl("following"));
  await feedRes; // 若前端本地短路不发 /feed/following，这里超时 → FAIL
  await waitSettled(p1);
  expect(
    (await p1.locator(".empty").count()) === 0,
    "关注 tab 对已关注用户渲染了空态"
  );
  const fol = await cardTitles(p1);
  expect(fol.length >= 1, "关注 tab 首屏没有卡片");
  const stray = fol.filter((t) => !followedTitles.has(t));
  expect(
    stray.length === 0,
    `关注流混入未关注内容（疑似推荐流兜底）: ${stray.slice(0, 3).join(" | ")}`
  );

  await p1.goto(tabUrl("recommended"));
  await waitSettled(p1);
  const rec = await cardTitles(p1);
  expect(
    rec.some((t) => !followedTitles.has(t)),
    "推荐流首屏与关注集合完全一致（无法证明 following 不是推荐兜底）"
  );
  console.log(`  [a] following=${fol.length} 卡 ⊆ 关注集合; recommended=${rec.length} 卡且含关注外内容`);

  // ---------- b. 0 关注用户 + 匿名：空态 + 可执行 CTA，不渲染推荐卡 ----------
  const u2 = await register();
  const p2 = await authedPage(browser, u2.token);
  await p2.goto(tabUrl("following"));
  await p2.locator(".empty").waitFor({ timeout: 15000 });
  const eTitle = ((await p2.locator(".empty__title").textContent()) || "").trim();
  expect(eTitle.length > 0, "0 关注用户关注 tab 缺少空态文案");
  const cards2 = await p2.locator(".feed__item").count();
  expect(cards2 <= 2, `0 关注用户关注 tab 渲染了 ${cards2} 张卡（疑似推荐流平移）`);
  const ctas = await emptyCtas(p2);
  expect(
    ctas.filter(QUALIFY_CTA).length >= 1,
    `0 关注用户空态缺少可执行 CTA（去关注/去登录），现有链接: ${JSON.stringify(ctas)}`
  );
  console.log(`  [b] 0 关注: 空态「${eTitle}」CTA=[${ctas.map((c) => c.text).join("/")}] 卡数=${cards2}`);

  await page.goto(tabUrl("following"));
  await page.locator(".empty").waitFor({ timeout: 15000 });
  const anonCtas = await emptyCtas(page);
  expect(
    anonCtas.filter(QUALIFY_CTA).length >= 1,
    `未登录关注 tab 空态缺少 CTA（去登录等），现有链接: ${JSON.stringify(anonCtas)}`
  );
  expect(
    (await page.locator(".feed__item").count()) <= 2,
    "未登录关注 tab 渲染了推荐流卡片"
  );
  console.log(`  [b] 未登录: 空态 CTA=[${anonCtas.map((c) => c.text).join("/")}]`);

  // ---------- c. tab 选中态唯一且正确 ----------
  await expectTabs(p1, tabUrl("following"), "关注", "?tab=following");
  await expectTabs(p1, tabUrl("hot"), "热榜", "?tab=hot");
  await expectTabs(p1, `${E2E_BASE}/?tab=__bogus__`, "推荐", "?tab=__bogus__(非法参数)");
  console.log("  [c] aria-selected/aria-current 唯一且指向正确");
});
