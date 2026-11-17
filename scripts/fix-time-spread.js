#!/usr/bin/env node
/**
 * scripts/fix-time-spread.js — 回答/评论 created_at 塌缩一次性重排（Z1151）
 *
 * 背景：旧版 seed 的回答/评论时间用 Math.min(NOW-x, 对象时间 + 随机量) 封顶，
 *   题目越新随机量越被上限吃掉，同题回答/同答评论全部塌到同一秒——线上页面
 *   整屏「17 小时前」，一眼合成数据。
 *
 * 行为：
 *   1. 参照时刻 T_ref = max(questions.created_at, questions.updated_at)。
 *      只取本脚本绝不改写的表做时间锚——同一库重复执行结果不变（幂等）；
 *      仅当 T_ref 超过 wall-clock NOW-5min 时才截到该值（此时同一分钟内
 *      重跑仍幂等）。
 *   2. 每个问题的回答按 id 升序由老到新落在
 *      [max(问题+1h, T_ref-45d), T_ref-30min] 上：首末锚定（含 ±小时级
 *      的 per-question 哈希偏移，避免全站同秒），中间等分 + id 哈希分钟
 *      抖动；相邻 >=30min（窗口不足时按比例降级，仍保证两两不同且 > 问题）。
 *      窗口整体不可行（问题太新）依次退到 (问题+1min, T_ref-5min]、
 *      再从问题时间起 30min 步进顺延（仅极端数据，会打印警告）。
 *      answers.updated_at = max(新 created_at, 原 updated_at)。
 *   3. 每条回答的评论按 id 升序均匀落在 [回答+5min, T_ref-10min]：
 *      同答内两两不同且 >=3min（窗口不足按比例降级），parent_id 非空的
 *      回复必须晚于父评论 >=2min。target_type='question' 的评论以问题
 *      时间同法处理；找不到锚点对象（孤儿行）保持原样并警告。
 *   4. 只 UPDATE answers.created_at / answers.updated_at 与
 *      comments.created_at；content/author/parent_id/vote/is_deleted
 *      及表结构一律不动。值无变化的行不执行 UPDATE（二跑 0 变化）。
 *   5. 默认 dry-run 打印每题计划；--apply 写库前 db.backup() 到
 *      <db目录>/backups/zhihu-<YYYYMMDD-HHmm>-time-spread.db，
 *      生产库另须 --prod + ZH_ALLOW_PROD_WRITE=1（prod-write-gate 口径）。
 *
 * 用法：
 *   DB_PATH=/path/zhihu.db node scripts/fix-time-spread.js           # dry-run
 *   DB_PATH=/path/zhihu.db node scripts/fix-time-spread.js --apply
 *   生产库：--apply --prod 且 ZH_ALLOW_PROD_WRITE=1
 */
"use strict";

const fs = require("fs");
const path = require("path");

function requireFromServer(name) {
  try {
    return require(name);
  } catch (e) {
    return require(require.resolve(name, { paths: [path.join(__dirname, "..", "server")] }));
  }
}
const Database = requireFromServer("better-sqlite3");
const { resolveWriteMode } = require("./prod-write-gate");

const DB_PATH = path.resolve(
  process.env.DB_PATH || path.join(__dirname, "..", "data", "zhihu.db")
);
const APPLY = process.argv.includes("--apply") || process.env.FIX_ALLOW_PROD === "1";

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const pad2 = (n) => String(n).padStart(2, "0");
// 与 seed.js 同口径：UTC 时间戳 "YYYY-MM-DD HH:MM:SS"
const fmtTs = (ms) => {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
  );
};
const parseTs = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(s || "").trim());
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
};

// 确定性打散（splitmix32 风格，与 fix-answer-tails.js 同一份）
function hash32(n) {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  return (x ^ (x >>> 15)) >>> 0;
}
const hashIds = (...ids) => ids.reduce((h, id) => hash32(h ^ (id >>> 0)), 0x51f15e);

// ---------------------------------------------------------------------------
// 时间窗与散布
// ---------------------------------------------------------------------------

