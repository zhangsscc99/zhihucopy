#!/usr/bin/env node
// scripts/purge-walk-comments.js — 软删除「走查感想」模板评论 + 隐藏批量走查号（Z1169）。
//
// 背景：线上实测 answer#18（/question/6 首条回答）下有 20 条
//   「第NNNN条走查感想：这段关于依赖数组的解释我终于看懂了。」模板评论，
//   作者是 20 个「沈舟拾NNNN」连号走查号；另有「走查：…」「[e2e] …」
//   「走查第42轮：…」等探针残留。访客首屏可见，严重伤害可信度。
//
// 命中规则：复用 server/content-filter.js 的 walkProbeRules（R1–R4，
//   与 POST /comments 写入守卫同一份判定，防两处漂移）。刻意收窄：
//   裸子串「走查」会误杀讨论「代码走查」「走查表」的正常评论，不用。
//   顺带覆盖本轮「走查42」在 answer#1512 的 2 条「走查第42轮：…」评论（R4）。
//
// 处理（同一事务）：
//   1) 命中评论 is_deleted=1 —— 不物理删、不改 id；
//   2) 按 syncCommentCount 同口径（COUNT(*) WHERE is_deleted=0）重算受影响
//      answers.comment_count（questions 表无 comment_count 列，无需处理）；
//   3) 昵称匹配 ^沈舟拾\d{4}$ 且除模板评论外零有效发帖（无问题、无未删回答、
//      无未删非模板评论）的账号置 is_test=1 —— 其昵称/评论不再出现在前台、
//      搜索与通知。注意：这些账号在走查当轮顺手赞过 answer#18 等目标，
//      votes 行属走查产物，不算「有效发帖」；逐账号打印 vote 数供复核。
//
// 用法：
//   node scripts/purge-walk-comments.js                     # dry-run（默认）
//   node scripts/purge-walk-comments.js --apply             # 非生产库写库
//   FIX_ALLOW_PROD=1 node scripts/purge-walk-comments.js --apply
//   node scripts/purge-walk-comments.js --apply --prod      # 生产库（走写闸：
//     ZH_ALLOW_PROD_WRITE=1 + 当日备份齐备才放行，见 prod-write-gate.js）
//
// --apply 前置：写库前 db.backup() 到 data/backups/zhihu-<ts>.db。
// 幂等：已软删/已置 is_test 的行再次运行不再命中，二跑应输出全 0。
// 环境: DB_PATH（默认 ../data/zhihu.db，相对本脚本所在目录解析）。

const fs = require("fs");
const path = require("path");
// better-sqlite3 装在 server/node_modules（root node_modules 是软链且无此包）。
const Database = require(require.resolve("better-sqlite3", {
  paths: [path.join(__dirname, "..", "server")],
}));
const { walkProbeRules } = require("../server/content-filter");
const { resolveWriteMode } = require("./prod-write-gate");

const repoRoot = path.join(__dirname, "..");
const DB_PATH = path.resolve(
  process.env.DB_PATH || path.join(repoRoot, "data", "zhihu.db")
);

const MODE = resolveWriteMode({
  argv: process.argv,
  env: process.env,
  dbPath: DB_PATH,
  scriptName: "purge-walk",
  Database,
});
const APPLY = MODE === "apply";

const RE_BATCH_NICK = /^沈舟拾\d{4}$/;

function listHits(db) {
  return db
    .prepare(
      `SELECT c.id, c.target_type, c.target_id, c.author_id, c.content,
              c.created_at, u.nickname AS author
       FROM comments c JOIN users u ON u.id = c.author_id
       WHERE c.is_deleted = 0 ORDER BY c.id`
    )
    .all()
    .map((r) => ({ ...r, rules: walkProbeRules(r.content) }))
    .filter((r) => r.rules.length > 0);
}

