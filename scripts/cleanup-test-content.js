#!/usr/bin/env node
// scripts/cleanup-test-content.js — 物理删除自动化测试产物。
//
// 判定口径与运行时过滤完全一致（server/content-filter.js）：
//   - 问题：标题或作者命中测试模式（搜索验收-*/[assert] */巡检*/assert-* 账号等）
//   - 用户：昵称或邮箱域命中测试模式（assert-*、-mw 标记、@test.dev 等）
//     且清理完问题后已无任何剩余内容（questions/answers/comments 均为 0）
//
// 用法:
//   node scripts/cleanup-test-content.js           # dry-run：只统计、打印样例，不写库
//   node scripts/cleanup-test-content.js --apply   # 单事务真删
//
// 环境: DB_PATH（默认 ../data/zhihu.db，相对本脚本所在目录解析）。

const path = require("path");
// better-sqlite3 装在 server/node_modules（root node_modules 是软链且无此包）。
const Database = require(require.resolve("better-sqlite3", {
  paths: [path.join(__dirname, "..", "server")],
}));
const {
  questionMatchSql,
  userMatchSql,
  isTestTitle,
  isTestNickname,
  isTestEmail,
} = require("../server/content-filter");

const APPLY = process.argv.includes("--apply");
const DB_PATH = path.resolve(
  process.env.DB_PATH || path.join(__dirname, "..", "data", "zhihu.db")
);

const db = new Database(DB_PATH, APPLY ? {} : { readonly: true });
db.pragma("foreign_keys = ON");

// Z983：users.is_test 由 004 迁移加入 —— 未迁移的库降级为纯形态规则。
const HAS_IS_TEST = db.prepare("PRAGMA table_info(users)").all().some((c) => c.name === "is_test");
const OPTS = { isTest: HAS_IS_TEST };

// 待删对象进 TEMP 表，后续各依赖表统一 IN (SELECT id FROM ...) 子查询。
// - _del_q: 测试问题；- _del_a: 这些问题下的回答；- _del_u: 可删的测试账号。
const DDL = `
  CREATE TEMP TABLE _del_q (id INTEGER PRIMARY KEY);
  CREATE TEMP TABLE _del_a (id INTEGER PRIMARY KEY);
  CREATE TEMP TABLE _del_u (id INTEGER PRIMARY KEY);
  CREATE TEMP TABLE _del_a2 (id INTEGER PRIMARY KEY);
`;

function fillTargets() {
  db.prepare(
    `INSERT INTO _del_q
     SELECT q.id FROM questions q JOIN users u ON u.id = q.author_id
     WHERE ${questionMatchSql("q", "u", OPTS)}`
  ).run();
  db.prepare(
    `INSERT INTO _del_a SELECT a.id FROM answers a
     WHERE a.question_id IN (SELECT id FROM _del_q)`
  ).run();
  // 用户：命中测试模式且「清理后」无任何剩余内容 —— 即扣掉待删集（_del_q/_del_a）
  // 之后不再有 questions/answers/comments 的账号才删。
  db.prepare(
    `INSERT INTO _del_u SELECT u.id FROM users u
     WHERE ${userMatchSql("u", OPTS)}
       AND NOT EXISTS (SELECT 1 FROM questions q WHERE q.author_id = u.id
                        AND q.id NOT IN (SELECT id FROM _del_q))
       AND NOT EXISTS (SELECT 1 FROM answers a WHERE a.author_id = u.id
                        AND a.id NOT IN (SELECT id FROM _del_a))
       AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.author_id = u.id
                        AND NOT ((c.target_type = 'question' AND c.target_id IN (SELECT id FROM _del_q))
                              OR (c.target_type = 'answer' AND c.target_id IN (SELECT id FROM _del_a))))`
  ).run();
  // 安全网：门槛保证 _del_u 用户无回答，但万一有（并发写入），连同其依赖一起删。
  db.prepare(
    `INSERT INTO _del_a2 SELECT a.id FROM answers a
     WHERE a.author_id IN (SELECT id FROM _del_u)`
  ).run();
}

// 依赖行删除：answers 树（_del_a 与 _del_a2 两个来源）+ questions 树。
const ANSWER_DEPS = [
  ["comments", `DELETE FROM comments WHERE target_type = 'answer' AND target_id IN %s`],
  ["answer_revisions", `DELETE FROM answer_revisions WHERE answer_id IN %s`],
  ["votes", `DELETE FROM votes WHERE answer_id IN %s`],
  ["collection_items", `DELETE FROM collection_items WHERE answer_id IN %s`],
  ["notifications", `DELETE FROM notifications WHERE target_type = 'answer' AND target_id IN %s`],
  ["reports", `DELETE FROM reports WHERE target_type = 'answer' AND target_id IN %s`],
];