// 回答窗：理想 [max(qc+1h, T-45d), T-30min]；不可行时逐档降级。
function answerWindow(qcMs, n, T) {
  let lo = Math.max(qcMs + HOUR, T - 45 * DAY);
  let hi = T - 30 * MIN;
  if (lo < hi) return { lo, hi, tier: "ideal" };
  lo = qcMs + MIN;
  hi = T - 5 * MIN;
  if (lo < hi) return { lo, hi, tier: "fresh-q" };
  // 极端：问题时间贴住 T_ref —— 从问题时间起向后顺延（确定性，可能越过
  // T_ref-5min 但不会早于问题；是否越过 wall-clock 在打印阶段警告）。
  lo = qcMs + MIN;
  hi = qcMs + Math.max(2 * MIN, n * 30 * MIN);
  return { lo, hi, tier: "edge" };
}

// 评论窗：理想 [anchor+5min, T-10min]；降级同回答窗。
function commentWindow(anchorMs, n, T) {
  let lo = anchorMs + 5 * MIN;
  let hi = T - 10 * MIN;
  if (lo < hi) return { lo, hi, tier: "ideal" };
  lo = anchorMs + MIN;
  hi = T - 5 * MIN;
  if (lo < hi) return { lo, hi, tier: "fresh-a" };
  lo = anchorMs + MIN;
  hi = anchorMs + Math.max(2 * MIN, (n + 1) * 3 * MIN);
  return { lo, hi, tier: "edge" };
}

// 在 [lo, hi] 上放 n 个点：n>1 时首末近似锚定（t0 后移 <=3h、tn-1 前移 <=30min
// 的确定性偏移，避免全站同秒），中间等分 + 分钟级哈希抖动；
// 相邻间隔 >= minGap = min(wantGap, base*0.5)。返回 { times, minGap }。
function spread(lo, hi, n, wantGap, jitCap, seedOf) {
  if (n <= 0) return { times: [], minGap: 0 };
  const span = Math.max(0, hi - lo);
  if (n === 1) {
    return { times: [Math.round((lo + span / 2) / MIN) * MIN], minGap: 0 };
  }
  const base = span / (n - 1);
  const minGap = Math.max(MIN, Math.min(wantGap, base * 0.5));
  const jitSteps = Math.floor(Math.max(0, Math.min(base - minGap, jitCap)) / MIN);
  const anchorJit = Math.floor(Math.min(span * 0.05, 3 * HOUR) / MIN); // t0 后移上限
  const tailJit = Math.floor(Math.min(span * 0.05, 30 * MIN) / MIN); // tn-1 前移上限
  const times = new Array(n);
  for (let i = 0; i < n; i++) {
    let t;
    if (i === 0) {
      t = lo + (anchorJit > 0 ? (seedOf(0) % (anchorJit + 1)) * MIN : 0);
    } else if (i === n - 1) {
      t = hi - (tailJit > 0 ? (seedOf(i) % (tailJit + 1)) * MIN : 0);
    } else {
      t = lo + i * base + (jitSteps > 0 ? (seedOf(i) % (jitSteps + 1)) * MIN : 0);
    }
    times[i] = Math.round(t / MIN) * MIN;
  }
  // 兜底：截断/锚点偏移后仍保持相邻 >= minGap
  for (let i = 1; i < n; i++) {
    if (times[i] < times[i - 1] + minGap) times[i] = times[i - 1] + minGap;
  }
  return { times, minGap };
}

// 评论时序修复：在 spread 结果上按 id 顺序再保证「回复 >= 父评论 +2min」。
// parent.id < 回复 id 恒成立（回复时父评论须已存在），一趟前向扫描即可。
function applyReplyFloor(times, comments, minGap) {
  const idxOf = new Map(comments.map((c, i) => [c.id, i]));
  const out = times.slice();
  for (let i = 0; i < comments.length; i++) {
    let t = out[i];
    if (i > 0 && t < out[i - 1] + minGap) t = out[i - 1] + minGap;
    const p = comments[i].parent_id;
    if (p != null && idxOf.has(p)) {
      const pt = out[idxOf.get(p)] + 2 * MIN;
      if (t < pt) t = pt;
    }
    out[i] = t;
  }
  return out;
}

