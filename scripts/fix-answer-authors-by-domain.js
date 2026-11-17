#!/usr/bin/env node
/**
 * scripts/fix-answer-authors-by-domain.js — 存量回答作者人设重排（Z1097）
 *
 * 背景：旧版 seed 按 `uIdx % 8` 给用户定「擅长领域」，与 bio 人设无关，
 * 生产库出现「健身教练答 React」「HR 答前端」式错位。本脚本在不改 answer
 * 行 id 的前提下重排 answers.author_id，使「作者领域 ∩ 问题话题可接受域」
 * 非空（领域口径见 scripts/persona-domains.js）。
 *
 * 规则（Z1106 起判定下沉到话题级）：
 *   - 问题可接受域 = 其 topics 在 TOPIC_DOMAINS 的可接受域并集
 *     （topic 未覆盖 TOPIC_DOMAINS 直接抛错——不许退回大类口径假装没发生）。
 *   - 新作者：领域命中该题可接受域、不是提问者、不是同题其它回答的作者、
 *     未在该回答上投过票（避免自投自答）。同题多答保持不同作者。
 *   - 候选按「当前作答数升序 + id 升序」确定性地挑，把回答摊到更多人身上；
 *     同域候选不足时打印同域候选池明细并抛错，不许静默跳过。
 *   - 只动 answers.author_id：answer_count / comment_count / comments 引用不变；
 *     写库后按 seed 同口径重算 users.salt_value / level。
 *   - 幂等：跑过的库所有作者均已同域，第二次计划为 0。
 *
 * 用法：
 *   DB_PATH=/path/zhihu.db node scripts/fix-answer-authors-by-domain.js            # dry-run（默认）
 *   DB_PATH=/path/zhihu.db node scripts/fix-answer-authors-by-domain.js --apply    # 非生产库写库
 *   ZH_ALLOW_PROD_WRITE=1 node scripts/fix-answer-authors-by-domain.js \
 *     --apply --prod --backup data/backups/zhihu-<YYYYMMDD>-<HHmm>.db              # 生产库
 *
 * 写库门槛：非生产库 --apply 或 FIX_ALLOW_PROD=1 任一即写；目标为
 * /www/zhihucopy/data/zhihu.db 时走受控写闸（scripts/prod-write-gate.js）：
 * --apply + --prod + ZH_ALLOW_PROD_WRITE=1 + 当日备份文件，缺一拒绝并打印缺项。
 * 写库前自动 .backup() 到 data/backups/。
 */
"use strict";

const fs = require("fs");
const path = require("path");

// better-sqlite3 装在 server/node_modules 下（与 seed.js 同一解析策略）。
function requireFromServer(name) {
  try {
    return require(name);
  } catch (e) {
    return require(require.resolve(name, { paths: [path.join(__dirname, "..", "server")] }));
  }
}
const Database = requireFromServer("better-sqlite3");
const { TOPICS } = require("./seed");
const {
  TOPIC_DOMAINS,
  DOMAINS_BY_CAT,
  domainsOf,
  acceptedForTopics,
} = require("./persona-domains");

const DB_PATH = path.resolve(
  process.env.DB_PATH || path.join(__dirname, "..", "data", "zhihu.db")
);
// 写库门槛：非生产库 --apply 或 FIX_ALLOW_PROD=1；生产库走受控写闸
// （--apply --prod ZH_ALLOW_PROD_WRITE=1 + 当日备份，缺一拒绝）。
const { resolveWriteMode } = require("./prod-write-gate");
const APPLY =
  resolveWriteMode({
    argv: process.argv,
    env: process.env,
    dbPath: DB_PATH,
    scriptName: "fix-authors",
    Database,
  }) === "apply";

const topicCat = new Map(TOPICS.map((t) => [t.name, t.cat]));

