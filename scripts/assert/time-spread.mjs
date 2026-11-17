#!/usr/bin/env node
// scripts/assert/time-spread.mjs — Z1151 回答/评论时间戳塌缩断言
//
// 三口径：
//   A) API：/api/questions?tab=hot&limit=5 取热榜前 3 题，逐题
//      GET /api/questions/:id —— answers.created_at 去重数 === 回答条数，
//      且最新-最老 >= 1h（回答数 <2 的题跳过，至少 1 题受检）。
//      跨题口径：热榜前 5 题任意两题的回答 created_at 集合交集 <=1
//      （防「全库同三个绝对时刻」式重排）。
//   B) API：取 5 个有评论的回答，GET /api/comments?target_type=answer&target_id=N
//      —— comments.created_at 去重数 >= ceil(n*0.8)（含二级回复平铺计）。
//   C) DB（DB_PATH，缺省 <repo>/data/zhihu.db，只读；文件不存在且未显式
//      指定时跳过本档）：
//      - answers/comments/questions 无 created_at > now；answers.updated_at 同
//      - 每条回答 >= 所属问题时间；每条评论 >= 所属回答/所属问题时间；
//        回复 >= 父评论时间
//      - 每题（>=2 回答）回答 created_at 全不同 ← self-test 检出点
//      - 每答（>=2 评论）评论 created_at 去重 >= 80%
//   D) 页面：打开 /question/<热榜首个 >=2 回答的题>，前两条 .answer__date
//      文案必须不同。
//
// --self-test：把 DB_PATH 指向的库复制到临时文件，把某题回答全部改同秒，
//   checkDb 必须 FAIL（未 FAIL 则自检失败）。
//
// 运行前必须先 npm run build（页面档依赖 client/dist）。
// Env: E2E_BASE / API_BASE / DB_PATH / CHROME。退出码 0 PASS / 1 FAIL。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
const BASE = (process.env.E2E_BASE || API_BASE.replace(/\/api$/, "")).replace(/\/+$/, "");
// e2e/lib.mjs 顶层按 env 求值 BASE/API，须在动态 import 前赋值。
process.env.E2E_BASE ||= BASE;
process.env.API_BASE ||= API_BASE;
const { run, expect, apiOk } = await import("../e2e/lib.mjs");

const requireFromServer = createRequire(new URL("../../server/package.json", import.meta.url));
const Database = requireFromServer("better-sqlite3");

const DB_PATH = path.resolve(
  process.env.DB_PATH || path.join(SCRIPT_DIR, "..", "..", "data", "zhihu.db")
);
const DB_EXPLICIT = Boolean(process.env.DB_PATH);
const SELF_TEST = process.argv.includes("--self-test");

const ts = (s) => Date.parse(`${String(s).trim().replace(" ", "T")}Z`);

// ---- C) DB 口径 -------------------------------------------------------------
function checkDb(db) {
  for (const [table, col] of [
    ["answers", "created_at"],
    ["answers", "updated_at"],
    ["comments", "created_at"],
    ["questions", "created_at"],
  ]) {
    const bad = db
      .prepare(`SELECT COUNT(*) n, MAX(${col}) mx FROM ${table} WHERE ${col} > datetime('now')`)
      .get();
    expect(bad.n === 0, `${table}.${col} 有 ${bad.n} 行晚于 now（最晚 ${bad.mx}）`);
  }

  const earlyA = db
    .prepare(
      `SELECT COUNT(*) n FROM answers a JOIN questions q ON q.id = a.question_id
       WHERE a.created_at < q.created_at`
    )
    .get().n;
  expect(earlyA === 0, `${earlyA} 条回答早于所属问题 created_at`);
  const earlyAC = db
    .prepare(
      `SELECT COUNT(*) n FROM comments c JOIN answers a ON a.id = c.target_id
       WHERE c.target_type = 'answer' AND c.created_at < a.created_at`
    )
    .get().n;
  expect(earlyAC === 0, `${earlyAC} 条评论早于所属回答 created_at`);
  const earlyQC = db
    .prepare(
      `SELECT COUNT(*) n FROM comments c JOIN questions q ON q.id = c.target_id
       WHERE c.target_type = 'question' AND c.created_at < q.created_at`
    )
    .get().n;
  expect(earlyQC === 0, `${earlyQC} 条评论早于所属问题 created_at`);
  const earlyR = db
    .prepare(
      `SELECT COUNT(*) n FROM comments c JOIN comments p ON p.id = c.parent_id
       WHERE c.created_at < p.created_at`
    )
    .get().n;
  expect(earlyR === 0, `${earlyR} 条回复早于父评论 created_at`);

  const collapsedQ = db
    .prepare(
      `SELECT question_id qid, COUNT(*) n, COUNT(DISTINCT created_at) d
       FROM answers GROUP BY question_id HAVING n > 1 AND d < n`
    )
    .all();
  expect(
    collapsedQ.length === 0,
    `${collapsedQ.length} 个问题下回答 created_at 重复（如 q#${collapsedQ[0]?.qid} ${collapsedQ[0]?.d}/${collapsedQ[0]?.n}）`
  );

  const perAnswer = db
    .prepare(
      `SELECT target_id aid, COUNT(*) n, COUNT(DISTINCT created_at) d
       FROM comments WHERE target_type = 'answer' GROUP BY target_id HAVING n > 1`
    )
    .all();
  const collapsedC = perAnswer.filter((r) => r.d < Math.ceil(r.n * 0.8));
  expect(
    collapsedC.length === 0,
    `${collapsedC.length} 个回答下评论 created_at 去重 <80%（如 a#${collapsedC[0]?.aid} ${collapsedC[0]?.d}/${collapsedC[0]?.n}）`
  );
  console.log(
    `  DB 口径通过：无未来时间、层级时序正确、同题回答互异、同答评论去重>=80%`
  );
}