// ---------------------------------------------------------------------------

async function main() {
  const db = new Database(DB_PATH, APPLY ? undefined : { readonly: true });

  const wallNow = Date.now();
  const trefRow = db
    .prepare("SELECT MAX(created_at) mc, MAX(updated_at) mu FROM questions")
    .get();
  let Tref = Math.max(parseTs(trefRow && trefRow.mc) || 0, parseTs(trefRow && trefRow.mu) || 0);
  if (!Number.isFinite(Tref) || Tref <= 0) Tref = wallNow - 30 * MIN;
  if (Tref > wallNow - 5 * MIN) Tref = wallNow - 5 * MIN;

  const questions = db.prepare("SELECT id, created_at FROM questions ORDER BY id").all();
  const qById = new Map(questions.map((q) => [q.id, q]));

  const answersByQ = new Map();
  for (const a of db
    .prepare("SELECT id, question_id, created_at, updated_at FROM answers ORDER BY id")
    .all()) {
    if (!answersByQ.has(a.question_id)) answersByQ.set(a.question_id, []);
    answersByQ.get(a.question_id).push(a);
  }
  const commentsByAnswer = new Map();
  const commentsByQuestion = new Map();
  for (const c of db
    .prepare("SELECT id, target_type, target_id, parent_id, created_at FROM comments ORDER BY id")
    .all()) {
    const m = c.target_type === "question" ? commentsByQuestion : commentsByAnswer;
    if (!m.has(c.target_id)) m.set(c.target_id, []);
    m.get(c.target_id).push(c);
  }

  const answerPlan = []; // {id, created_at, updated_at, oldCreated, oldUpdated}
  const commentPlan = []; // {id, created_at, oldCreated}
  const warnings = [];
  const hardCap = wallNow - 5 * MIN;

  // 给一组 comments 排时间并写入 commentPlan；返回打印用 span 文本。
  const layoutComments = (list, anchorMs, tagOf) => {
    const win = commentWindow(anchorMs, list.length, Tref);
    const sp = spread(win.lo, win.hi, list.length, 3 * MIN, 12 * MIN, (j) =>
      hashIds(list[j].id, 0xc07)
    );
    const times = applyReplyFloor(sp.times, list, sp.minGap);
    let mn = Infinity;
    let mx = -Infinity;
    for (let j = 0; j < list.length; j++) {
      const t = times[j];
      mn = Math.min(mn, t);
      mx = Math.max(mx, t);
      if (t > hardCap) warnings.push(`comment#${list[j].id} ${tagOf} 超过 NOW-5min`);
      if (t < anchorMs) warnings.push(`comment#${list[j].id} ${tagOf} 早于所属对象`);
      commentPlan.push({ id: list[j].id, created_at: fmtTs(t), oldCreated: list[j].created_at });
    }
    return `x${list.length} ${fmtTs(mn)}~${fmtTs(mx)}${win.tier === "ideal" ? "" : `(${win.tier})`}`;
  };

  const plans = [];
  for (const q of questions) {
    const qcMs = parseTs(q.created_at);
    const list = answersByQ.get(q.id) || [];
    const n = list.length;
    const entry = { qid: q.id, qc: q.created_at, n, times: [], cspans: [] };

    if (!Number.isFinite(qcMs)) {
      warnings.push(`q#${q.id} created_at 无法解析「${q.created_at}」，回答/评论保持原样`);
      for (const a of list) commentsByAnswer.delete(a.id);
      commentsByQuestion.delete(q.id);
    } else {
      const win = answerWindow(qcMs, n, Tref);
      const { times } = spread(win.lo, win.hi, n, 30 * MIN, 20 * MIN, (i) =>
        hashIds(q.id, list[i].id)
      );
      for (let i = 0; i < n; i++) {
        const a = list[i];
        const t = times[i];
        entry.times.push(`a#${a.id}:${fmtTs(t)}`);
        if (t > hardCap) warnings.push(`answer#${a.id} q#${q.id} 超过 NOW-5min（${win.tier}）`);
        if (t < qcMs) warnings.push(`answer#${a.id} q#${q.id} 早于所属问题`);
        const oldUpd = parseTs(a.updated_at);
        const newUpd = Math.max(t, Number.isFinite(oldUpd) ? oldUpd : 0);
        answerPlan.push({
          id: a.id,
          created_at: fmtTs(t),
          updated_at: fmtTs(newUpd),
          oldCreated: a.created_at,
          oldUpdated: a.updated_at,
        });
        const cs = commentsByAnswer.get(a.id) || [];
        if (cs.length) {
          commentsByAnswer.delete(a.id);
          entry.cspans.push(`a#${a.id} ${layoutComments(cs, t, "评论")}`);
        }
      }
      const qcs = commentsByQuestion.get(q.id) || [];
      if (qcs.length) {
        commentsByQuestion.delete(q.id);
        entry.cspans.push(`q#${q.id} ${layoutComments(qcs, qcMs, "题评")}`);
      }
    }
    plans.push(entry);
  }

  // 孤儿行：所属问题/回答不存在，保持原样并警告。
  for (const [aid, cs] of commentsByAnswer) {
    warnings.push(`answer#${aid} 不存在（或问题缺失），其 ${cs.length} 条评论保持原样`);
  }
  for (const [qid, cs] of commentsByQuestion) {
    warnings.push(`question#${qid} 不存在，其 ${cs.length} 条评论保持原样`);
  }
  for (const [qid, list] of answersByQ) {
    if (!qById.has(qid)) warnings.push(`question#${qid} 不存在，其 ${list.length} 条回答保持原样`);
  }

  const aChanged = answerPlan.filter(
    (p) => p.created_at !== p.oldCreated || p.updated_at !== p.oldUpdated
  );
  const cChanged = commentPlan.filter((p) => p.created_at !== p.oldCreated);

  console.log(
    `[fix-spread] db=${DB_PATH} mode=${APPLY ? "apply" : "dry-run"} T_ref=${fmtTs(Tref)}`
  );
  console.log(
    `[fix-spread] 回答 ${answerPlan.length} 条（待改 ${aChanged.length}），` +
      `评论 ${commentPlan.length} 条（待改 ${cChanged.length}）`
  );
  for (const e of plans) {
    if (!e.n && !e.cspans.length) continue;
    console.log(`  q#${e.qid} qc=${e.qc} 回答${e.n}条`);
    if (e.times.length) console.log(`    ${e.times.join("  ")}`);
    for (const s of e.cspans) console.log(`    评论 ${s}`);
  }
  for (const w of warnings.slice(0, 40)) console.log(`  [warn] ${w}`);
  if (warnings.length > 40) console.log(`  [warn] …共 ${warnings.length} 条`);

  if (!APPLY) {
    db.close();
    return;
  }

  // 写库前先备份到 <db目录>/backups/zhihu-<YYYYMMDD-HHmm>-time-spread.db。
  const bdir = path.join(path.dirname(DB_PATH), "backups");
  fs.mkdirSync(bdir, { recursive: true });
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(
    now.getHours()
  )}${pad2(now.getMinutes())}`;
  const backup = path.join(bdir, `zhihu-${stamp}-time-spread.db`);
  await db.backup(backup);
  console.log(`[fix-spread] 备份已落盘：${backup}`);

  const mode = resolveWriteMode({
    argv: process.argv.concat(["--backup", backup]),
    env: process.env,
    dbPath: DB_PATH,
    scriptName: "fix-spread",
    Database,
  });
  if (mode !== "apply") {
    db.close();
    return;
  }

  const updA = db.prepare("UPDATE answers SET created_at = ?, updated_at = ? WHERE id = ?");
  const updC = db.prepare("UPDATE comments SET created_at = ? WHERE id = ?");
  const tx = db.transaction(() => {
    for (const p of aChanged) updA.run(p.created_at, p.updated_at, p.id);
    for (const p of cChanged) updC.run(p.created_at, p.id);
  });
  tx();
  db.close();
  console.log(
    `[fix-spread] apply 完成：回答 ${aChanged.length} 条、评论 ${cChanged.length} 条已更新时间`
  );
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`[fix-spread] 执行失败: ${e.message || e}`);
    process.exit(1);
  });
}
