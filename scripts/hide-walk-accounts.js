#!/usr/bin/env node
// scripts/hide-walk-accounts.js — 软隐藏「沈舟拾NNNN」走查空号（Z1178）。
//
// 背景：外部定时走查任务（product-walkthrough，不在本仓库）持续以
//   review<6位数字>@zhihucopy.dev 邮箱注册「沈舟拾NNNN」昵称空号（零提问/
//   零回答/零评论），注册时 is_test=0 会漏进 /api/users?q= 用户搜索。
//   服务端根治在 server/routes/auth.js（命中 isWalkAccount 即落 is_test=1），
//   本脚本负责存量清理：把已存在的零产出空号软置 is_test=1 —— 不物理删、
//   不改 id、不删行，公共读路径（testUserSql）从此将其过滤。
//
// 命中口径：nickname 命中 ^沈舟拾\d{4}$ 且零有效产出
//   （questions=0、未删 answers=0、未删 comments=0）。有产出的号跳过并打印
//   SKIP (有产出)，绝不误伤真人同名号。
//
// 用法：
//   node scripts/hide-walk-accounts.js                      # dry-run（默认，退出码 0）
//   node scripts/hide-walk-accounts.js --apply              # 非生产库写库
//   node scripts/hide-walk-accounts.js --apply --db <path>  # 指定库（副本/自测）
//   node scripts/hide-walk-accounts.js --apply --prod       # 生产库（走写闸：
//     ZH_ALLOW_PROD_WRITE=1 + 当日备份齐备才放行，见 prod-write-gate.js）
//
// --apply 前置：写库前 db.backup() 到 data/backups/zhihu-YYYYMMDD-HHmm.db。
// 幂等：已置 is_test 的号不再命中，二跑输出「0 条需处理」。
// 环境: DB_PATH（默认 ../data/zhihu.db，相对本脚本所在目录解析；--db 优先）。

const fs = require("fs");
const path = require("path");
// better-sqlite3 装在 server/node_modules（root node_modules 是软链且无此包）。
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
  scriptName: "hide-walk-accounts",
  Database,
});
const APPLY = MODE === "apply";

const RE_BATCH_NICK = /^沈舟拾\d{4}$/;

// 命中清单：^沈舟拾\d{4}$ 且 is_test=0 且零有效产出（q=0、未删 a=0、未删 c=0）。
// 有产出跳过（SKIP 打印）；is_test=1 的已隐藏号不重复计入（幂等口径）。
function listTargets(db) {
  const qHasDel = db
    .prepare("PRAGMA table_info(questions)")
    .all()
    .some((c) => c.name === "is_deleted");
  const users = db
    .prepare(
      `SELECT id, nickname, email, is_test, created_at FROM users
       WHERE is_test = 0 AND nickname GLOB '沈舟拾*' ORDER BY id`
    )
    .all()
    .filter((u) => RE_BATCH_NICK.test(u.nickname || ""));
  const out = [];
  for (const u of users) {
    const q = db
      .prepare(
        `SELECT COUNT(*) c FROM questions WHERE author_id = ?${qHasDel ? " AND is_deleted = 0" : ""}`
      )
      .get(u.id).c;
    const a = db
      .prepare("SELECT COUNT(*) c FROM answers WHERE author_id = ? AND is_deleted = 0")
      .get(u.id).c;
    const c = db
      .prepare("SELECT COUNT(*) c FROM comments WHERE author_id = ? AND is_deleted = 0")
      .get(u.id).c;
    if (q === 0 && a === 0 && c === 0) {
      out.push({ ...u, q, a, c });
    } else {
      console.log(`  SKIP (有产出) ${u.nickname}#${u.id}：q=${q} a=${a} c=${c}`);
    }
  }
  return out;
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[hide-walk] DB 不存在：${DB_PATH}`);
    process.exit(2);
  }
  const db = new Database(DB_PATH, APPLY ? {} : { readonly: true });

  const hasIsTest = db
    .prepare("PRAGMA table_info(users)")
    .all()
    .some((c) => c.name === "is_test");
  if (!hasIsTest) {
    console.error("[hide-walk] users 表无 is_test 列，请先跑迁移（不新造迁移）");
    process.exit(2);
  }

  const targets = listTargets(db);
  console.log(`[hide-walk] db=${DB_PATH} mode=${APPLY ? "APPLY" : "dry-run"}`);
  for (const u of targets) {
    console.log(
      `  隐藏 ${u.nickname}#${u.id} <${u.email}> is_test=${u.is_test} created_at=${u.created_at}（q=${u.q} a=${u.a} c=${u.c}）`
    );
  }
  console.log(`[hide-walk] ${targets.length} 条需处理`);

  if (!APPLY) {
    db.close();
    console.log("[hide-walk] dry-run 结束（加 --apply 才写库）");
    return;
  }

  const backupDir = path.join(repoRoot, "data", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const backupPath = path.join(backupDir, `zhihu-${stamp}.db`);
  await db.backup(backupPath);
  console.log(`[hide-walk] 写库前备份完成：${backupPath}`);

  const flag = db.prepare("UPDATE users SET is_test = 1 WHERE id = ? AND is_test = 0");
  let flagged = 0;
  db.transaction(() => {
    for (const u of targets) flagged += flag.run(u.id).changes;
  })();

  const remaining = listTargets(db).length;
  console.log(`[hide-walk] 汇总：命中 ${targets.length} / 置 is_test ${flagged} / 剩余未隐藏 ${remaining}`);
  db.close();
  if (remaining !== 0) {
    console.error(`[hide-walk] FAIL：仍有 ${remaining} 个空号未置 is_test`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`[hide-walk] FAIL: ${e.message || e}`);
    process.exit(1);
  });
}
