// Z1169 — 「走查感想」模板评论清零 + 写入守卫断言（HTTP 级 + 数据级 self-test）。
//
// 契约（线上 /question/6 首条回答 answer#18，与 purge-walk-comments.js 配套）：
//   1) GET /comments?target_type=answer&target_id=18（接口一次返回全量树）
//      正文匹配 /走查感想|走查：|e2e/i 且 is_deleted=0 的评论数 = 0；
//   2) 该回答可见评论 total ≥ 35（证明真人评论没被误删）；
//   3) GET /users?q=沈舟拾 返回 0 条（20 个连号走查号已 is_test=1 隐藏）；
//   4) 用「走查42」账号 token POST /comments 发「第1条走查感想：测试」
//      必须 403，且该回答 comment_count 与调用前一致（不入库、不动计数）；
//   5) 间隔巡检：连续两次采样，间隔 ZH_WALK_INTERVAL_MS（默认 300000=5min，
//      =0 跳过等待——仅本地调试用；CI/线上走默认值，脚本不自覆盖）；
//   6) --self-test：复制 DB_PATH 库到临时文件，植入 5 条模板评论 + 3 个
//      「沈舟拾NNNN」号，跑 purge-walk-comments.js --apply 后必须清干净；
//   7) 反向自检：基线（清理前）运行本断言应 FAIL——脚本启动时打印提示。
//
// 环境：API_BASE（默认 http://127.0.0.1:3030/zhihucopy/api）；
//       DB_PATH（self-test 的母库与「走查42」查号用，默认 ../data/zhihu.db）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, main, req, ok, login } from "./lib.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const requireHere = createRequire(import.meta.url);
const requireFromServer = createRequire(
  path.join(SCRIPT_DIR, "..", "..", "server", "package.json")
);
const { walkProbeRules, isWalkProbeContent } = requireHere("../../server/content-filter.js");
const { signToken } = requireHere("../../server/util.js");

const DB_PATH = path.resolve(
  process.env.DB_PATH || path.join(SCRIPT_DIR, "..", "..", "data", "zhihu.db")
);
const SELF_TEST = process.argv.includes("--self-test");
const INTERVAL_MS = process.env.ZH_WALK_INTERVAL_MS !== undefined
  ? Number(process.env.ZH_WALK_INTERVAL_MS)
  : 300000;
const MIN_VISIBLE = 35; // 契约 2：首条回答可见评论下限（含软删占位，防误删）

const RE_TEMPLATE = /走查感想|走查：|e2e/i;

function openDb(p, readonly = true) {
  const Database = requireFromServer("better-sqlite3");
  return new Database(p, { readonly });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- HTTP 级采样：answer#18 评论区模板评论数 -----------------------------
async function sampleWalkComments() {
  const data = await ok("GET", "/comments?target_type=answer&target_id=18");
  const hits = [];
  const walk = (nodes) => {
    for (const n of nodes || []) {
      if (n.content && RE_TEMPLATE.test(n.content) && !n.is_deleted) hits.push(n);
      if (n.children) walk(n.children);
    }
  };
  walk(data.items);
  return { total: data.total, hits };
}

async function liveChecks() {
  console.log("[no-walk-comments] 提示：基线（清理前）运行本断言应 FAIL");

  const twoSamples = async () => {
    for (let i = 0; i < 2; i++) {
      const { total, hits } = await sampleWalkComments();
      console.log(`  采样#${i + 1}: total=${total} 模板命中=${hits.length}`);
      expect(
        hits.length === 0,
        `answer#18 仍有 ${hits.length} 条可见模板评论：` +
          hits.map((h) => `#${h.id}`).join(",")
      );
      expect(
        total >= MIN_VISIBLE,
        `answer#18 可见评论 total=${total} < ${MIN_VISIBLE}（疑似误删真人评论）`
      );
      if (i === 0 && INTERVAL_MS > 0) {
        console.log(`  间隔巡检：等待 ${INTERVAL_MS}ms 后二次采样`);
        await sleep(INTERVAL_MS);
      }
    }
  };
  await twoSamples();

  // 3) 连号走查号已隐藏。
  const us = await ok("GET", `/users?q=${encodeURIComponent("沈舟拾")}&limit=50`);
  expect(
    (us.items || []).length === 0,
    `/users?q=沈舟拾 仍返回 ${(us.items || []).length} 个账号`
  );

  // 4) 写入守卫：走查号发模板评论必须 403 且计数不变。
  const db = openDb(DB_PATH);
  let probe;
  try {
    probe = db
      .prepare(
        `SELECT id, email, nickname FROM users
         WHERE nickname = '走查42' OR nickname GLOB '走查[0-9]*' ORDER BY id LIMIT 1`
      )
      .get();
  } finally {
    db.close();
  }
  expect(probe, "库里没有「走查NN」账号可用于守卫断言");
  let token;
  const lr = await login(probe.email, "zhihu123456");
  if (lr.status === 200 && lr.data.token) {
    token = lr.data.token;
  } else {
    token = signToken({ id: probe.id }); // 与 server/util.js 同一 SECRET 口径
  }
  const before = (await sampleWalkComments()).total;
  const r = await req("POST", "/comments", {
    token,
    body: { target_type: "answer", target_id: 18, body: "第1条走查感想：测试" },
  });
  expect(r.status === 403, `走查号发模板评论应 403，实际 ${r.status}`);
  const after = (await sampleWalkComments()).total;
  expect(
    after === before,
    `403 后评论数变化 ${before} -> ${after}（守卫可能已入库）`
  );
  console.log(`  守卫断言：POST /comments -> 403，total 保持 ${before}`);
}

// ---- --self-test：临时副本库植入探针 -> purge --apply -> 必须清干净 ---------
function seedProbe(db) {
  const ins = db.prepare(
    `INSERT INTO users (email, password_hash, nickname, created_at)
     VALUES (?, 'x', ?, datetime('now'))`
  );
  const insC = db.prepare(
    `INSERT INTO comments (target_type, target_id, author_id, content, is_deleted)
     VALUES ('answer', 18, ?, ?, 0)`
  );
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const info = ins.run(`st${Date.now()}${i}@zhihucopy.dev`, `沈舟拾${9000 + i}`);
    ids.push(Number(info.lastInsertRowid));
  }
  for (let i = 0; i < 5; i++) {
    insC.run(ids[i % 3], `第${8000 + i}条走查感想：这段关于依赖数组的解释我终于看懂了。`);
  }
  return ids;
}

