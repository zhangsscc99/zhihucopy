// Z1092 — 回答卡作者行「+ 关注」入口（浏览器级断言，playwright-core + chromium）。
//
// 契约：
//   1) 种子号打开「自己没答过」的问题页：首条回答作者行右侧有关注按钮，
//      文案匹配 /^\+?\s*关注$/。
//   2) 点击 → 1.5s 内文案变「已关注」，且后端生效（GET /users/:id 的
//      is_following === true）。
//   3) 刷新页面 → 仍「已关注」（列表批量回带 author.is_following，无 N+1）。
//   4) 再点一次 → 变回「关注」，后端 is_following === false。
//   5) 打开自己答过的问题页：自己的回答卡没有关注按钮，别人的仍有。
//   6) 未登录（新 context）点关注 → 跳 /login?next=/question/<id>…。
//   7) 390×844：按钮可见、documentElement 无横向溢出、按钮与昵称矩形不相交。
//   8) 全程 window.__errs（error/unhandledrejection/console.error）为空；
//      body.innerText > 200。
//   9) finally 里清掉本 run 产生的 follow 关系。
//
// 基线（无 .answer__follow 按钮）在步骤 1 的首个 waitFor 即超时 FAIL。
const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
if (!process.env.E2E_API) process.env.E2E_API = API_BASE;
if (!process.env.E2E_BASE) process.env.E2E_BASE = API_BASE.replace(/\/api$/, "");

