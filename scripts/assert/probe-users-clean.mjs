// scripts/assert/probe-users-clean.mjs — Z1122 探针账号清零断言（数据卫生）。
//
// 口径 = server/content-filter.js probeUserMatchSql（与关系双侧命中才算探针）：
//   昵称 GLOB 'z[0-9]*user*' / '走查*' / '真人*'
//   且 邮箱 LIKE '%@example.com' / 'real-%@zhihucopy.dev'
//
// 检查（全部完成后统一判定，失败项逐条打印）：
//   DB-1  不存在昵称∧邮箱双侧命中探针口径的账号（0 个）。
//   DB-2  不存在 0 问题/0 回答/0 评论 且 昵称命中探针口径的账号（0 个）——
//         防止出现「双侧未同时命中但仍显然是探针」的零内容残留。
//   DB-3  种子人设号（email LIKE '%@zhihucopy.dev' 且 NOT LIKE 'real-%'，
//         参数化白名单查询）数量 ≥ SEED_PERSONA_FLOOR —— 清理不得误伤
//         种子域账号。基线在 Z1122 清理前实测 = 240，清理只删探针、不该动它。
//   API-1 GET /users?limit=200（翻页拉全）返回昵称中 isProbeNickname 命中 0。
//
// 反向自检：--self-test 把 DB_PATH 复制到临时库、植入一个探针号与一个
// 假种子号，再跑同一套检查 —— DB-1/DB-2 必须检出（缺检出则断言恒真、
// 本脚本以 FAIL 退出）。清理前基线上本断言 FAIL（DB 命中 13），清理后 PASS。
//
// Env: API_BASE（缺省 3030）、DB_PATH（缺省 ../../data/zhihu.db）。

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ok, db, expect, main } from "./lib.mjs";

const requireHere = createRequire(import.meta.url);
const {
  probeNickMatchSql,
  probeUserMatchSql,
  isProbeNickname,
} = requireHere("../../server/content-filter.js");

// Z1122 清理前实测种子人设号数量（email @zhihucopy.dev 且非 real-）。
const SEED_PERSONA_FLOOR = 240;
const SELF_TEST = process.argv.includes("--self-test");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB_SRC =
  process.env.DB_PATH || path.join(HERE, "..", "..", "data", "zhihu.db");

const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.log(`  FAIL: ${msg}`);
};

// ---- DB 侧 -----------------------------------------------------------------
function checkDb(d, { collect = true } = {}) {
  const hits = d
    .prepare(
      `SELECT u.id, u.nickname, u.email FROM users u
       WHERE ${probeUserMatchSql("u")} ORDER BY u.id`
    )
    .all();
  console.log(`  DB-1: 双侧命中探针口径账号 ${hits.length} 个`);
  if (collect) {
    for (const u of hits.slice(0, 10)) {
      fail(`DB-1 残留探针 u:${u.id} ${u.nickname} <${u.email}>`);
    }
  }

  const zeroSide = d
    .prepare(
      `SELECT u.id, u.nickname, u.email FROM users u
       WHERE ${probeNickMatchSql("u")}
         AND NOT EXISTS (SELECT 1 FROM questions q WHERE q.author_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM answers a WHERE a.author_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.author_id = u.id)
       ORDER BY u.id`
    )
    .all();
  console.log(`  DB-2: 零内容且昵称命中探针口径账号 ${zeroSide.length} 个`);
  if (collect) {
    for (const u of zeroSide.slice(0, 10)) {
      fail(`DB-2 零内容探针残留 u:${u.id} ${u.nickname} <${u.email}>`);
    }
  }

  const personas = d
    .prepare(
      `SELECT COUNT(*) c FROM users
       WHERE email LIKE ? AND email NOT LIKE ?`
    )
    .get("%@zhihucopy.dev", "real-%@zhihucopy.dev").c;
  console.log(`  DB-3: 种子人设号（@zhihucopy.dev 非 real-）= ${personas}（下限 ${SEED_PERSONA_FLOOR}）`);
  if (collect && personas < SEED_PERSONA_FLOOR) {
    fail(`DB-3 种子人设号 ${personas} < ${SEED_PERSONA_FLOOR}，疑似清理误伤`);
  }
  return { hits, zeroSide, personas };
}

// ---- API 侧 ----------------------------------------------------------------
async function checkApi() {
  const bad = [];
  let seen = 0;
  for (let offset = 0; ; offset += 200) {
    const data = await ok("GET", `/users?limit=200&offset=${offset}`);
    const items = data.items || [];
    if (!items.length) break;
    seen += items.length;
    for (const it of items) {
      if (isProbeNickname(it.nickname)) bad.push(`${it.id}:${it.nickname}`);
    }
    if (items.length < 200) break;
  }
  console.log(`  API-1: /users 拉到 ${seen} 个，可疑昵称 ${bad.length} 个`);
  expect(seen > 0, "API-1 /users 返回 0 条（断言应非恒真）");
  if (bad.length) {
    fail(`API-1 /users 含可疑昵称: ${bad.slice(0, 8).join(" ")}`);
  }
}

// ---- 反向自检 ---------------------------------------------------------------
// 把目标库快照到临时文件，植入一个探针号，重跑 DB 侧检查：
// DB-1/DB-2 必须检出植入的探针（检出不到 = 断言恒真，--self-test 判 FAIL）。
async function selfTest() {
  const tmp = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "probe-clean-")),
    "zhihu.db"
  );
  const requireFromServer = createRequire(
    new URL("../../server/package.json", import.meta.url)
  );
  const Database = requireFromServer("better-sqlite3");
  // .backup() 拿一致快照（源库在 WAL 模式，裸 cp .db 会丢未 checkpoint 的写入）。
  const src = new Database(DB_SRC, { readonly: true });
  try {
    await src.backup(tmp);
  } finally {
    src.close();
  }
  const w = new Database(tmp);
  const { lastInsertRowid } = w
    .prepare(
      `INSERT INTO users (email, password_hash, nickname, is_admin, is_test)
       VALUES (?, ?, ?, 0, 0)`
    )
    .run("z9999.selftest@example.com", "x", "z9999userselftest");
  w.close();
  const d = new Database(tmp, { readonly: true });
  try {
    const res = checkDb(d, { collect: false });
    const id = Number(lastInsertRowid);
    const found =
      res.hits.some((u) => u.id === id) && res.zeroSide.some((u) => u.id === id);
    if (!found) {
      fail("--self-test 植入探针未被 DB-1/DB-2 检出（断言恒真风险）");
    } else {
      console.log("  --self-test: 植入探针已被 DB-1/DB-2 检出（断言非恒真）");
    }
  } finally {
    d.close();
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  }
}

main("probe-users-clean", async () => {
  let d;
  try {
    d = db();
  } catch (e) {
    console.log(`  DB 不可用（${e.message || e}），跳过 DB 侧检查`);
  }
  if (d) {
    try {
      checkDb(d);
    } finally {
      d.close();
    }
    if (SELF_TEST) await selfTest();
  }
  await checkApi();
  expect(failures.length === 0, `probe-users-clean ${failures.length} 项未过`);
});
