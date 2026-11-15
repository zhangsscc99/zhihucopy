// artifact-cleanup.js — 自动化产物物理删除的共享机械（Z983 拆出；Z986 起 routes/test-support.js 复用）。
//
// 两侧调用方式：
//   scripts/cleanup-artifacts.mjs  有 DB 权限的调度/运维入口（本模块的 fill 是信任版）；
//   routes/test-support.js         只有 API 权限的断言机入口（fill 是逐 id 权限校验版）。
// 共同语义：显式 q/a/c/col 清单直接进删除集；u: 仅当账号命中测试标记/形态且非管理员
// 才删；被删账号/问题/回答级联带走其内容；最后按 DEPS 的 FK 顺序硬删并回填计数。

const { questionMatchSql, userMatchSql } = require("./content-filter");

// IN 子查询片段 —— 调用方拼 SQL 时用。
const SEL = {
  q: "(SELECT id FROM _del_q)",
  a: "(SELECT id FROM _del_a)",
  c: "(SELECT id FROM _del_c)",
  u: "(SELECT id FROM _del_u)",
  col: "(SELECT id FROM _del_col)",
};

const count = (db, sql) => db.prepare(sql).get().c;

// 每次清理前重建 _del_* 临时表（连接是长驻单例，必须清掉上次的痕迹）。
function initDelTables(db) {
  db.exec(`
    DROP TABLE IF EXISTS _del_q; DROP TABLE IF EXISTS _del_a;
    DROP TABLE IF EXISTS _del_c; DROP TABLE IF EXISTS _del_u;
    DROP TABLE IF EXISTS _del_col;
    CREATE TEMP TABLE _del_q (id INTEGER PRIMARY KEY);
    CREATE TEMP TABLE _del_a (id INTEGER PRIMARY KEY);
    CREATE TEMP TABLE _del_c (id INTEGER PRIMARY KEY);
    CREATE TEMP TABLE _del_u (id INTEGER PRIMARY KEY);
    CREATE TEMP TABLE _del_col (id INTEGER PRIMARY KEY);
  `);
}

// 评论子回复级联：父评论被删时整条回复链一起删（parent_id 有 FK）。
function expandCommentReplies(db) {
  db.prepare(
    `WITH RECURSIVE d(id) AS (
       SELECT id FROM _del_c
       UNION
       SELECT c.id FROM comments c JOIN d ON c.parent_id = d.id
     )
     INSERT OR IGNORE INTO _del_c SELECT id FROM d`
  ).run();
}

// 被删账号的级联：其问题/回答/评论/收藏全部进删除集（FK 要求 + 产物语义）。
function cascadeFromDelUsers(db) {
  db.prepare(`INSERT OR IGNORE INTO _del_q SELECT id FROM questions WHERE author_id IN ${SEL.u}`).run();
  db.prepare(
    `INSERT OR IGNORE INTO _del_a SELECT id FROM answers
     WHERE question_id IN ${SEL.q} OR author_id IN ${SEL.u}`
  ).run();
  db.prepare(
    `INSERT OR IGNORE INTO _del_c SELECT c.id FROM comments c
     WHERE c.author_id IN ${SEL.u}
        OR (c.target_type = 'question' AND c.target_id IN ${SEL.q})
        OR (c.target_type = 'answer' AND c.target_id IN ${SEL.a})`
  ).run();
  expandCommentReplies(db);
  db.prepare(`INSERT OR IGNORE INTO _del_col SELECT id FROM collections WHERE owner_id IN ${SEL.u}`).run();
}

const listIds = (ids) => (ids.length ? `(${ids.join(",")})` : "(NULL)");

// 信任版 owned 填充（DB 模式）：显式 q/a/c/col 直接进集（age 仅约束显式项）；
// 显式账号必须命中机器标记或测试形态 —— 防误删种子/真实账号。
// age(col) 返回形如 "q.created_at < datetime('now','-2 hours')" 或 "1=1" 的 SQL 片段。
function addOwnedTargets(db, owned, { age = () => "1=1", hasIsTest = true } = {}) {
  const OPTS = { isTest: hasIsTest };
  const skippedUsers = [];

  if (owned.q.length) {
    db.prepare(`INSERT OR IGNORE INTO _del_q SELECT id FROM questions WHERE id IN ${listIds(owned.q)} AND ${age("created_at")}`).run();
  }
  if (owned.a.length) {
    db.prepare(`INSERT OR IGNORE INTO _del_a SELECT id FROM answers WHERE id IN ${listIds(owned.a)} AND ${age("created_at")}`).run();
  }
  if (owned.c.length) {
    db.prepare(`INSERT OR IGNORE INTO _del_c SELECT id FROM comments WHERE id IN ${listIds(owned.c)} AND ${age("created_at")}`).run();
  }
  if (owned.col.length) {
    db.prepare(`INSERT OR IGNORE INTO _del_col SELECT id FROM collections WHERE id IN ${listIds(owned.col)} AND ${age("created_at")}`).run();
  }
  if (owned.u.length) {
    skippedUsers.push(
      ...db
        .prepare(
          `SELECT u.id, u.nickname, u.email FROM users u
           WHERE u.id IN ${listIds(owned.u)}
             AND NOT (${userMatchSql("u", OPTS)} AND u.is_admin = 0)`
        )
        .all()
    );
    db.prepare(
      `INSERT OR IGNORE INTO _del_u SELECT u.id FROM users u
       WHERE u.id IN ${listIds(owned.u)} AND ${userMatchSql("u", OPTS)}
         AND u.is_admin = 0 AND ${age("u.created_at")}`
    ).run();
  }
  cascadeFromDelUsers(db);
  return { skippedUsers };
}

