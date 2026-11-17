// Z1079 — /feed/following 过滤口径回归修复：私域流只按作者身份过滤，不按标题形态。
//   · 真实作者命中标题规则（「…回归 <小写随机串> 复盘？」形态）的提问出现在关注流
//     —— Z1078 的标题规则曾把 feed-following 链路提问整个吞掉（本断言基线必 FAIL）
//   · 反向守卫：同一提问不得出现在 /feed/recommended、/feed/hot、/questions?limit=50
//     —— 公共出口仍是标题+作者双滤，Z1078 的残留拦截不能退化
//   · @test.dev 测试号作者即使被关注、标题正常，其提问也不进关注流（作者过滤仍生效）
// 产物清理：全部经 lib.mjs req() 跟踪，退出时 cleanup-artifacts 自动删除。
import { createRequire } from "node:module";
import { ok, req, register, expect, main, uniq } from "./lib.mjs";

const require = createRequire(import.meta.url);
const { isTestTitle } = require("../../server/content-filter.js");

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

main("following-title-allow", async () => {
  const a = await realRegister();
  const b = await realRegister();
  await ok("POST", `/users/${b.user.id}/follow`, { token: a.token });

  // 核心：B 发一条命中 content-filter 标题规则的提问（「…回归 <token> 复盘？」，
  // token 直接跟在「回归」后 → 命中 /回归[ 　]*[a-z]…{7,}/ 规则）。
  const tok = uniq("q").replace(/-/g, "");
  const title = `回归测试该由谁负责 回归${tok} 复盘？`;
  expect(isTestTitle(title), `title should hit content-filter title rules: ${title}`);
  const { question } = await ok("POST", "/questions", {
    token: b.token,
    body: { title, detail_md: "" },
  });

  // 1) 私域流不按标题形态过滤 → 出现在 A 的关注流。
  const feed = await ok("GET", "/feed/following?page=1&limit=50", { token: a.token });
  expect(hasQ(feed, question.id), "title-flagged real question missing from following feed");
  expect("has_more" in feed, "no has_more in feed response");

  // 2) 公共出口反向守卫：同一问题不得出现在 recommended / hot / questions。
  const rec = await ok("GET", "/feed/recommended?page=1&limit=50");
  expect(!hasQ(rec, question.id), "title-flagged question leaked into /feed/recommended");
  const hot = await ok("GET", "/feed/hot");
  expect(!hasQ(hot, question.id), "title-flagged question leaked into /feed/hot");
  const list = await ok("GET", "/questions?page=1&limit=50");
  expect(!hasQ(list, question.id), "title-flagged question leaked into /questions list");

  // 3) 测试号作者仍被关注流按作者身份过滤。
  const d = await register(); // @test.dev / assert-* 形态
  await ok("POST", `/users/${d.user.id}/follow`, { token: a.token });
  const { question: tq } = await ok("POST", "/questions", {
    token: d.token,
    body: { title: `测试作者的正常标题提问 ${uniq("q").replace(/-/g, "")}？` },
  });
  const feed2 = await ok("GET", "/feed/following?page=1&limit=50", { token: a.token });
  expect(!hasQ(feed2, tq.id), "test-account author's question leaked into following feed");
});
