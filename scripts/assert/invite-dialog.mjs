// Z1141 — 「邀请回答」死按钮 → 真实邀请弹层（P2）。
//
// 覆盖：
//  1) 登录态点「邀请回答」→ [role=dialog].invite 恰好 1 个、aria-modal/labelledby
//     到位、main 文本含「邀请」、window.__errs 为空；
//  2) 搜索框用 aria-label=搜索用户 定位（与顶栏 aria-label=搜索 不冲突），
//     输入「阿罗」→ 结果行 ≥1 → 点「邀请」→ 按钮变「已邀请」且 disabled →
//     toast 含「已邀请」；
//  3) Esc 关层 → 弹层 0 个且焦点回 .question__invite；点遮罩外关层 → 弹层 0；
//     重新打开 → 阿罗行仍「已邀请」disabled（服务端口径恢复）；
//  4) 无匹配关键词（zzzz不存在）→ 空态「暂无匹配用户」；
//  5) 1440x900 / 390x844 打开态：documentElement 无横向溢出、弹层 rect 在视口内；
//  6) API 侧：未登录 POST/GET 均 401，自邀/坏参 400，重复 POST already:true；
//  7) 未登录点「邀请回答」走既有登录跳转（/login），不崩。
//
// 清理：register() 账号经 lib 退出自清理；邀请记录随 inviter 账号级联删除
// （artifact-cleanup DEPS 已含 question_invites）。
// Env: API_BASE / E2E_BASE / CHROME。退出码 0 PASS / 1 FAIL。

const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
const BASE = (process.env.E2E_BASE || API_BASE.replace(/\/api$/, "")).replace(/\/+$/, "");
// e2e/lib.mjs 顶层按 env 求值 BASE/API，须在动态 import 前赋值。
process.env.E2E_BASE ||= BASE;
process.env.API_BASE ||= API_BASE;
const { run, expect, api, apiOk, register, TOKEN_KEY } = await import("../e2e/lib.mjs");

function inject(page, token) {
  return page.addInitScript(
    ([k, t]) => {
      if (t) localStorage.setItem(k, t);
      const w = window;
      w.__errs = [];
      w.addEventListener("error", (e) => w.__errs.push(`error:${e.message}`));
      w.addEventListener("unhandledrejection", (e) =>
        w.__errs.push(`unhandledrejection:${e.reason && e.reason.message ? e.reason.message : e.reason}`)
      );
      const ce = console.error.bind(console);
      console.error = (...a) => {
        w.__errs.push(`console.error:${a.map(String).join(" ")}`);
        ce(...a);
      };
    },
    [TOKEN_KEY, token]
  );
}

const dialogCount = (page) => page.locator('[role="dialog"].invite').count();
const pageErrs = (page) => page.evaluate(() => window.__errs || []);

// 弹层打开态度量：横向溢出 + 弹层 rect 是否完整落在视口内。
async function checkOpenLayout(page, tag) {
  const m = await page.evaluate(() => {
    const el = document.querySelector('[role="dialog"].invite');
    const r = el ? el.getBoundingClientRect() : null;
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      rect: r && { left: r.left, right: r.right },
      vw: window.innerWidth,
    };
  });
  expect(m.overflow === 0, `[${tag}] 打开态横向溢出 ${m.overflow}px`);
  expect(
    m.rect && m.rect.left >= 0 && m.rect.right <= m.vw,
    `[${tag}] 弹层越界 left=${m.rect && m.rect.left} right=${m.rect && m.rect.right} vw=${m.vw}`
  );
}

// 「阿罗」结果行按钮状态（精确昵称匹配，防 阿罗不困 等前缀误中）。
function aluoBtn(page) {
  return page
    .locator(".invite__row", { has: page.locator(".invite__nick", { hasText: /^阿罗$/ }) })
    .first()
    .locator(".invite__btn");
}

