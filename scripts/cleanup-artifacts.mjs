#!/usr/bin/env node
// scripts/cleanup-artifacts.mjs — 自动化产物物理删除（Z983；Z986 起支持 --api 模式）。
//
// 与 scripts/cleanup-test-content.js 的区别：
//   - 识别口径多了 users.is_test 机器标记（004 迁移；测试邮箱域注册时落 1），
//     被标记账号的内容无论标题形态一律清理；未迁移的旧库自动降级回形态规则。
//   - 支持 --older-than=<N>{s|m|h|d}：只清超过 N 时间的产物，保护正在跑的 E2E。
//   - 支持 --only-owned=u:1,q:2,a:3,c:4,col:5：只删本次 run 自己创建的对象
//     （assert/e2e lib 退出时回调用这个；u: 仅当账号命中标记/形态才删，防误伤真实号）。
//
// 两种模式：
//   DB 模式  —— 直连 SQLite。--db=<path> 或环境 DB_PATH 生效时启用；
//              支持标记+形态全量扫描 与 --only-owned 清单两种口径。
//   API 模式 —— 无 DB_PATH 时的默认（禁止隐式指向 data/zhihu.db）。
//              凭 API_BASE + 会话 token + id 清单走 server 的
//              POST /test-support/cleanup，只支持 --only-owned 口径。
//              会话清单走 CLEANUP_API_SESSIONS（JSON {"<token>":"u:1,q:2"}），
//              或用 --api-token=<jwt> / CLEANUP_API_TOKEN 传单个会话；
//              --only-owned 的 id 作为「无会话归属」追加进每个会话的请求。
//
// 用法:
//   node scripts/cleanup-artifacts.mjs --db=/tmp/x.db          # dry-run：只统计打印
//   node scripts/cleanup-artifacts.mjs --db=/tmp/x.db --apply  # 单事务真删
//   node scripts/cleanup-artifacts.mjs --db=/tmp/x.db --older-than=2h
//   node scripts/cleanup-artifacts.mjs --apply --older-than=0h --only-owned=u:12,q:34
//   node scripts/cleanup-artifacts.mjs --apply --only-owned-file=/tmp/owned.json
//   API_BASE=… CLEANUP_API_TOKEN=… node scripts/cleanup-artifacts.mjs --api --apply --only-owned=q:34
//
// 安全: DB 模式 --apply 指向生产库 /www/zhihucopy/data/zhihu.db 时必须再加 --force。

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const cleanup = require("../server/artifact-cleanup.js");
const { questionMatchSql, userMatchSql, probeUserMatchSql, commentMatchSql } = require("../server/content-filter.js");
const {
  SEL, count, initDelTables, cascadeFromDelUsers, expandCommentReplies,
  addOwnedTargets, deleteMarked, recomputeDerived, delCounts,
} = cleanup;

const PROD_DB = "/www/zhihucopy/data/zhihu.db";

// ---- 参数 ------------------------------------------------------------------

