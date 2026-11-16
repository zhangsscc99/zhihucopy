// Z985 — 个人页统计口径与列表接口一致：
//   GET /users/:id 的 stats.questions === GET /questions?author=:id 的 total
//   GET /users/:id 的 stats.answers  === GET /answers?author=:id 的 total
// 覆盖：真实用户（列表里已有内容的作者）+ 自建「正常 + 测试标记」混合内容的用户
//   + 测试账号（其内容整体被过滤，两侧应同为 0）。
// 跑法: API_BASE=http://127.0.0.1:3145/zhihucopy/api node scripts/assert/stats-consistency.mjs
// 清理：设 DB_PATH 时脚本在结尾物理删除自建数据；未设则跳过（测试标题内容已被过滤，
// 可由 scripts/cleanup-test-content.js 兜底）。
import { createRequire } from "node:module";
import path from "node:path";
import { ok, req, expect, main, uniq } from "./lib.mjs";

const requireFromServer = createRequire(
  new URL("../../server/package.json", import.meta.url)
);
const { isTestTitle, isTestNickname, isTestEmail } = requireFromServer(
  "./content-filter.js"
);

const created = { userIds: [], questionIds: [], answerIds: [] };

// 自建「真实」用户：不用 lib.register（@test.dev 邮箱会被判为测试账号）。
// 昵称/邮箱/标题都先过一遍 content-filter 的 JS 判定，保证不命中测试模式。
async function registerReal() {
  const stamp = Date.now().toString(36);
  const nickname = `z985user${stamp}`;
  const email = `z985.${stamp}@example.com`;
  expect(!isTestNickname(nickname), `nickname ${nickname} 命中测试模式`);
  expect(!isTestEmail(email), `email ${email} 命中测试域`);
  const r = await req("POST", "/auth/register", {
    body: { email, password: "assert-pass-123", nickname },
  });
  expect(r.status === 201, `register real user -> ${r.status} ${JSON.stringify(r.data)}`);
  created.userIds.push(r.data.user.id);
  return { token: r.data.token, user: r.data.user };
}

async function checkUser(userId, label) {
  const { stats } = await ok("GET", `/users/${userId}`);
  const qs = await ok("GET", `/questions?author=${userId}&limit=100`);
  const as = await ok("GET", `/answers?author=${userId}&limit=100`);
  expect(
    stats.questions === qs.total,
    `${label}: stats.questions=${stats.questions} != /questions?author total=${qs.total}`
  );
  expect(
    stats.answers === as.total,
    `${label}: stats.answers=${stats.answers} != /answers?author total=${as.total}`
  );
  console.log(
    `  ${label} (id=${userId}): questions=${stats.questions}, answers=${stats.answers} — 一致`
  );
  return stats;
}

function cleanup() {
  const dbPath = process.env.DB_PATH;
  if (!dbPath) {
    console.log(
      "  note: 未设 DB_PATH，跳过物理清理（测试标题内容已被过滤，可用 cleanup-test-content.js 清除）"
    );
    return;
  }
  const Database = requireFromServer("better-sqlite3");
  const db = new Database(path.resolve(dbPath));
  try {
    db.transaction(() => {
      for (const id of created.answerIds)
        db.prepare("DELETE FROM answers WHERE id = ?").run(id);
      for (const id of created.questionIds) {
        db.prepare("DELETE FROM question_topics WHERE question_id = ?").run(id);
        db.prepare("DELETE FROM answers WHERE question_id = ?").run(id);
        db.prepare("DELETE FROM questions WHERE id = ?").run(id);
      }
      for (const id of created.userIds) {
        db.prepare("DELETE FROM notifications WHERE user_id = ? OR actor_id = ?").run(id, id);
        db.prepare("DELETE FROM follows WHERE follower_id = ?").run(id);
        db.prepare("DELETE FROM user_badges WHERE user_id = ?").run(id);
        db.prepare("DELETE FROM users WHERE id = ?").run(id);
      }
    })();
    console.log("  cleanup: 已删除自建用户/问题/回答");
  } finally {
    db.close();
  }
}

main("stats-consistency", async () => {
  try {
    // 1) 真实用户：公共列表过滤后的第一位问题作者（保证非测试账号且有内容）。
    const pub = await ok("GET", "/questions?limit=1");
    expect(pub.items.length > 0, "公共列表为空，找不到真实用户");
    const realId = pub.items[0].author.id;
    const realStats = await checkUser(realId, "real-user");
    expect(realStats.questions >= 1, "真实用户应至少有 1 条可见问题");

    // 2) 真实用户发「正常 + 测试标记」混合内容：过滤后两侧仍相等。
    const { token, user } = await registerReal();
    const normalTitle = `Z985 口径一致性问题 ${Date.now()}`;
    const testTitle = `assert-z985-${Date.now()} 应被过滤的测试问题`;
    expect(!isTestTitle(normalTitle), `标题「${normalTitle}」命中测试模式`);
    expect(isTestTitle(testTitle), `标题「${testTitle}」未命中测试模式`);

    const q1 = await ok("POST", "/questions", {
      token,
      body: { title: normalTitle, detail_md: "正常内容" },
    });
    created.questionIds.push(q1.question.id);
    const q2 = await ok("POST", "/questions", {
      token,
      body: { title: testTitle, detail_md: "测试内容" },
    });
    created.questionIds.push(q2.question.id);
    const a1 = await ok("POST", `/questions/${q1.question.id}/answers`, {
      token,
      body: { content_md: "z985 正常回答" },
    });
    created.answerIds.push(a1.answer.id);
    // 测试标题问题下的回答：问题被过滤 → 这条回答也不计入口径。
    const a2 = await ok("POST", `/questions/${q2.question.id}/answers`, {
      token,
      body: { content_md: "z985 测试问题下的回答" },
    });
    created.answerIds.push(a2.answer.id);

    const s = await checkUser(user.id, "mixed-user");
    expect(s.questions === 1, `mixed-user 期望 questions=1（测试标题被过滤），实际 ${s.questions}`);
    expect(s.answers === 1, `mixed-user 期望 answers=1（测试问题下回答被过滤），实际 ${s.answers}`);

    // 3) 测试账号（assert- 昵称）：内容整体被过滤，个人页计数与列表同为 0。
    const tnick = `assert-${uniq("u")}`;
    const tr = await req("POST", "/auth/register", {
      body: { email: `${uniq("assert")}@test.dev`, password: "assert-pass-123", nickname: tnick },
    });
    expect(tr.status === 201, `register test user -> ${tr.status}`);
    created.userIds.push(tr.data.user.id);
    const tq = await ok("POST", "/questions", {
      token: tr.data.token,
      body: { title: `Z985 普通标题但作者是测试账号 ${Date.now()}`, detail_md: "x" },
    });
    created.questionIds.push(tq.question.id);
    const ts = await checkUser(tr.data.user.id, "test-account");
    expect(ts.questions === 0, `test-account 期望 questions=0，实际 ${ts.questions}`);

    // 4) 参数校验：author 非法时 400。
    const bad = await req("GET", "/questions?author=abc");
    expect(bad.status === 400, `/questions?author=abc -> ${bad.status}`);
    const badA = await req("GET", "/answers?author=abc");
    expect(badA.status === 400, `/answers?author=abc -> ${badA.status}`);
  } finally {
    cleanup();
  }
});
