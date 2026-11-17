// Z1038 — 通知补 comment/agree 事件 + #answer- 锚点（浏览器级）。
// 契约：
//   B 评论 A 的回答 → A 未读 +1，最新通知 type='comment' 且 payload.anchor 含 '#answer-'；
//   A 打开 /notifications → 行文案含「评论」、href 含 '#answer-'，点击后 URL 带 hash
//     且 #answer-N 元素滚进视口（不许仍停在页面顶部）；
//   B 赞同 → A 未读 +1 且 type='agree'；重复赞同/取消再赞同不重复发（幂等）；
//   反对、自赞、自评不产生通知；回复二级评论时通知被回复的评论作者。
//   分页锚点：目标回答排在首屏 5 条之外时——提问者侧自动补页落到列表项
//     （li.answer#answer-N，高亮出现且 2.4s 内消失、无 box-shadow、scrollY>0），
//     作者侧（Z1155 起本人回答带「你的回答」置顶为 .answerlist 第一条）
//     落到 li.answer.answer--mine#answer-N。
//
// 环境：verify.sh 透传 API_BASE；e2e/lib.mjs 的 BASE/API 在模块加载时定型，
// 故先按 API_BASE 反推 E2E_BASE/E2E_API 再动态 import。
const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
if (!process.env.E2E_API) process.env.E2E_API = API_BASE;
if (!process.env.E2E_BASE) process.env.E2E_BASE = API_BASE.replace(/\/api$/, "");

const { run, expect, BASE, register, authedPage, apiOk, uniq } = await import("../e2e/lib.mjs");

const unreadOf = (token) =>
  apiOk("GET", "/notifications/unread-count", { token }).then((d) => d.count ?? -1);

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
      const detail = last instanceof Error ? `；last error: ${last.message}` : `；last: ${JSON.stringify(last)}`;
      throw new Error(`${label} — ${timeout}ms 内未满足${detail}`);
    }
    await new Promise((r) => setTimeout(r, step));
  }
}

