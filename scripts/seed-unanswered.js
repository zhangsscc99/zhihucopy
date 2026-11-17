#!/usr/bin/env node
/**
 * scripts/seed-unanswered.js — 幂等补「零回答」问题存量（Z1102）
 *
 * 背景：右栏「等你来答」（UnansweredRail）与 /unanswered 列表都依赖
 * answer_count=0 的问题。全量 seed 会把每个 story 的回答一起灌进去，
 * 库里零回答问题清零后右栏第二块整体不渲染（0 条不渲染空卡）。
 * 本脚本把 scripts/seed-data/unanswered.js 里的 10 条真实形态零回答
 * 问题补进既有库，不重建、不清表。
 *
 * 幂等：判据为「标题是否已存在于 questions」。已存在则整行跳过
 * （含 question_topics / follows / follower_count），可反复执行。
 *
 * 用法：
 *   node scripts/seed-unanswered.js                         # dry-run：只打印计划
 *   DB_PATH=/tmp/zhihu-copy.db node scripts/seed-unanswered.js
 *   SEED_ALLOW_PROD=1 node scripts/seed-unanswered.js       # 真正写库
 *
 * 写库前置：先 db.backup() 到 <DB 所在目录>/backups/zhihu-<yyyymmdd-hhmm>-seed-unanswered.db。
 * DB 路径与保护口径沿用 scripts/seed.js：DB_PATH || <repo>/data/zhihu.db；
 * SEED_ALLOW_PROD=1 是唯一的写库开关（含生产库）。
 */
"use strict";

const fs = require("fs");
const path = require("path");

// better-sqlite3 装在 server/node_modules 下（与 seed.js 同一解析策略）。
function requireFromServer(name) {
  try {
    return require(name);
  } catch (e) {
    return require(
      require.resolve(name, { paths: [path.join(__dirname, "..", "server")] })
    );
  }
}
const Database = requireFromServer("better-sqlite3");
const { TOPICS } = require("./seed");
const UNANSWERED = require("./seed-data/unanswered");

const APPLY = process.env.SEED_ALLOW_PROD === "1";
const DB_PATH = path.resolve(
  process.env.DB_PATH || path.join(__dirname, "..", "data", "zhihu.db")
);

// ---- 语料校验（加载期失败直接抛，不进 main） -------------------------------
const TOPIC_CAT = new Map(TOPICS.map((t) => [t.name, t.cat]));
const cnLen = (s) => [...s].length;
{
  const seen = new Set();
  for (const s of UNANSWERED) {
    const where = `seed-data/unanswered.js: 「${String(s.title).slice(0, 24)}…」`;
    if (typeof s.title !== "string" || !s.title.trim() || s.title.length > 100) {
      throw new Error(`${where} 标题缺失或超过 100 字符`);
    }
    if (seen.has(s.title)) throw new Error(`${where} 标题重复`);
    seen.add(s.title);
    const len = cnLen(String(s.detail || "").trim());
    if (len < 120 || len > 300) {
      throw new Error(`${where} 补充说明 ${len} 字（需 120–300）`);
    }
    if (!Array.isArray(s.topics) || s.topics.length < 1 || s.topics.length > 2) {
      throw new Error(`${where} topics 需 1–2 个`);
    }
    const cats = new Set();
    for (const name of s.topics) {
      const cat = TOPIC_CAT.get(name);
      if (cat === undefined) throw new Error(`${where} 未知话题「${name}」`);
      cats.add(cat);
    }
    if (cats.size !== 1) throw new Error(`${where} 话题跨大类（${[...cats]}）`);
    for (const marker of ["[e2e]", "[assert]", "巡检", "assert-"]) {
      if (s.title.includes(marker) || s.detail.includes(marker)) {
        throw new Error(`${where} 含测试标记「${marker}」`);
      }
    }
  }
}

const pad2 = (n) => String(n).padStart(2, "0");
const fmtTs = (ms) => {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
  );
};
const backupStamp = () => {
  const d = new Date();
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `-${pad2(d.getHours())}${pad2(d.getMinutes())}`
  );
};

// 确定性散布：10 题落在最近 ~2 周，间隔错开，避免「同一秒批量注册」观感。
const HOUR = 3600000;
const createdMsAt = (i, now) => now - (26 + i * 29) * HOUR - ((i * 47) % 60) * 60000;
const viewCountAt = (i) => 38 + ((i * 67) % 260);
// 每题 0–2 个真实关注者（follows 行同步写入，follower_count 为真实计数）。
const followerCountAt = (i) => (i * 5 + 1) % 3;

