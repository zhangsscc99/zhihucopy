// Z1052 — 评论「回复」入口（浏览器级断言）。
//
// 契约：
//   一级评论（parent_id==null 且未删除）行头有「回复」按钮（aria-label「回复 <昵称> 的评论」）；
//   二级评论行无「回复」；已删除评论无「回复」。
//   点「回复」→ 该评论下方内联展开 .answer__reply-form（textarea maxLength=500、
//   placeholder 含被回复者昵称、自动聚焦、Esc 关闭）；同一时刻只许一个表单
//   （点另一条切换后 .answer__reply-form 数量仍恰为 1）。
//   提交（按钮文案恰为「回复」，不含 发布/发送/提交 字样）→ toast「回复已发布」、
//   表单收起清空、新回复以 .answer__comment--child 挂到该父评论末尾、计数 +1、
//   刷新后仍在（服务端持久化）。未登录点「回复」→ 跳 /login?next=。
//
// 通用守卫：body.innerText>200（防整站白屏假绿）、window.__errs 为空、
// 「新元素存在」与「旧状态元素为 0」成对断言。
//
// 注意：e2e 注册号（@test.dev → is_test=1）的评论被公共列表过滤，必须在
// 评论区可见的留言一律用种子号（userN@zhihucopy.dev / zhihu123456）发；
// 问题/回答本体挂测试号即可（详情页不按作者过滤）。
//
// 环境：verify.sh 透传 API_BASE；e2e/lib.mjs 的 BASE/API 在模块加载时定型，
// 故先按 API_BASE 反推 E2E_BASE/E2E_API 再动态 import。
const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
if (!process.env.E2E_API) process.env.E2E_API = API_BASE;
if (!process.env.E2E_BASE) process.env.E2E_BASE = API_BASE.replace(/\/api$/, "");

