// Z1169 — 「走查感想」模板评论清零 + 写入守卫断言（HTTP 级 + 数据级 self-test）。
//
// 契约（线上 /question/6 首条回答 answer#18，与 purge-walk-comments.js 配套）：
//   1) GET /comments?target_type=answer&target_id=18（接口一次返回全量树）
//      正文匹配 /走查感想|走查：|e2e/i 且 is_deleted=0 的评论数 = 0；
//   2) 该回答可见评论 total ≥ 35（证明真人评论没被误删）；
//   3) 沈舟拾NNNN 口径收窄为「有可见产出的未隐藏号 = 0」（库级统计 answers/
//      questions/comments 可见行；模板评论不计入）。/users?q= 降级为 info 行：
//      线上走查任务持续注册新空号（is_test=0、零产出），API 口径随注册节奏
//      波动，属 flaky 断言。另加全站抽样：10 个回答（含 #18）评论区不得有
//      可见沈舟拾NNNN 评论；
//   4) 临时注册探针号（每次 run 唯一）发「第1条走查感想：测试」必须 403、
//      不发通知/不入库；紧接着发正常中性评论必须 201 且计数只 +1；
//      收尾 POST /test-support/cleanup 自删产物（不依赖任何种子密码/JWT_SECRET，
//      线上与本地同口径 —— Z1169b 修掉的正是本地 signToken 秘钥不一致造成的假 401）；
//   5) 间隔巡检：连续两次采样，间隔 ZH_WALK_INTERVAL_MS（默认 300000=5min，
//      =0 跳过等待——仅本地调试用；CI/线上走默认值，脚本不自覆盖）；
//   6) --self-test：复制 DB_PATH 库到临时文件，植入 5 条模板评论 + 3 个
//      「沈舟拾NNNN」号，跑 purge-walk-comments.js --apply 后必须清干净；
//   7) 反向自检：基线（清理前）运行本断言应 FAIL——脚本启动时打印提示。
//
// 环境：API_BASE（默认 http://127.0.0.1:3030/zhihucopy/api）；
//       DB_PATH（仅 --self-test 的母库用，默认 ../data/zhihu.db）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, main, req, ok, db } from "./lib.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const requireHere = createRequire(import.meta.url);
const requireFromServer = createRequire(
  path.join(SCRIPT_DIR, "..", "..", "server", "package.json")
);
const { walkProbeRules, isWalkProbeContent } = requireHere("../../server/content-filter.js");

const DB_PATH = path.resolve(
  process.env.DB_PATH || path.join(SCRIPT_DIR, "..", "..", "data", "zhihu.db")
);
const SELF_TEST = process.argv.includes("--self-test");
const INTERVAL_MS = process.env.ZH_WALK_INTERVAL_MS !== undefined
  ? Number(process.env.ZH_WALK_INTERVAL_MS)
  : 300000;
const MIN_VISIBLE = 35; // 契约 2：首条回答可见评论下限（含软删占位，防误删）

