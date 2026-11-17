// Z1109 — toast 单实例（浏览器级断言）。
//
// 契约：
//   同一次用户操作只产生一条 toast；同一 key（文案 + 类型）在存活期内重复触发
//   时替换旧条而不叠加；不同文案可堆叠但最多 3 条。
//   活体区域挂在每条 .toast 上（role=status），堆栈容器本身不是 status 节点，
//   因此 `[role=status],[class*=toast]` 命中的可见节点数 = 实际 toast 条数。
//
// 场景：
//   A. 重复邮箱注册 →「该邮箱已注册」可见节点数 = 1（且错误 toast 为 error 级）；
//      表单内联错误若存在不得被误删（数量 ≤1 且与 toast 不重复计）。
//   B. 种子号在某问题回答下发布评论 →「评论已发布」可见节点数 = 1。
//   C. 同一操作（邀请回答复制链接）1.5s 内连点两次 → 同文案节点数 ≤ 1。
//
// Env: API_BASE（缺省 3030）、E2E_BASE（缺省 API_BASE 去 /api）。
// 反向自检：未修基线 stack 容器带 role=status，场景 A/B 实测节点数 = 2 必 FAIL。
const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
if (!process.env.E2E_API) process.env.E2E_API = API_BASE;
if (!process.env.E2E_BASE) process.env.E2E_BASE = API_BASE.replace(/\/api$/, "");

const { run, expect, BASE, register, authedPage, api, apiOk, uniq } = await import(
  "../e2e/lib.mjs"
);

// 统计匹配 [role=status],[class*=toast] 且可见、文本含 t 的节点数。
function visibleToastNodes(page, t) {
  return page.evaluate((text) => {
    const els = [...document.querySelectorAll("[role=status],[class*=toast]")];
    return els.filter((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const visible =
        r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
      return visible && (el.textContent || "").includes(text);
    }).length;
  }, t);
}

// 表单内联错误（非 toast 的活体/错误节点）中含 t 的可见节点数。
function inlineErrorNodes(page, t) {
  return page.evaluate((text) => {
    const els = [...document.querySelectorAll(".authform *")].filter(
      (el) => !el.closest(".toast") && (el.textContent || "").includes(text)
    );
    return els.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }).length;
  }, t);
}

run("toast-single", async ({ browser }) => {
  // ---- 场景 A：重复邮箱注册 -------------------------------------------------
  const dup = await register(uniq("dup"));
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
  await page.fill("#reg-nickname", "单实例断言");
  await page.fill("#reg-email", dup.user.email);
  await page.fill("#reg-password", "abc12345");
  await page.click('.authform button[type="submit"]');
  await page.locator(".toast", { hasText: "该邮箱已注册" }).waitFor();

  const aCount = await visibleToastNodes(page, "该邮箱已注册");
  const aInline = await inlineErrorNodes(page, "该邮箱已注册");
  console.log(`  [scene A] 「该邮箱已注册」匹配节点=${aCount}（期望 1），表单内联节点=${aInline}`);
  expect(aCount === 1, `A:「该邮箱已注册」可见节点数=${aCount}，期望 1（双弹/容器重复计？）`);
  expect(aInline <= 1, `A: 表单内联「该邮箱已注册」节点数=${aInline}，期望 ≤1（不得重复渲染）`);
  expect(
    (await page.locator(".toast--error", { hasText: "该邮箱已注册" }).count()) === 1,
    "A: 注册失败 toast 应为 error 级"
  );
  await page.close();

  // ---- 场景 B：发布评论 ------------------------------------------------------
  const op = await register(uniq("op"));
  const login = await api("POST", "/auth/login", {
    body: { email: "user4@zhihucopy.dev", password: "zhihu123456" },
  });
  expect(login.status === 200, `seed login -> ${login.status}`);
  const me = login.data;

  const { question } = await apiOk("POST", "/questions", {
    token: op.token,
    body: { title: `[e2e] ${uniq("q")} — toast 单实例验证`, detail_md: "toast 单实例验收用问题。" },
  });
  const { answer } = await apiOk("POST", `/questions/${question.id}/answers`, {
    token: op.token,
    body: { content_md: "回答正文：toast 单实例断言挂点。" },
  });
  const aid = answer.id;

  const bPage = await authedPage(browser, me.token);
  await bPage.goto(`${BASE}/question/${question.id}`);
  await bPage.locator(".question__title").first().waitFor();
  const ans = bPage.locator(`#answer-${aid}`);
  await ans.getByRole("button", { name: /条评论|收起评论/ }).click();
  const form = ans.locator(".answer__comment-form");
  await form.locator("textarea").waitFor();
  const marker = `toast 单实例断言 ${Date.now()}`;
  await form.locator("textarea").fill(marker);
  await form.getByRole("button", { name: "发布评论", exact: true }).click();
  await bPage.locator(".toast", { hasText: "评论已发布" }).waitFor();

  const bCount = await visibleToastNodes(bPage, "评论已发布");
  console.log(`  [scene B] 「评论已发布」匹配节点=${bCount}（期望 1）`);
  expect(bCount === 1, `B:「评论已发布」可见节点数=${bCount}，期望 1`);

  // ---- 场景 C：1.5s 内连点两次同一操作 ---------------------------------------
  const invite = bPage.locator(".question__invite");
  await invite.click();
  await invite.click();
  // 成功路径文案「链接已复制，发给你想邀请的人吧」；剪贴板被拒时退化为 URL 本体。
  const cSuccess = await visibleToastNodes(bPage, "链接已复制，发给你想邀请的人吧");
  const cFallback = await visibleToastNodes(bPage, `${BASE}/question/${question.id}`);
  console.log(`  [scene C] 连点两次「邀请回答」同文案节点=${Math.max(cSuccess, cFallback)}（期望 ≤1）`);
  expect(
    cSuccess <= 1 && cFallback <= 1,
    `C: 1.5s 内重复触发同 key toast，可见节点数=${Math.max(cSuccess, cFallback)}，期望 ≤1`
  );

  // 收尾：UI 发布的评论不在 api() 跟踪网内，按正文找回 id 删除。
  const list = await apiOk("GET", `/comments?target_type=answer&target_id=${aid}`);
  const mine = (list.items || []).find((c) => c.content === marker);
  expect(mine && mine.id > 0, "API 复核：评论未落库");
  await apiOk("DELETE", `/comments/${mine.id}`, { token: me.token });
});
