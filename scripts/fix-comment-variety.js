#!/usr/bin/env node
/**
 * scripts/fix-comment-variety.js — 存量「万能句」评论一次性重写（Z1147）
 *
 * 背景：旧版 seed 的评论池全是跨领域通用句且随机取用，线上同一 answer 下
 * 出现同文案多条（如 answer#18 两条「有一个小细节我可能理解得不对…」），
 * 评论区一眼机器感。
 *
 * 行为：
 *   1. 扫描 comments.is_deleted=0 且正文（去首尾空白后）精确命中
 *      GENERIC_WHITELIST（scripts/seed-data/comments.js，与断言同一份表）
 *      的评论 —— 只处理这些命中行，非白名单内容一律不动。
 *   2. 每条命中评论重写成「该 answer 所在话题大类的锚定句」：由回答正文
 *      关键词匹配 DOMAIN_COMMENTS[cat]，再依次退本类兜底句、通用池、
 *      回复池；候选跳过该 answer 下已存在的文案（含本批已指派的新文案），
 *      保证写完后同一 answer 无重复文案。
 *   3. 只 UPDATE content：author_id / created_at / parent_id / is_deleted
 *      原样保留；answers.comment_count 不变（不改删除态）。
 *   4. 幂等：重写后的文案不在白名单内，重跑时命中集为空，二次执行零改动。
 *   5. 默认 dry-run 打印「旧句 → 新句」对照；--apply 才写库，写库前
 *      db.backup() 到 <db目录>/backups/zhihu-<ts>-comment-variety.db。
 *
 * 用法：
 *   DB_PATH=/path/zhihu.db node scripts/fix-comment-variety.js           # dry-run
 *   DB_PATH=/path/zhihu.db node scripts/fix-comment-variety.js --apply
 *   生产库：--apply --prod 且 ZH_ALLOW_PROD_WRITE=1（prod-write-gate 口径）。
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
const { TOPICS } = require("./seed");
const {
  WHITELIST_SET,
  pickReplacement,
} = require("./seed-data/comments");

const DB_PATH = path.resolve(
  process.env.DB_PATH || path.join(__dirname, "..", "data", "zhihu.db")
);
const APPLY = process.argv.includes("--apply") || process.env.FIX_ALLOW_PROD === "1";

const CAT_BY_TOPIC = new Map(TOPICS.map((t) => [t.name, t.cat]));

async function main() {
  const db = new Database(DB_PATH, APPLY ? undefined : { readonly: true });

  // answer 元信息：主话题（最小 topic_id）-> cat；正文用于关键词锚定。
  const answerMeta = db.prepare(
    `SELECT a.id, a.content_md, t.name AS topic_name
     FROM answers a
     LEFT JOIN question_topics qt ON qt.question_id = a.question_id
       AND qt.topic_id = (
         SELECT MIN(q2.topic_id) FROM question_topics q2 WHERE q2.question_id = a.question_id
       )
     LEFT JOIN topics t ON t.id = qt.topic_id
     WHERE a.id = ?`
  );
  const metaOf = (aid) => {
    const m = answerMeta.get(aid) || {};
    return { cat: CAT_BY_TOPIC.get(m.topic_name) || null, content: m.content_md || "" };
  };

  // 每个 answer 已占用的文案（未删除评论全集），随指派逐步补充。
  const usedByAnswer = new Map();
  const usedOf = (aid) => {
    if (!usedByAnswer.has(aid)) {
      const rows = db
        .prepare(
          "SELECT TRIM(content) t FROM comments WHERE target_type = 'answer' AND target_id = ? AND is_deleted = 0"
        )
        .all(aid);
      usedByAnswer.set(aid, new Set(rows.map((r) => r.t)));
    }
    return usedByAnswer.get(aid);
  };

  const hits = db
    .prepare(
      "SELECT id, target_id, content, author_id, parent_id, created_at FROM comments WHERE target_type = 'answer' AND is_deleted = 0 ORDER BY id"
    )
    .all()
    .filter((r) => WHITELIST_SET.has(String(r.content || "").trim()));

  const plan = [];
  const unresolved = [];
  for (const h of hits) {
    const used = usedOf(h.target_id);
    used.delete(String(h.content).trim()); // 本句即将被替换，允许其它命中行复用位
    const { cat, content } = metaOf(h.target_id);
    const next = pickReplacement(cat, content, used, h.id);
    if (next === null) {
      unresolved.push(h);
      used.add(String(h.content).trim());
      continue;
    }
    used.add(next);
    plan.push({ id: h.id, aid: h.target_id, cat: cat || "?", from: h.content, to: next });
  }

  console.log(`[fix-variety] db=${DB_PATH} mode=${APPLY ? "apply" : "dry-run"}`);
  console.log(`[fix-variety] 白名单命中 ${hits.length} 条，可重写 ${plan.length} 条`);
  for (const p of plan) {
    console.log(
      `  comment#${p.id} answer#${p.aid} [${p.cat}] ` +
        `「${String(p.from).slice(0, 22)}」→「${p.to.slice(0, 30)}…」`
    );
  }
  for (const u of unresolved) {
    console.log(`  comment#${u.id} answer#${u.target_id} 无可替换句，保持原样`);
  }

  if (!APPLY) {
    db.close();
    return;
  }

  // 写库前先在 <db目录>/backups/ 落 zhihu-<YYYYMMDD>-<HHMMSS>-comment-variety.db，
  // 文件名与 prod-write-gate 的「当日备份」口径一致，随后直接用它过闸。
  const bdir = path.join(path.dirname(DB_PATH), "backups");
  fs.mkdirSync(bdir, { recursive: true });
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const backup = path.join(bdir, `zhihu-${stamp}-comment-variety.db`);
  await db.backup(backup);
  console.log(`[fix-variety] 备份已落盘：${backup}`);

  const mode = resolveWriteMode({
    argv: process.argv.concat(["--backup", backup]),
    env: process.env,
    dbPath: DB_PATH,
    scriptName: "fix-variety",
    Database,
  });
  if (mode !== "apply") {
    db.close();
    return;
  }

  const upd = db.prepare("UPDATE comments SET content = ? WHERE id = ?");
  const tx = db.transaction(() => {
    for (const p of plan) upd.run(p.to, p.id);
  });
  tx();
  db.close();
  console.log(`[fix-variety] 已重写 ${plan.length} 条，备份=${backup}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`[fix-variety] 执行失败: ${e.message || e}`);
    process.exit(1);
  });
}
