#!/usr/bin/env node
// scripts/cleanup-artifacts.mjs — 自动化产物物理删除（Z983）。
//
// 与 scripts/cleanup-test-content.js 的区别：
//   - 识别口径多了 users.is_test 机器标记（004 迁移；测试邮箱域注册时落 1），
//     被标记账号的内容无论标题形态一律清理；未迁移的旧库自动降级回形态规则。
//   - 支持 --older-than=<N>{s|m|h|d}：只清超过 N 时间的产物，保护正在跑的 E2E。
//   - 支持 --only-owned=u:1,q:2,a:3,c:4,col:5：只删本次 run 自己创建的对象
//     （assert/e2e lib 退出时回调用这个；u: 仅当账号命中标记/形态才删，防误伤真实号）。
//
// 用法:
//   node scripts/cleanup-artifacts.mjs                      # dry-run：只统计打印
//   node scripts/cleanup-artifacts.mjs --apply              # 单事务真删
//   node scripts/cleanup-artifacts.mjs --older-than=2h      # 只清 >2h 的产物
//   node scripts/cleanup-artifacts.mjs --apply --older-than=0h --only-owned=u:12,q:34
//   node scripts/cleanup-artifacts.mjs --apply --only-owned-file=/tmp/owned.json
//
// 环境: DB_PATH（或 --db=；默认 ../data/zhihu.db，相对本脚本目录解析）。
// 安全: --apply 指向生产库 /www/zhihucopy/data/zhihu.db 时必须再加 --force。

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// better-sqlite3 装在 server/node_modules（root node_modules 是软链且无此包）。
const Database = require(require.resolve("better-sqlite3", {
  paths: [path.join(HERE, "..", "server")],
}));
const { questionMatchSql, userMatchSql } = require("../server/content-filter.js");

const PROD_DB = "/www/zhihucopy/data/zhihu.db";

// ---- 参数 ------------------------------------------------------------------

function usage(rc = 0) {
  console.log(`用法: node scripts/cleanup-artifacts.mjs [--apply] [--force] [--db=<path>]
       [--older-than=<N>{s|m|h|d}] [--only-owned=<k:id,...>] [--only-owned-file=<path>]
  默认 dry-run。k ∈ u|q|a|c|col（或 user|question|answer|comment|collection）。`);
  process.exit(rc);
}

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const FORCE = argv.includes("--force");
let olderArg = "0h";
let ownedSpec = null;
let ownedFile = null;
let dbArg = null;
for (const a of argv) {
  if (a === "--apply" || a === "--force") continue;
  if (a === "-h" || a === "--help") usage(0);
  if (a.startsWith("--older-than=")) olderArg = a.slice("--older-than=".length);
  else if (a.startsWith("--only-owned=")) ownedSpec = a.slice("--only-owned=".length);
  else if (a.startsWith("--only-owned-file=")) ownedFile = a.slice("--only-owned-file=".length);
  else if (a.startsWith("--db=")) dbArg = a.slice("--db=".length);
  else {
    console.error(`未知参数: ${a}`);
    usage(2);
  }
}
if (ownedSpec !== null && ownedFile !== null) {
  console.error("--only-owned 与 --only-owned-file 只能用一个");
  process.exit(2);
}
const OWNED_MODE = ownedSpec !== null || ownedFile !== null;

// --older-than: 转成 SQLite datetime 修饰符；0 → 不过滤。
function parseOlderThan(v) {
  const m = /^(\d+)\s*(s|m|h|d)$/i.exec(String(v).trim());
  if (!m) {
    console.error(`--older-than 格式错误: ${v}（示例 30m / 2h / 1d）`);
    process.exit(2);
  }
  const n = Number(m[1]);
  if (n === 0) return null;
  const unit = { s: "seconds", m: "minutes", h: "hours", d: "days" }[m[2].toLowerCase()];
  return `-${n} ${unit}`;
}
const OLDER = parseOlderThan(olderArg);
const age = (col) => (OLDER ? `${col} < datetime('now', '${OLDER}')` : "1=1");

// --only-owned: "u:1,2,q:3" —— 逗号分隔，缺省 kind 沿用上一个。
const KINDS = { u: "u", user: "u", q: "q", question: "q", a: "a", answer: "a",
  c: "c", comment: "c", col: "col", collection: "col" };