const QUESTION_DEPS = [
  ["comments", `DELETE FROM comments WHERE target_type = 'question' AND target_id IN (SELECT id FROM _del_q)`],
  ["question_votes", `DELETE FROM question_votes WHERE question_id IN (SELECT id FROM _del_q)`],
  ["follows", `DELETE FROM follows WHERE target_type = 'question' AND target_id IN (SELECT id FROM _del_q)`],
  ["notifications", `DELETE FROM notifications WHERE target_type = 'question' AND target_id IN (SELECT id FROM _del_q)`],
  ["reports", `DELETE FROM reports WHERE target_type = 'question' AND target_id IN (SELECT id FROM _del_q)`],
  ["question_topics", `DELETE FROM question_topics WHERE question_id IN (SELECT id FROM _del_q)`],
];

// 测试账号自身挂的行（answers/comments 门槛已保证为 0，这里兜底；其余是 FK 必删项）。
const USER_DEPS = [
  ["notifications", `DELETE FROM notifications WHERE user_id IN (SELECT id FROM _del_u) OR actor_id IN (SELECT id FROM _del_u)`],
  ["follows", `DELETE FROM follows WHERE follower_id IN (SELECT id FROM _del_u) OR (target_type = 'user' AND target_id IN (SELECT id FROM _del_u))`],
  ["votes", `DELETE FROM votes WHERE user_id IN (SELECT id FROM _del_u)`],
  ["question_votes", `DELETE FROM question_votes WHERE user_id IN (SELECT id FROM _del_u)`],
  ["comments", `DELETE FROM comments WHERE author_id IN (SELECT id FROM _del_u)`],
  ["badges", `DELETE FROM badges WHERE user_id IN (SELECT id FROM _del_u)`],
  ["reports(reporter)", `DELETE FROM reports WHERE reporter_id IN (SELECT id FROM _del_u)`],
  ["reports(handled_by)", `UPDATE reports SET handled_by = NULL WHERE handled_by IN (SELECT id FROM _del_u)`],
  ["mod_logs", `DELETE FROM mod_logs WHERE admin_id IN (SELECT id FROM _del_u)`],
  ["collection_items", `DELETE FROM collection_items WHERE collection_id IN (SELECT id FROM collections WHERE owner_id IN (SELECT id FROM _del_u))`],
  ["collections", `DELETE FROM collections WHERE owner_id IN (SELECT id FROM _del_u)`],
];

const count = (sql) => db.prepare(sql).get().c;

function sampleTitles() {
  return db
    .prepare("SELECT title FROM questions WHERE id IN (SELECT id FROM _del_q) ORDER BY id DESC LIMIT 10")
    .all()
    .map((r) => r.title);
}

// 删除后回填反范式计数（votes/follows 行没了，计数字段要同步）。
const RECOMPUTE = [
  `UPDATE answers SET
     vote_up = (SELECT COUNT(*) FROM votes v WHERE v.answer_id = answers.id AND v.value = 1),
     vote_down = (SELECT COUNT(*) FROM votes v WHERE v.answer_id = answers.id AND v.value = -1),
     comment_count = (SELECT COUNT(*) FROM comments c WHERE c.target_type = 'answer' AND c.target_id = answers.id AND c.is_deleted = 0)`,
  `UPDATE questions SET
     answer_count = (SELECT COUNT(*) FROM answers a WHERE a.question_id = questions.id AND a.is_deleted = 0),
     follower_count = (SELECT COUNT(*) FROM follows f WHERE f.target_type = 'question' AND f.target_id = questions.id),
     vote_up = (SELECT COUNT(*) FROM question_votes v WHERE v.question_id = questions.id AND v.value = 1),
     vote_down = (SELECT COUNT(*) FROM question_votes v WHERE v.question_id = questions.id AND v.value = -1)`,
  `UPDATE topics SET
     follower_count = (SELECT COUNT(*) FROM follows f WHERE f.target_type = 'topic' AND f.target_id = topics.id)`,
];

