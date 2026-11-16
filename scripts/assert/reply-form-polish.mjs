// Z1067 — 回复表单细节打磨（浏览器级断言）。
//
// 契约：
//   A) 收起态「回复」按钮：若输出 aria-controls，目标 id 必须在 DOM 里真实存在
//      （稳定 slot：.answer__reply-slot#reply-slot-N）；aria-expanded 收起为
//      "false"，点击展开后变 "true" 且目标容器内出现 .answer__reply-form。
//   B) 放弃草稿提示是信息告知而非报错：切目标丢弃草稿时出现的 toast 节点
//      不得带 .toast--error（实际 className 会打印出来）。
//   C) Esc 只在一处处理：按一次表单关闭；再按一次无异常、无残留副作用，
//      window.__errs 全程为空。
//
// 通用守卫：body.innerText>200、window.__errs 为空。
//
// 注意：可见评论一律用种子号发（userN@zhihucopy.dev / zhihu123456）；
// 内容标记用纯数字。
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

const postComment = (token, targetId, body) =>
  apiOk("POST", "/comments", {
    token,
    body: { target_type: "answer", target_id: targetId, body },
  });

run("reply-form-polish", async ({ browser }) => {
  const op = await register(uniq("op"));
  const u1 = await seedLogin("user2@zhihucopy.dev");
  const u2 = await seedLogin("user3@zhihucopy.dev");

  const { question } = await apiOk("POST", "/questions", {
    token: op.token,
    body: { title: `[e2e] ${uniq("q")} — 回复表单细节验证`, detail_md: "回复表单打磨验收用问题。" },
  });
  const { answer } = await apiOk("POST", `/questions/${question.id}/answers`, {
    token: op.token,
    body: { content_md: "回答正文：回复表单细节断言挂点。" },
  });
  const aid = answer.id;

  const c1Text = mark("打磨评论甲");
  const c2Text = mark("打磨评论乙");
  await postComment(u1.token, aid, c1Text);
  await postComment(u2.token, aid, c2Text);

  const page = await authedPage(browser, u1.token);
  await injectErrs(page);
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

  // ---- A) 收起态 aria：aria-controls 必须指向真实存在的节点 ----
  const replyBtns = page
    .locator("li.answer__comment:not(.answer__comment--child)")
    .getByRole("button", { name: replyOpRe });
  const btnCount = await replyBtns.count();
  expect(btnCount >= 2, `一级评论「回复」按钮数=${btnCount}，期望 ≥2`);
  for (let i = 0; i < btnCount; i++) {
    const b = replyBtns.nth(i);
    const ctl = await b.getAttribute("aria-controls");
    const exp = await b.getAttribute("aria-expanded");
    if (ctl !== null) {
      const exists = await page.evaluate(
        (id) => document.getElementById(id) !== null,
        ctl
      );
      expect(
        exists,
        `收起态按钮#${i} aria-controls="${ctl}" 指向不存在的节点（应指向常驻 slot）`
      );
    }
    if (exp !== null) {
      expect(exp === "false", `收起态按钮#${i} aria-expanded="${exp}"，期望 "false"`);
    }
  }

  // 展开：aria-expanded 变 true，且 aria-controls 目标容器内出现表单。
  const c1Btn = c1Li.getByRole("button", { name: replyOpRe });
  const c1Ctl = await c1Btn.getAttribute("aria-controls");
  await c1Btn.click();
  expect((await replyForms.count()) === 1, "点「回复」后表单未展开");
  if (c1Ctl !== null) {
    const expanded = await page.evaluate((id) => {
      const slot = document.getElementById(id);
      return {
        exists: slot !== null,
        hasForm: slot !== null && slot.querySelector(".answer__reply-form") !== null,
      };
    }, c1Ctl);
    expect(expanded.exists, `展开后 aria-controls="${c1Ctl}" 仍指向不存在节点`);
    expect(
      expanded.hasForm,
      `aria-controls="${c1Ctl}" 容器内未渲染 .answer__reply-form`
    );
  }
  const expAfter = await c1Btn.getAttribute("aria-expanded");
  expect(expAfter === "true", `展开后 aria-expanded="${expAfter}"，期望 "true"`);

  // ---- C) Esc 单处处理：一次关闭；再按无副作用 ----
  await page.keyboard.press("Escape");
  expect((await replyForms.count()) === 0, "Esc 后回复表单未关闭");
  await page.keyboard.press("Escape"); // 第二次：应静默无异常
  await page.waitForTimeout(300);
  expect((await replyForms.count()) === 0, "二次 Esc 后表单状态异常");
  let errs = await pageErrs(page);
  expect(errs.length === 0, `Esc 流程出现页面错误：${errs.join(" | ")}`);

  // ---- B) 放弃草稿提示为 info/neutral，不得带 toast--error ----
  await c1Btn.click();
  expect((await replyForms.count()) === 1, "重开 c1 回复表单失败");
  const dropDraft = `将被放弃的草稿 ${Date.now()}`;
  await replyForms.first().locator("textarea").fill(dropDraft);
  await c2Li.getByRole("button", { name: replyOpRe }).click();
  const abandonToast = page.locator(".toast", { hasText: "放弃" });
  await abandonToast.first().waitFor();
  const abandonCls = await abandonToast.first().getAttribute("class");
  console.log(`[polish] 放弃草稿 toast className = ${abandonCls}`);
  expect(
    !/toast--error/.test(abandonCls || ""),
    `放弃草稿提示用了 error 语义（应为 info/neutral）：${abandonCls}`
  );
  // 表单已切到 c2，草稿为空。
  expect((await c2Li.locator(".answer__reply-form").count()) === 1, "切换后表单不在 c2 行内");
  const newDraft = await replyForms.first().locator("textarea").inputValue();
  expect(newDraft === "", `切换目标后草稿未清空：「${newDraft}」`);

  errs = await pageErrs(page);
  expect(errs.length === 0, `打磨断言流程出现页面错误：${errs.join(" | ")}`);
});
