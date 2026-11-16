// Z1044 — /search 分类 scope：type=answer 命中回答正文、type=user 命中昵称/bio，
// 且 scope 真的分流（回答关键词不会落到问题 scope 兜底）。
//
// 动态断言：
//   1. 真实账号（@example.com 保留可见域，非 is_test）发 1 题 + 1 条含唯一随机串 kw 的回答：
//      GET /search?q=<kw>&type=answer 命中该回答且 question_id 正确；
//      同 query type=question（默认）items 不含该问题（证明分流而非兜底）。
//   2. GET /search?q=<昵称片段>&type=user 命中该用户；同 query type=answer 不命中回答。
//   3. counts 三 scope 都是数字；默认（question）响应仍含 items/total/page/limit。
//   4. ?q=？ 仍 reason="too_short"、total=0（Z1028 回归）。
//   5. 未知 type 保守返回空页而非 500。
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ok, req, expect, main, uniq } from "./lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const requireFromServer = createRequire(join(root, "server", "package.json"));
const { isTestTitle, isTestNickname, isTestEmail } = requireFromServer(
  "./content-filter.js"
);

// 自建「真实」用户：@test.dev / assert-* 会被 testUserSql/testQuestionSql 过滤，
// 这里用 example.com 保留域 + 不命中测试模式的昵称，保证内容可见于搜索。
async function registerReal() {
  const stamp = Date.now().toString(36);
  const nickname = `z1044user${stamp}`;
  const email = `z1044.${stamp}@example.com`;
  expect(!isTestNickname(nickname), `nickname ${nickname} 命中测试模式`);
  expect(!isTestEmail(email), `email ${email} 命中测试域`);
  const r = await req("POST", "/auth/register", {
    body: { email, password: "assert-pass-123", nickname },
  });
  expect(r.status === 201, `register real user -> ${r.status} ${JSON.stringify(r.data)}`);
  return { token: r.data.token, user: r.data.user, nickname };
}

main("search-scope", async () => {
  const { token, user, nickname } = await registerReal();

  // 1) 问题 + 含唯一随机串的回答（标题不带 kw，保证问题 scope 不命中）。
  const title = "代码质量保障有哪些值得借鉴的实践？";
  expect(!isTestTitle(title), `标题「${title}」命中测试模式`);
  const kw = `kw${Date.now().toString(36)}x`;
  const qr = await ok("POST", "/questions", {
    token,
    body: { title, detail_md: "想听听大家在评审、测试、重构上的经验。" },
  });
  const questionId = qr.question.id;
  const ar = await ok("POST", `/questions/${questionId}/answers`, {
    token,
    body: { content_md: `我的观点：代码质量的核心在于评审与测试，${kw} 只是标记串。` },
  });
  const answerId = ar.answer.id;

  // 2) type=answer 命中该回答，question_id 正确。
  const aRes = await ok("GET", `/search?q=${kw}&type=answer`);
  const aHit = (aRes.items || []).find((it) => it.id === answerId);
  expect(aHit, `type=answer 未命中回答 a:${answerId}（items=${JSON.stringify(aRes.items).slice(0, 200)}）`);
  expect(aHit.question_id === questionId, `回答命中但 question_id=${aHit.question_id}，期望 ${questionId}`);
  expect(aHit.question_title === title, `question_title 不符：${aHit.question_title}`);
  expect(aHit.author && aHit.author.id === user.id, "回答项缺少正确 author");
  expect(typeof aHit.vote_up === "number", "回答项缺少 vote_up");
  expect(typeof aHit.snippet === "string" && aHit.snippet.length > 0, "回答项缺少 snippet");

  // 3) 同 query 默认问题 scope 不命中该问题（scope 真的分流，不是详情兜底）。
  const qRes = await ok("GET", `/search?q=${kw}`);
  expect(!(qRes.items || []).some((it) => it.id === questionId),
    `type=question 不应命中 q:${questionId}（标题不含 kw）`);

  // 4) type=user 命中该用户；同 query type=answer 不命中回答。
  const nickFrag = nickname.slice(4); // 避开可能命中测试前缀判定的开头
  const uRes = await ok("GET", `/search?q=${encodeURIComponent(nickFrag)}&type=user`);
  const uHit = (uRes.items || []).find((it) => it.id === user.id);
  expect(uHit, `type=user 未命中用户 u:${user.id}（query=${nickFrag}）`);
  expect(typeof uHit.answer_count === "number" && typeof uHit.follower_count === "number",
    "用户项缺少 answer_count/follower_count");
  const aRes2 = await ok("GET", `/search?q=${encodeURIComponent(nickFrag)}&type=answer`);
  expect(!(aRes2.items || []).some((it) => it.id === answerId),
    `type=answer 不应命中 a:${answerId}（正文不含昵称片段）`);

  // 5) counts 三 scope 都是数字；默认响应结构含 items/total/page/limit。
  for (const res of [aRes, uRes, qRes]) {
    for (const k of ["question", "answer", "user"]) {
      expect(typeof res.counts?.[k] === "number", `counts.${k} 不是数字：${JSON.stringify(res.counts)}`);
    }
  }
  expect(Array.isArray(qRes.items) && typeof qRes.total === "number"
    && typeof qRes.page === "number" && typeof qRes.limit === "number",
    `默认响应缺 items/total/page/limit：${Object.keys(qRes).join(",")}`);
  expect(aRes.counts.answer >= 1 && uRes.counts.user >= 1, "counts 未覆盖本 run 的命中");

  // 6) Z1028 回归：标点串仍 too_short，且三种 type 一致生效。
  for (const t of ["", "&type=answer", "&type=user"]) {
    const res = await ok("GET", `/search?q=${encodeURIComponent("？")}${t}`);
    expect(res.reason === "too_short" && res.total === 0,
      `q=？${t} 应 reason=too_short/total=0，实际 ${JSON.stringify(res)}`);
  }

  // 7) 未知 type 保守空页，不 500。
  const unk = await ok("GET", `/search?q=${encodeURIComponent("代码")}&type=bogus`);
  expect((unk.items || []).length === 0 && unk.total === 0,
    `未知 type 应返回空页，实际 total=${unk.total}`);
  expect(unk.counts && typeof unk.counts.question === "number", "未知 type 也应返回 counts");

  console.log(
    `  ids: user=${user.id} question=${questionId} answer=${answerId} kw=${kw} ` +
      `counts(q/a/u)=${aRes.counts.question}/${aRes.counts.answer}/${aRes.counts.user}`
  );
});
