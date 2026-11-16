// Z1066 — 评论计数两态口径一致性（浏览器级断言）。
//
// 契约：
//   同一回答的评论计数，收起态「N 条评论」与展开态「收起评论（N）」必须
//   取同一个值：N === 非删除可见行数（= 服务端 comment_count，不含
//   「该评论已删除」占位行）。来回切换不跳变。
//
// 反向自检：夹具埋 1 条发后即删评论 → 渲染 3 行（1 行删除占位）、可见 2 行。
//   旧口径（展开态回显渲染行数）会得到 展开 N=3 vs 收起 N=2 → 本断言 FAIL。
//
// 通用守卫：body.innerText>200（防白屏假绿）、window.__errs 为空、每一步
// 既断言新文案存在也断言旧文案消失。
//
// 注意：@test.dev 注册号（is_test=1）的评论被公共评论列表过滤，评论区里
// 需要可见的留言一律用种子号（user5@zhihucopy.dev / zhihu123456）发；
// 断言用内容标记一律纯数字，避免撞正文过滤规则。
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

run("comment-count-parity", async ({ browser }) => {
  const op = await register(uniq("op"));
  const login = await api("POST", "/auth/login", {
    body: { email: "user5@zhihucopy.dev", password: "zhihu123456" },
  });
  expect(login.status === 200, `seed login -> ${login.status}`);
  const me = login.data;

  const { question } = await apiOk("POST", "/questions", {
    token: op.token,
    body: { title: `[e2e] ${uniq("q")} — 评论计数两态一致性`, detail_md: "评论计数口径验收用问题。" },
  });
  const { answer } = await apiOk("POST", `/questions/${question.id}/answers`, {
    token: op.token,
    body: { content_md: "回答正文：评论计数奇偶断言挂点。" },
  });
  const aid = answer.id;

  // 服务端口径回读：GET /questions/:id 的 answers（本人回答在 my_answers）
  // 里找本回答的 comment_count，与按钮 N 交叉校验。字段不符先打印再断言。
  const serverCount = async () => {
    const detail = await apiOk("GET", `/questions/${question.id}`, { token: me.token });
    const hit = [...(detail.answers || []), ...(detail.my_answers || [])].find(
      (a) => a && a.id === aid
    );
    if (!hit || typeof hit.comment_count !== "number") {
      console.log(
        "[debug] detail keys:",
        Object.keys(detail),
        "| answer fields:",
        hit ? Object.keys(hit) : "NOT FOUND"
      );
    }
    expect(hit, `服务端 detail 中找不到 answer#${aid}`);
    expect(
      typeof hit.comment_count === "number",
      `answer#${aid} 缺少数值型 comment_count（见上方 debug 输出）`
    );
    return hit.comment_count;
  };

  // 预埋：1 条一级 + 1 条二级回复 + 1 条发后即删（占位行）。
  //   渲染行数 = 3；非删除可见行数 = 2。内容标记纯数字。
  const tag = String(Date.now()).slice(-6);
  const { comment: parent } = await apiOk("POST", "/comments", {
    token: me.token,
    body: { target_type: "answer", target_id: aid, body: `p${tag}` },
  });
  await apiOk("POST", "/comments", {
    token: me.token,
    body: { target_type: "answer", target_id: aid, parent_id: parent.id, body: `r${tag}` },
  });
  const { comment: doomed } = await apiOk("POST", "/comments", {
    token: me.token,
    body: { target_type: "answer", target_id: aid, body: `d${tag}` },
  });
  await apiOk("DELETE", `/comments/${doomed.id}`, { token: me.token });

  const page = await authedPage(browser, me.token);
  await injectErrs(page);
  await page.goto(`${BASE}/question/${question.id}`);
  await page.locator(".question__title").first().waitFor();

  const ans = page.locator(`#answer-${aid}`);
  const toggle = ans.getByRole("button", { name: /条评论|收起评论/ });

  // ---- 通用守卫：页面非白屏 ----
  const bodyLen = await page.evaluate(() => document.body.innerText.length);
  expect(bodyLen > 200, `页面内容过少：innerText=${bodyLen}`);

  const readClosed = async () => {
    const text = (await toggle.innerText()).trim();
    const m = RE_CLOSED.exec(text);
    expect(m !== null, `收起态文案异常：「${text}」不匹配 /^\\d+ 条评论$/`);
    expect(!RE_OPEN.test(text), `收起态残留展开文案：「${text}」`);
    return Number(m[1]);
  };
  const readOpen = async () => {
    const text = (await toggle.innerText()).trim();
    const m = RE_OPEN.exec(text);
    expect(m !== null, `展开态文案异常：「${text}」不匹配 /^收起评论（\\d+）$/`);
    expect(!RE_CLOSED.test(text), `展开态残留收起文案：「${text}」`);
    const rows = await ans.locator("li.answer__comment").count();
    const placeholders = await ans
      .locator("li.answer__comment", { hasText: "该评论已删除" })
      .count();
    return { n: Number(m[1]), rows, visible: rows - placeholders };
  };

  // ---- 第 1 轮：收起 2 → 展开必须仍是 2（旧口径此处 3 vs 2 → FAIL）----
  const closed1 = await readClosed();
  expect(closed1 === 2, `收起态 N=${closed1}，期望 2`);
  let srv = await serverCount();
  expect(closed1 === srv, `收起态 N=${closed1} ≠ 服务端 comment_count=${srv}`);
  await toggle.click();
  await ans.locator("li.answer__comment").first().waitFor();
  let st = await readOpen();
  expect(st.rows === 3, `渲染行数=${st.rows}，期望 3（删除占位仍渲染）`);
  expect(st.visible === 2, `非删除可见行数=${st.visible}，期望 2`);
  expect(st.n === st.visible, `展开态 N=${st.n} ≠ 可见行数 ${st.visible}`);
  expect(st.n === closed1, `两态不一致：展开 N=${st.n} vs 收起 N=${closed1}`);
  expect(st.n === srv, `展开态 N=${st.n} ≠ 服务端 comment_count=${srv}`);

  // ---- 收回：文案回到收起态且 N 不变 ----
  await toggle.click();
  const closed2 = await readClosed();
  expect(closed2 === st.n, `收起后 N=${closed2} ≠ 展开时 ${st.n}`);

  // ---- 再展开：来回切换数字不得跳变 ----
  await toggle.click();
  await ans.locator("li.answer__comment").first().waitFor();
  st = await readOpen();
  expect(st.n === closed2 && st.n === 2, `二次展开 N=${st.n}，期望仍为 2`);

  // ---- 发布一条（UI，纯数字标记）：两态都应变 3 ----
  const marker = `s${String(Date.now()).slice(-6)}`;
  const form = ans.locator(".answer__comment-form");
  await form.locator("textarea").fill(marker);
  await form.getByRole("button", { name: /发布/ }).click();
  await ans.locator("li.answer__comment", { hasText: marker }).waitFor();
  st = await readOpen();
  expect(st.n === st.visible && st.n === 3, `发布后展开 N=${st.n} 可见=${st.visible}，期望 3`);
  await toggle.click();
  const closed3 = await readClosed();
  expect(closed3 === 3, `发布后收起 N=${closed3}，期望与展开一致 =3`);
  srv = await serverCount();
  expect(closed3 === srv, `发布后收起 N=${closed3} ≠ 服务端 comment_count=${srv}`);

  // ---- 发布后再刷新一致性：reload → 重新定位 #answer-<aid>，两态相等且等于服务端 ----
  await page.reload();
  await page.locator(".question__title").first().waitFor();
  const closedR = await readClosed();
  expect(closedR === srv, `刷新后收起 N=${closedR} ≠ 服务端 comment_count=${srv}`);
  await toggle.click();
  await ans.locator("li.answer__comment").first().waitFor();
  st = await readOpen();
  expect(
    st.n === closedR && st.n === srv,
    `刷新后不一致：展开 N=${st.n} vs 收起 N=${closedR} vs 服务端 ${srv}`
  );
  await toggle.click();
  expect(
    (await readClosed()) === srv,
    `刷新后收回 N 跳变，≠ 服务端 comment_count=${srv}`
  );

  // ---- 再展开删除刚发的评论：两态回到 2 ----
  await toggle.click();
  await ans.locator("li.answer__comment").first().waitFor();
  const myRow = ans.locator("li.answer__comment", { hasText: marker });
  await myRow.getByRole("button", { name: "删除", exact: true }).click();
  await myRow.getByRole("button", { name: "确认删除" }).click();
  await ans.locator("li.answer__comment", { hasText: marker }).waitFor({ state: "detached" });
  st = await readOpen();
  expect(st.n === st.visible && st.n === 2, `删除后展开 N=${st.n} 可见=${st.visible}，期望 2`);
  await toggle.click();
  const closed4 = await readClosed();
  expect(closed4 === 2, `删除后收起 N=${closed4}，期望与展开一致 =2`);
  srv = await serverCount();
  expect(closed4 === srv, `删除后收起 N=${closed4} ≠ 服务端 comment_count=${srv}`);

  const errs = await pageErrs(page);
  expect(errs.length === 0, `两态一致性流程出现页面错误：${errs.join(" | ")}`);
});