function parseOwned(spec) {
  const out = { u: [], q: [], a: [], c: [], col: [] };
  let last = null;
  for (const tok of String(spec).split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = /^([a-zA-Z]+)?:?(\d+)$/.exec(tok);
    if (!m || (m[1] && !KINDS[m[1].toLowerCase()])) {
      console.error(`--only-owned 无法解析: "${tok}"`);
      process.exit(2);
    }
    const kind = m[1] ? KINDS[m[1].toLowerCase()] : last;
    if (!kind) {
      console.error(`--only-owned 首项必须带类型前缀: "${tok}"`);
      process.exit(2);
    }
    last = kind;
    out[kind].push(Number(m[2]));
  }
  return out;
}
let OWNED = { u: [], q: [], a: [], c: [], col: [] };
if (ownedFile !== null) {
  const raw = fs.readFileSync(ownedFile, "utf8").trim();
  if (raw.startsWith("{")) {
    const j = JSON.parse(raw);
    for (const [k, v] of Object.entries(j)) {
      const kind = KINDS[k.toLowerCase()];
      if (kind && Array.isArray(v)) OWNED[kind].push(...v.map(Number));
    }
  } else {
    OWNED = parseOwned(raw);
  }
} else if (ownedSpec !== null) {
  OWNED = parseOwned(ownedSpec);
}

// ---- 打开库 -----------------------------------------------------------------

const DB_PATH = path.resolve(dbArg || process.env.DB_PATH || path.join(HERE, "..", "data", "zhihu.db"));
if (APPLY && DB_PATH === PROD_DB && !FORCE) {
  console.error(`[abort] 拒绝直接 --apply 生产库 ${PROD_DB}；确认要跑请加 --force`);
  process.exit(2);
}
if (!fs.existsSync(DB_PATH)) {
  console.error(`[abort] DB 不存在: ${DB_PATH}`);
  process.exit(2);
}
const db = new Database(DB_PATH, APPLY ? {} : { readonly: true });
db.pragma("foreign_keys = ON");

// 未跑 004 迁移的库没有 is_test 列 → 降级为纯形态规则。
const hasIsTest = db.prepare("PRAGMA table_info(users)").all().some((c) => c.name === "is_test");
const OPTS = { isTest: hasIsTest };

db.exec(`
  CREATE TEMP TABLE _del_q (id INTEGER PRIMARY KEY);
  CREATE TEMP TABLE _del_a (id INTEGER PRIMARY KEY);
  CREATE TEMP TABLE _del_c (id INTEGER PRIMARY KEY);
  CREATE TEMP TABLE _del_u (id INTEGER PRIMARY KEY);
  CREATE TEMP TABLE _del_col (id INTEGER PRIMARY KEY);
`);

const inQ = "(SELECT id FROM _del_q)";
const inA = "(SELECT id FROM _del_a)";
const inC = "(SELECT id FROM _del_c)";
const inU = "(SELECT id FROM _del_u)";
const inCol = "(SELECT id FROM _del_col)";

