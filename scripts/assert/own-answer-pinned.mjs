#!/usr/bin/env node
// own-answer-pinned.mjs — Z1155 本人回答置顶验收（浏览器级）。
//
// 契约：
//   1) 新号在热榜首题（answer_count >= 8）发一条回答 → 详情页 .answerlist > li
//      第一条是这张卡，带「你的回答」小标识且正文是自己的；刷新后仍置顶；
//   2) 匿名（新上下文）打开同题：列表 0 条「你的回答」，前两条 vote_up 单调不增；
//   3) API 口径：登录态 GET /questions/:id 的 answers 含该回答且 is_mine===true
//      （其余条目 is_mine===false）；匿名响应任何条目都不含 is_mine 字段、
//      answers 里找不到这条新回答；
//   4) answer_count 发布前后差 1；
//   5) 1440/390 无横向溢出，window.__errs 为空。
//
// Env: API_BASE / E2E_BASE / E2E_API / CHROME / DB_PATH。
// 反向自检：未修基线（detail.answers 只回首屏 5 条、无 is_mine）跑本断言必须
// FAIL —— 会在「登录态 detail.answers 找不到新回答 / is_mine !== true」处折。
const apiBaseEnv = (process.env.API_BASE || "").replace(/\/+$/, "");
const derivedBase = apiBaseEnv.replace(/\/api$/, "");
process.env.E2E_BASE =
  process.env.E2E_BASE || derivedBase || "http://127.0.0.1:3030/zhihucopy";
process.env.E2E_API =
  process.env.E2E_API || apiBaseEnv || `${process.env.E2E_BASE}/api`;

const { run, expect, BASE, apiOk, register, authedPage, uniq, trackOwned } =
  await import("../e2e/lib.mjs");

const ERR_HOOK = () => {
  window.__errs = [];
  const push = (m) => {
    try {
      window.__errs.push(String(m && m.message ? m.message : m));
    } catch {}
  };
  window.addEventListener("error", (e) => push(e.message || e.error));
  window.addEventListener("unhandledrejection", (e) => push(e.reason));
  const orig = console.error.bind(console);
  console.error = (...a) => {
    push(a.map((x) => String(x)).join(" "));
    orig(...a);
  };
};

async function until(fn, { timeout = 12000, step = 250, label } = {}) {
  const t0 = Date.now();
  let last;
  for (;;) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    if (Date.now() - t0 >= timeout) {
      const detail =
        last instanceof Error ? `；last error: ${last.message}` : `；last: ${JSON.stringify(last)}`;
      throw new Error(`${label} — ${timeout}ms 内未满足${detail}`);
    }
    await new Promise((r) => setTimeout(r, step));
  }
}

const errsOf = (p) => p.evaluate(() => window.__errs || []);
const noErrs = async (p, tag) => {
  const e = await errsOf(p);
  expect(e.length === 0, `${tag}: __errs 非空 ${e.join(" | ")}`);
};
const noXOverflow = async (p, tag) => {
  const diff = await p.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(diff <= 1, `${tag} 横向溢出 ${diff}px`);
};

