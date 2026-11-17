// Z021 — 关注流 /feed/following：
//   · 关注用户后其提问/回答出现在流中
//   · 关注话题后该话题下的问题出现在流中
//   · 关注的问题出现在流中
//   · 未登录返回 401（与 notifications/votes 等需登录接口一致）
//   · 测试账号作者的内容即使被关注也不进流；Z1079 起标题形态不再过滤关注流
//     （私域流仅按作者身份过滤），命中标题规则的真实作者提问应出现在流中
// 注意：进流与否只看作者身份；测试作者由 @test.dev 邮箱/is_test 标记识别。
import { ok, req, register, expect, main, uniq } from "./lib.mjs";

const hasQ = (feed, qid) =>
  (feed.items || []).some(
    (it) => it.id === qid || it.question_id === qid || (it.question && it.question.id === qid)
  );

// content-filter 会过滤 assert-*/test.dev 等测试账号，因此进流验证须用真实形态账号。
async function realRegister() {
  const nickname = `真人${uniq("n").replace(/-/g, "")}`.slice(0, 24);
  const email = `${uniq("real")}@zhihucopy.dev`;
  const reg = await req("POST", "/auth/register", {
    body: { email, password: "assert-pass-123", nickname },
  });
  expect(reg.status === 201, `register -> ${reg.status}`);
  return { token: reg.data.token, user: reg.data.user };
}

main("feed-following", async () => {
  // 未登录：401。
  const anon = await req("GET", "/feed/following?page=1");
  expect(anon.status === 401, `anonymous /feed/following -> ${anon.status} (want 401)`);

  const a = await realRegister();
  const b = await realRegister();
  const c = await realRegister();
  await ok("POST", `/users/${b.user.id}/follow`, { token: a.token });

  // 关注用户 → 其提问与回答进流。
  const { question } = await ok("POST", "/questions", { token: b.token, body: { title: `关注流链路回归 ${uniq("q").replace(/-/g, "")} 复盘？`, detail_md: "" } });
  await ok("POST", `/questions/${question.id}/answers`, { token: b.token, body: { content_md: "B 的回答" } });

  const feed = await ok("GET", "/feed/following?page=1", { token: a.token });
  expect(hasQ(feed, question.id), "B's question/answer not in A's following feed");
  expect("has_more" in feed, "no has_more in feed response");

  // 关注话题 → 该话题下的问题进流。
  const { items: topics } = await ok("GET", "/topics?limit=1");
  expect(Array.isArray(topics) && topics.length > 0, "no seeded topic to follow");
  await ok("POST", `/topics/${topics[0].id}/follow`, { token: a.token });
  const { question: tq } = await ok("POST", "/questions", {
    token: c.token,
    body: { title: `话题关注链路回归 ${uniq("q").replace(/-/g, "")} 复盘？`, topic_ids: [topics[0].id] },
  });
  const feedTopic = await ok("GET", "/feed/following?page=1", { token: a.token });
  expect(hasQ(feedTopic, tq.id), "followed-topic question not in A's feed");

  // 关注的问题 → 进流。
  const { question: fq } = await ok("POST", "/questions", { token: c.token, body: { title: `问题关注链路回归 ${uniq("q").replace(/-/g, "")} 复盘？` } });
  await ok("POST", `/questions/${fq.id}/follow`, { token: a.token });
  const feedQ = await ok("GET", "/feed/following?page=1", { token: a.token });
  expect(hasQ(feedQ, fq.id), "followed question not in A's feed");

  // Z1079：关注流不按标题形态过滤 —— 真实作者命中标题规则（[assert] 前缀）的
  // 提问仍应进流（公共出口才拦；由 following-title-allow.mjs 反向守卫）。
  const { question: spam } = await ok("POST", "/questions", { token: b.token, body: { title: `[assert] ${uniq("q")} — spam?` } });
  const feedSpam = await ok("GET", "/feed/following?page=1&limit=50", { token: a.token });
  expect(hasQ(feedSpam, spam.id), "real-author question wrongly title-filtered from following feed");

  // 测试账号作者的提问即使标题正常、被关注也不进流。
  const d = await register();
  await ok("POST", `/users/${d.user.id}/follow`, { token: a.token });
  const { question: tq2 } = await ok("POST", "/questions", {
    token: d.token,
    body: { title: `测试作者过滤场景 ${uniq("q").replace(/-/g, "")} 复盘？` },
  });
  const feedAuthor = await ok("GET", "/feed/following?page=1&limit=50", { token: a.token });
  expect(!hasQ(feedAuthor, tq2.id), "test-account author's question leaked into following feed");
});
