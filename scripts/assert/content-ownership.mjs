// Z1033 — 浏览器级断言（Playwright）：内容主权。
//   1) 自己的回答卡右上角有「⋯」按钮（aria-label="更多操作"），菜单含 编辑/删除；
//      他人的回答卡上没有该入口；
//   2) 编辑：内联 MarkdownEditor → 保存 → PATCH → 正文即时换成唯一串 →
//      toast「已保存」→ reload 后仍是新内容；
//   3) 删除回答：菜单「删除」→ 确认条「删除后不可恢复」→ 确认删除 →
//      卡片消失、页头计数 -1、toast → reload 后仍不在（软删）；
//   4) 自己的评论行右侧有「删除」→ 二次确认 → 行消失、「N 条评论」-1、
//      reload 后正文不再出现；他人的评论行没有删除入口；
//   5) API 面：PATCH 非作者 403 / 匿名 401 / 空内容 400。
// URL 推导需在 e2e/lib.mjs 求值前写入 env（lib 在模块顶层固化 BASE/API），故用动态 import。
const apiBaseEnv = (process.env.API_BASE || "").replace(/\/+$/, "");
const derivedBase = apiBaseEnv.replace(/\/api$/, "");
process.env.E2E_BASE =
  process.env.E2E_BASE || derivedBase || "http://127.0.0.1:3030/zhihucopy";
process.env.E2E_API =
  process.env.E2E_API || apiBaseEnv || `${process.env.E2E_BASE}/api`;

const { run, expect, BASE, TOKEN_KEY, register, apiOk, api, uniq, trackOwned } =
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
const countHead = async (page) =>
  parseInt(
    (
      (await page.locator("h2.answers__count").first().textContent()) || "0"
    ).match(/\d+/)?.[0] || "0",
    10
  );