run("own-answer-pinned", async ({ browser }) => {
  // ---- 选题：热榜前 5 里 answer_count >= 8 的第一题 ----
  const hot = await apiOk("GET", "/questions?tab=hot&limit=5");
  const top = (hot.items || []).find((it) => it.answer_count >= 8);
  expect(
    top && Number.isInteger(top.id),
    "热榜前 5 无 answer_count >= 8 的题（Z1153 补数应先就位）"
  );
  const qid = top.id;
  const me = await register(uniq("pin"));
  const marker = uniq("置顶复盘");
  const body = `${marker}：发布后回到问题页，这条回答应固定显示在回答列表最上方。`;

  const countOf = (d) => d.question.answer_count;
  const ac0 = countOf(await apiOk("GET", `/questions/${qid}`));
  expect(ac0 >= 8, `q#${qid} answer_count=${ac0} < 8，选错题`);

  const page = await authedPage(browser, me.token);
  const ctxs = [];
  let myAnswerId = null;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(ERR_HOOK);
    await page.goto(`${BASE}/question/${qid}`, { waitUntil: "networkidle" });
    await page.locator(".answerlist > li").first().waitFor();

    // ---- UI 发布：乐观置顶 + 「你的回答」标识 ----
    await page.locator(".answer-editor textarea").fill(body);
    await page.getByRole("button", { name: "发布回答" }).click();
    const firstLi = page.locator(".answerlist > li").first();
    await until(async () => (await firstLi.innerText()).includes(marker), {
      label: "发布后列表第一条不是刚发的回答",
    });
    const domId = (await firstLi.getAttribute("id")) || "";
    myAnswerId = Number(domId.replace(/^answer-/, ""));
    expect(
      Number.isInteger(myAnswerId) && myAnswerId > 0,
      `第一条 li id 异常：${domId}`
    );
    trackOwned("a", myAnswerId, me.token);
    expect(
      (await firstLi.innerText()).includes("你的回答"),
      "第一条缺少「你的回答」标识"
    );
    const tagEl = firstLi.locator(".answer__mine");
    expect(await tagEl.count(), "第一条缺 .answer__mine 标识节点");
    expect(/你的回答/.test((await tagEl.innerText()).trim()), "标识文案不是「你的回答」");
    // 0 赞同数显示与他人一致：按钮文案仍是「赞同」形态。
    expect(
      /赞同/.test(await firstLi.locator(".answer__vote--up").innerText()),
      "本人卡赞同按钮文案异常"
    );
    // 页头计数 +1。
    const headText = await page.locator("h2.answers__count").first().innerText();
    expect(
      Number((headText.match(/\d+/) || [0])[0]) === ac0 + 1,
      `页头计数未 +1：「${headText}」`
    );

    // ---- 刷新后仍置顶（detail 接口回带的置顶口径） ----
    await page.reload({ waitUntil: "networkidle" });
    const firstLi2 = page.locator(".answerlist > li").first();
    await firstLi2.waitFor();
    expect(
      (await firstLi2.getAttribute("id")) === `answer-${myAnswerId}`,
      `刷新后第一条不是本人回答（id=${await firstLi2.getAttribute("id")}）`
    );
    const t2 = await firstLi2.innerText();
    expect(t2.includes("你的回答"), "刷新后第一条缺「你的回答」标识");
    expect(t2.includes(marker), "刷新后第一条正文不是本人回答");

    // ---- API 口径 ----
    const detMine = await apiOk("GET", `/questions/${qid}`, { token: me.token });
    expect(
      countOf(detMine) === ac0 + 1,
      `answer_count ${ac0} -> ${countOf(detMine)}，预期 +1`
    );
    const hit = detMine.answers.find((a) => a.id === myAnswerId);
    expect(
      hit && hit.is_mine === true,
      `登录态 detail.answers 未含新回答 #${myAnswerId} 或 is_mine !== true` +
        `（ids=${detMine.answers.map((a) => `${a.id}:${a.is_mine}`).join(",")}）`
    );
    expect(
      detMine.answers.every((a) => typeof a.is_mine === "boolean"),
      "登录态其他回答未统一带 is_mine:false"
    );
    const detAnon = await apiOk("GET", `/questions/${qid}`);
    expect(
      !detAnon.answers.some((a) => a.id === myAnswerId),
      "匿名 detail.answers 不应含这条新回答"
    );
    expect(
      detAnon.answers.every((a) => !("is_mine" in a)),
      "匿名响应不应携带 is_mine 字段"
    );
    expect(
      detAnon.answers.length < 2 ||
        detAnon.answers[0].vote_up >= detAnon.answers[1].vote_up,
      `匿名前两条 vote_up 非单调不增：${detAnon.answers
        .slice(0, 2)
        .map((a) => a.vote_up)
        .join(",")}`
    );

    // ---- 匿名浏览器：0 条「你的回答」、赞数单调不增 ----
    const actx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
    });
    ctxs.push(actx);
    const ap = await actx.newPage();
    ap.setDefaultTimeout(15000);
    await ap.addInitScript(ERR_HOOK);
    await ap.goto(`${BASE}/question/${qid}`, { waitUntil: "networkidle" });
    await ap.locator(".answerlist > li").first().waitFor();
    expect(
      (await ap.locator(".answerlist .answer__mine").count()) === 0,
      "匿名页出现「你的回答」标识"
    );
    expect(
      (await ap.locator(".answerlist > li", { hasText: "你的回答" }).count()) === 0,
      "匿名列表某条含「你的回答」"
    );
    const ups = await ap.$$eval(
      ".answerlist .answer .answer__vote--up",
      (els) =>
        els.map((e) => parseInt((e.textContent || "").replace(/\D+/g, ""), 10) || 0)
    );
    expect(ups.length >= 2, `匿名首屏回答条数异常：${ups.length}`);
    expect(
      ups[0] >= ups[1],
      `匿名前两条 vote_up 非单调不增：${ups.slice(0, 2).join(",")}`
    );
    await noErrs(ap, "anon1440");
    await noXOverflow(ap, "anon1440");

    // ---- 390 视口：登录态无横溢、__errs 空 ----
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/question/${qid}`, { waitUntil: "networkidle" });
    const firstLiM = page.locator(".answerlist > li").first();
    await firstLiM.waitFor();
    const t3 = await firstLiM.innerText();
    expect(t3.includes("你的回答") && t3.includes(marker), "390 首条不是本人置顶卡");
    await noXOverflow(page, "mine390");
    await noErrs(page, "mine390");

    console.log(
      `  q#${qid} answer_count ${ac0}->${ac0 + 1}，本人卡 #${myAnswerId} 置顶（登录/刷新/390 一致；匿名无标记、赞数有序）`
    );
  } finally {
    await page.context().close().catch(() => {});
    for (const c of ctxs) await c.close().catch(() => {});
  }
});
