#!/usr/bin/env node
// scripts/clean-residue-comments.js — 软删除断言/巡检残留的公开评论（Z1101）。
//
// 背景：content-filter 的正文标记口径漏掉了「正文以 ≥5 位纯数字结尾」这类
// 断言产物（如 comment#497「…清理函数就是退租 411293」，作者为真实种子号，
// 不被 is_test/邮箱域规则命中），残留会渲染在真实问题评论区。
//
// 命中规则（仅 is_deleted=0 的行参与扫描）：
//   R1  正文以 ≥5 位纯数字结尾（允许尾随空格）——断言脚本的随机尾标形态；
//   R2a 正文含 巡检|走查评论|[e2e]|[assert]（大小写不敏感）——巡检/断言标记；
//   R2b 第[一二三四五六七八九十百0-9]{1,4}轮走查 ——轮次走查探针（Z1130）；
//   R2c 走查[0-9]{4,} ——带随机数的走查标记（Z1130）；
//   R2d 行首「走查」（(?!表) 排除「走查表」开头）——短探针（Z1130）。
//   注意 R2b/R2c/R2d 刻意不用裸子串「走查」：正文讨论「走查表」「代码走查」
//   属正常内容，仅收窄到探针形态（Z1086 收窄时曾把走查形态整个丢掉）。
//
// 处理：软删除（is_deleted=1），不物理删除；同事务内按 syncCommentCount
// 同口径（COUNT(*) WHERE is_deleted=0）重算受影响 answers.comment_count。
//
// 用法:
//   node scripts/clean-residue-comments.js                       # dry-run
//   FIX_ALLOW_PROD=1 node scripts/clean-residue-comments.js --apply
//
// --apply 前置：写库前 db.backup() 到 data/backups/zhihu-<ts>.db。
// 环境: DB_PATH（默认 ../data/zhihu.db，相对本脚本所在目录解析）。

const fs = require("fs");
const path = require("path");
// better-sqlite3 装在 server/node_modules（root node_modules 是软链且无此包）。
const Database = require(require.resolve("better-sqlite3", {
  paths: [path.join(__dirname, "..", "server")],
}));

const APPLY = process.argv.includes("--apply");
const repoRoot = path.join(__dirname, "..");
const DB_PATH = path.resolve(
  process.env.DB_PATH || path.join(repoRoot, "data", "zhihu.db")
);

if (APPLY && process.env.FIX_ALLOW_PROD !== "1") {
  console.error(
    "[clean-residue] 拒绝写库：--apply 需要显式 FIX_ALLOW_PROD=1（dry-run 不带 --apply 即可）"
  );
  process.exit(2);
}

const RE_TRAILING_DIGITS = /\d{5,}\s*$/;
const RE_MARKER = /巡检|走查评论|\[e2e\]|\[assert\]/i;
const RE_WALK_ROUND = /第[一二三四五六七八九十百0-9]{1,4}轮走查/;
const RE_WALK_DIGITS = /走查\d{4,}/;
const RE_WALK_HEAD = /^\s*走查(?!表)/;

function matchRules(content) {
  const rules = [];
  if (typeof content !== "string" || !content.trim()) return rules;
  if (RE_TRAILING_DIGITS.test(content)) rules.push("R1:尾部纯数字>=5位");
  if (RE_MARKER.test(content)) rules.push("R2a:巡检/走查评论/e2e/assert标记");
  if (RE_WALK_ROUND.test(content)) rules.push("R2b:第N轮走查");
  if (RE_WALK_DIGITS.test(content)) rules.push("R2c:走查+数字>=4位");
  if (RE_WALK_HEAD.test(content)) rules.push("R2d:走查开头");
  return rules;
}

module.exports = { matchRules };

async function main() {
  const db = new Database(DB_PATH, APPLY ? {} : { readonly: true });
  const rows = db
    .prepare(
      `SELECT c.id, c.target_type, c.target_id, c.content, u.nickname AS author
       FROM comments c JOIN users u ON u.id = c.author_id
       WHERE c.is_deleted = 0
       ORDER BY c.id`
    )
    .all();

  const hits = rows
    .map((r) => ({ ...r, rules: matchRules(r.content) }))
    .filter((r) => r.rules.length > 0);

  console.log(`[clean-residue] db=${DB_PATH} mode=${APPLY ? "APPLY" : "dry-run"}`);
  for (const h of hits) {
    const target = `${h.target_type}#${h.target_id}`;
    const body = String(h.content).replace(/\s+/g, " ").trim().slice(0, 40);
    console.log(
      `  id=${h.id} | ${target} | ${h.author} | ${h.rules.join("+")} | ${body}`
    );
  }
  console.log(
    `[clean-residue] 命中 ${hits.length} 条（扫描 ${rows.length} 条未删除评论）`
  );

  if (!APPLY) {
    db.close();
    return;
  }

  const backupDir = path.join(repoRoot, "data", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `zhihu-${ts}.db`);
  await db.backup(backupPath);
  console.log(`[clean-residue] 写库前备份完成：${backupPath}`);

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

  let deleted = 0;
  const tx = db.transaction(() => {
    const answerTargets = new Set();
    for (const h of hits) {
      const info = del.run(h.id);
      deleted += info.changes;
      if (h.target_type === "answer") answerTargets.add(h.target_id);
    }
    for (const tid of answerTargets) sync.run(tid);
  });
  tx();

  console.log(
    `[clean-residue] 软删 ${deleted} 条 / 跳过 ${rows.length - hits.length} 条`
  );
  db.close();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`[clean-residue] FAIL: ${e.message || e}`);
    process.exit(1);
  });
}
