#!/usr/bin/env node
// scripts/clean-probe-users.js — 物理删除断言探针账号（Z1121 起，Z1122 扩展口径）。
//
// 背景：scripts/assert/ 下 follows/questions/notifications/search-page 等脚本
// 注册「真人<随机串>」+ real-*@zhihucopy.dev 的真实形态探针号，更早期的
// 巡检脚本留下 z985user*/z1028user*/走查员* + *@example.com 残留，跑完没被
// 自清理财掉（cleanup 的 u: 守卫把它们当种子域/普通号保护），把
// nickname-realism 断言压向临界。本脚本按三条件交集定点删除：
//   1) nickname 命中 probeNickMatchSql：GLOB 'z[0-9]*user*' / '走查*' / '真人*'
//   2) email 命中 probeEmailMatchSql：LIKE '%@example.com' / 'real-%@zhihucopy.dev'
//   3) 该账号在 questions/answers/comments/votes（含 question_votes）上全为 0
// 1)∧2) 是 content-filter.js 的 probeUserMatchSql（与关系，本脚本直接复用，
// 不另写一份 SQL）；任一不满足 → 跳过并打印原因（被 fix-nicknames 改过名的
// real-* 账号、@example.com 普通号、已产生内容的账号一律不动）。
//
// 用法:
//   node scripts/clean-probe-users.js [--db <path>]            # dry-run
//   node scripts/clean-probe-users.js --db /tmp/x.db --apply   # 临时库真删
//   node scripts/clean-probe-users.js --apply --prod --db /www/zhihucopy/data/zhihu.db
// 安全:
//   - 默认 dry-run，只打印不写入；--apply 才写库。
//   - 写库前先 db.backup() 到 <db目录>/backups/zhihu-<YYYYMMDD-HHmm>-probe-users.db。
//   - 目标是生产库时走 scripts/prod-write-gate.js：须 --apply + --prod +
//     ZH_ALLOW_PROD_WRITE=1 + 当日有效备份（本脚本刚做的 backup 即满足）。
//   - 单事务删依赖（follows/votes/notifications/user_badges/collections 等）
//     再删 users；幂等，二次运行 0 命中。

"use strict";

const fs = require("fs");
const path = require("path");

const HERE = __dirname;
const REPO = path.join(HERE, "..");
const Database = require(require.resolve("better-sqlite3", {
  paths: [path.join(REPO, "server")],
}));
const { resolveWriteMode } = require("./prod-write-gate.js");
const {
  probeNickMatchSql,
  probeEmailMatchSql,
  probeUserMatchSql,
  isProbeNickname,
  isProbeEmail,
} = require("../server/content-filter.js");
const {
  initDelTables,
  cascadeFromDelUsers,
  deleteMarked,
  recomputeDerived,
  delCounts,
} = require("../server/artifact-cleanup.js");

function usage(rc = 0) {
  console.log(`用法: node scripts/clean-probe-users.js [--db <path>|--db=<path>] [--apply] [--prod] [--dry-run]
  默认 dry-run。删除条件（同时满足）：昵称 GLOB 'z[0-9]*user*'/'走查*'/'真人*'、
  邮箱 LIKE '%@example.com'/'real-%@zhihucopy.dev'（probeUserMatchSql）、
  q/a/c/votes 全为 0。
  生产库写需 --apply --prod ZH_ALLOW_PROD_WRITE=1（prod-write-gate）。`);
  process.exit(rc);
}

const argv = process.argv.slice(2);
let dbArg = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--apply" || a === "--prod" || a === "--dry-run") continue;
  if (a === "-h" || a === "--help") usage(0);
  if (a === "--db") {
    dbArg = argv[++i];
  } else if (a.startsWith("--db=")) {
    dbArg = a.slice("--db=".length);
  } else if (a === "--backup") {
    i++; // 透传给 prod-write-gate（findTodayBackup 会解析）
  } else if (a.startsWith("--backup=")) {
    // 同上
  } else {
    console.error(`未知参数: ${a}`);
    usage(2);
  }
}

const DB_PATH = path.resolve(dbArg || process.env.DB_PATH || path.join(REPO, "data", "zhihu.db"));
const APPLY = argv.includes("--apply") || process.env.FIX_ALLOW_PROD === "1";

if (!fs.existsSync(DB_PATH)) {
  console.error(`[abort] DB 不存在: ${DB_PATH}`);
  process.exit(2);
}

const pad = (n) => String(n).padStart(2, "0");
function stamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

const NICK_COND = probeNickMatchSql("u");
const EMAIL_COND = probeEmailMatchSql("u");

// 账号在公开内容上全为 0（votes/question_votes 缺一表按 0 计）。
function contentCounts(db, uid) {
  const one = (sql) => {
    try {
      return db.prepare(sql).get(uid).c;
    } catch (e) {
      if (/no such table/.test(e.message)) return 0;
      throw e;
    }
  };
  return {
    questions: one("SELECT COUNT(*) c FROM questions WHERE author_id = ?"),
    answers: one("SELECT COUNT(*) c FROM answers WHERE author_id = ?"),
    comments: one("SELECT COUNT(*) c FROM comments WHERE author_id = ?"),
    votes:
      one("SELECT COUNT(*) c FROM votes WHERE user_id = ?") +
      one("SELECT COUNT(*) c FROM question_votes WHERE user_id = ?"),
  };
}

