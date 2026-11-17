#!/usr/bin/env node
/**
 * scripts/fix-comment-variety.js — 存量「万能句 + 过度复用」评论一次性重写
 *（Z1147 起，Z1152 扩展到占用率/跨题复用两条新口径）
 *
 * 背景：旧版 seed 的评论池全是跨领域通用句且随机取用，同一 answer 下出现
 * 同文案多条；Z1147 分域锚定后仍有个别高频句跨题刷屏（如「上线先灰度再
 * 全量…」同时出现在 13 个 question 下），一眼机器感。
 *
 * 处理对象（comments.is_deleted=0 且 target_type='answer'，按 id 升序）：
 *   1. 正文（去首尾空白）精确命中 GENERIC_WHITELIST 的评论 —— 全部重写；
 *   2. 全站单句占用 >8% 的句：每句只保留 id 最小的 floor(8%×存活总数) 条，
 *      超额行重写；
 *   3. 同一句出现在 >3 个不同 question 下的句：按行 id 升序保留前 3 个
 *      question 里的行，落在其它 question 的行重写；
 *   4. 「无实指」评论（Z1152）：与该回答正文无 ≥4 字连续重合、且不命中
 *      该回答所属大类领域名词表（DOMAIN_NOUNS）——与断言同一份判据。
 *      存量库里这类句占七成，只改前三类到不了断言的 ≥60% 实指占比，
 *      故一并重写为域内锚定句。
 *   四类条件取并集构成重写集；「保留集」完全按行 id 确定性计算。
 *
 * 重写取句：该 answer 所在话题大类的锚定句 → 本类兜底 → 通用池 → 二级回复
 * 池（回复句 k 需命中父评论当前文本；父评论本身被重写时用新文本）。候选句
 * 还必须满足：同 answer 未占用、指派后全站占用 ≤8%、所在 question 集合
 * ≤3 —— 保证写完后三类条件全部失效，二次执行零改动（幂等）。
 *
 * 只 UPDATE content：author_id / created_at / parent_id / is_deleted 原样
 * 保留；answers.comment_count 不变（不改删除态）。
 *
 * 默认 dry-run 打印概要与「旧句 → 新句」对照；--apply 才写库，写库前
 * db.backup() 到 <db目录>/backups/zhihu-<ts>-comment-variety.db。
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
  isAnchored,
  pickQuote,
} = require("./seed-data/comments");

const DB_PATH = path.resolve(
  process.env.DB_PATH || path.join(__dirname, "..", "data", "zhihu.db")
);
const APPLY = process.argv.includes("--apply") || process.env.FIX_ALLOW_PROD === "1";

const CAT_BY_TOPIC = new Map(TOPICS.map((t) => [t.name, t.cat]));
const CROSS_Q_CAP = 3; // 同一句最多出现在 3 个不同 question 下（与断言口径一致）

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

  // 全量存活 answer 评论（含所在 question_id），按 id 升序 = 全脚本确定性来源。
  const rows = db
    .prepare(
      `SELECT c.id, c.target_id AS aid, a.question_id AS qid, c.parent_id,
              TRIM(c.content) AS t
       FROM comments c JOIN answers a ON a.id = c.target_id
       WHERE c.target_type = 'answer' AND c.is_deleted = 0
       ORDER BY c.id`
    )
    .all();
  const total = rows.length;
  const useCap = Math.max(1, Math.floor(total * 0.08));

  // ---------- 重写集判定：白名单 + 占用超限 + 跨题超限（并集） ----------
  const byText = new Map(); // t -> rows[]（输入已按 id 排序）
  for (const r of rows) {
    if (!byText.has(r.t)) byText.set(r.t, []);
    byText.get(r.t).push(r);
  }
  const rewriteIds = new Set();
  let wlRowN = 0;
  const occViol = []; // {t, n}
  const qViol = []; // {t, qn, n}
  for (const [t, list] of byText) {
    if (WHITELIST_SET.has(t)) {
      wlRowN += list.length;
      for (const r of list) rewriteIds.add(r.id);
      continue;
    }
    const qids = new Set(list.map((r) => r.qid));
    if (list.length > useCap) occViol.push({ t, n: list.length });
    if (qids.size > CROSS_Q_CAP) qViol.push({ t, qn: qids.size, n: list.length });
    // 保留集：按 id 升序、前 3 个 question 内、且不超过 useCap 条。
    const keptQ = new Set();
    let kept = 0;
    for (const r of list) {
      if ((keptQ.size < CROSS_Q_CAP || keptQ.has(r.qid)) && kept < useCap) {
        keptQ.add(r.qid);
        kept++;
      } else {
        rewriteIds.add(r.id);
      }
    }
  }

  // ---------- 规则 4：无实指评论（与断言同判据），并入重写集 ----------
  let unanchoredN = 0;
  for (const r of rows) {
    if (rewriteIds.has(r.id)) continue;
    const { cat, content } = metaOf(r.aid);
    if (!isAnchored(r.t, cat, content)) {
      rewriteIds.add(r.id);
      unanchoredN++;
    }
  }

  // ---------- 替换可用性基线：只统计「保留集」的占用与跨题分布 ----------
  const useCount = new Map(); // t -> 保留行数
  const qUse = new Map(); // t -> Set<qid>
  for (const r of rows) {
    if (rewriteIds.has(r.id)) continue;
    useCount.set(r.t, (useCount.get(r.t) || 0) + 1);
    if (!qUse.has(r.t)) qUse.set(r.t, new Set());
    qUse.get(r.t).add(r.qid);
  }
  const allow = (t, qid) =>
    (useCount.get(t) || 0) < useCap &&
    (!qUse.has(t) || qUse.get(t).has(qid) || qUse.get(t).size < CROSS_Q_CAP);

  // 每个 answer 已占用文案（含未重写行的旧文案与已指派新文案，随指派更新）。
  const usedByAnswer = new Map();
  for (const r of rows) {
    if (!usedByAnswer.has(r.aid)) usedByAnswer.set(r.aid, new Set());
    usedByAnswer.get(r.aid).add(r.t);
  }
  // 父评论文本：库里原值 + 本批已指派的新值（回复句 k 要挂到父评论实指上）。
  const rawText = new Map(
    db.prepare("SELECT id, TRIM(content) t FROM comments").all().map((r) => [r.id, r.t])
  );
  const finalText = new Map();

  const plan = [];
  const unresolved = [];
  for (const r of rows) {
    if (!rewriteIds.has(r.id)) continue;
    const used = usedByAnswer.get(r.aid);
    used.delete(r.t); // 本句即将被替换，允许同 answer 其它命中行复用位
    const { cat, content } = metaOf(r.aid);
    const parentText = r.parent_id
      ? finalText.get(r.parent_id) || rawText.get(r.parent_id) || ""
      : "";
    // 取句三轮（候选一律要求「实指」isAnchored —— 换上的句自身满足断言判据，
    // 二次执行才不会被规则 4 再次命中，幂等才有保证）：
    // ① k 命中回答正文的锚定句（含消耗新跨题名额——实指优先）；
    // ② 已「计费」到本题的实指句（同题多 answer 复用不新增跨题占用）；
    // ③ 消耗新跨题名额的实指句。① 保实指密度，② 保后面 question 的配额。
    const charged = (t) => qUse.has(t) && qUse.get(t).has(r.qid);
    const fits = (t) => allow(t, r.qid) && isAnchored(t, cat, content);
    let next = pickReplacement(cat, content, used, r.id, {
      allow: fits,
      prefer: charged,
      parentText,
      onlyAnchored: true,
    });
    if (next === null) {
      next = pickReplacement(cat, content, used, r.id, {
        allow: (t) => (useCount.get(t) || 0) < useCap && charged(t) && isAnchored(t, cat, content),
        parentText,
      });
    }
    if (next === null) {
      next = pickReplacement(cat, content, used, r.id, {
        allow: fits,
        parentText,
      });
    }
    // ④ 兜底引述句：语料/名额占满时从回答正文摘片段包裹成句，实指成立。
    if (next === null) {
      next = pickQuote(content, used, r.id, (t) => allow(t, r.qid));
    }
    if (next === null) {
      unresolved.push(r);
      used.add(r.t);
      continue;
    }
    used.add(next);
    useCount.set(next, (useCount.get(next) || 0) + 1);
    if (!qUse.has(next)) qUse.set(next, new Set());
    qUse.get(next).add(r.qid);
    finalText.set(r.id, next);
    plan.push({ id: r.id, aid: r.aid, qid: r.qid, cat: cat || "?", from: r.t, to: next });
  }

  console.log(`[fix-variety] db=${DB_PATH} mode=${APPLY ? "apply" : "dry-run"}`);
  console.log(
    `[fix-variety] 存活评论 ${total} 条，占用上限 ${useCap} 条/句，跨题上限 ${CROSS_Q_CAP} 题/句`
  );
  console.log(
    `[fix-variety] 命中：白名单 ${wlRowN} 行；占用>8% 的句 ${occViol.length} 种；` +
      `跨题>${CROSS_Q_CAP} 的句 ${qViol.length} 种；无实指 ${unanchoredN} 行；` +
      `待重写 ${plan.length} 行` +
      (unresolved.length ? `（${unresolved.length} 行无可替换句）` : "")
  );
  for (const v of occViol) {
    console.log(`  占用超限 「${String(v.t).slice(0, 28)}」×${v.n}`);
  }
  for (const v of qViol.slice(0, 12)) {
    console.log(`  跨题超限 「${String(v.t).slice(0, 28)}」×${v.n} 行 / ${v.qn} 题`);
  }
  if (qViol.length > 12) console.log(`  …跨题超限另有 ${qViol.length - 12} 种`);
  const SHOW = 60;
  for (const p of plan.slice(0, SHOW)) {
    console.log(
      `  comment#${p.id} answer#${p.aid} q#${p.qid} [${p.cat}] ` +
        `「${String(p.from).slice(0, 22)}」→「${p.to.slice(0, 30)}…」`
    );
  }
  if (plan.length > SHOW) console.log(`  …改写明细另有 ${plan.length - SHOW} 行`);
  for (const u of unresolved) {
    console.log(`  comment#${u.id} answer#${u.aid} 无可替换句，保持原样`);
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
