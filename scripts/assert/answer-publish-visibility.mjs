// Z1032 — 浏览器级断言（Playwright）：问题页发布回答后，
//   1) 不刷新即见自己的回答（乐观置顶 + 高亮），并从 DOM 取回答 id 登记清理；
//   2) 刷新后默认视图 0 次点击即可看到：Z1155 起本人回答带「你的回答」标识
//      置顶为 .answerlist 第一条（他人条目仍保持纯赞数序公开口径）。
//      基线（无置顶口径）上，新回答在 9 条里排最末、首屏 5 条之外，
//      需点 1 次「查看全部」→ clicks===1 → FAIL；
//   3) 排序切换写进 URL（?sort=new），刷新后保持；翻到底条数与页头计数自洽；
//   4) 回归：?sort=new 下点右栏热榜（Link 无 query，search → ""）跨问题导航，
//      新问题标题出现、Spinner 消失、回答列表是新问题的（修复前：URL 同步
//      effect 用旧闭包抢 answersReq 序号 → detail 响应被丢、loading 永不复位、
//      页面永久卡 Spinner）。
// URL 推导需在 e2e/lib.mjs 求值前写入 env（lib 在模块顶层固化 BASE/API），故用动态 import。
const apiBaseEnv = (process.env.API_BASE || "").replace(/\/+$/, "");
const derivedBase = apiBaseEnv.replace(/\/api$/, "");
process.env.E2E_BASE =
  process.env.E2E_BASE || derivedBase || "http://127.0.0.1:3030/zhihucopy";
process.env.E2E_API =
  process.env.E2E_API || apiBaseEnv || `${process.env.E2E_BASE}/api`;

const { run, expect, BASE, TOKEN_KEY, register, apiOk, uniq, trackOwned } =
  await import("../e2e/lib.mjs");

// 轮询工具：不靠固定 sleep，条件满足即返回，超时抛错（含最后一次观测值）。
async function until(fn, { timeout = 15000, step = 250, label } = {}) {
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
        last instanceof Error
          ? `；last error: ${last.message}`
          : last !== undefined
            ? `；last: ${JSON.stringify(last)}`
            : "";
      throw new Error(`${label} — ${timeout}ms 内未满足${detail}`);
    }
    await new Promise((r) => setTimeout(r, step));
  }
}

const rand6 = () => String(Math.floor(100000 + Math.random() * 900000));
const visible = async (loc) =>
  (await loc.count()) > 0 && (await loc.first().isVisible().catch(() => false));

