#!/usr/bin/env node
/**
 * scripts/clean-answer-tails.js — 跨话题误挂的数据免责尾巴切除（Z1108）
 *
 * 背景：旧版 ANSWER_TAILS.code 池里混着「别照抄文里的参数和阈值……换环境
 * 先小流量验证」这类数据/实验免责句，被无差别追加到 code/psy/edu 等话题的
 * 回答上（如 /question/6 的 React useEffect 回答），语义不符。
 *
 * 口径：只切「问题主话题大类 ∈ {code, psy, edu} 且正文含数据免责标记」的
 *   answers 行。切除命中标记的整行（含其前置 `>` 引用行），正文其余部分
 *   原样保留，末尾多余空行 trim 掉。幂等：跑第二遍命中 0 条。
 *
 * 用法：
 *   DB_PATH=/path/zhihu.db node scripts/clean-answer-tails.js   # 默认 dry-run（--dry-run 等价）
 *   DB_PATH=/path/zhihu.db node scripts/clean-answer-tails.js --apply   # 非生产库写库
 *   ZH_ALLOW_PROD_WRITE=1 node scripts/clean-answer-tails.js \
 *     --apply --prod --backup data/backups/zhihu-<YYYYMMDD>-<HHmm>.db   # 生产库
 *
 * 写库门槛：非生产库 --apply 或 FIX_ALLOW_PROD=1 任一即写；目标为
 * /www/zhihucopy/data/zhihu.db 时走受控写闸（scripts/prod-write-gate.js）：
 * --apply + --prod + ZH_ALLOW_PROD_WRITE=1 + 当日备份文件，缺一拒绝并打印缺项。
 * 写库前自动 .backup() 到 data/backups/。
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
const { TOPICS } = require("./seed");

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
    scriptName: "clean-tails",
    Database,
  }) === "apply";

// 数据免责尾巴标记：与 assert/answer-tail-domain.mjs 同一口径
const TAIL_MARK_RE = /别照抄|小流量验证|我这份数据/;
// 只许切这些大类；其余大类允许保留数据免责尾巴
const FORBIDDEN_CATS = new Set(["code", "psy", "edu"]);

const topicCat = new Map(TOPICS.map((t) => [t.name, t.cat]));

// 切除命中标记的整行；若该行是 `>` 引用块（尾巴形态）连块一起剥掉，
// 普通正文行命中则只去该行。收拢 3+ 连续换行，trimEnd 收尾。
function stripTail(md) {
  if (!TAIL_MARK_RE.test(md)) return null;
  const lines = md.split("\n");
  const kept = lines.filter((line) => !TAIL_MARK_RE.test(line));
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

async function main() {
  const db = new Database(DB_PATH);

  const hits = db
    .prepare(
      `SELECT a.id, a.content_md, q.title AS question_title,
              (SELECT t.name FROM question_topics qt
                 JOIN topics t ON t.id = qt.topic_id
                WHERE qt.question_id = a.question_id
                ORDER BY t.id LIMIT 1) AS topic_name
         FROM answers a
         JOIN questions q ON q.id = a.question_id
        WHERE a.content_md LIKE '%别照抄%'
           OR a.content_md LIKE '%小流量验证%'
           OR a.content_md LIKE '%我这份数据%'`
    )
    .all();

  const plans = [];
  let skippedAllowedCat = 0;
  for (const r of hits) {
    const cat = topicCat.get(r.topic_name) || "(unknown)";
    const next = stripTail(r.content_md);
    if (FORBIDDEN_CATS.has(cat) && next !== null && next !== r.content_md) {
      plans.push({ id: r.id, cat, topic: r.topic_name, title: r.question_title, before: r.content_md, next });
    } else {
      skippedAllowedCat++;
    }
  }

  console.log(`[clean-tails] mode=${APPLY ? "apply" : "dry-run"} db=${DB_PATH}`);
  console.log(`[clean-tails] 标记命中 ${hits.length} 条；可切(forbidden cat)=${plans.length} 保留(allowed cat)=${skippedAllowedCat}`);
  for (const p of plans) {
    const cut = p.before.slice(p.next.length).replace(/\n/g, "\\n");
    console.log(`  answer#${p.id} 「${p.title}」 topic=${p.topic}(${p.cat})`);
    console.log(`    切除: …${cut.slice(0, 90)}`);
  }

  if (!APPLY) {
    console.log(`[clean-tails] dry-run：不改库（--apply 生效；生产库另需 --prod + ZH_ALLOW_PROD_WRITE=1 + 当日备份）`);
    db.close();
    return;
  }

  // 写库前备份到 data/backups/（写闸要求的当日备份是 apply 前的底线）
  const backupDir = path.join(path.dirname(DB_PATH), "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const ts = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .replace(/\..*$/, "");
  const backupPath = path.join(backupDir, `zhihu-${ts}-tails.db`);
  await db.backup(backupPath);
  console.log(`[clean-tails] 写库前备份完成：${backupPath}`);

  const upd = db.prepare("UPDATE answers SET content_md = ? WHERE id = ?");
  let changed = 0;
  const tx = db.transaction(() => {
    for (const p of plans) changed += upd.run(p.next, p.id).changes;
  });
  tx();
  console.log(`[clean-tails] apply 完成：切除 ${changed} 条`);
  db.close();
}

main().catch((e) => {
  console.error(`[clean-tails] 失败: ${e.message || e}`);
  process.exit(1);
});
