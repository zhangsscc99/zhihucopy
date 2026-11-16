// Z1040 — 评论发布反馈（浏览器级断言）。
//
// 契约：
//   一级评论提交按钮可访问名恰为「发布评论」（不再是裸「发布」——同页有回答
//   「发布回答」，裸名会造成歧义命中）；全页不存在可访问名恰为「发布」的按钮。
//   点一次 → 成功 toast「评论已发布」，且页面上同时可见的 .toast 容器恰为 1
//   （不双弹）；新评论即时渲染进列表、计数 +1。
//
// 通用守卫：body.innerText>200（防整站白屏假绿）、window.__errs 为空、
// 「新元素存在」与「旧状态元素为 0」成对断言（提交前 .toast 为 0，成功后恰 1）。
//
// 注意：@test.dev 注册号（is_test=1）的评论被公共评论列表过滤，浏览器操作
// 一律用种子号（user4@zhihucopy.dev / zhihu123456）；断言收尾删除所发评论，
// 不留可见残留。
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

run("comment-feedback", async ({ browser }) => {
  const op = await register(uniq("op"));
  const login = await api("POST", "/auth/login", {
    body: { email: "user4@zhihucopy.dev", password: "zhihu123456" },
  });
  expect(login.status === 200, `seed login -> ${login.status}`);
  const me = login.data;

  const { question } = await apiOk("POST", "/questions", {
    token: op.token,
    body: { title: `[e2e] ${uniq("q")} — 评论发布反馈验证`, detail_md: "评论发布反馈验收用问题。" },
  });
  const { answer } = await apiOk("POST", `/questions/${question.id}/answers`, {
    token: op.token,
    body: { content_md: "回答正文：评论发布反馈断言挂点。" },
  });
  const aid = answer.id;

  const page = await authedPage(browser, me.token);
  await injectErrs(page);
  await page.goto(`${BASE}/question/${question.id}`);
  await page.locator(".question__title").first().waitFor();

  const ans = page.locator(`#answer-${aid}`);
  await ans.getByRole("button", { name: /条评论|收起评论/ }).click();
  await page.locator(".answer__comment-form textarea").waitFor();

  // ---- 通用守卫：页面非白屏 ----
  const bodyLen = await page.evaluate(() => document.body.innerText.length);
  expect(bodyLen > 200, `页面内容过少：innerText=${bodyLen}`);

  // ---- 按钮文案：恰为「发布评论」，无裸「发布」歧义 ----
  const form = ans.locator(".answer__comment-form");
  const submit = form.getByRole("button", { name: "发布评论", exact: true });
  expect((await submit.count()) === 1, `「发布评论」按钮数=${await submit.count()}，期望恰 1`);
  expect(
    (await page.getByRole("button", { name: "发布", exact: true }).count()) === 0,
    "页面上仍存在可访问名恰为「发布」的按钮（歧义）"
  );

  // ---- 旧态 0：提交前无 toast ----
  expect((await page.locator(".toast").count()) === 0, "提交前已存在 toast");

  // ---- 发布一次：toast 恰 1 个、文案「评论已发布」、评论即时渲染、计数 +1 ----
  // 同 comment-reply-ui 的教训：标记不能用 uniq()（含 -mw 段会被评论过滤），用纯数字。
  const marker = `评论反馈断言 ${Date.now()}`;
  await form.locator("textarea").fill(marker);
  await submit.click();

  const toast = page.locator(".toast", { hasText: "评论已发布" });
  await toast.waitFor();
  const toastCount = await page.locator(".toast").count();
  expect(toastCount === 1, `同时可见 toast 数=${toastCount}，期望恰 1（双弹？）`);

  const row = page.locator("li.answer__comment", { hasText: marker });
  await row.waitFor();

  const toggleText = await ans.getByRole("button", { name: /收起评论/ }).innerText();
  expect(toggleText.includes("收起评论（1）"), `计数未 +1：「${toggleText}」期望 收起评论（1）`);

  const errs = await pageErrs(page);
  expect(errs.length === 0, `发布评论出现页面错误：${errs.join(" | ")}`);

  // 收尾：UI 发布的评论不在 api() 跟踪网内，按正文找回 id 删除，不留残留。
  const list = await apiOk("GET", `/comments?target_type=answer&target_id=${aid}`);
  const mine = (list.items || []).find((c) => c.content === marker);
  expect(mine && mine.id > 0, "API 复核：评论未落库");
  await apiOk("DELETE", `/comments/${mine.id}`, { token: me.token });
});