const { run, expect, BASE, register, authedPage, newPage, api, apiOk, uniq } = await import(
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

const replyOpRe = /^回复 .+ 的评论$/;

const seedLogin = async (email) => {
  const r = await api("POST", "/auth/login", {
    body: { email, password: "zhihu123456" },
  });
  expect(r.status === 200, `seed login ${email} -> ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  return r.data;
};

// 评论正文不得含 uniq() 产物：当前 Date.now().toString(36) 以 mw 开头，
// uniq() 输出形如 x-mwXXXXXXXX-N 会命中服务端 bodyMatchSql 的 -mw 过滤，
// 整条评论从公共列表消失。标记统一用纯数字。
let mseq = 0;
const mark = (label) => `${label} ${Date.now()}${mseq++}`;

const postComment = (token, targetId, body, parentId) =>
  apiOk("POST", "/comments", {
    token,
    body: {
      target_type: "answer",
      target_id: targetId,
      ...(parentId ? { parent_id: parentId } : {}),
      body,
    },
  });

run("comment-reply-ui", async ({ browser }) => {
  const op = await register(uniq("op"));
  const u1 = await seedLogin("user2@zhihucopy.dev");
  const u2 = await seedLogin("user3@zhihucopy.dev");
  const u3 = await seedLogin("user6@zhihucopy.dev");

  const { question } = await apiOk("POST", "/questions", {
    token: op.token,
    body: { title: `[e2e] ${uniq("q")} — 评论回复入口验证`, detail_md: "回复入口验收用问题。" },
  });
  const { answer } = await apiOk("POST", `/questions/${question.id}/answers`, {
    token: op.token,
    body: { content_md: "回答正文：评论回复 UI 断言挂点。" },
  });
  const aid = answer.id;

  // c1（u1，待被回复）、c2（u2，预埋 u3 的二级回复）、doomed（u3 发后即删 → 占位行）。
  const c1Text = mark("回复断言甲");
  const c2Text = mark("回复断言乙");
  const { comment: c1 } = await postComment(u1.token, aid, c1Text);
  const { comment: c2 } = await postComment(u2.token, aid, c2Text);
  await postComment(u3.token, aid, mark("预埋二级回复"), c2.id);
  const { comment: doomed } = await postComment(u3.token, aid, mark("待删除占位"));
  await apiOk("DELETE", `/comments/${doomed.id}`, { token: u3.token });

  const page = await authedPage(browser, u1.token);
  await injectErrs(page);
  await page.goto(`${BASE}/question/${question.id}`);
  await page.locator(".question__title").first().waitFor();

  const ans = page.locator(`#answer-${aid}`);
  await ans.getByRole("button", { name: /条评论|收起评论/ }).click();
  await page.locator("li.answer__comment").first().waitFor();

  // ---- 通用守卫：页面非白屏 ----
  const bodyLen = await page.evaluate(() => document.body.innerText.length);
  expect(bodyLen > 200, `页面内容过少：innerText=${bodyLen}`);

  // ---- 入口可见性：一级有「回复」，二级/已删除没有 ----
  const tops = page.locator("li.answer__comment:not(.answer__comment--child)");
  const children = page.locator("li.answer__comment--child");
  // 行集：c1、c2、删除占位，共 3 个一级 + 1 个预埋二级。
  expect((await tops.count()) === 3, `一级评论行数=${await tops.count()}，期望 3`);
  expect((await children.count()) === 1, `二级评论行数=${await children.count()}，期望 1`);

  const topReplyBtns = tops.getByRole("button", { name: replyOpRe });
  expect(
    (await topReplyBtns.count()) === 2,
    `一级评论「回复」按钮数=${await topReplyBtns.count()}，期望 2（已删除行不应有）`
  );
  expect(
    (await children.getByRole("button", { name: replyOpRe }).count()) === 0,
    "二级评论行不应出现「回复」按钮"
  );

  // ---- 展开：旧态 0 → 新态恰 1，焦点落 textarea ----
  const replyForms = page.locator(".answer__reply-form");
  expect((await replyForms.count()) === 0, "未点「回复」前已存在回复表单");

  const c1Li = page.locator("li.answer__comment", { hasText: c1Text });
  await c1Li.getByRole("button", { name: replyOpRe }).click();
  expect((await replyForms.count()) === 1, `点「回复」后表单数=${await replyForms.count()}，期望恰 1`);
  const ta = replyForms.first().locator("textarea");
  expect((await ta.getAttribute("maxlength")) === "500", "回复 textarea maxLength != 500");
  const ph = await ta.getAttribute("placeholder");
  expect(ph && ph.includes(u1.user.nickname), `回复 placeholder 未含被回复者昵称：${ph}`);
  const focused = await page.evaluate(
    () => document.activeElement && document.activeElement.matches(".answer__reply-form textarea")
  );
  expect(focused, "展开回复表单后焦点未落在 textarea");

  // a11y：「回复」按钮的 aria-controls 指向常驻 slot；slot 存在只算一半，
  // 展开态下其内部必须真的装着恰 1 个 .answer__reply-form（否则恒真）。
  const ctl = await c1Li
    .getByRole("button", { name: replyOpRe })
    .first()
    .getAttribute("aria-controls");
  const slot = page.locator(`#${ctl}`);
  expect(
    ctl && (await slot.count()) === 1,
    `aria-controls=${ctl} 未指向真实存在的 slot 节点`
  );
  const slotFormsOpen = await slot.locator(".answer__reply-form").count();
  expect(
    slotFormsOpen === 1,
    `展开态下 slot 内回复表单数=${slotFormsOpen}，期望恰 1`
  );

  // 切换父评论：表单数仍恰为 1（全局单例）。
  const c2Li = page.locator("li.answer__comment", { hasText: c2Text });
  await c2Li.getByRole("button", { name: replyOpRe }).click();
  expect((await replyForms.count()) === 1, `切换目标后表单数=${await replyForms.count()}，期望恰 1`);

  // Esc 关闭。
  await page.keyboard.press("Escape");
  expect((await replyForms.count()) === 0, "Esc 后回复表单未关闭");

  // Esc 挂在表单容器上：焦点 Tab 到按钮区（离开 textarea）后 Esc 同样要关。
  // 先填一字让「回复」按钮可聚焦，Tab×2 落在 回复/取消 按钮上。
  await c1Li.getByRole("button", { name: replyOpRe }).click();
  await replyForms.first().locator("textarea").fill("x");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const onFormBtn = await page.evaluate(
    () =>
      document.activeElement &&
      document.activeElement.closest(".answer__reply-form") !== null &&
      !document.activeElement.matches("textarea")
  );
  expect(onFormBtn, "Tab 两次后焦点未落在回复表单的按钮区");
  await page.keyboard.press("Escape");
  expect((await replyForms.count()) === 0, "焦点在表单按钮上时 Esc 未关闭回复表单");

  // 收起态：slot 仍在但内部不得残留 .answer__reply-form。
  const slotFormsClosed = await slot.locator(".answer__reply-form").count();
  expect(
    slotFormsClosed === 0,
    `收起态下 slot 内回复表单数=${slotFormsClosed}，期望 0`
  );

  // ---- 提交一次：乐观挂上 + 计数 +1 + toast + 表单收起 ----
  const replyText = mark("回复断言正文");
  await c1Li.getByRole("button", { name: replyOpRe }).click();
  await replyForms.first().locator("textarea").fill(replyText);
  await replyForms.first().getByRole("button", { name: "回复", exact: true }).click();
  await page.locator(".toast", { hasText: "回复已发布" }).waitFor();

  expect((await replyForms.count()) === 0, "回复成功后表单未收起");
  expect((await children.count()) === 2, `回复后二级行数=${await children.count()}，期望 2`);

  // 归属：新回复是 c1 的 child（向上找最近非 child 的 li，其正文应为 c1Text）。
  const owner = await page.evaluate((needle) => {
    const lis = [...document.querySelectorAll("li.answer__comment")];
    const li = lis.find((x) => x.innerText.includes(needle));
    if (!li) return null;
    let p = li.previousElementSibling;
    while (p && p.classList.contains("answer__comment--child")) p = p.previousElementSibling;
    const body = p ? p.querySelector(".answer__comment-body") : null;
    return {
      isChild: li.classList.contains("answer__comment--child"),
      parentBody: body ? body.textContent : null,
    };
  }, replyText);
  expect(owner && owner.isChild, `新回复未以 answer__comment--child 渲染：${JSON.stringify(owner)}`);
  expect(
    owner.parentBody && owner.parentBody.includes(c1Text),
    `新回复归属错误：父评论正文=${owner.parentBody}，期望含 ${c1Text}`
  );

  // 计数 +1：非删除可见行数 2 一级 + 2 二级 = 4（删除占位不计入），
  // 按钮文案与可见行数一致（Z1066 口径）。
  const toggleText = (await ans.getByRole("button", { name: /收起评论/ }).innerText()).trim();
  expect(/^收起评论（4）$/.test(toggleText), `计数未 +1：「${toggleText}」期望 收起评论（4）`);

  let errs = await pageErrs(page);
  expect(errs.length === 0, `回复流程出现页面错误：${errs.join(" | ")}`);

  // ---- 持久化：刷新后回复仍在 ----
  await page.reload();
  await page.locator(".question__title").first().waitFor();
  await ans.getByRole("button", { name: /条评论|收起评论/ }).click();
  const persisted = page.locator("li.answer__comment--child", { hasText: replyText });
  await persisted.waitFor();
  expect((await persisted.count()) === 1, "刷新后回复未持久化");
  errs = await pageErrs(page);
  expect(errs.length === 0, `刷新后出现页面错误：${errs.join(" | ")}`);

  // UI 发布的回复不在 api() 跟踪网内：断言收尾按正文找回 id 并删除，不留可见残留。
  const list = await apiOk("GET", `/comments?target_type=answer&target_id=${aid}`);
  const replyRow = (list.items || [])
    .flatMap((c) => [c, ...(c.children || [])])
    .find((c) => c.content === replyText);
  expect(replyRow && replyRow.id > 0, "API 复核：回复未落库");
  await apiOk("DELETE", `/comments/${replyRow.id}`, { token: u1.token });

  // ---- 删除带子回复的一级评论：挂在其下的回复表单要一并关掉 ----
  // u1 自发一级评论 + u2 预埋一条子回复 → 页面上展开回复表单 → 行内确认删除。
  const d1Text = mark("删父断言");
  const { comment: d1 } = await postComment(u1.token, aid, d1Text);
  await postComment(u2.token, aid, mark("删父子回复"), d1.id);
  await page.reload();
  await page.locator(".question__title").first().waitFor();
  await ans.getByRole("button", { name: /条评论|收起评论/ }).click();
  const d1Li = page.locator("li.answer__comment", { hasText: d1Text });
  await d1Li.waitFor();
  await d1Li.getByRole("button", { name: replyOpRe }).click();
  expect((await replyForms.count()) === 1, "删前回复表单未展开");
  await replyForms.first().locator("textarea").fill("将随父评论一起作废的草稿");
  await d1Li.getByRole("button", { name: "删除", exact: true }).click();
  await d1Li.getByRole("button", { name: "确认删除" }).click();
  await page.locator(".toast", { hasText: "评论已删除" }).waitFor();
  expect(
    (await replyForms.count()) === 0,
    "删除带回复的父评论后回复表单仍悬挂（replyFor 未复位）"
  );
  const deletedRows = page.locator("li.answer__comment", {
    has: page.locator(".answer__comment-body--deleted"),
  });
  // [Z1069] 正向守卫：先确认场景里确实存在删除占位行，再断「无回复按钮」——
  // 否则选择器一漂移整组断言恒真。
  expect(
    (await deletedRows.count()) > 0,
    "正向守卫失败：页面应至少有一条「该评论已删除」占位行"
  );
  expect(
    (await deletedRows.getByRole("button", { name: replyOpRe }).count()) === 0,
    "「该评论已删除」占位行不应出现「回复」按钮"
  );
  expect(
    (await page.locator("[role=alert]").count()) === 0,
    "删除父评论后页面残留 role=alert"
  );
  errs = await pageErrs(page);
  expect(errs.length === 0, `删父流程出现页面错误：${errs.join(" | ")}`);

  // ---- [Z1069] 回复失败路径：表单仍开、[role=alert] 非空、草稿原样保留 ----
  // 稳定复现：u2 发父评论 → 页面渲染出「回复」入口 → u1 展开表单并填草稿 →
  // 服务端删掉父评论（页面行是陈旧的）→ 提交被 400「父评论不存在」拒。
  const f1Text = mark("失败路径父评论");
  const { comment: f1 } = await postComment(u2.token, aid, f1Text);
  await page.reload();
  await page.locator(".question__title").first().waitFor();
  await ans.getByRole("button", { name: /条评论|收起评论/ }).click();
  const f1Li = page.locator("li.answer__comment", { hasText: f1Text });
  await f1Li.waitFor();
  await f1Li.getByRole("button", { name: replyOpRe }).click();
  expect((await replyForms.count()) === 1, "失败路径：回复表单未展开");
  const failDraft = `失败草稿 ${Date.now()}`;
  await replyForms.first().locator("textarea").fill(failDraft);
  await apiOk("DELETE", `/comments/${f1.id}`, { token: u2.token });
  await replyForms.first().getByRole("button", { name: "回复", exact: true }).click();
  const failAlert = replyForms.first().locator("[role=alert]");
  await failAlert.waitFor();
  expect(
    ((await failAlert.innerText()) || "").trim().length > 0,
    "回复失败后 [role=alert] 未出现或文案为空"
  );
  expect(
    (await replyForms.count()) === 1,
    "回复失败后表单被关闭（应保持打开供用户重试/复制草稿）"
  );
  // 草稿用 inputValue() 读真实 value——getByText 会把 textarea 文本当节点文本误配。
  const keptDraft = await replyForms.first().locator("textarea").inputValue();
  expect(
    keptDraft === failDraft,
    `回复失败后草稿丢失：textarea=「${keptDraft}」期望「${failDraft}」`
  );
  errs = await pageErrs(page);
  expect(errs.length === 0, `回复失败路径出现页面错误：${errs.join(" | ")}`);

  // ---- 匿名：点「回复」→ /login?next= ----
  const anon = await newPage(browser);
  await injectErrs(anon);
  await anon.goto(`${BASE}/question/${question.id}`);
  await anon.locator(".question__title").first().waitFor();
  const anonAns = anon.locator(`#answer-${aid}`);
  await anonAns.getByRole("button", { name: /条评论|收起评论/ }).click();
  await anon.locator("li.answer__comment").first().waitFor();
  const anonReplyBtns = anon
    .locator("li.answer__comment:not(.answer__comment--child)")
    .getByRole("button", { name: replyOpRe });
  expect((await anonReplyBtns.count()) >= 1, "匿名态一级评论无「回复」按钮");
  await anonReplyBtns.first().click();
  await anon.waitForURL(/\/login/, { timeout: 10000 });
  const land = anon.url();
  expect(land.includes("/login") && land.includes("next="), `匿名点「回复」未跳登录页：${land}`);
});