// 评论子回复级联：父评论被删时整条回复链一起删（parent_id 有 FK）。
function expandCommentReplies() {
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
function cascadeFromDelUsers() {
  db.prepare(`INSERT OR IGNORE INTO _del_q SELECT id FROM questions WHERE author_id IN ${inU}`).run();
  db.prepare(
    `INSERT OR IGNORE INTO _del_a SELECT id FROM answers
     WHERE question_id IN ${inQ} OR author_id IN ${inU}`
  ).run();
  db.prepare(
    `INSERT OR IGNORE INTO _del_c SELECT c.id FROM comments c
     WHERE c.author_id IN ${inU}
        OR (c.target_type = 'question' AND c.target_id IN ${inQ})
        OR (c.target_type = 'answer' AND c.target_id IN ${inA})`
  ).run();
  expandCommentReplies();
  db.prepare(`INSERT OR IGNORE INTO _del_col SELECT id FROM collections WHERE owner_id IN ${inU}`).run();
}

function fillTargetsPattern() {
  // 顶层选择：形态规则 + is_test 标记作者，受 --older-than 约束。
  db.prepare(
    `INSERT OR IGNORE INTO _del_q
     SELECT q.id FROM questions q JOIN users u ON u.id = q.author_id
     WHERE ${questionMatchSql("q", "u", OPTS)} AND ${age("q.created_at")}`
  ).run();
  db.prepare(
    `INSERT OR IGNORE INTO _del_a SELECT a.id FROM answers a WHERE a.question_id IN ${inQ}`
  ).run();
  // 机器标记账号：无条件进删除集（is_admin 永不删）；其内容随后级联。
  if (hasIsTest) {
    db.prepare(
      `INSERT OR IGNORE INTO _del_u SELECT u.id FROM users u
       WHERE u.is_test = 1 AND u.is_admin = 0 AND ${age("u.created_at")}`
    ).run();
  }
  cascadeFromDelUsers();
  // 形态命中但未标记的账号：沿用旧规则 —— 扣掉待删集后无任何剩余内容才删。
  db.prepare(
    `INSERT OR IGNORE INTO _del_u SELECT u.id FROM users u
     WHERE ${userMatchSql("u", OPTS)} AND u.is_admin = 0 AND ${age("u.created_at")}
       AND u.id NOT IN ${inU}
       AND NOT EXISTS (SELECT 1 FROM questions q WHERE q.author_id = u.id
                        AND q.id NOT IN ${inQ})
       AND NOT EXISTS (SELECT 1 FROM answers a WHERE a.author_id = u.id
                        AND a.id NOT IN ${inA})
       AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.author_id = u.id
                        AND NOT ((c.target_type = 'question' AND c.target_id IN ${inQ})
                              OR (c.target_type = 'answer' AND c.target_id IN ${inA})))`
  ).run();
  cascadeFromDelUsers();
}

function fillTargetsOwned() {
  const list = (ids) => (ids.length ? `(${ids.join(",")})` : "(NULL)");
  // 显式指定的问题/回答/评论/收藏：直接进集（age 仅约束显式项）。
  if (OWNED.q.length) {
    db.prepare(`INSERT OR IGNORE INTO _del_q SELECT id FROM questions WHERE id IN ${list(OWNED.q)} AND ${age("created_at")}`).run();
  }
  if (OWNED.a.length) {
    db.prepare(`INSERT OR IGNORE INTO _del_a SELECT id FROM answers WHERE id IN ${list(OWNED.a)} AND ${age("created_at")}`).run();
  }
  if (OWNED.c.length) {
    db.prepare(`INSERT OR IGNORE INTO _del_c SELECT id FROM comments WHERE id IN ${list(OWNED.c)} AND ${age("created_at")}`).run();
  }
  if (OWNED.col.length) {
    db.prepare(`INSERT OR IGNORE INTO _del_col SELECT id FROM collections WHERE id IN ${list(OWNED.col)} AND ${age("created_at")}`).run();
  }
  // 显式账号：必须命中机器标记或测试形态才删 —— 防误删种子/真实账号。
  if (OWNED.u.length) {
    const skipped = db
      .prepare(
        `SELECT u.id, u.nickname, u.email FROM users u
         WHERE u.id IN ${list(OWNED.u)}
           AND NOT (${userMatchSql("u", OPTS)} AND u.is_admin = 0)`
      )
      .all();
    for (const s of skipped) {
      console.warn(`[owned] 跳过 u:${s.id}（${s.nickname} <${s.email}>）—— 非测试账号标记/形态，防误删`);
    }
    db.prepare(
      `INSERT OR IGNORE INTO _del_u SELECT u.id FROM users u
       WHERE u.id IN ${list(OWNED.u)} AND ${userMatchSql("u", OPTS)}
         AND u.is_admin = 0 AND ${age("u.created_at")}`
    ).run();
  }
  cascadeFromDelUsers();
}

// ---- 依赖删除（FK 顺序：deps → answers → questions → collections → users） ----

const DEPS = [
  // 评论树（含回复级联），先删 —— parent_id FK + target 挂在 q/a 上。
  ["comments", `DELETE FROM comments WHERE id IN ${inC}`],
  ["notifications→comment", `DELETE FROM notifications WHERE target_type = 'comment' AND target_id IN ${inC}`],
  ["reports→comment", `DELETE FROM reports WHERE target_type = 'comment' AND target_id IN ${inC}`],
  // 回答依赖。
  ["answer_revisions", `DELETE FROM answer_revisions WHERE answer_id IN ${inA}`],
  ["votes", `DELETE FROM votes WHERE answer_id IN ${inA}`],
  ["collection_items→answer", `DELETE FROM collection_items WHERE answer_id IN ${inA}`],
  ["notifications→answer", `DELETE FROM notifications WHERE target_type = 'answer' AND target_id IN ${inA}`],
  ["reports→answer", `DELETE FROM reports WHERE target_type = 'answer' AND target_id IN ${inA}`],
  // 问题依赖。
  ["question_votes", `DELETE FROM question_votes WHERE question_id IN ${inQ}`],
  ["follows→question", `DELETE FROM follows WHERE target_type = 'question' AND target_id IN ${inQ}`],
  ["notifications→question", `DELETE FROM notifications WHERE target_type = 'question' AND target_id IN ${inQ}`],
  ["reports→question", `DELETE FROM reports WHERE target_type = 'question' AND target_id IN ${inQ}`],
  ["question_topics", `DELETE FROM question_topics WHERE question_id IN ${inQ}`],
  // 回答、问题本体。
  ["answers", `DELETE FROM answers WHERE id IN ${inA}`],
  ["questions", `DELETE FROM questions WHERE id IN ${inQ}`],
  // 收藏依赖 + 本体（owner FK 在 users 前清掉）。
  ["collection_items→col", `DELETE FROM collection_items WHERE collection_id IN ${inCol}`],
  ["notifications→collection", `DELETE FROM notifications WHERE target_type = 'collection' AND target_id IN ${inCol}`],
  ["collections", `DELETE FROM collections WHERE id IN ${inCol}`],
  // 账号自身挂的行。
  ["notifications(user)", `DELETE FROM notifications WHERE user_id IN ${inU} OR actor_id IN ${inU}
     OR (target_type = 'user' AND target_id IN ${inU})`],
  ["follows(user)", `DELETE FROM follows WHERE follower_id IN ${inU} OR (target_type = 'user' AND target_id IN ${inU})`],
  ["votes(user)", `DELETE FROM votes WHERE user_id IN ${inU}`],
  ["question_votes(user)", `DELETE FROM question_votes WHERE user_id IN ${inU}`],
  ["comments(user)", `DELETE FROM comments WHERE author_id IN ${inU}`],
  ["badges", `DELETE FROM badges WHERE user_id IN ${inU}`],
  ["reports(reporter)", `DELETE FROM reports WHERE reporter_id IN ${inU} OR (target_type = 'user' AND target_id IN ${inU})`],
  ["reports(handled_by)", `UPDATE reports SET handled_by = NULL WHERE handled_by IN ${inU}`],
  ["mod_logs", `DELETE FROM mod_logs WHERE admin_id IN ${inU}`],
  // 账号本体。
  ["users", `DELETE FROM users WHERE id IN ${inU}`],
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

const count = (sql) => db.prepare(sql).get().c;

function report(mode) {
  const nQ = count("SELECT COUNT(*) c FROM _del_q");
  const nA = count("SELECT COUNT(*) c FROM _del_a");
  const nC = count("SELECT COUNT(*) c FROM _del_c");
  const nU = count("SELECT COUNT(*) c FROM _del_u");
  const nCol = count("SELECT COUNT(*) c FROM _del_col");
  const nQall = count("SELECT COUNT(*) c FROM questions");
  const nUall = count("SELECT COUNT(*) c FROM users");
  console.log(`[${mode}] DB: ${DB_PATH}`);
  console.log(`[${mode}] 口径: ${OWNED_MODE ? "only-owned 显式清单" : `标记(is_test${hasIsTest ? "" : "=无列,降级"})+形态规则`}；older-than=${olderArg}`);
  console.log(`[${mode}] questions: ${nQ} / ${nQall}`);
  console.log(`[${mode}] answers:   ${nA}`);
  console.log(`[${mode}] comments:  ${nC}（含回复级联）`);
  console.log(`[${mode}] users:     ${nU} / ${nUall}`);
  console.log(`[${mode}] collections: ${nCol}`);
  if (!OWNED_MODE && nUall) {
    const skipped = count(
      `SELECT COUNT(*) c FROM users u WHERE ${userMatchSql("u", OPTS)} AND u.id NOT IN ${inU}`
    );
    const residA = count(
      `SELECT COUNT(*) c FROM answers a JOIN users u ON u.id = a.author_id
       WHERE ${userMatchSql("u", OPTS)} AND a.id NOT IN ${inA}`
    );
    const residC = count(
      `SELECT COUNT(*) c FROM comments c JOIN users u ON u.id = c.author_id
       WHERE ${userMatchSql("u", OPTS)} AND c.id NOT IN ${inC}`
    );
    console.log(`[${mode}] 形态命中但保留的账号: ${skipped}（其残留 answers=${residA} comments=${residC} 在真实内容下，不在删除范围）`);
  }
  const samples = db
    .prepare(`SELECT title FROM questions WHERE id IN ${inQ} ORDER BY id DESC LIMIT 10`)
    .all();
  for (const r of samples) console.log(`  - ${r.title}`);
}

if (!APPLY) {
  (OWNED_MODE ? fillTargetsOwned : fillTargetsPattern)();
  report("dry-run");
  console.log("[dry-run] 未写库。加 --apply 才真正删除。");
} else {
  const stats = {};
  db.transaction(() => {
    (OWNED_MODE ? fillTargetsOwned : fillTargetsPattern)();
    report("apply");
    for (const [key, sql] of DEPS) {
      stats[key] = (stats[key] || 0) + db.prepare(sql).run().changes;
    }
    for (const sql of RECOMPUTE) db.exec(sql);
  })();

  // 复核：删除后仍命中口径的行数（JS 侧同口径再数一遍）。
  const dirtyQ = count(
    `SELECT COUNT(*) c FROM questions q JOIN users u ON u.id = q.author_id
     WHERE ${questionMatchSql("q", "u", OPTS)}`
  );
  console.log("[apply] 已删除/更新行数（按表）:");
  for (const [k, v] of Object.entries(stats)) if (v) console.log(`  ${k}: ${v}`);
  console.log(`[apply] 剩余 questions=${count("SELECT COUNT(*) c FROM questions")} users=${count("SELECT COUNT(*) c FROM users")}；复核命中口径 questions=${dirtyQ}`);
}