function dbCheck(db) {
  const live = db
    .prepare("SELECT id, content FROM comments WHERE is_deleted = 0")
    .all()
    .filter((r) => isWalkProbeContent(r.content));
  expect(live.length === 0, `副本库仍有 ${live.length} 条模板评论未清`);
  const vis = db
    .prepare("SELECT id, nickname FROM users WHERE is_test = 0 AND nickname GLOB '沈舟拾*'")
    .all();
  expect(vis.length === 0, `副本库仍有 ${vis.length} 个沈舟拾* 未置 is_test`);
  const a18 = db
    .prepare(
      `SELECT comment_count,
         (SELECT COUNT(*) FROM comments WHERE target_type='answer'
           AND target_id=18 AND is_deleted=0) AS real
       FROM answers WHERE id = 18`
    )
    .get();
  expect(a18 && a18.comment_count === a18.real, "answer#18 comment_count 与实数不一致");
}

function selfTest() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "z1169-selftest-"));
  const tmp = path.join(tmpDir, "zhihu.db");
  fs.copyFileSync(DB_PATH, tmp);
  const db = openDb(tmp, false);
  try {
    const before = dbCheckSafe(db); // 基线（母库也可能已有残留——记录即可）
    console.log(`  self-test: 植入前基线模板评论 ${before} 条`);
    const ids = seedProbe(db);
    const seeded = db
      .prepare("SELECT id, content FROM comments WHERE is_deleted = 0")
      .all()
      .filter((r) => walkProbeRules(r.content).length > 0).length;
    expect(seeded >= 5, `self-test 植入失败：仅 ${seeded} 条模板评论`);
    db.close();

    // purge 需要写库：非生产副本走 --apply 口径。
    const out = execFileSync(
      process.execPath,
      [path.join(SCRIPT_DIR, "..", "purge-walk-comments.js"), "--apply"],
      { env: { ...process.env, DB_PATH: tmp }, encoding: "utf8", timeout: 120000 }
    );
    process.stdout.write(out);

    const db2 = openDb(tmp);
    try {
      dbCheck(db2);
      const flagged = db2
        .prepare("SELECT COUNT(*) c FROM users WHERE is_test = 1 AND nickname GLOB '沈舟拾*'")
        .get().c;
      expect(flagged >= ids.length, `沈舟拾* 置 is_test 数 ${flagged} < ${ids.length}`);
      console.log(`  self-test: 清后模板 0、沈舟拾* 已隐藏 ${flagged} 个、comment_count 口径一致`);
    } finally {
      db2.close();
    }
    console.log("[ASSERT] no-walk-comments --self-test PASS");
  } finally {
    try { db.close(); } catch {}
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function dbCheckSafe(db) {
  return db
    .prepare("SELECT content FROM comments WHERE is_deleted = 0")
    .all()
    .filter((r) => isWalkProbeContent(r.content)).length;
}

if (SELF_TEST) {
  try {
    selfTest();
    process.exit(0);
  } catch (e) {
    console.error(`[ASSERT] no-walk-comments --self-test FAIL: ${e.message || e}`);
    process.exit(1);
  }
}

main("no-walk-comments", liveChecks);