async function waitAluoState(page, text, disabled, tag) {
  const btn = aluoBtn(page);
  await btn.waitFor({ state: "visible" });
  await page.waitForFunction(
    ([wantText, wantDisabled]) => {
      const row = [...document.querySelectorAll(".invite__row")].find(
        (r) => r.querySelector(".invite__nick")?.textContent.trim() === "阿罗"
      );
      const b = row && row.querySelector(".invite__btn");
      return b && b.textContent.trim() === wantText && b.disabled === wantDisabled;
    },
    [text, disabled]
  ).catch(() => {
    throw new Error(`[${tag}] 阿罗行按钮未到达 ${text}/disabled=${disabled}`);
  });
  return btn;
}

async function openDialog(page, tag) {
  await page.locator(".question__invite").click();
  await page.locator('[role="dialog"].invite').waitFor({ state: "visible" });
  expect((await dialogCount(page)) === 1, `[${tag}] 弹层数量 != 1`);
}

const focusOnTrigger = (page) =>
  page.evaluate(
    () =>
      document.activeElement instanceof HTMLElement &&
      document.activeElement.classList.contains("question__invite")
  );

run("invite-dialog", async ({ browser }) => {
  const { token, user } = await register("e2e-invite");

  // 选一个有回答的种子问题；阿罗 id 经同一数据源（/search?type=user）确认。
  const qs = await apiOk("GET", "/questions?tab=hot&limit=50");
  const q = (qs.items || []).find((it) => it.answer_count > 0) || qs.items[0];
  expect(q, "没有可用的种子问题");
  const qid = q.id;
  const url = `${BASE}/question/${qid}`;

  const us = await apiOk("GET", "/search?q=%E9%98%BF%E7%BD%97&type=user&limit=10", { token });
  const aluo = (us.items || []).find((u) => u.nickname === "阿罗");
  expect(aluo, "搜索「阿罗」没有精确命中");

  // ---- Phase A：1440x900 登录态全流程 ------------------------------------
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await inject(page, token);
    await page.goto(url);
    await page.waitForSelector(".question__invite");

    // 1) 开弹层。
    await openDialog(page, "1440");
    const attrs = await page.locator('[role="dialog"].invite').evaluate((el) => ({
      modal: el.getAttribute("aria-modal"),
      labelledby: el.getAttribute("aria-labelledby"),
      title: document.getElementById(el.getAttribute("aria-labelledby") || "")?.textContent?.trim(),
    }));
    expect(attrs.modal === "true", `[1440] aria-modal=${attrs.modal}`);
    expect(attrs.labelledby && attrs.title === "邀请回答", `[1440] aria-labelledby 未指向标题「邀请回答」`);
    const mainText = await page.locator("main").innerText();
    expect(mainText.includes("邀请"), "[1440] main 文本不含「邀请」");
    await checkOpenLayout(page, "1440");

    // 打开时焦点进搜索框（aria-label 定位，不与顶栏搜索冲突）。
    const searchInput = page.getByLabel("搜索用户");
    expect(await searchInput.count() === 1, "[1440] aria-label=搜索用户 命中数 != 1");
    expect(
      await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "搜索用户"),
      "[1440] 打开后焦点未落在搜索输入框"
    );

    // 2) 搜「阿罗」→ 行 ≥1 → 邀请。
    await searchInput.fill("阿罗");
    await page.locator(".invite__row").first().waitFor({ state: "visible" });
    expect((await page.locator(".invite__row").count()) >= 1, "[1440] 搜「阿罗」无结果行");
    const btn = await waitAluoState(page, "邀请", false, "1440");
    await btn.click();
    await waitAluoState(page, "已邀请", true, "1440");
    await page.locator(".toast", { hasText: "已邀请" }).first().waitFor({ state: "visible" });

    // 弹层保持打开。
    expect((await dialogCount(page)) === 1, "[1440] 邀请成功后弹层被关闭");

    // 3a) Esc 关闭 + 焦点回触发按钮。
    await page.keyboard.press("Escape");
    expect((await dialogCount(page)) === 0, "[1440] Esc 后弹层仍存在");
    expect(await focusOnTrigger(page), "[1440] Esc 后焦点未回「邀请回答」");

    // 3b) 重开 → 「已邀请」保持（同会话服务端回读）。
    await openDialog(page, "1440");
    await page.getByLabel("搜索用户").fill("阿罗");
    await waitAluoState(page, "已邀请", true, "1440-重开");

    // 3c) 点遮罩外部关闭。
    await page.locator(".invite__mask").click({ position: { x: 4, y: 4 } });
    expect((await dialogCount(page)) === 0, "[1440] 点遮罩外弹层仍存在");
    expect(await focusOnTrigger(page), "[1440] 遮罩外关闭后焦点未回「邀请回答」");

    // 4) 无匹配 → 空态。
    await openDialog(page, "1440");
    await page.getByLabel("搜索用户").fill("zzzz不存在");
    await page.locator(".invite__empty", { hasText: "暂无匹配用户" }).waitFor({ state: "visible" });
    expect((await page.locator(".invite__row").count()) === 0, "[1440] 无匹配仍渲染结果行");

    // 右上角关闭按钮也可关。
    await page.locator('[role="dialog"].invite').getByLabel("关闭").click();
    expect((await dialogCount(page)) === 0, "[1440] 关闭按钮未关弹层");
    expect(await focusOnTrigger(page), "[1440] 关闭按钮后焦点未回「邀请回答」");

    // 6) API 侧口径。
    const list = await apiOk("GET", `/invites?question_id=${qid}`, { token });
    expect(
      Array.isArray(list.invitee_ids) && list.invitee_ids.includes(aluo.id),
      `[api] GET /invites 未回含阿罗 id=${aluo.id}：${JSON.stringify(list)}`
    );
    const dup = await api("POST", "/invites", {
      token,
      body: { question_id: qid, invitee_id: aluo.id },
    });
    expect(dup.status === 200 && dup.data.already === true, `[api] 重复邀请未幂等：${dup.status}`);
    const anonPost = await api("POST", "/invites", { body: { question_id: qid, invitee_id: aluo.id } });
    expect(anonPost.status === 401, `[api] 未登录 POST 非 401：${anonPost.status}`);
    const anonGet = await api("GET", `/invites?question_id=${qid}`);
    expect(anonGet.status === 401, `[api] 未登录 GET 非 401：${anonGet.status}`);
    const selfInvite = await api("POST", "/invites", {
      token,
      body: { question_id: qid, invitee_id: user.id },
    });
    expect(selfInvite.status === 400, `[api] 邀请自己非 400：${selfInvite.status}`);
    const badParam = await api("POST", "/invites", { token, body: { question_id: qid, invitee_id: "x" } });
    expect(badParam.status === 400, `[api] 非法参数非 400：${badParam.status}`);

    const errs = await pageErrs(page);
    expect(errs.length === 0, `[1440] __errs: ${errs.slice(0, 3).join(" | ")}`);
    await context.close();
  }

  // ---- Phase B：390x844 登录态——刷新级持久化 + 打开态布局 -------------------
  {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "zh-CN",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await inject(page, token);
    await page.goto(url);
    await page.waitForSelector(".question__invite");

    await openDialog(page, "390");
    await checkOpenLayout(page, "390");
    // 全新页面加载：「已邀请」由 GET /invites 服务端口径恢复。
    await page.getByLabel("搜索用户").fill("阿罗");
    await waitAluoState(page, "已邀请", true, "390-刷新");
    await page.keyboard.press("Escape");
    expect((await dialogCount(page)) === 0, "[390] Esc 后弹层仍存在");
    expect(await focusOnTrigger(page), "[390] Esc 后焦点未回「邀请回答」");
    const errs = await pageErrs(page);
    expect(errs.length === 0, `[390] __errs: ${errs.slice(0, 3).join(" | ")}`);
    await context.close();
  }

  // ---- Phase C：未登录——点「邀请回答」走既有登录跳转 --------------------------
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await inject(page, null);
    await page.goto(url);
    await page.waitForSelector(".question__invite");
    await page.locator(".question__invite").click();
    await page.waitForURL(/\/login/, { timeout: 10000 });
    expect((await dialogCount(page)) === 0, "[anon] 未登录却打开了弹层");
    const errs = await pageErrs(page);
    expect(errs.length === 0, `[anon] __errs: ${errs.slice(0, 3).join(" | ")}`);
    await context.close();
  }
});
