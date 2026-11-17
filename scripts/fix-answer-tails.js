#!/usr/bin/env node
/**
 * scripts/fix-answer-tails.js — 旧模板收尾一次性修正（Z1091）
 *
 * 背景：旧版 seed 给每第 6 条回答追加同一句「> 补充：<alpha>——任何方法都
 * 有适用边界，先确认你的约束和我的一致，再决定要不要照做。」，其中 alpha
 * 有三个变体，且部分变体虚构了评论区/读者互动。
 *
 * 行为：
 *   1. 扫描 answers.content_md，命中旧尾巴的回答剥掉尾巴，改接 seed.js 新
 *      ANSWER_TAILS 池中按「问题大类 + 命中集内按 id 排序的位次」映射的一句
 *      —— 同一大类内两两不重句（只要命中数 ≤ 池大小），同一批命中集上同一
 *      id 恒映射同一句，保证幂等可重跑。
 *   2. answer_revisions 中若存在同样残留旧尾巴的记录，同步改写（沿用其
 *      answer 对应的那句；答案不在命中集时退化为 id 哈希取句）。
 *   3. 默认 --dry-run 只报告；--apply 才写库，并打印改动条数。
 *
 * 用法：
 *   DB_PATH=/path/zhihu.db node scripts/fix-answer-tails.js            # dry-run
 *   DB_PATH=/path/zhihu.db node scripts/fix-answer-tails.js --apply
 *
 * 生产库保护：--apply 目标为 /www/zhihucopy/data/zhihu.db 时需显式
 * FIX_ALLOW_PROD=1（与 seed.js 的 SEED_ALLOW_PROD 口径一致）。
 */
"use strict";

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
const { TOPICS, ANSWER_TAILS } = require("./seed");

const APPLY = process.argv.includes("--apply");
const DB_PATH = path.resolve(
  process.env.DB_PATH || path.join(__dirname, "..", "data", "zhihu.db")
);
const PROD_DB = "/www/zhihucopy/data/zhihu.db";

if (APPLY && DB_PATH === PROD_DB && process.env.FIX_ALLOW_PROD !== "1") {
  console.error(
    `[fix-tails] 拒绝对生产库写入: ${DB_PATH}\n` +
      `[fix-tails] 请在副本上验证；确需写生产库请显式设置 FIX_ALLOW_PROD=1`
  );
  process.exit(1);
}

// 旧尾巴是单行引用块：`> 补充：<一句>——任何方法都有适用边界……照做。`
// 正常只出现在文末；全局匹配以兼容个别多条残留的病态数据。
const OLD_TAIL_G =
  />[ \t]*补充：[^\n]*?——?任何方法都有适用边界，先确认你的约束和我的一致，再决定要不要照做。/g;
const OLD_TAIL_MARK = "任何方法都有适用边界，先确认你的约束和我的一致，再决定要不要照做。";

const topicCat = new Map(TOPICS.map((t) => [t.name, t.cat]));

// 确定性整数打散（splitmix32 风格）：revision 退路取句用
function hash32(n) {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  return (x ^ (x >>> 15)) >>> 0;
}

function poolFor(cat) {
  return ANSWER_TAILS[cat] || ANSWER_TAILS.life;
}

function rewrite(md, sentence) {
  if (!md.includes(OLD_TAIL_MARK)) return null;
  const stripped = md
    .replace(OLD_TAIL_G, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  return stripped + "\n\n> " + sentence;
}

function main() {
  const db = new Database(DB_PATH);

  // 取命中旧尾巴的回答 + 其问题主话题名（同题话题同大类，取最小 id 即代表）
  const hits = db
    .prepare(
      `SELECT a.id, a.content_md,
              (SELECT t.name FROM question_topics qt
                 JOIN topics t ON t.id = qt.topic_id
                WHERE qt.question_id = a.question_id
                ORDER BY t.id LIMIT 1) AS topic_name
         FROM answers a
        WHERE a.content_md LIKE '%任何方法都有适用边界%'`
    )
    .all();

  const revHits = db
    .prepare(
      `SELECT id, answer_id, content_md FROM answer_revisions
        WHERE content_md LIKE '%任何方法都有适用边界%'`
    )
    .all();

  // answer id -> 确定的一句：同 cat 命中 id 升序位次 -> 池内同位次，
  // 同 cat 内不重句（命中数 ≤ 池大小时），同一命中集上完全确定。
  const sentenceOf = new Map();
  const catOfAnswer = new Map();
  const byCat = new Map();
  for (const r of hits) {
    const cat = topicCat.get(r.topic_name) || "life";
    catOfAnswer.set(r.id, cat);
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(r.id);
  }
  for (const [cat, ids] of byCat) {
    ids.sort((a, b) => a - b);
    const pool = poolFor(cat);
    ids.forEach((id, i) => sentenceOf.set(id, pool[i % pool.length]));
    if (ids.length > pool.length) {
      console.error(`[fix-tails] 警告：${cat} 命中 ${ids.length} 条 > 池 ${pool.length}，会有重复句`);
    }
  }

  const plans = [];
  for (const r of hits) {
    const next = rewrite(r.content_md, sentenceOf.get(r.id));
    if (next !== null) plans.push({ table: "answers", id: r.id, next });
  }

  // 修订记录同步：优先沿用对应 answer 的那句；answer 不在命中集时用 id 哈希
  const topicNameOfAnswer = db.prepare(
    `SELECT t.name FROM answers a
       JOIN question_topics qt ON qt.question_id = a.question_id
       JOIN topics t ON t.id = qt.topic_id
      WHERE a.id = ? ORDER BY t.id LIMIT 1`
  );
  for (const r of revHits) {
    let sentence = sentenceOf.get(r.answer_id);
    if (!sentence) {
      const row = topicNameOfAnswer.get(r.answer_id);
      const cat = topicCat.get(row && row.name) || "life";
      const pool = poolFor(cat);
      sentence = pool[hash32(r.answer_id) % pool.length];
    }
    const next = rewrite(r.content_md, sentence);
    if (next !== null) plans.push({ table: "answer_revisions", id: r.id, next });
  }

  const mode = APPLY ? "apply" : "dry-run";
  console.log(`[fix-tails] mode=${mode} db=${DB_PATH}`);
  console.log(`[fix-tails] 命中 answers=${hits.length} answer_revisions=${revHits.length}`);

  if (!APPLY) {
    for (const p of plans.slice(0, 5)) {
      const tail = p.next.slice(-60).replace(/\n/g, "\\n");
      console.log(`  样例 ${p.table}#${p.id}: …${tail}`);
    }
    console.log(`[fix-tails] dry-run：将改写 ${plans.length} 条（加 --apply 生效）`);
    db.close();
    return;
  }

  const upd = {
    answers: db.prepare("UPDATE answers SET content_md = ? WHERE id = ?"),
    answer_revisions: db.prepare("UPDATE answer_revisions SET content_md = ? WHERE id = ?"),
  };
  let changed = 0;
  const tx = db.transaction(() => {
    for (const p of plans) {
      const info = upd[p.table].run(p.next, p.id);
      changed += info.changes;
    }
  });
  tx();
  console.log(`[fix-tails] apply 完成：改写 ${changed} 条`);
  db.close();
}

main();