function usage(rc = 0) {
  console.log(`用法: node scripts/cleanup-artifacts.mjs [--apply] [--force]
       [--db=<path>] [--api] [--api-token=<jwt>]
       [--older-than=<N>{s|m|h|d}] [--only-owned=<k:id,...>] [--only-owned-file=<path>]
  默认 dry-run。k ∈ u|q|a|c|col（或 user|question|answer|comment|collection）。
  无 --db/DB_PATH 时走 API 模式（需 API_BASE + 会话 token），不再默认指向 data/zhihu.db。`);
  process.exit(rc);
}

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const FORCE = argv.includes("--force");
const API_FLAG = argv.includes("--api");
let olderArg = "0h";
let ownedSpec = null;
let ownedFile = null;
let dbArg = null;
let apiTokenArg = null;
for (const a of argv) {
  if (a === "--apply" || a === "--force" || a === "--api") continue;
  if (a === "-h" || a === "--help") usage(0);
  if (a.startsWith("--older-than=")) olderArg = a.slice("--older-than=".length);
  else if (a.startsWith("--only-owned=")) ownedSpec = a.slice("--only-owned=".length);
  else if (a.startsWith("--only-owned-file=")) ownedFile = a.slice("--only-owned-file=".length);
  else if (a.startsWith("--db=")) dbArg = a.slice("--db=".length);
  else if (a.startsWith("--api-token=")) apiTokenArg = a.slice("--api-token=".length);
  else {
    console.error(`未知参数: ${a}`);
    usage(2);
  }
}
if (ownedSpec !== null && ownedFile !== null) {
  console.error("--only-owned 与 --only-owned-file 只能用一个");
  process.exit(2);
}
if (API_FLAG && dbArg !== null) {
  console.error("--api 与 --db 互斥：走 API 请去掉 --db");
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
const EMPTY_OWNED = () => ({ u: [], q: [], a: [], c: [], col: [] });
let OWNED = EMPTY_OWNED();
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

// ---- 模式选择：--api 显式指定 API；--db/DB_PATH → DB；其余 → API ----
// （绝不隐式指向 data/zhihu.db —— 无 DB 指针时只能走 API。）

const DB_RESOLVED = dbArg || process.env.DB_PATH || null;
const MODE = API_FLAG ? "api" : DB_RESOLVED ? "db" : "api";

// ============================================================================
// API 模式 —— POST {API_BASE}/test-support/cleanup，逐会话删除各自产物。
// ============================================================================

function mergeOwned(dst, src) {
  for (const k of Object.keys(dst)) dst[k] = [...new Set([...dst[k], ...src[k]])];
  return dst;
}

async function runApi() {
  const API_BASE = (process.env.API_BASE || "").replace(/\/+$/, "");
  if (!API_BASE) {
    console.error("[abort] API 模式需要 API_BASE 环境变量（如 http://127.0.0.1:3030/zhihucopy/api）");
    process.exit(2);
  }

  // 会话清单：CLEANUP_API_SESSIONS = {"<token>": "u:1,q:2" 或 ["u:1","q:2"]}
  const sessions = []; // [{ token, owned }]
  const rawSessions = process.env.CLEANUP_API_SESSIONS;
  if (rawSessions) {
    let j;
    try {
      j = JSON.parse(rawSessions);
    } catch (e) {
      console.error(`[abort] CLEANUP_API_SESSIONS 不是合法 JSON: ${e.message}`);
      process.exit(2);
    }
    if (!j || typeof j !== "object" || Array.isArray(j)) {
      console.error("[abort] CLEANUP_API_SESSIONS 应为 {\"<token>\": \"u:1,q:2\"} 形态的对象");
      process.exit(2);
    }
    for (const [token, spec] of Object.entries(j)) {
      const s = Array.isArray(spec) ? spec.join(",") : spec;
      sessions.push({ token, owned: parseOwned(s) });
    }
  }
  const soloToken = apiTokenArg || process.env.CLEANUP_API_TOKEN || null;
  if (soloToken) sessions.push({ token: soloToken, owned: EMPTY_OWNED() });

  if (!sessions.length) {
    console.error("[abort] API 模式需要会话 token：--api-token / CLEANUP_API_TOKEN / CLEANUP_API_SESSIONS");
    process.exit(2);
  }
  const totalIds =
    sessions.reduce((n, s) => n + Object.values(s.owned).flat().length, 0) +
    Object.values(OWNED).flat().length;
  if (!totalIds) {
    console.log("[api] 清单为空，无可删对象。");
    process.exit(0);
  }

  // --only-owned 的 id 无会话归属：追加进每个会话的请求，由服务端按权限逐条裁决。
  const bodies = sessions.map((s) => mergeOwned(mergeOwned(EMPTY_OWNED(), s.owned), OWNED));

  if (!APPLY) {
    console.log(`[dry-run] API 模式 ${API_BASE}，会话 ${sessions.length} 个，id 合计 ${totalIds}（含无会话归属 ${Object.values(OWNED).flat().length}）`);
    for (const [i, b] of bodies.entries()) {
      console.log(`  session#${i + 1} …${sessions[i].token.slice(-8)}: u=${b.u.length} q=${b.q.length} a=${b.a.length} c=${b.c.length} col=${b.col.length}`);
    }
    console.log("[dry-run] 未发请求。加 --apply 才真正删除。");
    process.exit(0);
  }

  let failed = false;
  const agg = { u: 0, q: 0, a: 0, c: 0, col: 0 };
  const allSkipped = [];
  for (const [i, s] of sessions.entries()) {
    const tag = `…${s.token.slice(-8)}`;
    let res;
    try {
      res = await fetch(`${API_BASE}/test-support/cleanup`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${s.token}` },
        body: JSON.stringify(bodies[i]),
      });
    } catch (e) {
      console.error(`[api] session#${i + 1} ${tag} 请求失败: ${e.message || e}`);
      failed = true;
      continue;
    }
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      console.error(`[api] session#${i + 1} ${tag} HTTP ${res.status}: ${text.slice(0, 300)}`);
      failed = true;
      continue;
    }
    const d = data.deleted || {};
    for (const k of Object.keys(agg)) agg[k] += d[k] || 0;
    if (Array.isArray(data.skipped)) allSkipped.push(...data.skipped);
    for (const u of data.skipped_users || []) {
      console.warn(`[api] 跳过 u:${u.id}（${u.nickname} <${u.email}>）—— 非测试账号标记/形态或权限不足，防误删`);
    }
    console.log(`[api] session#${i + 1} ${tag} deleted: u=${d.u || 0} q=${d.q || 0} a=${d.a || 0} c=${d.c || 0} col=${d.col || 0} skipped=${(data.skipped || []).length}`);
  }
  console.log(`[api] 合计删除 u=${agg.u} q=${agg.q} a=${agg.a} c=${agg.c} col=${agg.col}${allSkipped.length ? `；跳过 ${allSkipped.length}（${[...new Set(allSkipped)].join(",")}）` : ""}`);
  process.exit(failed ? 1 : 0);
}

// ============================================================================
// DB 模式 —— 直连 SQLite（原 Z983 逻辑，机械部分下沉 server/artifact-cleanup.js）。
// ============================================================================

function runDb() {
  const Database = require(require.resolve("better-sqlite3", {
    paths: [path.join(HERE, "..", "server")],
  }));

  const DB_PATH = path.resolve(DB_RESOLVED);
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

  initDelTables(db);

  function fillTargetsPattern() {
    // 顶层选择：形态规则 + is_test 标记作者，受 --older-than 约束。
    db.prepare(
      `INSERT OR IGNORE INTO _del_q
       SELECT q.id FROM questions q JOIN users u ON u.id = q.author_id
       WHERE ${questionMatchSql("q", "u", OPTS)} AND ${age("q.created_at")}`
    ).run();
    db.prepare(
      `INSERT OR IGNORE INTO _del_a SELECT a.id FROM answers a WHERE a.question_id IN ${SEL.q}`
    ).run();
    // 机器标记账号：无条件进删除集（is_admin 永不删）；其内容随后级联。
    if (hasIsTest) {
      db.prepare(
        `INSERT OR IGNORE INTO _del_u SELECT u.id FROM users u
         WHERE u.is_test = 1 AND u.is_admin = 0 AND ${age("u.created_at")}`
      ).run();
    }
    cascadeFromDelUsers(db);
    // Z1045：测试账号挂在「真实问题」下的回答/评论、以及正文命中产物标记的
    // 评论（作者昵称不命中也算，如「质检小七」发的 comment-ui-*），都进删除集。
    // 旧口径把这些留在库里当「残留提示」，实测它们对公开访客可见 —— 必须删。
    db.prepare(
      `INSERT OR IGNORE INTO _del_a SELECT a.id FROM answers a
       JOIN users u ON u.id = a.author_id
       WHERE ${userMatchSql("u", OPTS)} AND ${age("a.created_at")}`
    ).run();
    db.prepare(
      `INSERT OR IGNORE INTO _del_c SELECT c.id FROM comments c
       JOIN users u ON u.id = c.author_id
       WHERE ${commentMatchSql("c", "u", OPTS)} AND ${age("c.created_at")}`
    ).run();
    // 被删父评论的回复链 + 新进删除集的回答下挂的评论，统一级联收编。
    expandCommentReplies(db);
    cascadeFromDelUsers(db);
    // 形态命中但未标记的账号：沿用旧规则 —— 扣掉待删集后无任何剩余内容才删。
    db.prepare(
      `INSERT OR IGNORE INTO _del_u SELECT u.id FROM users u
       WHERE (${userMatchSql("u", OPTS)} OR ${probeUserMatchSql("u")})
         AND u.is_admin = 0 AND ${age("u.created_at")}
         AND u.id NOT IN ${SEL.u}
         AND NOT EXISTS (SELECT 1 FROM questions q WHERE q.author_id = u.id
                          AND q.id NOT IN ${SEL.q})
         AND NOT EXISTS (SELECT 1 FROM answers a WHERE a.author_id = u.id
                          AND a.id NOT IN ${SEL.a})
         AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.author_id = u.id
                          AND NOT ((c.target_type = 'question' AND c.target_id IN ${SEL.q})
                                OR (c.target_type = 'answer' AND c.target_id IN ${SEL.a})))`
    ).run();
    cascadeFromDelUsers(db);
  }

  const fillTargetsOwned = () =>
    addOwnedTargets(db, OWNED, { age, hasIsTest }).skippedUsers;

  function report(mode) {
    const nQall = count(db, "SELECT COUNT(*) c FROM questions");
    const nUall = count(db, "SELECT COUNT(*) c FROM users");
    const n = delCounts(db);
    console.log(`[${mode}] DB: ${DB_PATH}`);
    console.log(`[${mode}] 口径: ${OWNED_MODE ? "only-owned 显式清单" : `标记(is_test${hasIsTest ? "" : "=无列,降级"})+形态规则`}；older-than=${olderArg}`);
    console.log(`[${mode}] questions: ${n.q} / ${nQall}`);
    console.log(`[${mode}] answers:   ${n.a}`);
    console.log(`[${mode}] comments:  ${n.c}（含回复级联）`);
    console.log(`[${mode}] users:     ${n.u} / ${nUall}`);
    console.log(`[${mode}] collections: ${n.col}`);
    if (!OWNED_MODE && nUall) {
      const skipped = count(db,
        `SELECT COUNT(*) c FROM users u WHERE ${userMatchSql("u", OPTS)} AND u.id NOT IN ${SEL.u}`
      );
      const residA = count(db,
        `SELECT COUNT(*) c FROM answers a JOIN users u ON u.id = a.author_id
         WHERE ${userMatchSql("u", OPTS)} AND a.id NOT IN ${SEL.a}`
      );
      const residC = count(db,
        `SELECT COUNT(*) c FROM comments c JOIN users u ON u.id = c.author_id
         WHERE ${userMatchSql("u", OPTS)} AND c.id NOT IN ${SEL.c}`
      );
      console.log(`[${mode}] 形态命中但保留的账号: ${skipped}（其残留 answers=${residA} comments=${residC} 在真实内容下，不在删除范围）`);
    }
    const samples = db
      .prepare(`SELECT title FROM questions WHERE id IN ${SEL.q} ORDER BY id DESC LIMIT 10`)
      .all();
    for (const r of samples) console.log(`  - ${r.title}`);
  }

  if (!APPLY) {
    (OWNED_MODE ? fillTargetsOwned : fillTargetsPattern)();
    report("dry-run");
    console.log("[dry-run] 未写库。加 --apply 才真正删除。");
  } else {
    let skippedUsers = [];
    const stats = {};
    db.transaction(() => {
      skippedUsers = OWNED_MODE ? fillTargetsOwned() : (fillTargetsPattern(), []);
      report("apply");
      Object.assign(stats, deleteMarked(db));
      recomputeDerived(db);
    })();
    for (const s of skippedUsers) {
      console.warn(`[owned] 跳过 u:${s.id}（${s.nickname} <${s.email}>）—— 非测试账号标记/形态，防误删`);
    }

    // 复核：删除后仍命中口径的行数（JS 侧同口径再数一遍）。
    const dirtyQ = count(db,
      `SELECT COUNT(*) c FROM questions q JOIN users u ON u.id = q.author_id
       WHERE ${questionMatchSql("q", "u", OPTS)}`
    );
    console.log("[apply] 已删除/更新行数（按表）:");
    for (const [k, v] of Object.entries(stats)) if (v) console.log(`  ${k}: ${v}`);
    console.log(`[apply] 剩余 questions=${count(db, "SELECT COUNT(*) c FROM questions")} users=${count(db, "SELECT COUNT(*) c FROM users")}；复核命中口径 questions=${dirtyQ}`);
  }
}

if (MODE === "api") {
  await runApi();
} else {
  runDb();
}