const RE_TEMPLATE = /走查感想|走查：|e2e/i;
const RE_WALK_USER = /^沈舟拾\d{4}$/;

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

  // 3) 沈舟拾NNNN 口径收窄。/users?q= 降级为 info：线上走查任务持续注册
  //    新空号（is_test=0、零产出，守卫已挡住模板评论写入），检索数随注册
  //    节奏波动，参与 PASS/FAIL 会让线上 E2E 连跑必 FAIL。
  const us = await ok("GET", `/users?q=${encodeURIComponent("沈舟拾")}&limit=50`);
  console.log(
    `  info: /users?q=沈舟拾 返回 ${(us.items || []).length} 条（空号持续新注册，仅观测不计入断言）`
  );

  //    硬断言：有可见产出的未隐藏（is_test=0）沈舟拾NNNN 号 = 0。
  //    可见产出 = answers/questions 未删行 或 comments 未删且非模板正文。
  {
    const d = db();
    try {
      const qHasDel = d
        .prepare("PRAGMA table_info(questions)")
        .all()
        .some((c) => c.name === "is_deleted");
      const qSql = `SELECT COUNT(*) c FROM questions WHERE author_id = ?${
        qHasDel ? " AND is_deleted = 0" : ""
      }`;
      const suspects = d
        .prepare(
          "SELECT id, nickname FROM users WHERE is_test = 0 AND nickname GLOB '沈舟拾*'"
        )
        .all()
        .filter((u) => RE_WALK_USER.test(u.nickname));
      const withOutput = [];
      for (const u of suspects) {
        const na = d
          .prepare("SELECT COUNT(*) c FROM answers WHERE author_id = ? AND is_deleted = 0")
          .get(u.id).c;
        const nq = d.prepare(qSql).get(u.id).c;
        const nc = d
          .prepare("SELECT content FROM comments WHERE author_id = ? AND is_deleted = 0")
          .all(u.id)
          .filter((r) => !isWalkProbeContent(r.content)).length;
        if (na + nq + nc > 0) withOutput.push(`${u.nickname}(a=${na},q=${nq},c=${nc})`);
      }
      expect(
        withOutput.length === 0,
        `有可见产出的未隐藏沈舟拾号 ${withOutput.length} 个：${withOutput.join(", ")}`
      );
      console.log(`  沈舟拾NNNN 未隐藏号 ${suspects.length} 个，有可见产出 = 0`);
    } finally {
      d.close();
    }
  }

  //    全站抽样硬断言：固定 10 个回答（含 #18），评论区不得有可见的
  //    沈舟拾NNNN 作者评论（is_deleted=0）。
  {
    const d = db();
    let ids;
    try {
      ids = d
        .prepare("SELECT id FROM answers WHERE is_deleted = 0 ORDER BY id LIMIT 40")
        .all()
        .map((r) => r.id);
    } finally {
      d.close();
    }
    const sample = [18, ...ids.filter((i) => i !== 18)].slice(0, 10);
    for (const aid of sample) {
      const cd = await ok("GET", `/comments?target_type=answer&target_id=${aid}`);
      const hits = [];
      const walkTree = (nodes) => {
        for (const n of nodes || []) {
          if (!n.is_deleted && n.author && RE_WALK_USER.test(n.author.nickname || "")) {
            hits.push(n.id);
          }
          if (n.children) walkTree(n.children);
        }
      };
      walkTree(cd.items);
      expect(
        hits.length === 0,
        `answer#${aid} 有 ${hits.length} 条可见沈舟拾NNNN 评论：#${hits.join(",#")}`
      );
    }
    console.log(`  全站抽样：${sample.length} 个回答评论区沈舟拾NNNN 可见评论 = 0`);
  }

  // 4) 写入守卫：自注册探针号发模板评论必须 403，正常评论必须 201 且
  //    计数只 +1；收尾 /test-support/cleanup 自删本 run 产物。
  //    探针形态刻意取 probeUserMatchSql 双侧命中（昵称 z<N>user* + 邮箱
  //    @example.com）：注册 is_test=0（否则守卫把正常评论也 403），同时
  //    账号本身可被本人 token 自删 —— 不污染前台、不依赖种子密码/JWT_SECRET。
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const reg = await req("POST", "/auth/register", {
    body: {
      email: `z1169guard${stamp}@example.com`,
      password: "z1169-guard-pass",
      nickname: `z1169user${stamp}`,
    },
  });
  expect(
    reg.status === 201 && reg.data.token && reg.data.user,
    `探针注册失败：status=${reg.status} body=${JSON.stringify(reg.data).slice(0, 120)}`
  );
  const token = reg.data.token;
  const uid = reg.data.user.id;
  let normalCommentId = null;
  try {
    const before = (await sampleWalkComments()).total;
    const r = await req("POST", "/comments", {
      token,
      body: { target_type: "answer", target_id: 18, body: "第1条走查感想：测试" },
    });
    expect(
      r.status === 403,
      `探针发模板评论应 403，实际 status=${r.status} body=${JSON.stringify(r.data).slice(0, 120)}`
    );
    const mid = (await sampleWalkComments()).total;
    expect(
      mid === before,
      `403 后评论数变化 ${before} -> ${mid}（守卫可能已入库）`
    );
    const r2 = await req("POST", "/comments", {
      token,
      body: { target_type: "answer", target_id: 18, body: "这条回答讲得挺清楚，收藏了" },
    });
    expect(
      r2.status === 201 && r2.data.comment,
      `探针发正常评论应 201，实际 status=${r2.status} body=${JSON.stringify(r2.data).slice(0, 120)}`
    );
    normalCommentId = r2.data.comment.id;
    const after = (await sampleWalkComments()).total;
    expect(
      after === before + 1,
      `正常评论后计数应只 +1：${before} -> ${after}（模板评论疑似入库）`
    );
    console.log(
      `  守卫断言：模板 403、正常 201，total ${before} -> ${after}（+1）`
    );
  } finally {
    const cu = await req("POST", "/test-support/cleanup", {
      token,
      body: { c: normalCommentId ? [normalCommentId] : [], u: [uid] },
    });
    if (cu.status !== 200 || !cu.data.ok) {
      console.warn(
        `  [warn] 探针自清理失败（不影响断言结果）：status=${cu.status} ` +
          `body=${JSON.stringify(cu.data).slice(0, 120)}`
      );
    }
  }
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
