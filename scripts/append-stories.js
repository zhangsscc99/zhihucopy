#!/usr/bin/env node
/**
 * scripts/append-stories.js — 幂等追加 seed-data story 到既有库（Z1116）
 *
 * 背景：全量 seed.js 是「清库重灌」，不能用于给线上既有库补语料。
 * 本脚本把 scripts/seed-data/index.js 里全部 story 按 questions.title 判重，
 * 只插库里没有的题（问题 + 其 answers + question_topics 关联），不重建、不清表。
 *
 * 用法：
 *   node scripts/append-stories.js                 # dry-run：只打印计划（默认）
 *   node scripts/append-stories.js --dry-run       # 同上，显式
 *   DB_PATH=/tmp/zhihu-copy.db node scripts/append-stories.js --apply
 *   APPEND_ALLOW_PROD=1 node scripts/append-stories.js --apply   # 写生产库
 *
 * 写库前置：先 db.backup() 到 <repo>/data/backups/zhihu-<yyyymmdd-hhmm>-append-stories.db。
 * DB 路径口径沿用 seed.js：DB_PATH || <repo>/data/zhihu.db；生产库写库必须
 * APPEND_ALLOW_PROD=1（与 SEED_ALLOW_PROD 同思路）。
 *
 * 回答作者：只在「作者领域 ∩ 话题可接受域」（scripts/persona-domains.js）里挑，
 * 与 seed.js 同一套口径；同域作者不足的 story 整题跳过并打印原因。
 *
 * 幂等：判据为「标题是否已存在于 questions」，事务内再查一次，可反复执行；
 * 连续两次 apply 第二次插入 0 条。写入完成后对受影响的问题用 SQL 聚合回填
 * answer_count / follower_count / updated_at 与回答的 vote_up / vote_down /
 * comment_count，保证反范式字段与真实行一致。
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
// 复用 seed.js 的 TOPICS（话题名->大类映射）与 STORIES（加载期已做结构/长度校验，
// 并回填了 story.topicIdx）。require 不触发 main()，不会清库。
const { TOPICS, STORIES } = require("./seed");
const { authorFitsTopic } = require("./persona-domains");

// ---- 参数解析 --------------------------------------------------------------
const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const unknown = argv.filter((a) => a !== "--apply" && a !== "--dry-run");
if (unknown.length) {
  console.error(`[append-stories] 未知参数：${unknown.join(" ")}（支持 --dry-run / --apply）`);
  process.exit(1);
}

const DB_PATH = path.resolve(
  process.env.DB_PATH || path.join(__dirname, "..", "data", "zhihu.db")
);
const PROD_DB = "/www/zhihucopy/data/zhihu.db";

if (APPLY && DB_PATH === PROD_DB && process.env.APPEND_ALLOW_PROD !== "1") {
  console.error(
    `[append-stories] 拒绝对生产库写入: ${DB_PATH}\n` +
      `[append-stories] 请使用 DB_PATH=<副本路径>；确需写入生产库请显式设置 APPEND_ALLOW_PROD=1`
  );
  process.exit(1);
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

const TOPIC_CAT = new Map(TOPICS.map((t) => [t.name, t.cat]));
const DAY = 86400000;
const HOUR = 3600000;

async function main() {
  console.log(`[append-stories] db=${DB_PATH} mode=${APPLY ? "APPLY" : "dry-run"}`);

  if (!fs.existsSync(DB_PATH)) {
    console.error("[append-stories] 目标库不存在，拒绝新建（应为既有库的增量补充）");
    process.exit(1);
  }

  const db = new Database(DB_PATH, APPLY ? {} : { readonly: true });

  // 候选作者池：限定种子域账号（@zhihucopy.dev），排除 e2e/巡检残留的
  // is_test=0 账号（走查员*/z985user* 等真实感昵称但属自动化产物）；
  // 问题作者全池可挑，回答作者按话题可接受域再过滤。
  const pool = db
    .prepare(
      "SELECT id, nickname, bio FROM users WHERE is_test = 0 AND email LIKE '%@zhihucopy.dev' ORDER BY id"
    )
    .all();
  if (pool.length < 8) {
    console.error(`[append-stories] 可用作者池仅 ${pool.length} 人，至少需 8`);
    process.exit(1);
  }

  const exists = db.prepare("SELECT id FROM questions WHERE title = ?");
  const topicIds = new Map(
    db.prepare("SELECT id, name FROM topics").all().map((t) => [t.name, t.id])
  );
  // 各大类下的话题 id 列表（确定性顺序），给附加话题用。
  const topicsByCat = new Map();
  for (const t of db.prepare("SELECT id, name FROM topics ORDER BY id").all()) {
    const cat = TOPIC_CAT.get(t.name);
    if (!cat) continue;
    if (!topicsByCat.has(cat)) topicsByCat.set(cat, []);
    topicsByCat.get(cat).push(t.id);
  }

  const now = Date.now();
  const plan = [];
  let skippedExists = 0;
  let skippedOther = 0;

  for (let si = 0; si < STORIES.length; si++) {
    const story = STORIES[si];
    const label = `「${story.title.slice(0, 24)}…」`;

    if (exists.get(story.title)) {
      skippedExists++;
      continue;
    }
    const topicId = topicIds.get(story.topic);
    if (topicId === undefined) {
      console.log(`  ! ${label} 话题不存在：${story.topic} —— 跳过`);
      skippedOther++;
      continue;
    }
    const cat = TOPIC_CAT.get(story.topic);
    if (!cat) {
      console.log(`  ! ${label} 话题「${story.topic}」无大类映射 —— 跳过`);
      skippedOther++;
      continue;
    }

    // 问题作者：确定性散布到不同人头上（提问不做领域限制，与 seed 一致）。
    const qAuthor = pool[(si * 11 + 3) % pool.length];

    // 回答作者：作者领域 ∩ 话题可接受域（topic 级口径），且不与问题作者、
    // 同题其它回答者重复；同域候选不足则整题跳过，宁缺毋滥。
    const fitPool = pool.filter(
      (u) =>
        u.id !== qAuthor.id &&
        authorFitsTopic(u.nickname, u.bio, story.topic, cat)
    );
    if (fitPool.length < story.answers.length) {
      console.log(
        `  ! ${label} 同域回答作者不足（需 ${story.answers.length}，得 ${fitPool.length}）—— 跳过`
      );
      skippedOther++;
      continue;
    }
    const answerAuthors = [];
    for (
      let k = 0, pos = (si * 13) % fitPool.length;
      answerAuthors.length < story.answers.length && pos < fitPool.length * 2;
      k++, pos++
    ) {
      const u = fitPool[pos % fitPool.length];
      if (!answerAuthors.includes(u.id)) answerAuthors.push(u.id);
    }

    // 附加话题：同大类、确定性 0-2 个（模拟 seed 的同大类附加逻辑）。
    const sameCat = (topicsByCat.get(cat) || []).filter((id) => id !== topicId);
    const nExtra = Math.min(sameCat.length, (si * 5 + 1) % 3);
    const extraTopicIds = [];
    for (let k = 0; k < nExtra; k++) {
      extraTopicIds.push(sameCat[(si * 7 + k) % sameCat.length]);
    }

    // 时间：确定性散布在最近 ~10-70 天，回答依次晚于提问数小时。
    const createdMs = now - (10 + si * 4) * DAY - ((si * 23) % 60) * 60000;
    const answers = story.answers.map((a, k) => ({
      content: a.content,
      authorId: answerAuthors[k],
      createdMs: Math.min(
        now - HOUR,
        createdMs + (k + 1) * 6 * HOUR + ((si * 31 + k * 17) % 90) * 60000
      ),
    }));
    const viewCount = 40 + ((si * 97) % 350);

    plan.push({
      story,
      qAuthorId: qAuthor.id,
      topicId,
      extraTopicIds,
      createdMs,
      answers,
      viewCount,
    });
    console.log(
      `  + ${label} 作者=${qAuthor.nickname}#${qAuthor.id} ` +
        `话题=${story.topic}(+${extraTopicIds.length}) 回答=${answers.length} ` +
        `时间=${fmtTs(createdMs)}`
    );
  }
  console.log(
    `[append-stories] 计划新增 ${plan.length} 题（跳过：已存在 ${skippedExists}，其它 ${skippedOther}）`
  );

  if (!APPLY) {
    console.log("[append-stories] dry-run 未写库；--apply 才真正写入");
    db.close();
    return;
  }
  if (plan.length === 0) {
    console.log("[append-stories] 无新增，不写库");
    db.close();
    return;
  }

  // 写库前备份到 <repo>/data/backups/。
  const backupDir = path.join(__dirname, "..", "data", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(
    backupDir,
    `zhihu-${backupStamp()}-append-stories.db`
  );
  await db.backup(backupPath);
  console.log(`[append-stories] 写库前备份完成：${backupPath}`);

  const insQ = db.prepare(
    `INSERT INTO questions (author_id, title, detail_md, created_at, updated_at, answer_count, follower_count, view_count)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?)`
  );
  const insQT = db.prepare(
    "INSERT OR IGNORE INTO question_topics (question_id, topic_id) VALUES (?, ?)"
  );
  const insA = db.prepare(
    `INSERT INTO answers (question_id, author_id, content_md, vote_up, vote_down, comment_count, is_collapsed, is_deleted, created_at, updated_at)
     VALUES (?, ?, ?, 0, 0, 0, 0, 0, ?, ?)`
  );

  const insertedQids = [];
  const tx = db.transaction(() => {
    for (const p of plan) {
      if (exists.get(p.story.title)) continue; // 事务内再查一次，彻底幂等
      const info = insQ.run(
        p.qAuthorId,
        p.story.title,
        p.story.detail,
        fmtTs(p.createdMs),
        fmtTs(p.createdMs),
        p.viewCount
      );
      const qid = Number(info.lastInsertRowid);
      insQT.run(qid, p.topicId);
      for (const tid of p.extraTopicIds) insQT.run(qid, tid);
      for (const a of p.answers) {
        insA.run(qid, a.authorId, a.content, fmtTs(a.createdMs), fmtTs(a.createdMs));
      }
      insertedQids.push(qid);
      console.log(`  -> q#${qid} 「${p.story.title.slice(0, 32)}」`);
    }

    // 反范式计数回填（只动受影响的问题，口径与 seed.js 聚合一致）
    if (insertedQids.length) {
      const inList = insertedQids.map(() => "?").join(",");
      db.prepare(
        `UPDATE answers SET
           vote_up = (SELECT COUNT(*) FROM votes v WHERE v.answer_id = answers.id AND v.value = 1),
           vote_down = (SELECT COUNT(*) FROM votes v WHERE v.answer_id = answers.id AND v.value = -1),
           comment_count = (SELECT COUNT(*) FROM comments c WHERE c.target_type = 'answer' AND c.target_id = answers.id AND c.is_deleted = 0)
         WHERE question_id IN (${inList})`
      ).run(...insertedQids);
      db.prepare(
        `UPDATE questions SET
           answer_count = (SELECT COUNT(*) FROM answers a WHERE a.question_id = questions.id AND a.is_deleted = 0),
           follower_count = (SELECT COUNT(*) FROM follows f WHERE f.target_type = 'question' AND f.target_id = questions.id),
           updated_at = COALESCE(
             (SELECT MAX(a.updated_at) FROM answers a WHERE a.question_id = questions.id AND a.is_deleted = 0),
             questions.created_at)
         WHERE id IN (${inList})`
      ).run(...insertedQids);
    }
  });
  tx();

  console.log(
    `[append-stories] 实写 ${insertedQids.length} 题 / ${plan.reduce((n, p) => n + p.answers.length, 0)} 回答`
  );
  db.close();
}

main().catch((e) => {
  console.error(`[append-stories] FAIL: ${e.message || e}`);
  process.exit(1);
});
