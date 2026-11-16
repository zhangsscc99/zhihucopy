// Z1068 — 回复草稿边缘路径防丢（浏览器级断言）。
//
// 契约：
//   A) 删除评论的 DELETE 往返期间，用户把回复表单切到另一条评论：
//      响应落地只许关「归属被删评论」的表单（replyForRef 现值比对），
//      新开的表单与新草稿一个字都不许丢。
//      —— 用 page.route 把 DELETE 人为挂起，往返窗口确定性可控。
//   B) 切换排序（默认→最新）整体重建列表：replyFor/replyDraft/replyError
//      必须一起复位；放弃非空草稿时给 info 级提示「已放弃未提交的回复草稿」；
//      之后再开表单 textarea.value 必须为空（旧草稿不串味）。
//
// 通用守卫：body.innerText>200（防整站白屏假绿）、window.__errs 为空。
//
// 注意：断言要读「持久化后仍可见」的评论一律用种子号发
// （userN@zhihucopy.dev / zhihu123456）；@test.dev 注册号的评论被过滤。
// 内容标记用纯数字（uniq() 的 pre-... 串有概率命中内容过滤规则）。
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

const replyOpRe = /^回复 .+ 的评论$/;

const seedLogin = async (email) => {
  const r = await api("POST", "/auth/login", {
    body: { email, password: "zhihu123456" },
  });
  expect(r.status === 200, `seed login ${email} -> ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  return r.data;
};

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

run("reply-draft-race", async ({ browser }) => {
  const op = await register(uniq("op"));
  const me = await seedLogin("user2@zhihucopy.dev");

  const { question } = await apiOk("POST", "/questions", {
    token: op.token,
    body: { title: `[e2e] ${uniq("q")} — 回复草稿竞态验证`, detail_md: "草稿防丢验收用问题。" },
  });
  const { answer } = await apiOk("POST", `/questions/${question.id}/answers`, {
    token: op.token,
    body: { content_md: "回答正文：回复草稿竞态断言挂点。" },
  });
  const aid = answer.id;

  // 三条本人一级评论：c1 排序切换后开表单用；c2 待删除（先挂表单）；
  // c3 是删除往返期间切入的目标。全是本人评论 → 「删除」入口都可见。
  const c1Text = mark("竞态评论甲");
  const c2Text = mark("竞态评论乙");
  const c3Text = mark("竞态评论丙");
  await postComment(me.token, aid, c1Text);
  const { comment: c2 } = await postComment(me.token, aid, c2Text);
  const { comment: c3 } = await postComment(me.token, aid, c3Text);

  const page = await authedPage(browser, me.token);
  await injectErrs(page);

  // 把「c2 的 DELETE」挂在闸门后：往返窗口确定性拉长，窗口内切表单必现竞态。
  // 只放行非目标请求；闸门 release 前 c2 的 DELETE 不出浏览器。
  let releaseDelete = null;
  const deleteGate = new Promise((r) => (releaseDelete = r));
  let deleteHeld = false;
  await page.route(/\/api\/comments\/\d+$/, async (route) => {
    const req = route.request();
    if (req.method() === "DELETE" && req.url().endsWith(`/api/comments/${c2.id}`)) {
      deleteHeld = true;
      await deleteGate;
    }
    return route.continue();
  });

  await page.goto(`${BASE}/question/${question.id}`);
  await page.locator(".question__title").first().waitFor();

  const bodyLen = await page.evaluate(() => document.body.innerText.length);
  expect(bodyLen > 200, `页面内容过少：innerText=${bodyLen}`);

  const ans = page.locator(`#answer-${aid}`);
  await ans.getByRole("button", { name: /条评论|收起评论/ }).click();
  await page.locator("li.answer__comment").first().waitFor();

  const replyForms = page.locator(".answer__reply-form");
  const c1Li = page.locator("li.answer__comment", { hasText: c1Text });
  const c2Li = page.locator("li.answer__comment", { hasText: c2Text });
  const c3Li = page.locator("li.answer__comment", { hasText: c3Text });

  // ---- A) DELETE 往返期间切表单：新表单与新草稿不许被误关 ----
  await c2Li.getByRole("button", { name: replyOpRe }).click();
  expect((await replyForms.count()) === 1, "A：c2 的回复表单未展开");
  const draftA = `竞态草稿A ${Date.now()}`;
  await replyForms.first().locator("textarea").fill(draftA);

  await c2Li.getByRole("button", { name: "删除", exact: true }).click();
  await c2Li.getByRole("button", { name: "确认删除" }).click();
  // DELETE 已被路由闸门挂起（等它确实进入挂起态再切，确保落在往返窗口内）。
  for (let i = 0; i < 200 && !deleteHeld; i++) await page.waitForTimeout(25);
  expect(deleteHeld, "A：c2 的 DELETE 未被路由闸门挂住（竞态窗口无法复现）");

  // 窗口内把表单切到 c3 并写入新草稿。
  await c3Li.getByRole("button", { name: replyOpRe }).click();
  expect((await replyForms.count()) === 1, "A：切换到 c3 后表单数异常");
  const draftB = `竞态草稿B ${Date.now()}`;
  await replyForms.first().locator("textarea").fill(draftB);

  // 放行 DELETE：响应落地后只许关「归属 c2」的表单；当前表单归属 c3 → 不许动。
  releaseDelete();
  await page.locator(".toast", { hasText: "评论已删除" }).waitFor();
  await page.waitForTimeout(600); // 给误关路径留出一个渲染周期再判

  expect(
    (await replyForms.count()) === 1,
    "A：删除响应落地后 c3 的回复表单被误关（replyFor 闭包竞态丢草稿）"
  );
  expect(
    (await c3Li.locator(".answer__reply-form").count()) === 1,
    "A：残存的回复表单不在 c3 行内"
  );
  const keptB = await replyForms.first().locator("textarea").inputValue();
  expect(
    keptB === draftB,
    `A：c3 草稿在删除落地后丢失：textarea=「${keptB}」期望「${draftB}」（${draftB.length} 字符）`
  );
  console.log(`[race] A 路径通过：c3 表单保留，草稿 ${draftB.length} 字符未丢`);

  // ---- B) 切排序：reply 三态整体复位 + info 提示 + 再开表单草稿为空 ----
  // 复用 A 里仍开着的 c3 表单（draftB 未提交）——切排序即「整体重置」路径。
  // 排序按钮在 .answers__sort（answer li 外）。
  await page.locator(".answers__sort").getByRole("button", { name: "最新" }).click();
  await page.waitForTimeout(800); // 排序请求 + 重渲染落地
  expect(
    (await replyForms.count()) === 0,
    "B：切排序后回复表单仍悬挂（replyFor/replyDraft 未随列表重置）"
  );
  const abandonToast = page.locator(".toast", { hasText: "已放弃未提交的回复草稿" });
  await abandonToast.first().waitFor();
  const abandonCls = await abandonToast.first().getAttribute("class");
  console.log(`[race] 放弃草稿 toast className = ${abandonCls}`);
  expect(
    !/toast--error/.test(abandonCls || ""),
    `B：放弃草稿提示用了 error 语义：${abandonCls}`
  );
  await c1Li.getByRole("button", { name: replyOpRe }).click();
  expect((await replyForms.count()) === 1, "B：排序后回复表单未展开");
  const staleDraft = await replyForms.first().locator("textarea").inputValue();
  expect(
    staleDraft === "",
    `B：旧草稿串入新表单：textarea=「${staleDraft}」（期望空串）`
  );

  const errs = await pageErrs(page);
  expect(errs.length === 0, `竞态/排序流程出现页面错误：${errs.join(" | ")}`);
});
