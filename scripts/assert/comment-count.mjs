// Z1029 — 评论计数常显（浏览器级断言）。
// Z1066 — 计数口径统一为「可见且未删除的评论数」（= 服务端 comment_count）。
//
// 契约：
//   收起态「N 条评论」与展开态「收起评论（N）」的 N 严格相等，且 N ===
//   非删除可见行数（不含「该评论已删除」占位行）；占位行仍照常渲染。
//   发布 +1、删除 -1 即时回写，两态同步。
//
// 场景里刻意埋一条已删除占位行：渲染行数 = 3，非删除可见行数 = 2。
// 旧口径（展开态回显渲染行数）会 N=3 vs 收起态 2 在此暴露。
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

const RE_CLOSED = /^(\d+) 条评论$/;
const RE_OPEN = /^收起评论（(\d+)）$/;

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
  //   渲染行数 = 3；非删除可见行数 = 2 = 服务端 comment_count。
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

  // 收起态：「N 条评论」（N=非删除可见行数 2，占位不计）。
  const closedText = (await toggle.innerText()).trim();
  const mClosed = RE_CLOSED.exec(closedText);
  expect(mClosed && Number(mClosed[1]) === 2, `收起态文案异常：「${closedText}」期望 2 条评论`);

  // ---- 通用守卫：页面非白屏 ----
  const bodyLen = await page.evaluate(() => document.body.innerText.length);
  expect(bodyLen > 200, `页面内容过少：innerText=${bodyLen}`);

  // 展开后：文案「收起评论（N）」，N === 非删除可见行数；占位行仍渲染。
  const readOpenCount = async () => {
    const text = (await toggle.innerText()).trim();
    const m = RE_OPEN.exec(text);
    const rows = await ans.locator("li.answer__comment").count();
    const placeholders = await ans
      .locator("li.answer__comment", { hasText: "该评论已删除" })
      .count();
    return { text, n: m ? Number(m[1]) : null, rows, visible: rows - placeholders };
  };

  await toggle.click();
  await ans.locator("li.answer__comment").first().waitFor();
  let st = await readOpenCount();
  expect(st.n !== null, `展开后计数消失：「${st.text}」不匹配 收起评论（N）`);
  expect(st.rows === 3, `展开后渲染行数=${st.rows}，期望 3（含删除占位）`);
  expect(st.n === st.visible && st.n === 2, `展开后 N=${st.n} 可见=${st.visible}，期望均为 2（不含删除占位）`);

  // ---- 发布一条（UI）：N +1 且与可见行数同步 ----
  const marker = `计数断言自发 ${Date.now()}s`;
  const form = ans.locator(".answer__comment-form");
  await form.locator("textarea").fill(marker);
  await form.getByRole("button", { name: /发布/ }).click();
  await page.locator("li.answer__comment", { hasText: marker }).waitFor();
  st = await readOpenCount();
  expect(st.n !== null && st.n === st.visible && st.n === 3, `发布后 N=${st.n} 可见=${st.visible}，期望均为 3`);

  // ---- 删除刚发的评论：N -1 且与可见行数同步 ----
  const myRow = page.locator("li.answer__comment", { hasText: marker });
  await myRow.getByRole("button", { name: "删除", exact: true }).click();
  await myRow.getByRole("button", { name: "确认删除" }).click();
  await page.locator("li.answer__comment", { hasText: marker }).waitFor({ state: "detached" });
  st = await readOpenCount();
  expect(st.n !== null && st.n === st.visible && st.n === 2, `删除后 N=${st.n} 可见=${st.visible}，期望均为 2`);

  // ---- 奇偶一致性：收起后「N 条评论」的 N 与展开态严格相等 ----
  const openN = st.n;
  await toggle.click();
  const closedAgain = (await toggle.innerText()).trim();
  const mAgain = RE_CLOSED.exec(closedAgain);
  expect(mAgain !== null, `收起后文案异常：「${closedAgain}」不匹配 N 条评论`);
  expect(Number(mAgain[1]) === openN && openN === 2, `收起后 N=${mAgain[1]}，期望与展开态一致 =2`);

  // ---- 重载页面（排序切换等价路径）后两态仍一致 ----
  await page.reload();
  await page.locator(".question__title").first().waitFor();
  const ans2 = page.locator(`#answer-${aid}`);
  const toggle2 = ans2.getByRole("button", { name: /条评论|收起评论/ });
  const closedReload = (await toggle2.innerText()).trim();
  const mReload = RE_CLOSED.exec(closedReload);
  expect(mReload && Number(mReload[1]) === 2, `重载后收起态文案异常：「${closedReload}」期望 2 条评论`);
  await toggle2.click();
  await ans2.locator("li.answer__comment").first().waitFor();
  const openText2 = (await toggle2.innerText()).trim();
  const mOpen2 = RE_OPEN.exec(openText2);
  expect(mOpen2 && Number(mOpen2[1]) === 2, `重载后展开态文案异常：「${openText2}」期望 收起评论（2）`);

  const errs = await pageErrs(page);
  expect(errs.length === 0, `计数流程出现页面错误：${errs.join(" | ")}`);
});