// 批量走查号口径：^沈舟拾\d{4}$，且除模板评论外零有效发帖
// （无问题 / 无未删回答 / 无未删非模板评论）。votes 逐账号列出供复核。
function listFlaggable(db) {
  const users = db
    .prepare(`SELECT id, nickname, email, is_test FROM users WHERE is_test = 0`)
    .all()
    .filter((u) => RE_BATCH_NICK.test(u.nickname || ""));
  const out = [];
  for (const u of users) {
    const q = db.prepare("SELECT COUNT(*) c FROM questions WHERE author_id = ?").get(u.id).c;
    const a = db
      .prepare("SELECT COUNT(*) c FROM answers WHERE author_id = ? AND is_deleted = 0")
      .get(u.id).c;
    const comments = db
      .prepare("SELECT content FROM comments WHERE author_id = ? AND is_deleted = 0")
      .all(u.id);
    const nonTemplate = comments.filter((c) => walkProbeRules(c.content).length === 0).length;
    const votes = db.prepare("SELECT COUNT(*) c FROM votes WHERE user_id = ?").get(u.id).c;
    if (q === 0 && a === 0 && nonTemplate === 0) {
      out.push({ ...u, votes });
    } else {
      console.log(
        `  跳过 ${u.nickname}#${u.id}：有效发帖存在（q=${q} a=${a} 非模板评论=${nonTemplate}）`
      );
    }
  }
  return out;
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[purge-walk] DB 不存在：${DB_PATH}`);
    process.exit(2);
  }
  const db = new Database(DB_PATH, APPLY ? {} : { readonly: true });

  const hasIsTest = db
    .prepare("PRAGMA table_info(users)")
    .all()
    .some((c) => c.name === "is_test");
  if (!hasIsTest) {
    console.error("[purge-walk] users 表无 is_test 列，请先跑迁移（不新造迁移）");
    process.exit(2);
  }

  const hits = listHits(db);
  const flaggable = listFlaggable(db);

  console.log(`[purge-walk] db=${DB_PATH} mode=${APPLY ? "APPLY" : "dry-run"}`);
  for (const h of hits) {
    const target = `${h.target_type}#${h.target_id}`;
    const body = String(h.content).replace(/\s+/g, " ").trim().slice(0, 30);
    console.log(
      `  id=${h.id} | ${target} | ${h.author}#${h.author_id} | ${h.created_at} | ${h.rules.join("+")} | ${body}`
    );
  }
  console.log(`[purge-walk] 命中 ${hits.length} 条模板评论`);
  for (const u of flaggable) {
    console.log(`  置 is_test=1：${u.nickname}#${u.id} <${u.email}>（走查期间 votes=${u.votes}）`);
  }
  console.log(`[purge-walk] 将置 is_test=1 的账号 ${flaggable.length} 个`);

  // 预览 comment_count 变化（answers 才有该冗余列）。
  const answerIds = [...new Set(hits.filter((h) => h.target_type === "answer").map((h) => h.target_id))];
  if (answerIds.length) {
    const rows = db
      .prepare(
        `SELECT id, comment_count,
           (SELECT COUNT(*) FROM comments c WHERE c.target_type='answer'
             AND c.target_id = answers.id AND c.is_deleted = 0) AS live
         FROM answers WHERE id IN (${answerIds.map(() => "?").join(",")})`
      )
      .all(...answerIds);
    for (const r of rows) {
      const del = hits.filter((h) => h.target_type === "answer" && h.target_id === r.id).length;
      console.log(`  answer#${r.id} comment_count ${r.comment_count} -> ${r.live - del}`);
    }
  }

  if (!APPLY) {
    db.close();
    console.log("[purge-walk] dry-run 结束（加 --apply 才写库）");
    return;
  }

  const backupDir = path.join(repoRoot, "data", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `zhihu-${ts}.db`);
  await db.backup(backupPath);
  console.log(`[purge-walk] 写库前备份完成：${backupPath}`);

  const del = db.prepare(
    "UPDATE comments SET is_deleted = 1 WHERE id = ? AND is_deleted = 0"
  );
  // 与 server/routes/comments.js syncCommentCount 同口径重算冗余计数列。
  const sync = db.prepare(
    `UPDATE answers SET comment_count =
       (SELECT COUNT(*) FROM comments c
        WHERE c.target_type = 'answer' AND c.target_id = answers.id AND c.is_deleted = 0)
     WHERE id = ?`
  );
  const flag = db.prepare("UPDATE users SET is_test = 1 WHERE id = ? AND is_test = 0");

  let deleted = 0;
  let flagged = 0;
  const tx = db.transaction(() => {
    for (const h of hits) deleted += del.run(h.id).changes;
    for (const tid of answerIds) sync.run(tid);
    for (const u of flaggable) flagged += flag.run(u.id).changes;
  });
  tx();

  const remaining = listHits(db).length;
  console.log(
    `[purge-walk] 汇总：命中 ${hits.length} / 软删 ${deleted} / 置 is_test ${flagged} / 剩余模板 ${remaining}`
  );
  db.close();
  if (remaining !== 0) {
    console.error(`[purge-walk] FAIL：仍有 ${remaining} 条模板评论未软删`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`[purge-walk] FAIL: ${e.message || e}`);
    process.exit(1);
  });
}
