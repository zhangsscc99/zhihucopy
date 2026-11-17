#!/usr/bin/env node
// scripts/assert/answer-tail-domain.mjs — Z1108 数据免责尾巴按话题限定断言
//
// 校验口径：
//   1) 问题主话题大类 ∈ {code, psy, edu} 的回答中，正文含数据免责标记
//      （别照抄|小流量验证|我这份数据）的条数必须 = 0，违规逐条列出 id。
//   2) 其余大类允许保留该类尾巴，但标记必须出现在正文最后一段
//      （按空行分段取末段），不许插在正文中间。
//   3) 命中标记的尾巴形态必须是 `>` 引用行收尾（content_md.trimEnd() 的末段
//      以 `>` 开头），避免标记混在普通句子里蒙混过关。
//
// 环境：DB_PATH（默认 <repo>/data/zhihu.db，readonly 打开）。
// 输出：逐项 PASS/FAIL + 总结 n/n；任一失败 process.exit(1)。

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const requireFromServer = createRequire(new URL("../../server/package.json", import.meta.url));
const Database = requireFromServer("better-sqlite3");
const requireSeed = createRequire(new URL("../seed.js", import.meta.url));
const { TOPICS } = requireSeed("./seed.js");

const DB_FILE = process.env.DB_PATH || fileURLToPath(new URL("../../data/zhihu.db", import.meta.url));

const TAIL_MARK_RE = /别照抄|小流量验证|我这份数据/;
const FORBIDDEN_CATS = new Set(["code", "psy", "edu"]);
const topicCat = new Map(TOPICS.map((t) => [t.name, t.cat]));

const results = [];
function report(name, ok, info = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${info ? ` — ${info}` : ""}`);
}

function main() {
  const db = new Database(DB_FILE, { readonly: true });

  const hits = db
    .prepare(
      `SELECT a.id, a.content_md,
              (SELECT t.name FROM question_topics qt
                 JOIN topics t ON t.id = qt.topic_id
                WHERE qt.question_id = a.question_id
                ORDER BY t.id LIMIT 1) AS topic_name
         FROM answers a
        WHERE a.content_md LIKE '%别照抄%'
           OR a.content_md LIKE '%小流量验证%'
           OR a.content_md LIKE '%我这份数据%'`
    )
    .all();

  // --- 1) code/psy/edu 话题下数据免责尾巴 = 0 -------------------------------
  const forbidden = [];
  const rest = [];
  for (const r of hits) {
    const cat = topicCat.get(r.topic_name) || "(unknown)";
    (FORBIDDEN_CATS.has(cat) ? forbidden : rest).push({ ...r, cat });
  }
  report(
    "db: code/psy/edu 话题回答无数据免责尾巴",
    forbidden.length === 0,
    forbidden.length === 0
      ? "违规=0"
      : `违规=${forbidden.length} ids=${forbidden.map((r) => r.id).join(",")}`
  );

  // --- 2) 允许类话题：标记只许出现在最后一段 ---------------------------------
  {
    const bad = [];
    for (const r of rest) {
      const trimmed = r.content_md.trimEnd();
      const nl2 = trimmed.lastIndexOf("\n\n");
      const lastParaStart = nl2 < 0 ? 0 : nl2 + 2; // 无空行 → 全文即一段
      const firstMark = trimmed.search(TAIL_MARK_RE);
      if (firstMark < lastParaStart) bad.push(r.id);
    }
    report(
      "db: 允许类话题的数据免责尾巴只出现在末段",
      bad.length === 0,
      bad.length === 0 ? `命中=${rest.length} 居中=${bad.length}` : `插在正文中间 ids=${bad.join(",")}`
    );
  }

  // --- 3) 允许类话题：末段须为 `>` 引用尾巴 ----------------------------------
  {
    const bad = [];
    for (const r of rest) {
      const lastPara = r.content_md.trimEnd().split(/\n\n+/).pop();
      if (!lastPara || !/^>/.test(lastPara.trimStart())) bad.push(r.id);
    }
    report(
      "db: 数据免责尾巴以 `>` 引用收尾",
      bad.length === 0,
      bad.length === 0 ? `命中=${rest.length}` : `非引用收尾 ids=${bad.join(",")}`
    );
  }

  db.close();
  const pass = results.filter(Boolean).length;
  console.log(`${pass}/${results.length}`);
  if (pass !== results.length) process.exit(1);
}

main();
