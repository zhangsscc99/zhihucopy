#!/usr/bin/env node
// scripts/mark-fixtures.js — 历史测试数据回填 is_fixture=1（Z1204 读路径过滤）。
//
// 背景：线上首屏与问题页被守卫上线前已入库的历史夹具污染
//   （「走查问题NNN？」/作者「真人nm…」/「巡检回答 r-…」/「回答正文 NNNNNN」），
//   写入侧 is_test/content-filter 只挡新数据。服务端改在公共读路径 SQL 层
//   追加 is_fixture = 0，本脚本负责把存量夹具回填成 is_fixture=1 ——
//   不物理删、不改 id、不动其他列。
//
// 命中口径（JS 侧逐行判定，避免巨型 SQL）：
//   questions: title 命中 ^(走查问题|关注流新回答场景)|^测试 或
//              「场景的提问 <小写token≥6>」，或作者昵称命中
//              真人nm|巡检用户|mw[a-z0-9]{6,}$
//   answers:   正文命中 ^回答正文 \d+$|巡检回答 |巡检问题|走查记录，
//              或作者昵称命中同一组规则，或所属问题已是夹具
//
// 用法：
//   node scripts/mark-fixtures.js                      # dry-run（默认，退出码 0）
//   node scripts/mark-fixtures.js --apply              # 非生产库写库
//   node scripts/mark-fixtures.js --apply --db <path>  # 指定库（副本/自测）
//   node scripts/mark-fixtures.js --apply --prod       # 生产库（走 prod-write-gate：
//     ZH_ALLOW_PROD_WRITE=1 + 当日备份齐备才放行）
//
// --apply 前置：写库前 db.backup() 到 <db目录>/backups/zhihu-YYYYMMDD-HHmm.db。
// 幂等：已置 is_fixture=1 的行不再命中，二跑输出「0 条需处理」。
// 环境: DB_PATH（默认 ../data/zhihu.db，相对本脚本所在目录解析；--db 优先）。

"use strict";

const fs = require("fs");
const path = require("path");
// better-sqlite3 装在 server/node_modules（与 hide-walk-accounts.js 同口径）。
const Database = require(require.resolve("better-sqlite3", {
  paths: [path.join(__dirname, "..", "server")],
}));
const { resolveWriteMode } = require("./prod-write-gate");

const repoRoot = path.join(__dirname, "..");

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? path.resolve(v) : null;
}

const DB_PATH = path.resolve(
  argValue("--db") || process.env.DB_PATH || path.join(repoRoot, "data", "zhihu.db")
);

const MODE = resolveWriteMode({
  argv: process.argv,
  env: process.env,
  dbPath: DB_PATH,
  scriptName: "mark-fixtures",
  Database,
});
const APPLY = MODE === "apply";

// ---- 命中规则（与任务书/断言脚本同一组正则） ---------------------------------
const Q_TITLE_RE = /^(走查问题|关注流新回答场景)|^测试/;
const Q_SCENE_RE = /场景的提问 [a-z0-9]{6,}/;
const NICK_RE = /真人nm|巡检用户|mw[a-z0-9]{6,}$/;
const A_BODY_RE = /^回答正文 \d+$|巡检回答 |巡检问题|走查记录/;

function hitReason(title, nickname) {
  if (Q_TITLE_RE.test(title || "")) return "title:走查/测试前缀";
  if (Q_SCENE_RE.test(title || "")) return "title:场景的提问+token";
  if (NICK_RE.test(nickname || "")) return "author:夹具昵称";
  return null;
}

