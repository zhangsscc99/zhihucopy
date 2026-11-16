// Z1029 — 评论计数常显（浏览器级断言）。
//
// 契约：
//   评论区展开后按钮文案必须是「收起评论（N）」，且 N === 实际渲染的
//   .answer__comment 行数（一级 + 二级，含「该评论已删除」占位行）；发布 +1、
//   删除 -1 都即时回写；收起态回到「N 条评论」。
//
// 场景里刻意埋一条已删除占位行：服务端 comment_count 不计已删除，
// 但占位行仍占一个 .answer__comment —— 旧口径（直接回显 comment_count）
// 会 N<行数 在此暴露（反向自检可复现 FAIL）。
//
// 通用守卫：body.innerText>200（防整站白屏假绿）、window.__errs 为空、
// 每一步都同时断言「新文案存在」与「行数相等」。
//
// 注意：@test.dev 注册号（is_test=1）的评论被公共评论列表过滤，评论区里
// 需要可见的留言一律用种子号（user5@zhihucopy.dev / zhihu123456）发。
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

run("comment-count", async ({ browser }) => {
  const op = await register(uniq("op"));
  const login = await api("POST", "/auth/login", {
    body: { email: "user5@zhihucopy.dev", password: "zhihu123456" },
  });
  expect(login.status === 200, `seed login -> ${login.status}`);
  const me = login.data;

  const { question } = await apiOk("POST", "/questions", {
    token: op.token,
    body: { title: `[e2e] ${uniq("q")} — 评论计数常显验证`, detail_md: "评论计数验收用问题。" },
  });
  const { answer } = await apiOk("POST", `/questions/${question.id}/answers`, {
    token: op.token,
    body: { content_md: "回答正文：评论计数断言挂点。" },
  });
  const aid = answer.id;

  // 预埋：1 条一级 + 1 条二级回复 + 1 条发后即删（占位行）。
  //   渲染行数 = 3；服务端 comment_count = 2（不计已删除）。
  const { comment: parent } = await apiOk("POST", "/comments", {
    token: me.token,
    body: { target_type: "answer", target_id: aid, body: `计数断言一级 ${Date.now()}` },
  });
  await apiOk("POST", "/comments", {
    token: me.token,
    body: { target_type: "answer", target_id: aid, parent_id: parent.id, body: `计数断言二级 ${Date.now()}r` },
  });
  const { comment: doomed } = await apiOk("POST", "/comments", {
    token: me.token,
    body: { target_type: "answer", target_id: aid, body: `计数断言待删 ${Date.now()}d` },
  });
  await apiOk("DELETE", `/comments/${doomed.id}`, { token: me.token });

  const page = await authedPage(browser, me.token);
  await injectErrs(page);
  await page.goto(`${BASE}/question/${question.id}`);
  await page.locator(".question__title").first().waitFor();

  const ans = page.locator(`#answer-${aid}`);
  const toggle = ans.getByRole("button", { name: /条评论|收起评论/ });

  // 收起态：「N 条评论」（N=服务端口径 2，已删除不计）。
  const closedText = await toggle.innerText();
  expect(closedText.includes("2 条评论"), `收起态文案异常：「${closedText}」期望含 2 条评论`);

  // ---- 通用守卫：页面非白屏 ----
  const bodyLen = await page.evaluate(() => document.body.innerText.length);
  expect(bodyLen > 200, `页面内容过少：innerText=${bodyLen}`);

  // 展开后：文案必须仍是「收起评论（N）」且 N === 实际渲染行数。
  const readOpenCount = async () => {
    const text = await toggle.innerText();
    const m = /收起评论（(\d+)）/.exec(text);
    const rows = await ans.locator("li.answer__comment").count();
    return { text, n: m ? Number(m[1]) : null, rows };
  };

  await toggle.click();
  await ans.locator("li.answer__comment").first().waitFor();
  let st = await readOpenCount();
  expect(st.n !== null, `展开后计数消失：「${st.text}」不匹配 收起评论（N）`);
  expect(st.n === st.rows && st.n === 3, `展开后 N=${st.n} 行数=${st.rows}，期望均为 3（含删除占位）`);

  // ---- 发布一条（UI）：N +1 且与行数同步 ----
  const marker = `计数断言自发 ${Date.now()}s`;
  const form = ans.locator(".answer__comment-form");
  await form.locator("textarea").fill(marker);
  await form.getByRole("button", { name: /发布/ }).click();
  await page.locator("li.answer__comment", { hasText: marker }).waitFor();
  st = await readOpenCount();
  expect(st.n !== null && st.n === st.rows && st.n === 4, `发布后 N=${st.n} 行数=${st.rows}，期望均为 4`);

  // ---- 删除刚发的评论：N -1 且与行数同步 ----
  const myRow = page.locator("li.answer__comment", { hasText: marker });
  await myRow.getByRole("button", { name: "删除", exact: true }).click();
  await myRow.getByRole("button", { name: "确认删除" }).click();
  await page.locator("li.answer__comment", { hasText: marker }).waitFor({ state: "detached" });
  st = await readOpenCount();
  expect(st.n !== null && st.n === st.rows && st.n === 3, `删除后 N=${st.n} 行数=${st.rows}，期望均为 3`);

  // ---- 收起：回到「N 条评论」且计数正确 ----
  await toggle.click();
  const closedAgain = await toggle.innerText();
  expect(closedAgain.includes("2 条评论"), `收起后文案异常：「${closedAgain}」期望含 2 条评论`);

  const errs = await pageErrs(page);
  expect(errs.length === 0, `计数流程出现页面错误：${errs.join(" | ")}`);
});
