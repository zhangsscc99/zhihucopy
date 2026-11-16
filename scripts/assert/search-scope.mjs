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
import { ok, req, expect, main, uniq, login } from "./lib.mjs";

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

// Z1050 自清：本 run 注册的「真实可见」账号不被 testUserSql 过滤，/cleanup 的
// u: 口径删不掉 → 运行结束必须走 purge-residue（admin 白名单硬删）清掉自己，
// 否则「用户」tab 搜 z1044user 残留越积越多。
const ADMIN_EMAIL = "admin@zhihucopy.dev"; // 种子管理员（scripts/seed.js）
const ADMIN_PASSWORD = "zhihu123456";

// 降级通道：拿不到 admin 时直连 DB_PATH，只按本 run 的 user.id 删
// （显式 id 进删除集后走共享级联机械；绝不 LIKE 批量）。
function dbPurgeUserById(userId) {
  const dbPath = process.env.DB_PATH;
  if (!dbPath) return false;
  const Database = requireFromServer("better-sqlite3");
  const {
    initDelTables,
    cascadeFromDelUsers,
    deleteMarked,
    recomputeDerived,
  } = requireFromServer("./artifact-cleanup.js");
  let db;
  try {
    db = new Database(dbPath);
    db.pragma("foreign_keys = ON");
    let detail;
    db.transaction(() => {
      initDelTables(db);
      db.prepare("INSERT OR IGNORE INTO _del_u (id) VALUES (?)").run(userId);
      cascadeFromDelUsers(db);
      detail = deleteMarked(db);
      recomputeDerived(db);
    })();
    if (!detail || (detail.u || 0) < 1) {
      console.error(
        `[self-clean] DB 级自清 u:${userId} 删除 0 行（detail=${JSON.stringify(detail)}），视为失败`
      );
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[self-clean] DB 级自清失败 u:${userId}: ${e.message || e}`);
    return false;
  } finally {
    if (db) db.close();
  }
}

async function purgeResidueSelf(userId, nickname) {
  // 首选 API 通道：admin 登录 → POST /test-support/purge-residue
  // （白名单硬删，连带本 run 的题/答与历史残留号一起清）。
  try {
    const lr = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    if (lr.status === 200 && lr.data.token) {
      // only_nicknames 只清本 run 账号：并行 lane 的同名前缀账号不被误删，
      // 也不会在别人的断言途中制造假红（端点仍按白名单正则逐个复核）。
      const pr = await req("POST", "/test-support/purge-residue", {
        token: lr.data.token,
        body: { only_nicknames: [nickname] },
      });
      if (pr.status === 200 && pr.data.ok) {
        const purged = pr.data.purged_nicknames || [];
        const du = pr.data.deleted?.u ?? 0;
        console.log(
          `[self-clean] purge-residue OK: deleted.u=${du} ` +
            `purged=${JSON.stringify(purged)}`
        );
        // 不能只信 ok：白名单漂移时 200+ok 但本 run 账号没进删除集 = 静默残留。
        expect(
          Array.isArray(pr.data.purged_nicknames) && purged.includes(nickname),
          `purge-residue 未清掉本 run 账号 ${nickname}：purged_nicknames=${JSON.stringify(pr.data.purged_nicknames)}`
        );
        expect(du >= 1, `purge-residue deleted.u 应 >= 1，实际 ${du}`);
        return true;
      }
      console.warn(
        `[self-clean] purge-residue -> ${pr.status} ${JSON.stringify(pr.data).slice(0, 160)}，转 DB 级自清`
      );
    } else {
      console.warn(`[self-clean] admin 登录 -> ${lr.status}，转 DB 级自清`);
    }
  } catch (e) {
    console.warn(`[self-clean] API purge 异常: ${e.message || e}，转 DB 级自清`);
  }
  if (dbPurgeUserById(userId)) {
    console.log(`[self-clean] DB 级自清完成 u:${userId} (${nickname})`);
    return true;
  }
  console.error(
    "[self-clean] FAIL: 无 admin purge 通道且无 DB_PATH 写权限，残留账号未清"
  );
  return false;
}

main("search-scope", async () => {
  let cleaned = false;
  let user = null;
  let nickname = null;
  try {
  // 注册放进 try：若服务端已落库但客户端中途抛错，finally 仍能拿到
  // user/nickname 走自清，不会在库外留下无主的残留账号。
  const reg = await registerReal();
  const token = reg.token;
  user = reg.user;
  nickname = reg.nickname;

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
  } finally {
    if (user) {
      cleaned = await purgeResidueSelf(user.id, nickname).catch((e) => {
        console.error(`[self-clean] 异常: ${e.message || e}`);
        return false;
      });
    }
  }
  // 断言本身失败后也要先自清再向上抛；只有断言全过时才走到这里复核自清结果。
  if (user) {
    expect(cleaned, "Z1050 自清失败：admin purge 与 DB 降级均不可用，残留账号未清");
  }
});