// ---- A)+B) API 口径 ---------------------------------------------------------
async function checkApi() {
  const hot = await apiOk("GET", "/questions?tab=hot&limit=5");
  const items = hot.items || [];
  expect(items.length >= 3, `热榜返回不足 3 题（${items.length}）`);

  let checked = 0;
  const answerPool = [];
  const qTimeSets = new Map(); // qid -> Set<回答 created_at>（跨题交集口径用）
  const top5 = items.slice(0, 5);
  for (let idx = 0; idx < top5.length; idx++) {
    const it = top5[idx];
    const d = await apiOk("GET", `/questions/${it.id}`);
    const ans = d.answers || [];
    answerPool.push(...ans);
    if (ans.length) qTimeSets.set(it.id, new Set(ans.map((a) => a.created_at)));
    if (idx >= 3) continue; // 去重+跨度口径只检热榜前 3
    if (ans.length < 2) {
      console.log(`  热榜 q#${it.id} 回答数 ${ans.length}<2，跳过`);
      continue;
    }
    const distinct = new Set(ans.map((a) => a.created_at)).size;
    expect(
      distinct === ans.length,
      `热榜 q#${it.id} ${ans.length} 条回答只有 ${distinct} 个不同 created_at`
    );
    const ms = ans.map((a) => ts(a.created_at));
    const spanH = (Math.max(...ms) - Math.min(...ms)) / 3600000;
    expect(spanH >= 1, `热榜 q#${it.id} 回答时间跨度 ${spanH.toFixed(2)}h < 1h`);
    checked++;
  }
  expect(checked >= 1, "热榜前 3 题无 >=2 回答的题可检");
  console.log(`  热榜前 3 题：${checked} 题回答时间去重+跨度>=1h 通过`);

  // 跨题口径：热榜前 5 题两两回答 created_at 集合交集 <=1 个时间点。
  const qids = [...qTimeSets.keys()];
  let maxInter = 0;
  let worst = "";
  for (let i = 0; i < qids.length; i++) {
    for (let j = i + 1; j < qids.length; j++) {
      const b = qTimeSets.get(qids[j]);
      let inter = 0;
      for (const t of qTimeSets.get(qids[i])) if (b.has(t)) inter++;
      if (inter > maxInter) {
        maxInter = inter;
        worst = `q#${qids[i]}×q#${qids[j]}`;
      }
    }
  }
  expect(
    maxInter <= 1,
    `热榜跨题回答时间交集 ${maxInter}>1（${worst}）：不同题落在同一批绝对时刻`
  );
  console.log(`  跨题口径通过：热榜前 ${qids.length} 题两两回答时间交集最大 ${maxInter}（<=1）`);

  const commented = [];
  const seen = new Set();
  const pushIf = (a) => {
    if ((a.comment_count || 0) > 0 && !seen.has(a.id)) {
      seen.add(a.id);
      commented.push(a);
    }
  };
  answerPool.forEach(pushIf);
  if (commented.length < 5) {
    const more = await apiOk("GET", "/questions?tab=hot&limit=50");
    for (const it of more.items || []) {
      if (commented.length >= 5) break;
      const d = await apiOk("GET", `/questions/${it.id}`);
      (d.answers || []).forEach(pushIf);
    }
  }
  const picks = commented.slice(0, 5);
  expect(picks.length >= 5, `有评论的回答不足 5 个（${picks.length}）`);
  for (const a of picks) {
    const d = await apiOk("GET", `/comments?target_type=answer&target_id=${a.id}`);
    const flat = [];
    for (const it of d.items || []) {
      flat.push(it);
      for (const ch of it.children || []) flat.push(ch);
    }
    const n = flat.length;
    const distinct = new Set(flat.map((c) => c.created_at)).size;
    const need = Math.ceil(n * 0.8);
    expect(
      distinct >= need,
      `answer#${a.id} ${n} 条评论只有 ${distinct} 个不同 created_at（要求>=${need}）`
    );
  }
  console.log(`  5 个回答的评论时间去重 >=80% 通过`);

  return items;
}