// 守门版 owned 填充（API 模式）：逐 id 校验调用者权限。
//   q/a/c/col：调用者是作者/属主，或管理员，或 is_test 账号且目标本身是测试产物。
//   u：目标必须是测试账号形态且非管理员，且调用者是管理员 / is_test / 该账号本人。
// 通不过校验的 id 进 skipped 返回（含具体原因在 skippedUsers）。
function addOwnedTargetsGuarded(db, owned, { caller, hasIsTest }) {
  const OPTS = { isTest: hasIsTest };
  const cid = caller.id;
  const admin = caller.is_admin ? 1 : 0;
  const istest = caller.is_test ? 1 : 0;
  const skipped = [];
  const skippedUsers = [];

  const fill = (kind, ids, sql, table) => {
    if (!ids.length) return;
    const okIds = new Set(db.prepare(sql).all(cid, admin, istest).map((r) => r.id));
    const ins = db.prepare(`INSERT OR IGNORE INTO ${table} (id) VALUES (?)`);
    for (const id of ids) {
      if (okIds.has(id)) ins.run(id);
      else skipped.push(`${kind}:${id}`);
    }
  };

  fill("q", owned.q, `SELECT q.id FROM questions q JOIN users u ON u.id = q.author_id
     WHERE q.id IN ${listIds(owned.q)}
       AND (q.author_id = ? OR ? = 1 OR (? = 1 AND ${questionMatchSql("q", "u", OPTS)}))`, "_del_q");

  fill("a", owned.a, `SELECT a.id FROM answers a
     JOIN users ua ON ua.id = a.author_id
     JOIN questions pq ON pq.id = a.question_id
     JOIN users pu ON pu.id = pq.author_id
     WHERE a.id IN ${listIds(owned.a)}
       AND (a.author_id = ? OR ? = 1
            OR (? = 1 AND (${userMatchSql("ua", OPTS)} OR ${questionMatchSql("pq", "pu", OPTS)})))`, "_del_a");

  fill("c", owned.c, `SELECT c.id FROM comments c JOIN users ua ON ua.id = c.author_id
     WHERE c.id IN ${listIds(owned.c)}
       AND (c.author_id = ? OR ? = 1 OR (? = 1 AND ${userMatchSql("ua", OPTS)}))`, "_del_c");

  fill("col", owned.col, `SELECT col.id FROM collections col JOIN users o ON o.id = col.owner_id
     WHERE col.id IN ${listIds(owned.col)}
       AND (col.owner_id = ? OR ? = 1 OR (? = 1 AND ${userMatchSql("o", OPTS)}))`, "_del_col");

  if (owned.u.length) {
    const okIds = new Set(
      db.prepare(
        `SELECT u.id FROM users u
         WHERE u.id IN ${listIds(owned.u)} AND u.is_admin = 0 AND ${userMatchSql("u", OPTS)}
           AND (? = 1 OR ? = 1 OR u.id = ?)`
      ).all(admin, istest, cid).map((r) => r.id)
    );
    const ins = db.prepare("INSERT OR IGNORE INTO _del_u (id) VALUES (?)");
    const info = db.prepare("SELECT id, nickname, email FROM users WHERE id = ?");
    for (const id of owned.u) {
      if (okIds.has(id)) ins.run(id);
      else {
        skipped.push(`u:${id}`);
        const row = info.get(id);
        if (row) skippedUsers.push(row);
      }
    }
  }
  cascadeFromDelUsers(db);
  return { skipped, skippedUsers };
}

// ---- 依赖删除（FK 顺序：deps → answers → questions → collections → users） ----