run("notify-comment-anchor", async ({ browser }) => {
  const a = await register(uniq("A"));
  const b = await register(uniq("B"));

  // 长 detail 把首个回答压出首屏（900px 视口），让「是否滚进视口」可判定。
  const longDetail = Array.from(
    { length: 30 },
    (_, i) => `第 ${i + 1} 段：锚点验收需要足够长的正文把回答区压到首屏以下。`
  ).join("\n\n");
  const { question } = await apiOk("POST", "/questions", {
    token: a.token,
    body: { title: `[e2e] ${uniq("q")} — 通知锚点验证`, detail_md: longDetail },
  });
  const { answer } = await apiOk("POST", `/questions/${question.id}/answers`, {
    token: a.token,
    body: { content_md: "A 的回答正文，供锚点定位与高亮验证。" },
  });
  const aid = answer.id;

  // ---- 1. B 评论 A 的回答 → A 未读 +1，type=comment，anchor=#answer-<aid> ----
  const unread0 = await unreadOf(a.token);
  const { comment: bComment } = await apiOk("POST", "/comments", {
    token: b.token,
    body: { target_type: "answer", target_id: aid, body: `[e2e] ${uniq("c")} 评论一下` },
  });
  expect(
    (await unreadOf(a.token)) === unread0 + 1,
    `B 评论后 A 未读未 +1（${unread0} -> ${await unreadOf(a.token)}）`
  );
  let list = await apiOk("GET", "/notifications?limit=5", { token: a.token });
  let top = list.items && list.items[0];
  expect(top && top.type === "comment", `最新通知 type=${top && top.type}，期望 comment`);
  expect(top.actor && top.actor.id === b.user.id, "comment 通知的 actor 不是 B");
  expect(
    top.payload && top.payload.anchor === `#answer-${aid}`,
    `comment 通知 payload.anchor 缺失或不符：${JSON.stringify(top.payload)}`
  );

  // ---- 2. 浏览器：通知行文案含「评论」、href 带锚点，点击后 #answer-N 进视口 ----
  const page = await authedPage(browser, a.token);
  await page.goto(`${BASE}/notifications`);
  const row = page.locator(".ntf .ntf__item").filter({ hasText: "评论" }).first();
  await row.waitFor();
  const hit = row.locator("a.ntf__hit").first();
  const href = await hit.getAttribute("href");
  expect(href && href.includes(`#answer-${aid}`), `通知行 href 无锚点：${href}`);
  expect(href && href.includes(`/question/${question.id}`), `href 的 question id 与目标不符：${href}`);
  // 整行唯一链接是 .ntf__hit（position:absolute; inset:0 撑满整行），点击它即等价用户点击。
  await row.locator("a.ntf__hit").first().click();
  await page.waitForFunction((h) => window.location.hash === h, `#answer-${aid}`, { timeout: 10000 });
  const target = page.locator(`#answer-${aid}`);
  await target.waitFor({ state: "attached" });
  const vp = page.viewportSize() || { width: 1280, height: 900 };
  const box = await until(
    async () => {
      const b2 = await target.boundingBox();
      return b2 && b2.y < vp.height && b2.y + b2.height > 0 ? b2 : false;
    },
    { label: `#answer-${aid} 未滚入视口（仍停在页面顶部？）` }
  );
  expect(box.y < vp.height && box.y + box.height > 0, `#answer-${aid} 不在视口内`);

  // ---- 3. B 赞同 → A 未读 +1 且最新 type=agree；幂等不重复发 ----
  const u1 = await unreadOf(a.token); // 通知页已自动已读，预期归零
  await apiOk("POST", "/votes", {
    token: b.token,
    body: { target_type: "answer", target_id: aid, value: 1 },
  });
  expect((await unreadOf(a.token)) === u1 + 1, "B 赞同后 A 未读未 +1");
  list = await apiOk("GET", "/notifications?limit=5", { token: a.token });
  top = list.items[0];
  expect(top && top.type === "agree", `赞同后最新通知 type=${top && top.type}，期望 agree`);
  expect(top.payload && top.payload.anchor === `#answer-${aid}`, "agree 通知缺 anchor");

  // 幂等：重复赞同 / 取消再赞同 都不产生第二条 agree。
  await apiOk("POST", "/votes", { token: b.token, body: { target_type: "answer", target_id: aid, value: 1 } });
  await apiOk("POST", "/votes", { token: b.token, body: { target_type: "answer", target_id: aid, value: 0 } });
  await apiOk("POST", "/votes", { token: b.token, body: { target_type: "answer", target_id: aid, value: 1 } });
  const u2 = await unreadOf(a.token);
  expect(u2 === u1 + 1, `重复赞同产生了新通知（unread=${u2}，期望 ${u1 + 1}）`);
  list = await apiOk("GET", "/notifications?limit=20", { token: a.token });
  const agrees = list.items.filter((n) => n.type === "agree" && n.actor && n.actor.id === b.user.id);
  expect(agrees.length === 1, `agree 通知应唯一，实际 ${agrees.length} 条`);

  // 反对不产生通知。
  await apiOk("POST", "/votes", { token: b.token, body: { target_type: "answer", target_id: aid, value: -1 } });
  expect((await unreadOf(a.token)) === u2, `反对产生了通知（unread 变为 ${await unreadOf(a.token)}）`);

  // ---- 4. 自赞 / 自评不产生通知 ----
  await apiOk("POST", "/votes", { token: a.token, body: { target_type: "answer", target_id: aid, value: 1 } });
  await apiOk("POST", "/comments", {
    token: a.token,
    body: { target_type: "answer", target_id: aid, body: "自己补充一句，不应产生通知" },
  });
  expect((await unreadOf(a.token)) === u2, `自赞/自评产生了通知（unread 变为 ${await unreadOf(a.token)}）`);

  // ---- 5. 二级回复：A 回复 B 的评论 → B 收到 comment 通知（作者 A ≠ B）----
  const bUnread0 = await unreadOf(b.token);
  await apiOk("POST", "/comments", {
    token: a.token,
    body: { target_type: "answer", target_id: aid, parent_id: bComment.id, body: "回复你的评论" },
  });
  expect((await unreadOf(b.token)) === bUnread0 + 1, "回复 B 的评论后 B 未读未 +1");
  const bList = await apiOk("GET", "/notifications?limit=5", { token: b.token });
  const bTop = bList.items[0];
  expect(bTop && bTop.type === "comment" && bTop.actor && bTop.actor.id === a.user.id,
    `回复通知 type=${bTop && bTop.type} actor=${bTop && bTop.actor && bTop.actor.id}，期望 comment/A`);

  // ---- 6. 分页锚点：目标回答不在首屏 5 条时也必须落到可见位置 ----
  // 构造：新问题 + 6 条各 1 赞的回答 + B2 的 0 赞回答（默认序第 7 → 不在首屏）。
  //   提问者 A2 的 answer 通知 → 路径 A：自动补页后落到列表项 li.answer#answer-N；
  //   作者 B2 的 comment 通知 → 路径 B：落到「你的回答」固定条（兜底 id）。
  const a2 = await register(uniq("A2"));
  const b2 = await register(uniq("B2"));
  const filler = await register(uniq("F"));
  const voter2 = await register(uniq("V2"));
  const commenter = await register(uniq("M"));

  const { question: q2 } = await apiOk("POST", "/questions", {
    token: a2.token,
    body: { title: `[e2e] ${uniq("q")} — 分页锚点验证`, detail_md: longDetail },
  });
  for (let i = 0; i < 6; i++) {
    const r = await apiOk("POST", `/questions/${q2.id}/answers`, {
      token: filler.token,
      body: { content_md: `[e2e] filler ${i + 1} — 占住首屏高赞位` },
    });
    await apiOk("POST", "/votes", {
      token: voter2.token,
      body: { target_type: "answer", target_id: r.answer.id, value: 1 },
    });
  }
  const { answer: backAns } = await apiOk("POST", `/questions/${q2.id}/answers`, {
    token: b2.token,
    body: { content_md: `[e2e] ${uniq("b2")} — 0 赞排在后页的本人回答` },
  });
  await apiOk("POST", "/comments", {
    token: commenter.token,
    body: { target_type: "answer", target_id: backAns.id, body: "后页回答的评论" },
  });

  // 预埋校验：匿名 detail 首屏 5 条且不含 backAns（默认序第 7），否则用例无效。
  const det2 = await apiOk("GET", `/questions/${q2.id}`);
  expect(
    det2.answers.length === 5 && !det2.answers.some((x) => x.id === backAns.id),
    `预埋失败：目标回答仍在首屏（ids=${det2.answers.map((x) => x.id).join(",")}）`
  );

  // -- 路径 A（第 2 页 → 补页落列表项）：A2 最新 answer 通知指向 backAns --
  const pageA = await authedPage(browser, a2.token);
  await pageA.goto(`${BASE}/notifications`);
  const rowA = pageA
    .locator(".ntf .ntf__item")
    .filter({ hasText: "回答了你的问题" })
    .first();
  await rowA.waitFor();
  const hrefA = await rowA.locator("a.ntf__hit").first().getAttribute("href");
  expect(hrefA && hrefA.includes(`/question/${q2.id}`), `href 的 question id 与目标不符：${hrefA}`);
  expect(hrefA && hrefA.endsWith(`#answer-${backAns.id}`), `href 锚点不符：${hrefA}`);
  await rowA.locator("a.ntf__hit").first().click();
  await pageA.waitForFunction((h) => window.location.hash === h, `#answer-${backAns.id}`, { timeout: 10000 });
  const liA = pageA.locator(`li.answer#answer-${backAns.id}`);
  // 高亮 class 出现（补页落地瞬间挂上，2s 后淡出——先查出现在再查消失）。
  await pageA.waitForSelector(`li.answer#answer-${backAns.id}.answer--anchor`, { timeout: 6000 });
  const shadow = await liA.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(shadow === "none" || !shadow, `锚点高亮带 box-shadow：${shadow}`);
  await until(
    async () => {
      const bx = await liA.boundingBox().catch(() => null);
      return bx && bx.y < vp.height && bx.y + bx.height > 0 ? bx : false;
    },
    { label: `分页目标 li.answer#answer-${backAns.id} 未滚入视口（补页未生效？）` }
  );
  const scrollYA = await pageA.evaluate(() => window.scrollY);
  expect(scrollYA > 0, `补页落地后 scrollY=${scrollYA}，仍停在顶部`);
  // 高亮 2.4s 内消失
  await pageA.waitForSelector(`li.answer#answer-${backAns.id}:not(.answer--anchor)`, { timeout: 2400 });

  // -- 路径 B（本人回答置顶卡）：B2 的 comment 通知指向自己的 backAns --
  // Z1155 起本人回答带「你的回答」置顶为 .answerlist 第一条，锚点直接落该卡。
  const pageB = await authedPage(browser, b2.token);
  await pageB.goto(`${BASE}/notifications`);
  const rowB = pageB
    .locator(".ntf .ntf__item")
    .filter({ hasText: "评论了你的回答" })
    .first();
  await rowB.waitFor();
  const hrefB = await rowB.locator("a.ntf__hit").first().getAttribute("href");
  expect(hrefB && hrefB.endsWith(`#answer-${backAns.id}`), `B2 通知 href 锚点不符：${hrefB}`);
  await rowB.locator("a.ntf__hit").first().click();
  await pageB.waitForFunction((h) => window.location.hash === h, `#answer-${backAns.id}`, { timeout: 10000 });
  const mineItem = pageB.locator(`li.answer.answer--mine#answer-${backAns.id}`);
  await mineItem.waitFor({ state: "attached" });
  await until(
    async () => {
      const bx = await mineItem.boundingBox().catch(() => null);
      return bx && bx.y < vp.height && bx.y + bx.height > 0 ? bx : false;
    },
    { label: `置顶卡 #answer-${backAns.id} 未滚入视口` }
  );
  const scrollYB = await pageB.evaluate(() => window.scrollY);
  expect(scrollYB > 0, `置顶卡落地后 scrollY=${scrollYB}，仍停在顶部`);
});