run("answer-publish-visibility", async ({ page }) => {
  const seeder = await register(uniq("seeder")); // 造题 + 存量回答的号
  const me = await register(uniq("me")); // 浏览器里实际发布的号

  // 已有 8 条回答的问题（8 而不是 10：POST /answers 有 10 分钟 ≥10 条 429 限速，
  // 造 10 条会贴边）。默认首屏 5 条，新回答（0 赞、最新）纯赞数序下落在第 9
  // 位 —— 没有「你的回答」固定条/置顶口径时，首屏注定看不到。
  const { question } = await apiOk("POST", "/questions", {
    token: seeder.token,
    body: {
      title: `[assert] ${uniq("q")} — 回答发布后还能找到自己的回答吗？`,
      detail_md: "",
    },
  });
  const seededAnswerIds = [];
  for (let i = 0; i < 8; i++) {
    const { answer } = await apiOk("POST", `/questions/${question.id}/answers`, {
      token: seeder.token,
      body: { content_md: `[assert] ${uniq("a")} — 存量回答 ${i + 1}` },
    });
    seededAnswerIds.push(answer.id);
  }
  // 给首条存量回答 1 个真实赞同：拿它当「探针」，默认序首屏 vote_up
  // 必须单调不增——若有人把作者置顶/时间因子混回默认排序会立刻现形。
  await apiOk("POST", "/votes", {
    token: seeder.token,
    body: { target_type: "answer", target_id: seededAnswerIds[0], value: 1 },
  });

  // 真实形态文案：不带 [e2e]/「验证」前缀，不会被 content-filter 判成测试内容。
  const marker = `发布可见性回归复盘-${rand6()}`;
  const body = `${marker}：结论先行——发完刷新，这条回答在默认排序里也应该还在。`;

  await page.addInitScript(
    ([k, t]) => localStorage.setItem(k, t),
    [TOKEN_KEY, me.token]
  );
  await page.goto(`${BASE}/question/${question.id}`);
  await page.locator(".answerlist .answer").first().waitFor();

  const countLoc = page.locator("h2.answers__count", { hasText: "个回答" });
  const before = parseInt((await countLoc.textContent()) || "0", 10);
  expect(before === 8, `发布前应为 8 个回答，页头显示「${await countLoc.textContent()}」`);

  // mine：回答列表里正文含 marker 的卡（本人回答置顶后就是第一条）。
  const mine = page.locator(".answerlist .answer", { hasText: marker });

  // —— UI 发布 ——
  await page.locator(".answer-editor textarea").fill(body);
  await page.getByRole("button", { name: "发布回答" }).click();

  await until(() => visible(mine), {
    label: "发布后不刷新，列表里看不到刚发的回答",
  });
  // UI 发布的回答不经 apiOk 跟踪：从 DOM 的 li id="answer-<id>" 取回登记 owned，
  // 交给退出清理，避免每次跑完往库里残留一条真实答案行。
  const domId = await mine.first().getAttribute("id");
  const myAnswerId = Number((domId || "").replace(/^answer-/, ""));
  expect(
    Number.isInteger(myAnswerId) && myAnswerId > 0,
    `发布后无法从 DOM 取到回答 id（li id=${domId}）`
  );
  trackOwned("a", myAnswerId, me.token);
  expect(
    parseInt((await countLoc.textContent()) || "0", 10) === before + 1,
    "发布后页头回答计数未 +1"
  );

  // —— 刷新：本人回答带「你的回答」标识置顶为 .answerlist 第一条（0 点击可见）——
  await page.reload();
  await page.locator(".answerlist .answer").first().waitFor();
  const firstLi = page.locator(".answerlist > li").first();
  await until(async () => (await firstLi.innerText()).includes(marker), {
    label: "刷新后默认视图列表第一条不是自己的回答",
  });
  expect(
    (await firstLi.getAttribute("id")) === `answer-${myAnswerId}`,
    `刷新后自己的回答未置顶为第一条（id=${await firstLi.getAttribute("id")}）`
  );
  expect(
    ((await firstLi.innerText()) || "").includes("你的回答"),
    "置顶第一条缺少「你的回答」标识"
  );

  // —— 默认排序口径回归：他人条目 vote_up 必须单调不增（纯赞数序），
  // 0 赞的新回答只许走 is_mine 置顶位，不得混入他人排序位 ——
  const voteUps = await page.$$eval(
    ".answerlist .answer:not(.answer--mine) .answer__vote--up",
    (els) =>
      els.map((el) => parseInt((el.textContent || "").replace(/\D+/g, ""), 10) || 0)
  );
  expect(
    voteUps.length === 5,
    `默认首屏应渲染 5 条他人回答，实际 ${voteUps.length}`
  );
  expect(
    voteUps.every((v, i) => i === 0 || v <= voteUps[i - 1]),
    `默认排序首屏 vote_up 非单调不增：${voteUps.join(",")}`
  );
  expect(
    voteUps[0] >= 1,
    `他人首条应是被赞过的存量回答（vote_up>=1），实际 ${voteUps[0]}`
  );
  const firstDefault =
    (await page
      .locator(".answerlist .answer:not(.answer--mine)")
      .first()
      .textContent()) || "";
  expect(
    !firstDefault.includes(marker),
    "0 赞的新回答出现在他人序第 1 位（疑似置顶混入默认排序）"
  );

  let clicks = 0;
  if (!(await visible(mine))) {
    // 兼容「明确提示 + 一次点击」的实现：只允许点翻页/提示按钮，不许点排序切换
    // （基线上「最新」一点就能看到 → 会掩盖真实缺陷）。
    const more = page.locator(".feed-foot button").first();
    expect(
      (await more.count()) > 0,
      "刷新后既看不到自己的回答，也没有任何可点的提示/翻页入口"
    );
    await more.click();
    clicks++;
  }
  await until(() => visible(mine), {
    timeout: 8000,
    label: `刷新后默认视图 ${clicks} 次点击内仍看不到自己的回答`,
  });
  expect(
    clicks === 0,
    `刷新后要 ${clicks} 次点击才看到自己的回答（口径：0 次点击可见）`
  );

  // —— 排序切换：URL 可表达 + 刷新保持 + 计数自洽 ——
  await page.getByRole("button", { name: "最新", exact: true }).click();
  await until(() => page.url().includes("sort=new"), {
    label: "切「最新」后 URL 未出现 ?sort=new",
  });
  await until(() => visible(mine), { label: "切「最新」后列表里看不到自己的回答" });
  const firstText = (await page.locator(".answerlist .answer").first().textContent()) || "";
  expect(firstText.includes(marker), "「最新」序首条不是刚发布的回答");

  await page.reload();
  expect(page.url().includes("sort=new"), "刷新后 URL 丢失 ?sort=new");
  await page.locator(".answerlist .answer").first().waitFor();
  const active = (await page.locator(".answers__sort-btn--active").textContent()) || "";
  expect(active.includes("最新"), `刷新后活跃排序按钮是「${active.trim()}」而不是「最新」`);
  await until(() => visible(mine), {
    label: "?sort=new 刷新后未保持最新序，自己的回答不在可见列表",
  });

  // 翻到底：累计条数必须等于页头计数（排序切换 + 固定条不改变集合总数）。
  const total = parseInt(((await countLoc.textContent()) || "").match(/\d+/)?.[0] || "0", 10);
  expect(total === before + 1, `页头计数 ${total} != ${before + 1}`);
  let shown = await page.locator(".answerlist .answer").count();
  for (let g = 0; g < 12 && shown < total; g++) {
    if ((await page.locator(".feed-end").count()) > 0) break;
    const btn = page.locator(".feed-foot button").first();
    expect((await btn.count()) > 0, "未到底却找不到「加载更多」按钮");
    await btn.click();
    const prev = shown;
    await until(
      async () =>
        (await page.locator(".answerlist .answer").count()) > prev ||
        (await page.locator(".feed-end").count()) > 0,
      { label: "「加载更多」点击后列表条数没有变化" }
    );
    shown = await page.locator(".answerlist .answer").count();
  }
  expect(shown === total, `翻到底共 ${shown} 条 != 页头计数 ${total}`);

  // —— 回归：?sort=new 下跨问题导航（右栏热榜 Link 无 query，search → ""）——
  // 断言用的问题被 content-filter 挡在公共列表外，热榜条目必然指向别的问题。
  const railLinks = page.locator(".hotlist__link");
  const railN = await railLinks.count();
  expect(railN > 0, "右栏热榜为空，无法覆盖跨问题导航回归");
  let rail = null;
  let railQid = 0;
  for (let i = 0; i < railN; i++) {
    const href = (await railLinks.nth(i).getAttribute("href")) || "";
    const m = href.match(/\/question\/(\d+)/);
    if (m && Number(m[1]) !== question.id) {
      rail = railLinks.nth(i);
      railQid = Number(m[1]);
      break;
    }
  }
  expect(rail !== null, "右栏热榜里找不到可跳转的其他问题");
  const railQ = (await apiOk("GET", `/questions/${railQid}`)).question;
  await rail.click();
  // Bug 症状：URL 同步 effect 用旧闭包抢走 answersReq 序号 → detail 响应被丢、
  // loading 永不复位 → 永久 Spinner。修好则新问题标题与它的回答列表出现。
  await until(
    async () =>
      (
        (
          (await page
            .locator("h1.question__title")
            .textContent()
            .catch(() => "")) || ""
        ).trim() === railQ.title.trim()
      ),
    { label: `跨问题导航后新问题标题「${railQ.title}」未出现` }
  );
  expect(
    (await page.locator(".spinner").count()) === 0,
    "跨问题导航后 Spinner 未消失"
  );
  await until(
    async () =>
      ((await countLoc.textContent()) || "").trim() ===
      `${railQ.answer_count} 个回答`,
    { label: "跨问题导航后页头回答计数与新问题不符" }
  );
  await until(
    async () =>
      (await page.locator(".answerlist .answer").count()) ===
      Math.min(5, railQ.answer_count),
    { label: "跨问题导航后回答列表条数与新问题不符" }
  );
});