// ---- D) 页面口径 -------------------------------------------------------------
async function checkPage(page, hotItems) {
  let qid = null;
  for (const it of hotItems) {
    const d = await apiOk("GET", `/questions/${it.id}`);
    if ((d.answers || []).length >= 2) {
      qid = it.id;
      break;
    }
  }
  expect(qid, "热榜前 5 题没有 >=2 回答的题");
  await page.goto(`${BASE}/question/${qid}`);
  await page.waitForSelector(".answer__date");
  const texts = await page.$$eval(".answer__date", (els) =>
    els.slice(0, 2).map((e) => e.textContent.trim())
  );
  expect(texts.length >= 2, `q#${qid} 页面只渲染出 ${texts.length} 条回答时间`);
  expect(
    texts[0] !== texts[1],
    `q#${qid} 前两条回答时间文案相同：「${texts[0]}」（同秒塌缩特征）`
  );
  console.log(`  页面口径通过：q#${qid} 前两条回答时间「${texts[0]}」/「${texts[1]}」`);
}

// ---- self-test ----------------------------------------------------------------
function selfTest() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[ASSERT] time-spread --self-test FAIL: DB 不存在 ${DB_PATH}`);
    process.exit(1);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "z1151-selftest-"));
  const tmp = path.join(dir, "zhihu.db");
  // WAL 未 checkpoint 时裸拷 .db 会丢数据，三件套一起拷。
  for (const f of ["", "-wal", "-shm"]) {
    if (fs.existsSync(DB_PATH + f)) fs.copyFileSync(DB_PATH + f, tmp + f);
  }
  const db = new Database(tmp);
  try {
    const q = db
      .prepare(
        `SELECT a.question_id qid, q.created_at qc, COUNT(*) n
         FROM answers a JOIN questions q ON q.id = a.question_id
         GROUP BY a.question_id HAVING n >= 3 ORDER BY n DESC LIMIT 1`
      )
      .get();
    expect(q, "没有 >=3 回答的题可用于 self-test");
    // 塌缩到「问题时间 +1h」同一秒：不违反层级时序/未来时间约束，
    // 只有「同题 created_at 去重」一档能检出 —— 探针对准塌缩本身。
    const collapse = new Date(`${q.qc.replace(" ", "T")}Z`).getTime() + 3600000;
    const cs = new Date(collapse).toISOString().slice(0, 19).replace("T", " ");
    db.prepare("UPDATE answers SET created_at = ?, updated_at = ? WHERE question_id = ?").run(
      cs,
      cs,
      q.qid
    );
    let failed = false;
    try {
      checkDb(db);
    } catch (e) {
      failed = true;
      console.log(`  self-test: q#${q.qid} 塌缩同秒后 checkDb 如期 FAIL（${String(e.message).slice(0, 90)}）`);
    }
    expect(failed, "self-test 失败：同题回答改同秒后断言没有检出");
    console.log("[ASSERT] time-spread --self-test PASS");
    process.exit(0);
  } catch (e) {
    console.error(`[ASSERT] time-spread --self-test FAIL: ${e.message || e}`);
    process.exit(1);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (SELF_TEST) {
  selfTest();
} else {
  run("time-spread", async ({ page }) => {
    const hotItems = await checkApi();
    if (fs.existsSync(DB_PATH)) {
      const db = new Database(DB_PATH, { readonly: true });
      try {
        checkDb(db);
      } finally {
        db.close();
      }
    } else {
      const msg = `DB 不存在，跳过 DB 口径：${DB_PATH}`;
      expect(!DB_EXPLICIT, `${msg}（DB_PATH 显式指定但不可读）`);
      console.log(`  [skip] ${msg}`);
    }
    await checkPage(page, hotItems);
  });
}