const DEPS = [
  // 评论树（含回复级联），先删 —— parent_id FK + target 挂在 q/a 上。
  ["comments", `DELETE FROM comments WHERE id IN ${SEL.c}`],
  ["notifications→comment", `DELETE FROM notifications WHERE target_type = 'comment' AND target_id IN ${SEL.c}`],
  ["reports→comment", `DELETE FROM reports WHERE target_type = 'comment' AND target_id IN ${SEL.c}`],
  // 回答依赖。
  ["answer_revisions", `DELETE FROM answer_revisions WHERE answer_id IN ${SEL.a}`],
  ["votes", `DELETE FROM votes WHERE answer_id IN ${SEL.a}`],
  ["collection_items→answer", `DELETE FROM collection_items WHERE answer_id IN ${SEL.a}`],
  ["notifications→answer", `DELETE FROM notifications WHERE target_type = 'answer' AND target_id IN ${SEL.a}`],
  ["reports→answer", `DELETE FROM reports WHERE target_type = 'answer' AND target_id IN ${SEL.a}`],
  // 问题依赖。
  ["question_votes", `DELETE FROM question_votes WHERE question_id IN ${SEL.q}`],
  ["follows→question", `DELETE FROM follows WHERE target_type = 'question' AND target_id IN ${SEL.q}`],
  ["notifications→question", `DELETE FROM notifications WHERE target_type = 'question' AND target_id IN ${SEL.q}`],
  ["reports→question", `DELETE FROM reports WHERE target_type = 'question' AND target_id IN ${SEL.q}`],
  ["question_topics", `DELETE FROM question_topics WHERE question_id IN ${SEL.q}`],
  // 回答、问题本体。
  ["answers", `DELETE FROM answers WHERE id IN ${SEL.a}`],
  ["questions", `DELETE FROM questions WHERE id IN ${SEL.q}`],
  // 收藏依赖 + 本体（owner FK 在 users 前清掉）。
  ["collection_items→col", `DELETE FROM collection_items WHERE collection_id IN ${SEL.col}`],
  ["notifications→collection", `DELETE FROM notifications WHERE target_type = 'collection' AND target_id IN ${SEL.col}`],
  ["collections", `DELETE FROM collections WHERE id IN ${SEL.col}`],
  // 账号自身挂的行。
  ["notifications(user)", `DELETE FROM notifications WHERE user_id IN ${SEL.u} OR actor_id IN ${SEL.u}
     OR (target_type = 'user' AND target_id IN ${SEL.u})`],
  ["follows(user)", `DELETE FROM follows WHERE follower_id IN ${SEL.u} OR (target_type = 'user' AND target_id IN ${SEL.u})`],
  ["votes(user)", `DELETE FROM votes WHERE user_id IN ${SEL.u}`],
  ["question_votes(user)", `DELETE FROM question_votes WHERE user_id IN ${SEL.u}`],
  ["comments(user)", `DELETE FROM comments WHERE author_id IN ${SEL.u}`],
  ["user_badges", `DELETE FROM user_badges WHERE user_id IN ${SEL.u}`],
  ["badge_grants_legacy", `DELETE FROM badge_grants_legacy WHERE user_id IN ${SEL.u}`],
  ["reports(reporter)", `DELETE FROM reports WHERE reporter_id IN ${SEL.u} OR (target_type = 'user' AND target_id IN ${SEL.u})`],
  ["reports(handled_by)", `UPDATE reports SET handled_by = NULL WHERE handled_by IN ${SEL.u}`],
  ["mod_logs", `DELETE FROM mod_logs WHERE admin_id IN ${SEL.u}`],
  // 账号本体。
  ["users", `DELETE FROM users WHERE id IN ${SEL.u}`],
];

// 删除后回填反范式计数。
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

// 按 DEPS 顺序删除，返回 {key: 行数} 统计。
function deleteMarked(db) {
  const stats = {};
  for (const [key, sql] of DEPS) {
    try {
      stats[key] = (stats[key] || 0) + db.prepare(sql).run().changes;
    } catch (e) {
      // 可选表（如 badge_grants_legacy / reports）在部分库上不存在，跳过。
      if (!/no such table/.test(e.message)) throw e;
    }
  }
  return stats;
}

function recomputeDerived(db) {
  for (const sql of RECOMPUTE) db.exec(sql);
}

function delCounts(db) {
  return {
    q: count(db, "SELECT COUNT(*) c FROM _del_q"),
    a: count(db, "SELECT COUNT(*) c FROM _del_a"),
    c: count(db, "SELECT COUNT(*) c FROM _del_c"),
    u: count(db, "SELECT COUNT(*) c FROM _del_u"),
    col: count(db, "SELECT COUNT(*) c FROM _del_col"),
  };
}

module.exports = {
  SEL,
  count,
  initDelTables,
  expandCommentReplies,
  cascadeFromDelUsers,
  addOwnedTargets,
  addOwnedTargetsGuarded,
  deleteMarked,
  recomputeDerived,
  delCounts,
};