// 将连带删除的依赖行数（dry-run 展示用）。
function depCounts(db, selU) {
  const one = (sql) => {
    try {
      return db.prepare(sql).get().c;
    } catch (e) {
      if (/no such table/.test(e.message)) return 0;
      throw e;
    }
  };
  return {
    follows: one(
      `SELECT COUNT(*) c FROM follows WHERE follower_id IN ${selU}
        OR (target_type = 'user' AND target_id IN ${selU})`
    ),
    votes:
      one(`SELECT COUNT(*) c FROM votes WHERE user_id IN ${selU}`) +
      one(`SELECT COUNT(*) c FROM question_votes WHERE user_id IN ${selU}`),
    notifications: one(
      `SELECT COUNT(*) c FROM notifications WHERE user_id IN ${selU}
        OR actor_id IN ${selU}
        OR (target_type = 'user' AND target_id IN ${selU})`
    ),
    user_badges: one(`SELECT COUNT(*) c FROM user_badges WHERE user_id IN ${selU}`),
    collections: one(`SELECT COUNT(*) c FROM collections WHERE owner_id IN ${selU}`),
  };
}

async function main() {
  const db = new Database(DB_PATH, APPLY ? {} : { readonly: true });
  db.pragma("foreign_keys = ON");

  // 候选 = 命中昵称或邮箱任一形态；三条件全过才进删除集。
  const candidates = db
    .prepare(
      `SELECT u.id, u.nickname, u.email, u.is_admin FROM users u
       WHERE ${NICK_COND} OR ${EMAIL_COND} ORDER BY u.id`
    )
    .all();

  const keep = []; // {row, ids}
  const skipped = [];
  for (const u of candidates) {
    const nickOk = isProbeNickname(u.nickname);
    const emailOk = isProbeEmail(u.email);
    if (!nickOk || !emailOk) {
      skipped.push(
        `u:${u.id}（${u.nickname} <${u.email}>）跳过 —— ` +
          [
            !nickOk && "昵称非探针形态（z[0-9]*user*/走查*/真人*）",
            !emailOk && "邮箱非探针形态（*@example.com/real-*@zhihucopy.dev）",
          ]
            .filter(Boolean)
            .join("；")
      );
      continue;
    }
    if (u.is_admin) {
      skipped.push(`u:${u.id}（${u.nickname} <${u.email}>）跳过 —— 管理员`);
      continue;
    }
    const cc = contentCounts(db, u.id);
    const dirty = Object.entries(cc).filter(([, n]) => n > 0);
    if (dirty.length) {
      skipped.push(
        `u:${u.id}（${u.nickname} <${u.email}>）跳过 —— 有残留内容 ` +
          dirty.map(([k, n]) => `${k}=${n}`).join(",")
      );
      continue;
    }
    keep.push(u);
  }

  console.log(`[clean-probe-users] DB: ${DB_PATH}`);
  console.log(`[clean-probe-users] 候选 ${candidates.length}，可删 ${keep.length}，跳过 ${skipped.length}`);
  for (const s of skipped) console.log(`  skip ${s}`);

  const ids = keep.map((u) => u.id);
  const selU = `(SELECT id FROM _del_u)`;

  if (!ids.length) {
    console.log("[clean-probe-users] 0 命中，无需删除。");
    db.close();
    return;
  }
  for (const u of keep) console.log(`  del u:${u.id} ${u.nickname} <${u.email}>`);

  if (!APPLY) {
    initDelTables(db);
    const ins = db.prepare("INSERT OR IGNORE INTO _del_u (id) VALUES (?)");
    for (const id of ids) ins.run(id);
    const d = depCounts(db, selU);
    console.log(
      `[dry-run] 连带删除 follows=${d.follows} votes=${d.votes} notifications=${d.notifications} ` +
        `user_badges=${d.user_badges} collections=${d.collections}`
    );
    console.log("[dry-run] 未写库。加 --apply 才真正删除。");
    db.close();
    return;
  }

  // 写前备份（先于 prod-write-gate：备份产物本身即满足「当日备份」闸项）。
  const backupDir = path.join(path.dirname(DB_PATH), "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `zhihu-${stamp()}-probe-users.db`);
  await db.backup(backupPath);
  console.log(`[apply] 备份 -> ${backupPath}`);

  resolveWriteMode({
    argv,
    env: process.env,
    dbPath: DB_PATH,
    scriptName: "clean-probe-users",
    Database,
  });

  const stats = {};
  db.transaction(() => {
    initDelTables(db);
    const ins = db.prepare("INSERT OR IGNORE INTO _del_u (id) VALUES (?)");
    for (const id of ids) ins.run(id);
    cascadeFromDelUsers(db); // 保底级联（三条件已保证无内容，正常全为空集）
    Object.assign(stats, deleteMarked(db));
    recomputeDerived(db);
  })();

  console.log("[apply] 已删除/更新行数（按表）:");
  for (const [k, v] of Object.entries(stats)) if (v) console.log(`  ${k}: ${v}`);
  const left = db
    .prepare(`SELECT COUNT(*) c FROM users u WHERE ${probeUserMatchSql("u")}`)
    .get().c;
  console.log(`[apply] 完成；剩余命中探针口径账号 ${left}`);
  db.close();
}

main().catch((e) => {
  console.error(`[abort] ${e.stack || e}`);
  process.exit(1);
});
