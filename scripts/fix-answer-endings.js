#!/usr/bin/env node
/**
 * scripts/fix-answer-endings.js — 正文末段模板化收尾一次性修正（Z1125）
 *
 * 背景：真人走查发现多条回答正文末段共用同一类收束句式（「X 比 Y 更…」
 * 「是 A 不是 B」「记住顺序」式）。Z1125 已在 scripts/seed-data 里改写了
 * 这些末句，新旧句对照固化在 scripts/answer-endings-map.json；本脚本把
 * 同一份对照应用到历史库里已有的 answers / answer_revisions。
 *
 * 行为：
 *   1. 逐条查 answers.content_md 是否包含 map.old（原文内联替换，不动
 *      其后的补记尾巴）；同时扫 answer_revisions.content_md。
 *   2. 命中但 map 未覆盖的「模板形收尾」（answer-tail-variety 同口径）
 *      只在 dry-run 报告，不自动改——避免为了过断言写出空泛句子。
 *   3. 默认 dry-run 打印将改哪些 id、旧句 → 新句；--apply 才写库。
 *      写库前先在 <db目录>/backups/ 落一份 zhihu-<ts>-endings.db 备份。
 *   4. 幂等：替换按精确字符串匹配，已替换的行不再命中，可重复执行。
 *
 * 用法：
 *   DB_PATH=/path/zhihu.db node scripts/fix-answer-endings.js          # dry-run
 *   DB_PATH=/path/zhihu.db node scripts/fix-answer-endings.js --apply
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

const DB_PATH = path.resolve(
  process.env.DB_PATH || path.join(__dirname, "..", "data", "zhihu.db")
);
const MAP = JSON.parse(
  fs.readFileSync(path.join(__dirname, "answer-endings-map.json"), "utf8")
);
const APPLY = process.argv.includes("--apply") || process.env.FIX_ALLOW_PROD === "1";

// --- 模板形收尾分类器（与 scripts/assert/answer-tail-variety.mjs 同口径） ----
const CLAUSE = "[^，。！？]";
const SHAPES = [
  ["cmp", new RegExp(`比${CLAUSE}{1,20}(更|都|还)?(重要|牢|强|好|快|高|有用|管用|值|划算|贵|多|少|难|容易|稀缺|高级|有效|真实|可靠|省|顶)|比${CLAUSE}{1,15}(十|百|千|万)?倍`)],
  ["contrast", new RegExp(`不是${CLAUSE}{1,15}[，,]?(而)?是|是${CLAUSE}{1,15}[，,]?不是`)],
  ["imper", /(^|[，。；])(别(?!人|的|处|样|墅|致)|不要|不必)[^，。！？]{0,30}$/],
  ["order", new RegExp(`顺序|先${CLAUSE}{1,10}再|先${CLAUSE}{1,10}后`)],
  ["motto", /记住|一句话|总结成|说白了|归根结底|说到底|本质上?就是/],
];
function lastSentence(md) {
  const lines = md.trimEnd().split("\n");
  while (lines.length && /^>\s?/.test(lines[lines.length - 1])) lines.pop();
  const text = lines.join("\n").trimEnd().replace(/[*_`#>]/g, "");
  const parts = text.split(/(?<=[。！？!?])/).filter((p) => p.trim());
  return (parts.pop() || "").trim();
}
function shapeOf(s) {
  for (const [n, f] of SHAPES) if (f.test(s)) return n;
  return null;
}

function rewrite(md) {
  let out = md;
  const hits = [];
  for (const { old, new: nw } of MAP) {
    if (out.includes(old)) {
      out = out.split(old).join(nw);
      hits.push(old);
    }
  }
  return hits.length ? { text: out, hits } : null;
}

async function main() {
  const db = new Database(DB_PATH, APPLY ? undefined : { readonly: true });

  const answers = db
    .prepare("SELECT id, content_md FROM answers WHERE is_deleted = 0")
    .all();
  const revisions = db
    .prepare("SELECT id, content_md FROM answer_revisions")
    .all();

  const plan = [];
  for (const t of [["answers", answers], ["answer_revisions", revisions]]) {
    for (const r of t[1]) {
      const r2 = rewrite(r.content_md);
      if (r2) plan.push({ table: t[0], id: r.id, hits: r2.hits, text: r2.text });
    }
  }

  // 报告：map 覆盖之外的模板形末句（只报不改）
  const mappedOlds = new Set(MAP.map((m) => m.old));
  const unmapped = [];
  for (const r of answers) {
    const ls = lastSentence(r.content_md);
    const shape = shapeOf(ls);
    if (shape && !mappedOlds.has(ls)) unmapped.push({ id: r.id, shape, ls });
  }

  console.log(`[fix-endings] db=${DB_PATH} mode=${APPLY ? "apply" : "dry-run"}`);
  console.log(`[fix-endings] map=${MAP.length} 条，命中 answers/answer_revisions 行=${plan.length}`);
  for (const p of plan) {
    for (const h of p.hits) {
      console.log(`  ${p.table}#${p.id}: 「${h.slice(0, 42)}…」→ 已映射新句`);
    }
  }
  if (unmapped.length) {
    console.log(`[fix-endings] 另有 ${unmapped.length} 条模板形末句未被 map 覆盖（仅报告，不自动改写）：`);
    for (const u of unmapped.slice(0, 40)) {
      console.log(`  answers#${u.id} [${u.shape}] ${u.ls.slice(-60)}`);
    }
  }

  if (!APPLY) {
    db.close();
    return;
  }

  // 写库前先在 <db目录>/backups/ 落 zhihu-<YYYYMMDD>-<HHMMSS>-endings.db，
  // 文件名与 prod-write-gate 的「当日备份」口径一致，随后直接用它过闸。
  const bdir = path.join(path.dirname(DB_PATH), "backups");
  fs.mkdirSync(bdir, { recursive: true });
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const backup = path.join(bdir, `zhihu-${stamp}-endings.db`);
  await db.backup(backup);
  console.log(`[fix-endings] 备份已落盘：${backup}`);

  const mode = resolveWriteMode({
    argv: process.argv.concat(["--backup", backup]),
    env: process.env,
    dbPath: DB_PATH,
    scriptName: "fix-endings",
    Database,
  });
  if (mode !== "apply") {
    db.close();
    return;
  }

  const upd = {
    answers: db.prepare("UPDATE answers SET content_md = ?, updated_at = datetime('now','localtime') WHERE id = ?"),
    answer_revisions: db.prepare("UPDATE answer_revisions SET content_md = ? WHERE id = ?"),
  };
  const tx = db.transaction(() => {
    for (const p of plan) upd[p.table].run(p.text, p.id);
  });
  tx();
  db.close();
  console.log(`[fix-endings] 已改写 ${plan.length} 行，备份=${backup}`);
}

main().catch((e) => {
  console.error(`[fix-endings] 执行失败: ${e.message || e}`);
  process.exit(1);
});