function run() {
  db.exec(DDL);

  if (!APPLY) {
    // ---- dry-run ----
    db.transaction(fillTargets)();
    const nQ = count("SELECT COUNT(*) c FROM _del_q");
    const nA = count("SELECT COUNT(*) c FROM _del_a");
    const nC = count(`SELECT COUNT(*) c FROM comments WHERE
      (target_type='question' AND target_id IN (SELECT id FROM _del_q)) OR
      (target_type='answer' AND target_id IN (SELECT id FROM _del_a))`);
    const nV =
      count("SELECT COUNT(*) c FROM votes WHERE answer_id IN (SELECT id FROM _del_a)") +
      count("SELECT COUNT(*) c FROM question_votes WHERE question_id IN (SELECT id FROM _del_q)");
    const nU = count("SELECT COUNT(*) c FROM _del_u");
    const nQall = count("SELECT COUNT(*) c FROM questions");
    const nUall = count("SELECT COUNT(*) c FROM users");
    const skipped = count(
      `SELECT COUNT(*) c FROM users u WHERE ${userMatchSql("u", OPTS)} AND u.id NOT IN (SELECT id FROM _del_u)`
    );
    // 残留提示：测试账号挂在「真实问题」下的回答/评论不在删除范围内（spec 只删
    // 测试对象及其依赖 + 无内容账号），它们会让对应账号被判定为「仍有内容」。
    const residA = count(
      `SELECT COUNT(*) c FROM answers a WHERE a.author_id IN (
         SELECT u.id FROM users u WHERE ${userMatchSql("u", OPTS)})
         AND a.id NOT IN (SELECT id FROM _del_a)`
    );
    const residC = count(
      `SELECT COUNT(*) c FROM comments c WHERE c.author_id IN (
         SELECT u.id FROM users u WHERE ${userMatchSql("u", OPTS)})
         AND NOT ((c.target_type = 'question' AND c.target_id IN (SELECT id FROM _del_q))
               OR (c.target_type = 'answer' AND c.target_id IN (SELECT id FROM _del_a)))`
    );

    console.log(`[dry-run] DB: ${DB_PATH}`);
    console.log(`[dry-run] questions: ${nQ} / ${nQall} 将删除`);
    console.log(`[dry-run] answers:   ${nA} 将删除（含测试问题下的全部回答）`);
    console.log(`[dry-run] comments:  ${nC} 将删除`);
    console.log(`[dry-run] votes:     ${nV} 将删除（answer votes + question votes）`);
    console.log(`[dry-run] users:     ${nU} / ${nUall} 将删除（另有 ${skipped} 个测试账号因仍有内容保留）`);
    console.log(`[dry-run] 残留提示: ${residA} 条测试回答 + ${residC} 条测试评论挂在真实内容下，不在删除范围`);
    console.log("[dry-run] 样例标题（最多 10 条）:");
    for (const t of sampleTitles()) console.log(`  - ${t}`);
    console.log("[dry-run] 未写库。加 --apply 才真正删除。");
    return;
  }

  // ---- apply：单事务 ----
  const stats = {};
  db.transaction(() => {
    fillTargets();
    const del = (key, sql) => {
      stats[key] = (stats[key] || 0) + db.prepare(sql).run().changes;
    };

    for (const src of ["_del_a", "_del_a2"]) {
      for (const [key, tpl] of ANSWER_DEPS) del(key, tpl.replace("%s", `(SELECT id FROM ${src})`));
    }
    for (const [key, sql] of QUESTION_DEPS) del(key, sql);
    stats.answers = db
      .prepare("DELETE FROM answers WHERE id IN (SELECT id FROM _del_a) OR id IN (SELECT id FROM _del_a2)")
      .run().changes;
    stats.questions = db.prepare("DELETE FROM questions WHERE id IN (SELECT id FROM _del_q)").run().changes;

    for (const [key, sql] of USER_DEPS) del(key, sql);
    stats.users = db.prepare("DELETE FROM users WHERE id IN (SELECT id FROM _del_u)").run().changes;

    for (const sql of RECOMPUTE) db.exec(sql);
  })();

  const leftQ = count("SELECT COUNT(*) c FROM questions");
  const leftU = count("SELECT COUNT(*) c FROM users");
  // 复核：删除后仍命中模式的行应为 0（JS 侧同口径再数一遍）。
  const dirtyQ = db
    .prepare("SELECT q.title, u.nickname FROM questions q JOIN users u ON u.id = q.author_id")
    .all()
    .filter((r) => isTestTitle(r.title) || isTestNickname(r.nickname)).length;
  const dirtyU = db
    .prepare("SELECT nickname, email FROM users")
    .all()
    .filter((r) => isTestNickname(r.nickname) || isTestEmail(r.email)).length;

  console.log("[apply] 已删除行数（按表）:");
  for (const [k, v] of Object.entries(stats)) console.log(`  ${k}: ${v}`);
  console.log(`[apply] 剩余 questions: ${leftQ}；剩余 users: ${leftU}`);
  console.log(`[apply] 复核：仍命中测试模式的 questions=${dirtyQ}（应 0）；命中模式的 users=${dirtyU}（>0 属正常：仍有内容的账号按规则保留）`);
}

run();