function ensureFixtureColumn(db, table) {
  const has = db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((c) => c.name === "is_fixture");
  if (!has) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN is_fixture INTEGER NOT NULL DEFAULT 0`);
  }
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[mark-fixtures] DB 不存在：${DB_PATH}`);
    process.exit(2);
  }
  const db = new Database(DB_PATH, APPLY ? {} : { readonly: true });
  // dry-run 只读打开也能补列（readonly 下 ALTER 会抛）——先判再决定打开方式：
  // 简化处理：APPLY 才补列；dry-run 无列时按全量未标记对待。
  const hasCol = (t) =>
    db.prepare(`PRAGMA table_info(${t})`).all().some((c) => c.name === "is_fixture");
  if (APPLY) {
    ensureFixtureColumn(db, "questions");
    ensureFixtureColumn(db, "answers");
  }
  const qMarked = hasCol("questions") ? "is_fixture = 0" : "1 = 1";
  const aMarked = hasCol("answers") ? "is_fixture = 0" : "1 = 1";

  console.log(`[mark-fixtures] db=${DB_PATH} mode=${APPLY ? "APPLY" : "dry-run"}`);

  const questions = db
    .prepare(
      `SELECT q.id, q.title, u.nickname AS author_nickname
       FROM questions q JOIN users u ON u.id = q.author_id
       WHERE ${qMarked} ORDER BY q.id`
    )
    .all()
    .map((q) => ({ ...q, reason: hitReason(q.title, q.author_nickname) }))
    .filter((q) => q.reason);
  const fixtureQids = new Set(questions.map((q) => q.id));
  if (hasCol("questions")) {
    for (const r of db
      .prepare("SELECT id FROM questions WHERE is_fixture = 1")
      .all()) {
      fixtureQids.add(r.id);
    }
  }

  const answers = db
    .prepare(
      `SELECT a.id, a.content_md, a.question_id, u.nickname AS author_nickname
       FROM answers a JOIN users u ON u.id = a.author_id
       WHERE ${aMarked} ORDER BY a.id`
    )
    .all()
    .map((a) => {
      let reason = null;
      if (A_BODY_RE.test(a.content_md || "")) reason = "body:夹具正文";
      else if (NICK_RE.test(a.author_nickname || "")) reason = "author:夹具昵称";
      else if (fixtureQids.has(a.question_id)) reason = "parent:夹具问题";
      return { ...a, reason };
    })
    .filter((a) => a.reason);

  for (const q of questions.slice(0, 20)) {
    console.log(
      `  Q#${q.id} ${JSON.stringify((q.title || "").slice(0, 40))} 作者=${q.author_nickname} (${q.reason})`
    );
  }
  if (questions.length > 20) console.log(`  … questions 另有 ${questions.length - 20} 条`);
  for (const a of answers.slice(0, 20)) {
    console.log(
      `  A#${a.id} q=${a.question_id} ${JSON.stringify((a.content_md || "").slice(0, 40))} 作者=${a.author_nickname} (${a.reason})`
    );
  }
  if (answers.length > 20) console.log(`  … answers 另有 ${answers.length - 20} 条`);
  console.log(
    `[mark-fixtures] 命中 questions=${questions.length} answers=${answers.length}`
  );

  if (!APPLY) {
    db.close();
    console.log("[mark-fixtures] dry-run 结束（加 --apply 才写库）");
    return;
  }

  const backupDir = path.join(path.dirname(DB_PATH), "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const backupPath = path.join(backupDir, `zhihu-${stamp}.db`);
  await db.backup(backupPath);
  console.log(`[mark-fixtures] 写库前备份完成：${backupPath}`);

  const flagQ = db.prepare("UPDATE questions SET is_fixture = 1 WHERE id = ? AND is_fixture = 0");
  const flagA = db.prepare("UPDATE answers SET is_fixture = 1 WHERE id = ? AND is_fixture = 0");
  let fq = 0;
  let fa = 0;
  db.transaction(() => {
    for (const q of questions) fq += flagQ.run(q.id).changes;
    for (const a of answers) fa += flagA.run(a.id).changes;
  })();
  console.log(
    `[mark-fixtures] 汇总：命中 questions=${questions.length} answers=${answers.length} / 置位 questions=${fq} answers=${fa}`
  );
  db.close();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`[mark-fixtures] FAIL: ${e.message || e}`);
    process.exit(1);
  });
}
