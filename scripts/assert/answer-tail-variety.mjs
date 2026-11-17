#!/usr/bin/env node
// scripts/assert/answer-tail-variety.mjs — Z1125 正文末段模板感断言
//
// 校验口径（末句 = 正文去掉末尾「> 补记」引用行后，按 。！？ 切分的最后一句）：
//   1) 全量/抽样 ≥30 条回答，「末句骨架」重复率 ≤ 20%。
//      骨架归并口径：按收束修辞形态分桶 —— cmp（X 比 Y 更…/…倍）、
//      contrast（不是 A 是 B / 是 A 不是 B）、imper（别/不要/不必收尾）、
//      order（顺序/先…再…）、motto（记住/一句话/说白了…）。
//      非模板形末句每条独占骨架，不参与重复率分子。
//   2) 同一 question_id（语料模式下同一 story）下无两条回答共用同一骨架（0 冲突）。
//   3) scripts/seed.js 的 ANSWER_TAILS 每个大类池 ≥6 条、每条 35-100 字、
//      无禁用串（「任何方法都有适用边界」「评论区有人」「有读者提醒」「补充：补充」）。
//   4) 现有断言不回退：assert/seed-tails-variety.mjs 退出码须为 0。
//
// 数据源：DB_PATH（默认 <repo>/data/zhihu.db，readonly）；文件不存在时退化为
// 直接评估 scripts/seed-data 语料（story = 题目，answers = 同题回答）。
// 输出：逐项 PASS/FAIL + n/n；任一失败 exit 1。

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const requireFromServer = createRequire(new URL("../../server/package.json", import.meta.url));
const Database = requireFromServer("better-sqlite3");
const requireFromData = createRequire(new URL("../seed-data/index.js", import.meta.url));

const DB_FILE = process.env.DB_PATH || fileURLToPath(new URL("../../data/zhihu.db", import.meta.url));
const SEED_FILE = fileURLToPath(new URL("../seed.js", import.meta.url));
const TAILS_ASSERT = fileURLToPath(new URL("./seed-tails-variety.mjs", import.meta.url));

const results = [];
function report(name, ok, info = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${info ? ` — ${info}` : ""}`);
}

// --- 末句抽取与骨架分类 -------------------------------------------------------
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
// 模板形末句共享同形态骨架；非模板形每条独占（id 兜底），不参与重复率分子。
function skeletonOf(ls, id) {
  for (const [n, f] of SHAPES) if (f.test(ls)) return `shape:${n}`;
  return `u:${id}`;
}

// --- 取回答集：优先 DB，缺失时退化为语料 -------------------------------------
function loadAnswers() {
  if (fs.existsSync(DB_FILE)) {
    const db = new Database(DB_FILE, { readonly: true });
    const rows = db
      .prepare("SELECT id, question_id AS qid, content_md FROM answers WHERE is_deleted = 0")
      .all();
    db.close();
    return { src: `db:${DB_FILE}`, rows };
  }
  const { stories } = requireFromData(fileURLToPath(new URL("../seed-data/index.js", import.meta.url)));
  const rows = [];
  stories.forEach((st, si) =>
    st.answers.forEach((a, ai) => rows.push({ id: `${si}:${ai}`, qid: si, content_md: a.content }))
  );
  return { src: "corpus:scripts/seed-data", rows };
}

// --- 1)+2) 末句骨架重复率与同题冲突 ------------------------------------------
{
  const { src, rows } = loadAnswers();
  const items = rows.map((r) => ({ ...r, sk: skeletonOf(lastSentence(r.content_md), r.id) }));
  const cnt = new Map();
  for (const x of items) cnt.set(x.sk, (cnt.get(x.sk) || 0) + 1);
  const dup = items.filter((x) => cnt.get(x.sk) >= 2).length;
  const rate = items.length ? dup / items.length : 0;
  report(
    `${src}: 末句骨架重复率 ≤20%（n=${items.length}）`,
    items.length >= 30 && rate <= 0.2,
    `重复=${dup} (${(rate * 100).toFixed(1)}%)`
  );

  const byQ = new Map();
  for (const x of items) {
    if (!x.sk.startsWith("shape:")) continue;
    if (!byQ.has(x.qid)) byQ.set(x.qid, new Set());
    byQ.get(x.qid).add(x.sk);
  }
  const conflicts = [...byQ.entries()].flatMap(([qid, s]) =>
    [...s].filter((sk) => items.filter((x) => x.qid === qid && x.sk === sk).length >= 2)
      .map((sk) => `${qid}#${sk}`)
  );
  report(`${src}: 同题回答无重复末句骨架`, conflicts.length === 0, `冲突=${conflicts.length}${conflicts.length ? " " + conflicts.slice(0, 8).join(",") : ""}`);
}

// --- 3) ANSWER_TAILS 池 --------------------------------------------------------
{
  const src = fs.readFileSync(SEED_FILE, "utf8");
  const m = src.match(/const ANSWER_TAILS = \{[\s\S]*?\n\};/);
  const BANNED = ["任何方法都有适用边界", "评论区有人", "有读者提醒", "补充：补充"];
  if (!m) {
    report("seed: ANSWER_TAILS 池存在且合规", false, "未找到 const ANSWER_TAILS 池");
  } else {
    const cats = [...m[0].matchAll(/(\w+):\s*\[([\s\S]*?)\]/g)];
    const bad = [];
    for (const [cat, body] of cats.map((x) => [x[1], x[2]])) {
      const ss = [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]);
      if (ss.length < 6) bad.push(`${cat}:仅${ss.length}条`);
      const badLen = ss.filter((s) => [...s].length < 35 || [...s].length > 100);
      if (badLen.length) bad.push(`${cat}:${badLen.length}条长度越界`);
      const banned = BANNED.filter((b) => body.includes(b));
      if (banned.length) bad.push(`${cat}:含禁用串${banned.join("/")}`);
    }
    report(
      "seed: ANSWER_TAILS 每池 ≥6、35-100 字、无禁用串",
      cats.length > 0 && bad.length === 0,
      `池数=${cats.length}${bad.length ? " 问题=" + bad.join("; ") : ""}`
    );
  }
}

// --- 4) 现有断言不回退 ---------------------------------------------------------
{
  try {
    execFileSync(process.execPath, [TAILS_ASSERT], {
      env: {
        ...process.env,
        ...(fs.existsSync(DB_FILE) ? { DB_PATH: DB_FILE } : {}),
        NODE_CHANNEL_FD: "",
        NODE_CHANNEL_SERIALIZATION_MODE: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    report("regression: seed-tails-variety.mjs 仍 PASS", true);
  } catch (e) {
    const tail = `${e.stdout || ""}${e.stderr || ""}`.trim().split("\n").slice(-6).join(" | ");
    report("regression: seed-tails-variety.mjs 仍 PASS", false, tail);
  }
}

const pass = results.filter(Boolean).length;
console.log(`${pass}/${results.length}`);
if (pass !== results.length) process.exit(1);