run("content-ownership", async ({ page }) => {
  const other = await register(uniq("other")); // 题主 + 他人回答/评论
  const me = await register(uniq("me")); // 浏览器里操作本人内容的号

  const { question } = await apiOk("POST", "/questions", {
    token: other.token,
    body: {
      title: `内容主权回归复盘-${rand6()}：自己的回答能改能删吗？`,
      detail_md: "",
    },
  });
  const otherMarker = `他人的回答${rand6()}`;
  await apiOk("POST", `/questions/${question.id}/answers`, {
    token: other.token,
    body: { content_md: `${otherMarker}：这条不是本人发的，不该出现操作入口。` },
  });
  const myMarker = `本人的回答${rand6()}`;
  const { answer: myAnswer } = await apiOk(
    "POST",
    `/questions/${question.id}/answers`,
    {
      token: me.token,
      body: { content_md: `${myMarker}：初版正文，稍后要被编辑掉。` },
    }
  );
  const otherCommentMarker = `他人评论${rand6()}`;
  const { comment: otherComment } = await apiOk("POST", "/comments", {
    token: other.token,
    body: {
      target_type: "answer",
      target_id: myAnswer.id,
      body: `${otherCommentMarker}：别人的评论，我删不掉。`,
    },
  });

  // —— API 面：越权/匿名/非法内容 ——
  const forbidden = await api("PATCH", `/answers/${myAnswer.id}`, {
    token: other.token,
    body: { content_md: "越权改写" },
  });
  expect(forbidden.status === 403, `PATCH 他人回答应 403，实际 ${forbidden.status}`);
  const anon = await api("PATCH", `/answers/${myAnswer.id}`, {
    body: { content_md: "匿名改写" },
  });
  expect(anon.status === 401, `PATCH 匿名应 401，实际 ${anon.status}`);
  const empty = await api("PATCH", `/answers/${myAnswer.id}`, {
    token: me.token,
    body: { content_md: "   " },
  });
  expect(empty.status === 400, `PATCH 空内容应 400，实际 ${empty.status}`);

  await page.addInitScript(
    ([k, t]) => localStorage.setItem(k, t),
    [TOKEN_KEY, me.token]
  );
  await page.goto(`${BASE}/question/${question.id}`);
  await page.locator(".answerlist .answer").first().waitFor();

  // 卡片用稳定 id 定位：进入编辑态后正文换成 textarea（value 不算 textContent），
  // hasText 会失配。
  const myCard = page.locator(`#answer-${myAnswer.id}`);
  const otherCard = page.locator(".answerlist .answer", { hasText: otherMarker });
  await until(() => visible(myCard), { label: "自己的回答卡不在列表里" });
  await until(() => visible(otherCard), { label: "他人的回答卡不在列表里" });

  // —— 入口可见性：本人卡有「更多操作」，他人卡没有 ——
  const moreBtn = myCard.getByRole("button", { name: "更多操作" });
  expect(await moreBtn.count() === 1, "自己的回答卡上没有「更多操作」按钮");
  expect(
    (await otherCard.getByRole("button", { name: "更多操作" }).count()) === 0,
    "他人的回答卡上出现了「更多操作」按钮"
  );

  // —— 评论：本人行有「删除」、他人行没有；删除后计数 -1 且刷新不回 ——
  const commentToggle = myCard.getByRole("button", { name: /条评论|收起评论/ });
  await commentToggle.click();
  const otherRow = myCard.locator(".answer__comment", { hasText: otherCommentMarker });
  await until(() => visible(otherRow), { label: "他人评论未渲染" });
  expect(
    (await otherRow.getByRole("button", { name: "删除", exact: true }).count()) === 0,
    "他人的评论行上出现了「删除」按钮"
  );

  const myCommentMarker = `本人评论${rand6()}`;
  await myCard.locator(".answer__comment-form textarea").fill(
    `${myCommentMarker}：这条一会儿要删掉。`
  );
  await myCard.locator(".answer__comment-form").getByRole("button", { name: "发布" }).click();
  const myRow = myCard.locator(".answer__comment", { hasText: myCommentMarker });
  await until(() => visible(myRow), { label: "自己刚发的评论未渲染" });
  // 评论区展开时计数仍要可见（按钮文案形如「收起评论（2）」）。
  await until(
    async () => /（2）|2 条评论/.test((await commentToggle.textContent()) || ""),
    { label: "发评论后评论计数未变成 2（展开态）" }
  );

  await myRow.getByRole("button", { name: "删除", exact: true }).click();
  await myRow.getByRole("button", { name: "确认删除" }).click();
  await until(async () => !(await visible(myRow)), {
    label: "确认删除后评论行仍在 DOM 里",
  });
  // 评论区展开时计数仍要可见（按钮文案形如「收起评论（1）」）。
  await until(
    async () => /（1）|1 条评论/.test((await commentToggle.textContent()) || ""),
    { label: "删评论后评论计数未 -1（展开态应为 1）" }
  );

  // 评论区还开着就 reload：重开后他人评论还在、自己的正文串不再出现。
  await page.reload();
  await page.locator(".answerlist .answer").first().waitFor();
  const myCard2 = page.locator(`#answer-${myAnswer.id}`);
  await until(() => visible(myCard2), { label: "reload 后自己的回答卡消失（不该删）" });
  await myCard2.getByRole("button", { name: /条评论|收起评论/ }).click();
  await until(
    () => visible(myCard2.locator(".answer__comment", { hasText: otherCommentMarker })),
    { label: "reload 后他人评论不见了" }
  );
  expect(
    (await myCard2.locator(".answer__comment", { hasText: myCommentMarker }).count()) === 0,
    "reload 后已删评论的正文仍出现在 DOM"
  );
  const toggleAfterReload = myCard2.getByRole("button", { name: /条评论|收起评论/ });
  expect(
    /（1）|1 条评论/.test((await toggleAfterReload.textContent()) || ""),
    `reload 后评论计数应为 1，实际「${await toggleAfterReload.textContent()}」`
  );
  // 关闭评论区，接着做编辑/删除（同一回答卡）。
  await myCard2.getByRole("button", { name: "收起评论" }).click();

  // —— 编辑：⋯ → 编辑 → 改唯一串 → 保存 → 即时更新 + toast + reload 仍在 ——
  const edited = `编辑后的正文${rand6()}MARK`;
  await myCard2.getByRole("button", { name: "更多操作" }).click();
  await myCard2.getByRole("menuitem", { name: "编辑" }).click();
  const editor = myCard2.locator(".answer__edit textarea");
  await editor.waitFor();
  await editor.fill(`${edited}：覆盖初版，验证 PATCH 落库。`);
  await myCard2.getByRole("button", { name: "保存", exact: true }).click();
  await until(
    async () =>
      (
        (await myCard2.locator(".answer__body").textContent().catch(() => "")) || ""
      ).includes(edited),
    { label: "保存后卡片正文未即时换成编辑内容" }
  );
  await until(() => visible(page.locator(".toast", { hasText: "已保存" })), {
    timeout: 5000,
    label: "保存后没有出现「已保存」toast",
  });

  await page.reload();
  await page.locator(".answerlist .answer").first().waitFor();
  const myCard3 = page.locator(`#answer-${myAnswer.id}`);
  await until(() => visible(myCard3), {
    label: "reload 后编辑内容不在（PATCH 未持久化）",
  });
  expect(
    (await page.locator(".answerlist .answer", { hasText: myMarker }).count()) === 0,
    "reload 后旧版正文串仍在（疑似双写/未覆盖）"
  );

  // —— 删除回答：⋯ → 删除 → 「删除后不可恢复」→ 确认删除 → 卡片消失 + 计数 -1 ——
  const beforeCount = await countHead(page);
  expect(beforeCount === 2, `删除前页头应为 2 个回答，实际 ${beforeCount}`);
  await myCard3.getByRole("button", { name: "更多操作" }).click();
  await myCard3.getByRole("menuitem", { name: "删除" }).click();
  const confirmBar = myCard3.locator(".answer__del-confirm");
  await until(() => visible(confirmBar), { label: "点「删除」后未出现确认条" });
  expect(
    ((await confirmBar.textContent()) || "").includes("删除后不可恢复"),
    "确认条缺少「删除后不可恢复」文案"
  );
  await confirmBar.getByRole("button", { name: "确认删除" }).click();
  await until(async () => !(await visible(myCard3)), {
    label: "确认删除后自己的回答卡仍在列表",
  });
  await until(async () => (await countHead(page)) === beforeCount - 1, {
    label: `删除后页头计数未 -1（仍为 ${await countHead(page)}）`,
  });
  await until(() => visible(page.locator(".toast", { hasText: "已删除" })), {
    timeout: 5000,
    label: "删除后没有出现「已删除」toast",
  });
  await until(() => visible(otherCard), { label: "误伤：他人回答卡被一起删了" });

  await page.reload();
  await page.locator(".answerlist .answer").first().waitFor();
  expect(
    (await page.locator(".answerlist .answer", { hasText: edited }).count()) === 0,
    "reload 后已删回答又回到列表"
  );
  expect(
    (await countHead(page)) === beforeCount - 1,
    `reload 后页头计数应为 ${beforeCount - 1}`
  );
  // 「你的回答」固定条也应消失（本人回答已软删）。
  expect(
    (await page.locator(".myanswers__item", { hasText: edited }).count()) === 0,
    "「你的回答」固定条里仍列着已删回答"
  );

  // —— API 复核：GET 已删回答 404，列表口径与页头一致 ——
  const got = await api("GET", `/answers/${myAnswer.id}`, { token: me.token });
  expect(got.status === 404, `已删回答 GET 应 404，实际 ${got.status}`);
  const { total } = await apiOk(
    "GET",
    `/questions/${question.id}/answers?sort=default&page=1&limit=10`
  );
  expect(total === beforeCount - 1, `列表 total ${total} != ${beforeCount - 1}`);
  expect(otherComment.id > 0, "sanity: 他人评论未创建");
});