async function main() {
  const db = new Database(DB_PATH);

  // ---- 领域判定素材 ---------------------------------------------------------
  const users = db.prepare("SELECT id, nickname, bio FROM users").all();
  const userById = new Map(users.map((u) => [u.id, u]));
  const domainSetOf = new Map(
    users.map((u) => [u.id, domainsOf(u.nickname, u.bio)])
  );

  // 话题覆盖检查（Z1106）：凡是 question_topics 实际用到的话题名必须
  // 命中 TOPIC_DOMAINS；未覆盖直接抛错，不许退回大类口径。
  const qTopics = new Map(); // question_id -> string[]
  const usedTopicNames = new Set();
  for (const r of db
    .prepare(
      `SELECT qt.question_id, t.name FROM question_topics qt JOIN topics t ON t.id = qt.topic_id`
    )
    .all()) {
    usedTopicNames.add(r.name);
    if (!qTopics.has(r.question_id)) qTopics.set(r.question_id, []);
    qTopics.get(r.question_id).push(r.name);
  }
  const uncovered = [...usedTopicNames].filter(
    (n) => !TOPIC_DOMAINS[n] && !DOMAINS_BY_CAT[topicCat.get(n) || ""]
  );
  const catFallback = [...usedTopicNames].filter((n) => !TOPIC_DOMAINS[n]);
  if (catFallback.length) {
    db.close();
    throw new Error(
      `[fix-authors] 话题未覆盖 TOPIC_DOMAINS：${catFallback.join("、")} ` +
        `（含大类兜底 ${catFallback.length} 个，未知 ${uncovered.length} 个）；` +
        `请先在 scripts/persona-domains.js 补 TOPIC_DOMAINS 映射再跑`
    );
  }
  const acceptedOf = (qid) => {
    const names = qTopics.get(qid);
    if (!names || !names.length) return null;
    return acceptedForTopics(names, (n) => topicCat.get(n)).domains;
  };
  const intersects = (set, ok) => {
    for (const d of set) if (ok.has(d)) return true;
    return false;
  };

  const questions = new Map(
    db.prepare("SELECT id, author_id, title FROM questions").all().map((q) => [q.id, q])
  );
  const answers = db
    .prepare(
      "SELECT id, question_id, author_id FROM answers WHERE is_deleted = 0 ORDER BY id"
    )
    .all();
  const byQuestion = new Map();
  for (const a of answers) {
    if (!byQuestion.has(a.question_id)) byQuestion.set(a.question_id, []);
    byQuestion.get(a.question_id).push(a);
  }
  // 已投票用户不能再当作者（否则变成给自己投票）
  const votersOf = new Map();
  for (const v of db.prepare("SELECT answer_id, user_id FROM votes").all()) {
    if (!votersOf.has(v.answer_id)) votersOf.set(v.answer_id, new Set());
    votersOf.get(v.answer_id).add(v.user_id);
  }
  // 分摊负载：候选按当前作答数升序
  const answerCount = new Map();
  for (const a of answers) {
    answerCount.set(a.author_id, (answerCount.get(a.author_id) || 0) + 1);
  }

  // ---- 生成重排计划 ----------------------------------------------------------
  const plans = [];
  const skippedNoTopic = [];
  const noCand = []; // {answer, qid, ok, reasons[]} —— 同域候选不足，不得静默
  for (const [qid, list] of [...byQuestion.entries()].sort((a, b) => a[0] - b[0])) {
    const ok = acceptedOf(qid);
    if (!ok) {
      for (const a of list) skippedNoTopic.push(a.id);
      continue;
    }
    const qAuthor = questions.get(qid) ? questions.get(qid).author_id : null;
    const used = new Set([qAuthor]);
    for (const a of list) {
      const cur = domainSetOf.get(a.author_id) || new Set();
      if (intersects(cur, ok)) {
        used.add(a.author_id);
        a._keep = true;
      }
    }
    for (const a of list) {
      if (a._keep) continue;
      const voters = votersOf.get(a.id) || new Set();
      const sameDomain = users.filter((u) =>
        intersects(domainSetOf.get(u.id) || new Set(), ok)
      );
      const cands = sameDomain
        .filter((u) => !used.has(u.id) && !voters.has(u.id))
        .sort(
          (x, y) =>
            (answerCount.get(x.id) || 0) - (answerCount.get(y.id) || 0) ||
            x.id - y.id
        );
      if (!cands.length) {
        noCand.push({
          answer: a,
          qid,
          ok,
          pool: sameDomain.map((u) => ({
            u,
            reason: used.has(u.id)
              ? "已被同题占用"
              : voters.has(u.id)
              ? "在该回答投过票"
              : "?",
          })),
        });
        continue;
      }
      const pick = cands[0];
      plans.push({
        answer_id: a.id,
        qid,
        title: (questions.get(qid) || {}).title || "",
        from: a.author_id,
        to: pick.id,
      });
      used.add(pick.id);
      answerCount.set(pick.id, (answerCount.get(pick.id) || 0) + 1);
      answerCount.set(a.author_id, (answerCount.get(a.author_id) || 1) - 1);
    }
  }

  const mode = APPLY ? "apply" : "dry-run";
  console.log(`[fix-authors] mode=${mode} db=${DB_PATH}`);
  console.log(
    `[fix-authors] 回答总数=${answers.length} 需重排=${plans.length} ` +
      `无话题跳过=${skippedNoTopic.length}`
  );
  const fmt = (uid) => {
    const u = userById.get(uid);
    const ds = [...(domainSetOf.get(uid) || [])].join("+") || "∅";
    return u ? `${u.nickname}(${ds})` : `#${uid}(${ds})`;
  };
  for (const p of plans.slice(0, 15)) {
    console.log(
      `  回答 #${p.answer_id} q#${p.qid} 「${p.title.slice(0, 30)}」: ${fmt(p.from)} -> ${fmt(p.to)}`
    );
  }
  if (plans.length > 15) console.log(`  … 其余 ${plans.length - 15} 条略`);

  // 同域候选不足：打印候选池明细并抛错，不许静默跳过（Z1106）
  if (noCand.length) {
    console.error(`[fix-authors] ${noCand.length} 条回答无同域候选作者：`);
    for (const n of noCand) {
      const cur = userById.get(n.answer.author_id);
      console.error(
        `  回答 #${n.answer.id} q#${n.qid} 当前作者=${cur ? cur.nickname : n.answer.author_id} ` +
          `可接受域=[${[...n.ok].join("+")}] 同域候选池=${n.pool.length}：`
      );
      for (const c of n.pool.slice(0, 20)) {
        console.error(
          `    - ${c.u.nickname}#${c.u.id}[${[...(domainSetOf.get(c.u.id) || [])].join("+") || "∅"}] ${c.reason}`
        );
      }
      if (n.pool.length > 20) console.error(`    … 其余 ${n.pool.length - 20} 个略`);
    }
    db.close();
    throw new Error(
      `[fix-authors] ${noCand.length} 条回答同域候选不足，已中止（未写库）；` +
        `请扩充同域种子作者或人工指定`
    );
  }

  if (!APPLY) {
    console.log(`[fix-authors] dry-run：将改写 ${plans.length} 条（加 --apply 生效）`);
    db.close();
    return;
  }
  if (!plans.length) {
    console.log(`[fix-authors] 无需改动，跳过备份与写库`);
    db.close();
    return;
  }

  // 写库前备份到 data/backups/
  const backupDir = path.join(__dirname, "..", "data", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const ts = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .replace(/\..*$/, "");
  const backupPath = path.join(backupDir, `zhihu-${ts}-authors.db`);
  await db.backup(backupPath);
  console.log(`[fix-authors] 已备份: ${backupPath}`);

  const upd = db.prepare("UPDATE answers SET author_id = ? WHERE id = ?");
  let changed = 0;
  const tx = db.transaction(() => {
    for (const p of plans) changed += upd.run(p.to, p.answer_id).changes;
    // 计数口径不变（只换 author_id），按 seed 同口径重算保险
    db.prepare(
      `UPDATE questions SET
         answer_count = (SELECT COUNT(*) FROM answers a WHERE a.question_id = questions.id AND a.is_deleted = 0),
         follower_count = (SELECT COUNT(*) FROM follows f WHERE f.target_type = 'question' AND f.target_id = questions.id)`
    ).run();
    db.prepare(
      `UPDATE users SET
         salt_value = MAX(0,
           2 * (SELECT COALESCE(SUM(a.vote_up), 0) FROM answers a WHERE a.author_id = users.id AND a.is_deleted = 0)
           + 5 * (SELECT COUNT(*) FROM answers a
                  WHERE a.author_id = users.id AND a.is_deleted = 0
                    AND a.vote_up = (SELECT MAX(b.vote_up) FROM answers b
                                     WHERE b.question_id = a.question_id AND b.is_deleted = 0)
                    AND a.vote_up > 0)
           - 10 * (SELECT COUNT(*) FROM answers a WHERE a.author_id = users.id AND a.is_collapsed = 1)
         )`
    ).run();
    db.prepare(
      `UPDATE users SET level = CASE
         WHEN salt_value >= 300 THEN 7
         WHEN salt_value >= 200 THEN 6
         WHEN salt_value >= 130 THEN 5
         WHEN salt_value >= 80  THEN 4
         WHEN salt_value >= 40  THEN 3
         WHEN salt_value >= 15  THEN 2
         ELSE 1 END`
    ).run();
  });
  tx();
  console.log(`[fix-authors] apply 完成：改写 ${changed} 条 author_id`);
  db.close();
}

main().catch((e) => {
  console.error(`[fix-authors] 失败: ${e.message || e}`);
  process.exit(1);
});
