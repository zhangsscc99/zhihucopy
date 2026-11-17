// Z1029 — 评论计数常显（浏览器级断言）。
// Z1066 — 计数口径统一为「可见且未删除的评论数」（= 服务端 comment_count）。
// Z975  — 展开态按钮必须含当前评论数（「收起评论（N）」），且「N 条评论」
//         计数节点全页 ≤1（不得另起独立节点重复播报）。
//
// 契约：
//   收起态「N 条评论」与展开态「收起评论（N）」的 N 严格相等，且 N ===
//   非删除可见行数（不含「该评论已删除」占位行）；已删除但仍有存活子
//   回复的评论照常渲染占位行（无存活子回复的整条不渲染，Z1101）。
//   发布 +1、删除 -1 即时回写，两态同步。
//   任意状态下，页面上文本含「数字+条评论」的叶子节点数 ≤1。
//
// 场景里刻意埋一条「发后即删 + 存活子回复」的占位行：渲染行数 = 4，
// 非删除可见行数 = 3。旧口径（展开态回显渲染行数）会 N=4 vs 收起态 3
// 在此暴露。
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

// 全页「数字+条评论」叶子节点数：父级命中但子级也命中时只计最深一层，
// 用于锁死「计数节点 ≤1，不得重复挂独立节点」。
const countCommentCountNodes = (page) =>
  page.evaluate(() => {
    const re = /\d+\s*条评论/;
    const els = [...document.querySelectorAll("body *")];
    return els.filter(
      (el) =>
        re.test(el.textContent || "") &&
        ![...el.children].some((c) => re.test(c.textContent || ""))
    ).length;
  });

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

  // 预埋：1 条一级 + 1 条二级回复 + 1 条发后即删（带 1 条存活子回复 →
  //   按 Z1101 契约保留占位行）。渲染行数 = 4；非删除可见行数 = 3 =
  //   服务端 comment_count。
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
  await apiOk("POST", "/comments", {
    token: me.token,
    body: { target_type: "answer", target_id: aid, parent_id: doomed.id, body: `计数断言待删子 ${Date.now()}dr` },
  });
  await apiOk("DELETE", `/comments/${doomed.id}`, { token: me.token });

  const page = await authedPage(browser, me.token);
  await injectErrs(page);
  await page.goto(`${BASE}/question/${question.id}`);
  await page.locator(".question__title").first().waitFor();

  const ans = page.locator(`#answer-${aid}`);
  const toggle = ans.getByRole("button", { name: /条评论|收起评论/ });

  // 收起态：「N 条评论」（N=非删除可见行数 3，占位不计）。
  const closedText = (await toggle.innerText()).trim();
  // [Z1069] 锚定全等：includes("3 条评论")/未锚定匹配会被「13 条评论」误配 →
  // trimmed 全等 + 锚定正则双断言。
  expect(closedText === "3 条评论", `收起态文案异常：「${closedText}」期望恰为「3 条评论」`);
  const mClosed = RE_CLOSED.exec(closedText);
  expect(mClosed && Number(mClosed[1]) === 3, `收起态文案异常：「${closedText}」期望 3 条评论`);

  // [Z975] 收起态恰有 1 个「N 条评论」叶子节点（即按钮本身）。
  const closedCountNodes = await countCommentCountNodes(page);
  expect(closedCountNodes === 1, `收起态「N 条评论」计数节点数=${closedCountNodes}，期望恰为 1`);

  // ---- 通用守卫：页面非白屏 ----
  const bodyLen = await page.evaluate(() => document.body.innerText.length);
  expect(bodyLen > 200, `页面内容过少：innerText=${bodyLen}`);

  // 展开后：文案「收起评论（N）」，N === 非删除可见行数；带存活子回复的
  // 删除占位行仍渲染但不计入。
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
  // [Z975] 展开态按钮文本必须正向含当前评论数（未修基线「收起评论」不含数字 → FAIL）。
  expect(st.text.includes(`（${st.visible}）`), `展开后按钮未带当前评论数：「${st.text}」期望含（${st.visible}）`);
  // [Z975] 展开态不得另挂第二个「N 条评论」计数节点（屏幕阅读器重复播报）。
  const openCountNodes = await countCommentCountNodes(page);
  expect(openCountNodes <= 1, `展开态「N 条评论」计数节点数=${openCountNodes}，期望 ≤1`);
  expect(st.rows === 4, `展开后渲染行数=${st.rows}，期望 4（含删除占位）`);
  expect(st.n === st.visible && st.n === 3, `展开后 N=${st.n} 可见=${st.visible}，期望均为 3（不含删除占位）`);

  // ---- 发布一条（UI）：N +1 且与可见行数同步 ----
  const marker = `计数断言自发 ${Date.now()}s`;
  const form = ans.locator(".answer__comment-form");
  await form.locator("textarea").fill(marker);
  await form.getByRole("button", { name: /发布/ }).click();
  await page.locator("li.answer__comment", { hasText: marker }).waitFor();
  st = await readOpenCount();
  expect(st.n !== null && st.n === st.visible && st.n === 4, `发布后 N=${st.n} 可见=${st.visible}，期望均为 4`);

  // ---- 删除刚发的评论：N -1 且与可见行数同步 ----
  const myRow = page.locator("li.answer__comment", { hasText: marker });
  await myRow.getByRole("button", { name: "删除", exact: true }).click();
  await myRow.getByRole("button", { name: "确认删除" }).click();
  await page.locator("li.answer__comment", { hasText: marker }).waitFor({ state: "detached" });
  st = await readOpenCount();
  expect(st.n !== null && st.n === st.visible && st.n === 3, `删除后 N=${st.n} 可见=${st.visible}，期望均为 3`);

  // ---- 奇偶一致性：收起后「N 条评论」的 N 与展开态严格相等 ----
  const openN = st.n;
  await toggle.click();
  const closedAgain = (await toggle.innerText()).trim();
  expect(closedAgain === "3 条评论", `收起后文案异常：「${closedAgain}」期望恰为「3 条评论」`);
  const mAgain = RE_CLOSED.exec(closedAgain);
  expect(mAgain !== null, `收起后文案异常：「${closedAgain}」不匹配 N 条评论`);
  expect(Number(mAgain[1]) === openN && openN === 3, `收起后 N=${mAgain[1]}，期望与展开态一致 =3`);
  const closedAgainNodes = await countCommentCountNodes(page);
  expect(closedAgainNodes === 1, `收起后「N 条评论」计数节点数=${closedAgainNodes}，期望恰为 1`);

  // ---- 重载页面（排序切换等价路径）后两态仍一致 ----
  await page.reload();
  await page.locator(".question__title").first().waitFor();
  const ans2 = page.locator(`#answer-${aid}`);
  const toggle2 = ans2.getByRole("button", { name: /条评论|收起评论/ });
  const closedReload = (await toggle2.innerText()).trim();
  expect(closedReload === "3 条评论", `重载后收起态文案异常：「${closedReload}」期望恰为「3 条评论」`);
  const mReload = RE_CLOSED.exec(closedReload);
  expect(mReload && Number(mReload[1]) === 3, `重载后收起态文案异常：「${closedReload}」期望 3 条评论`);
  await toggle2.click();
  await ans2.locator("li.answer__comment").first().waitFor();
  const openText2 = (await toggle2.innerText()).trim();
  expect(openText2 === "收起评论（3）", `重载后展开态文案异常：「${openText2}」期望恰为「收起评论（3）」`);
  const mOpen2 = RE_OPEN.exec(openText2);
  expect(mOpen2 && Number(mOpen2[1]) === 3, `重载后展开态文案异常：「${openText2}」期望 收起评论（3）`);
  const openReloadNodes = await countCommentCountNodes(page);
  expect(openReloadNodes <= 1, `重载展开态「N 条评论」计数节点数=${openReloadNodes}，期望 ≤1`);

  const errs = await pageErrs(page);
  expect(errs.length === 0, `计数流程出现页面错误：${errs.join(" | ")}`);
});