const { run, expect, BASE, authedPage, api, apiOk } = await import(
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

const seedLogin = async (email) => {
  const r = await api("POST", "/auth/login", {
    body: { email, password: "zhihu123456" },
  });
  expect(r.status === 200, `seed login ${email} -> ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  return r.data;
};

// 轮询后端关注态（乐观更新先行，服务端往返可能尚未落地）。
async function waitFollowing(token, uid, want, tries = 10) {
  for (let i = 0; i < tries; i++) {
    const d = await apiOk("GET", `/users/${uid}`, { token });
    if (Boolean(d.is_following) === want) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  const d = await apiOk("GET", `/users/${uid}`, { token });
  expect(
    Boolean(d.is_following) === want,
    `后端 is_following 应为 ${want}，实际 ${d.is_following}`
  );
}

run("answer-author-follow", async ({ browser }) => {
  const me = await seedLogin("user2@zhihucopy.dev");
  const uid = me.user.id;

  // ---- 选题：user2 未答过且有回答的问题 ----
  const list = await apiOk("GET", "/questions?tab=hot&limit=50", { token: me.token });
  const candidates = [];
  for (const it of list.items || []) {
    if (!it.answer_count) continue;
    const d = await apiOk("GET", `/questions/${it.id}`, { token: me.token });
    const authored =
      (d.my_answers || []).length > 0 ||
      (d.answers || []).some((a) => a.author.id === uid);
    if (authored || !(d.answers || []).length) continue;
    candidates.push(d);
    if (candidates.length >= 12) break;
  }
  expect(
    candidates.length >= 2,
    `候选问题不足（需要 user2 未答过的有回答题 ≥2），实际 ${candidates.length}`
  );

  // 首答作者未被 user2 关注的优先；都已被关注则解粉第一个兜底（种子会预置互粉）。
  let q1 = null;
  for (const d of candidates) {
    const aid0 = d.answers[0].author.id;
    const st = await apiOk("GET", `/users/${aid0}`, { token: me.token });
    if (!st.is_following) {
      q1 = d;
      break;
    }
  }
  if (!q1) {
    q1 = candidates[0];
    await apiOk("DELETE", `/users/${q1.answers[0].author.id}/follow`, {
      token: me.token,
    });
  }
  const targetAnswer = q1.answers[0];
  const authorId = targetAnswer.author.id;
  const q2 = candidates.find((d) => d.question.id !== q1.question.id);
  expect(q2, "找不到第二个候选问题");

  // q2 上补一条 user2 自己的回答（自动记入 owned，退出自清理删除）。
  const { answer: mine } = await apiOk("POST", `/questions/${q2.question.id}/answers`, {
    token: me.token,
    body: { content_md: "作者行关注按钮验收自问自答。" },
  });

  const errs = [];
  try {
    // ---- 1) 首条回答作者行存在「+ 关注」 ----
    const page = await authedPage(browser, me.token);
    await injectErrs(page);
    await page.goto(`${BASE}/question/${q1.question.id}`);
    await page.locator(".question__title").first().waitFor();

    const bodyLen = await page.evaluate(() => document.body.innerText.length);
    expect(bodyLen > 200, `页面内容过少：innerText=${bodyLen}`);

    const card = page.locator(`#answer-${targetAnswer.id}`);
    await card.waitFor();
    const btn = card.locator(".answer__follow");
    await btn.waitFor();
    const label0 = (await btn.textContent()).trim();
    expect(/^\+?\s*关注$/.test(label0), `关注按钮初始文案应为「+ 关注」，实际「${label0}」`);

    // ---- 2) 点击 → 1.5s 内变「已关注」+ 后端生效 ----
    await btn.click();
    const handle = await card.locator(".answer__follow").elementHandle();
    await page.waitForFunction(
      (el) => el.textContent.trim() === "已关注",
      handle,
      { timeout: 1500 }
    );
    await waitFollowing(me.token, authorId, true);

    // ---- 3) 刷新 → 仍「已关注」（状态来自服务端批量回带） ----
    await page.reload();
    await card.locator(".answer__follow").waitFor();
    const labelAfterReload = (
      await card.locator(".answer__follow").textContent()
    ).trim();
    expect(
      labelAfterReload === "已关注",
      `刷新后应为「已关注」，实际「${labelAfterReload}」`
    );

    // ---- 4) 再点 → 回「关注」+ 后端取消 ----
    await card.locator(".answer__follow").click();
    const handle2 = await card.locator(".answer__follow").elementHandle();
    await page.waitForFunction(
      (el) => /^\+?\s*关注$/.test(el.textContent.trim()),
      handle2,
      { timeout: 1500 }
    );
    await waitFollowing(me.token, authorId, false);

    // ---- 5) 自己答过的题：自己的卡无按钮，别人的有 ----
    await page.goto(`${BASE}/question/${q2.question.id}?sort=new`);
    await page.locator(".question__title").first().waitFor();
    const myCard = page.locator(`#answer-${mine.id}`);
    await myCard.waitFor();
    expect(
      (await myCard.locator(".answer__follow").count()) === 0,
      "自己的回答卡不应出现关注按钮"
    );
    const othersBtns = page.locator(
      `.answerlist .answer:not(#answer-${mine.id}) .answer__follow`
    );
    expect(
      (await othersBtns.count()) >= 1,
      "他人回答卡仍应有关注按钮"
    );

    // ---- 7) 移动端 390×844：可见、无横溢、不与昵称重叠 ----
    await page.goto(`${BASE}/question/${q1.question.id}`);
    await card.locator(".answer__follow").waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const m = await page.evaluate((aid) => {
      const c = document.getElementById(`answer-${aid}`);
      const btn = c && c.querySelector(".answer__follow");
      const name = c && c.querySelector(".answer__name");
      const rb = btn && btn.getBoundingClientRect();
      const rn = name && name.getBoundingClientRect();
      return {
        hasBtn: !!btn,
        visible: !!rb && rb.width > 0 && rb.height > 0,
        overflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
        intersect:
          !!rb &&
          !!rn &&
          !(
            rb.right <= rn.left ||
            rn.right <= rb.left ||
            rb.bottom <= rn.top ||
            rn.bottom <= rb.top
          ),
      };
    }, targetAnswer.id);
    expect(m.hasBtn && m.visible, "390×844：关注按钮不可见");
    expect(m.overflow === 0, `390×844：横向溢出 ${m.overflow}px`);
    expect(!m.intersect, "390×844：关注按钮与昵称矩形重叠");
    await page.setViewportSize({ width: 1280, height: 900 });

    errs.push(...(await pageErrs(page)));

    // ---- 6) 未登录：点关注 → /login?next= ----
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: "zh-CN",
    });
    const anon = await ctx.newPage();
    await injectErrs(anon);
    await anon.goto(`${BASE}/question/${q1.question.id}`);
    await anon.locator(`#answer-${targetAnswer.id} .answer__follow`).waitFor();
    await anon.locator(`#answer-${targetAnswer.id} .answer__follow`).click();
    await anon.waitForURL(/\/login\?next=/);
    const here = new URL(anon.url());
    const next = here.searchParams.get("next") || "";
    expect(
      next.startsWith(`/question/${q1.question.id}`),
      `未登录点关注应跳 /login?next=/question/${q1.question.id}…，实际 next=${next}`
    );
    errs.push(...(await pageErrs(anon)));
    await ctx.close();

    expect(errs.length === 0, `页面错误：${errs.join(" | ")}`);
  } finally {
    // 清掉本 run 建立的 follow 关系（幂等），不污染后续 e2e。
    await api("DELETE", `/users/${authorId}/follow`, { token: me.token }).catch(
      () => {}
    );
  }
});