async function main() {
  console.log(`[seed-unanswered] db=${DB_PATH} mode=${APPLY ? "APPLY" : "dry-run"}`);

  if (!fs.existsSync(DB_PATH)) {
    if (APPLY) {
      console.error("[seed-unanswered] 目标库不存在，拒绝新建（应为既有库的增量补充）");
      process.exit(1);
    }
    console.log("[seed-unanswered] 目标库不存在，dry-run 按计划全量展示：");
    for (const s of UNANSWERED) {
      console.log(`  + 「${s.title}」 topics=[${s.topics.join(", ")}]`);
    }
    return;
  }

  const db = new Database(DB_PATH, APPLY ? {} : { readonly: true });

  // 作者池：非测试账号按 id 顺序，确定性步进挑选，摊到不同人头上。
  const pool = db
    .prepare("SELECT id, nickname FROM users WHERE is_test = 0 ORDER BY id")
    .all();
  if (pool.length < 4) {
    console.error(`[seed-unanswered] 可用作者池仅 ${pool.length} 人，至少需 4`);
    process.exit(1);
  }
  const pickAuthor = (i) => pool[(i * 7 + 3) % pool.length];
  const pickFollower = (i, k, authorId) => {
    // 与作者错开的确定性粉丝挑选；池子小时允许与作者重合之外的任意人。
    for (let step = 1; step <= pool.length; step++) {
      const u = pool[(i * 11 + k * 5 + step) % pool.length];
      if (u.id !== authorId) return u;
    }
    return pool[0];
  };

  const now = Date.now();
  const exists = db.prepare("SELECT id FROM questions WHERE title = ?");
  const topicIds = new Map(
    db.prepare("SELECT id, name FROM topics").all().map((t) => [t.name, t.id])
  );

  const plan = [];
  for (let i = 0; i < UNANSWERED.length; i++) {
    const s = UNANSWERED[i];
    const hit = exists.get(s.title);
    const missing = s.topics.filter((n) => !topicIds.has(n));
    if (missing.length) {
      console.log(`  ! 「${s.title}」 话题不存在：${missing.join(", ")} —— 跳过`);
      continue;
    }
    if (hit) {
      console.log(`  = 「${s.title}」 已存在（id=${hit.id}），跳过`);
      continue;
    }
    const author = pickAuthor(i);
    const nFollow = followerCountAt(i);
    const followers = [];
    for (let k = 0; k < nFollow; k++) followers.push(pickFollower(i, k, author.id).id);
    plan.push({
      ...s,
      author,
      followers,
      createdAt: fmtTs(createdMsAt(i, now)),
      viewCount: viewCountAt(i),
    });
    console.log(
      `  + 「${s.title}」 作者=${author.nickname}#${author.id} ` +
        `topics=[${s.topics.join(", ")}] 关注=${nFollow} 浏览=${viewCountAt(i)} ` +
        `时间=${fmtTs(createdMsAt(i, now))}`
    );
  }
  console.log(`[seed-unanswered] 计划新增 ${plan.length} 条 / 跳过 ${UNANSWERED.length - plan.length} 条`);

  if (!APPLY) {
    console.log("[seed-unanswered] dry-run 未写库；SEED_ALLOW_PROD=1 才真正写入");
    db.close();
    return;
  }
  if (plan.length === 0) {
    console.log("[seed-unanswered] 无新增，不写库");
    db.close();
    return;
  }

  // 写库前备份到 <DB 目录>/backups/。
  const backupDir = path.join(path.dirname(DB_PATH), "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(
    backupDir,
    `zhihu-${backupStamp()}-seed-unanswered.db`
  );
  await db.backup(backupPath);
  console.log(`[seed-unanswered] 写库前备份完成：${backupPath}`);

  const insQ = db.prepare(
    `INSERT INTO questions (author_id, title, detail_md, created_at, updated_at, answer_count, follower_count, view_count)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
  );
  const insQT = db.prepare(
    "INSERT OR IGNORE INTO question_topics (question_id, topic_id) VALUES (?, ?)"
  );
  const insF = db.prepare(
    "INSERT OR IGNORE INTO follows (follower_id, target_type, target_id, created_at) VALUES (?, 'question', ?, ?)"
  );

  let inserted = 0;
  const tx = db.transaction(() => {
    for (const p of plan) {
      if (exists.get(p.title)) continue; // 事务内再查一次，彻底幂等
      const info = insQ.run(
        p.author.id,
        p.title,
        p.detail.trim(),
        p.createdAt,
        p.createdAt,
        p.followers.length,
        p.viewCount
      );
      const qid = Number(info.lastInsertRowid);
      for (const name of p.topics) insQT.run(qid, topicIds.get(name));
      for (const fid of p.followers) insF.run(fid, qid, p.createdAt);
      inserted += info.changes;
      console.log(`  -> q#${qid} 「${p.title}」`);
    }
  });
  tx();

  const left = db
    .prepare("SELECT COUNT(*) c FROM questions WHERE answer_count = 0")
    .get().c;
  console.log(`[seed-unanswered] 实写 ${inserted} 条；库内零回答问题现存 ${left} 条`);
  db.close();
}

main().catch((e) => {
  console.error(`[seed-unanswered] FAIL: ${e.message || e}`);
  process.exit(1);
});
