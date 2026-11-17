// Z1075 — 评论输入框 Enter 提交（浏览器级断言）。
//
// 契约：
//   评论输入框按 Enter（与点「发布评论」同一提交函数）：
//     · 成功：评论即时渲染、计数 +1、toast「评论已发布」、草稿清空；
//     · 空/仅空白内容 Enter：不新增评论、不出错误 toast；
//     · 提交中再按 Enter 不重复提交（连按两次只落 1 条）；
//     · 「发布评论」按钮路径保持可用；
//     · 输入法组合态（isComposing）不提交——由实现侧守卫，此处不模拟。
//
// 通用守卫：body.innerText>200（防整站白屏假绿）、window.__errs 为空。
//
// 同 comment-feedback 的口径：@test.dev 注册号（is_test=1）的评论被公共
// 列表过滤，浏览器操作一律用种子号（user4@zhihucopy.dev / zhihu123456）；
// 断言收尾删除所发评论，不留可见残留。
//
// 环境：verify.sh 透传 API_BASE；e2e/lib.mjs 的 BASE/API 在模块加载时定型，
// 故先按 API_BASE 反推 E2E_BASE/E2E_API 再动态 import。
const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
if (!process.env.E2E_API) process.env.E2E_API = API_BASE;
if (!process.env.E2E_BASE) process.env.E2E_BASE = API_BASE.replace(/\/api$/, "");

const { run, expect, BASE, register, authedPage, api, apiOk, uniq } = await import(
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

run("comment-enter-submit", async ({ browser }) => {
  const op = await register(uniq("op"));
  const login = await api("POST", "/auth/login", {
    body: { email: "user4@zhihucopy.dev", password: "zhihu123456" },
  });
  expect(login.status === 200, `seed login -> ${login.status}`);
  const me = login.data;

  const { question } = await apiOk("POST", "/questions", {
    token: op.token,
    body: { title: `[e2e] ${uniq("q")} — 评论 Enter 提交验证`, detail_md: "评论 Enter 提交验收用问题。" },
  });
  const { answer } = await apiOk("POST", `/questions/${question.id}/answers`, {
    token: op.token,
    body: { content_md: "回答正文：评论 Enter 提交断言挂点。" },
  });
  const aid = answer.id;

  const page = await authedPage(browser, me.token);
  await injectErrs(page);
  await page.goto(`${BASE}/question/${question.id}`);
  await page.locator(".question__title").first().waitFor();

  const ans = page.locator(`#answer-${aid}`);
  await ans.getByRole("button", { name: /条评论|收起评论/ }).click();
  const form = ans.locator(".answer__comment-form");
  const input = form.locator("textarea");
  await input.waitFor();

  // ---- 通用守卫：页面非白屏 ----
  const bodyLen = await page.evaluate(() => document.body.innerText.length);
  expect(bodyLen > 200, `页面内容过少：innerText=${bodyLen}`);

  const toggle = () => ans.getByRole("button", { name: /收起评论/ });
  const countText = async () => (await toggle().innerText()).trim();

  // ---- 空内容 Enter：不新增评论、不出错误 toast ----
  await input.fill("   ");
  await input.press("Enter");
  await page.waitForTimeout(400);
  expect(
    (await countText()) === "收起评论（0）",
    `空内容 Enter 后计数变化：「${await countText()}」期望 收起评论（0）`
  );
  expect(
    (await page.locator(".toast", { hasText: "评论已发布" }).count()) === 0,
    "空内容 Enter 出现了成功 toast"
  );
  expect(
    (await page.locator(".toast--error").count()) === 0,
    "空内容 Enter 出现了错误 toast"
  );

  // ---- 路径 1：Enter 提交成功（2s 内渲染 + 计数 +1 + toast + 草稿清空） ----
  // 同 comment-reply-ui 的教训：标记不能用 uniq()（含 -mw 段会被评论过滤），用纯数字。
  const marker1 = `enter提交断言 ${Date.now()}`;
  await input.fill(marker1);
  await input.press("Enter");

  await page.locator("li.answer__comment", { hasText: marker1 }).waitFor({ timeout: 2000 });
  await page.locator(".toast", { hasText: "评论已发布" }).waitFor({ timeout: 2000 });
  expect(
    (await countText()) === "收起评论（1）",
    `Enter 提交后计数未 +1：「${await countText()}」期望 收起评论（1）`
  );
  expect((await input.inputValue()) === "", `Enter 提交后草稿未清空：「${await input.inputValue()}」`);

  // ---- 防双触发：fill 后连按两次 Enter，最终增量恰为 1 ----
  const marker2 = `enter双发断言 ${Date.now()}`;
  await input.fill(marker2);
  await input.press("Enter");
  await input.press("Enter");
  await page.locator("li.answer__comment", { hasText: marker2 }).waitFor({ timeout: 2000 });
  await page.waitForTimeout(800);
  const rows2 = await page.locator("li.answer__comment", { hasText: marker2 }).count();
  expect(rows2 === 1, `同一内容连按 Enter 产生 ${rows2} 条评论，期望恰 1（双触发）`);
  expect(
    (await countText()) === "收起评论（2）",
    `连按 Enter 后计数：「${await countText()}」期望 收起评论（2）`
  );

  // ---- 路径 2：「发布评论」按钮仍可用 ----
  const marker3 = `按钮提交断言 ${Date.now()}`;
  await input.fill(marker3);
  await form.getByRole("button", { name: "发布评论", exact: true }).click();
  await page.locator("li.answer__comment", { hasText: marker3 }).waitFor({ timeout: 2000 });
  expect(
    (await countText()) === "收起评论（3）",
    `按钮提交后计数：「${await countText()}」期望 收起评论（3）`
  );

  // ---- 全程无页面错误 ----
  const errs = await pageErrs(page);
  expect(errs.length === 0, `页面出现错误：${errs.join(" | ")}`);

  // 收尾：UI 发布的评论不在 api() 跟踪网内，按正文找回 id 删除，不留残留。
  const list = await apiOk("GET", `/comments?target_type=answer&target_id=${aid}`);
  for (const marker of [marker1, marker2, marker3]) {
    const mine = (list.items || []).find((c) => c.content === marker);
    expect(mine && mine.id > 0, `API 复核：评论「${marker}」未落库`);
    await apiOk("DELETE", `/comments/${mine.id}`, { token: me.token });
  }
});
