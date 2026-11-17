#!/usr/bin/env node
// scripts/assert/seed-tails-variety.mjs — Z1091 回答收尾多样性断言
//
// 校验口径：
//   1) answers.content_md 不再含旧模板尾巴（「任何方法都有适用边界」/「补充：补充」）。
//   2) 任意两条回答末尾 120 字的最长公共后缀 ≤ 20 字（全量 O(n²)，303 条可承受）。
//   3) 声称评论区/读者互动的句子（「评论区有人」「有读者提醒」）在 comment_count=0 的回答上为 0。
//   4) scripts/seed.js 的收尾句池 ≥ 12 条、每条 40-90 字，且不含禁用串。
//   5) API 抽 8 条 /answers/:id，content_md 不允许残留旧模板尾巴。
//
// 环境：API_BASE（默认 :3030）、DB_PATH（默认 <repo>/data/zhihu.db，readonly 打开）。
// 输出：逐项 PASS/FAIL + 总结 n/n；任一失败 process.exit(1)。

import { createRequire } from "node:module";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const requireFromServer = createRequire(new URL("../../server/package.json", import.meta.url));
const Database = requireFromServer("better-sqlite3");

const API = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
const DB_FILE = process.env.DB_PATH || new URL("../../data/zhihu.db", import.meta.url).pathname;
const SEED_FILE = fileURLToPath(new URL("../seed.js", import.meta.url));

const results = [];
function report(name, ok, info = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${info ? ` — ${info}` : ""}`);
}

// 旧模板尾巴：`\n\n> 补充：<alpha>——任何方法都有适用边界……照做。`（三种 alpha 变体同构）
const OLD_TAIL_RE = /补充：[^\n]*?任何方法都有适用边界/;
const BANNED = ["评论区有人问到", "有读者提醒我", "任何方法都有适用边界", "补充：补充"];

// 最长公共后缀长度（字符级）
function lcsSuffix(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

async function main() {
  const db = new Database(DB_FILE, { readonly: true });

  // --- 1) 旧模板尾巴清零 -----------------------------------------------------
  {
    const oldTail = db
      .prepare("SELECT COUNT(*) c FROM answers WHERE content_md LIKE '%任何方法都有适用边界%'")
      .get().c;
    const dup = db
      .prepare("SELECT COUNT(*) c FROM answers WHERE content_md LIKE '%补充：补充%'")
      .get().c;
    report("db: 旧模板尾巴/重复补充 清零", oldTail === 0 && dup === 0, `旧尾巴=${oldTail} 补充：补充=${dup}`);
  }

  // --- 2) 最长公共后缀 ≤ 20（全量两两比对，口径：所有 answers 行末 120 字） -----
  {
    const rows = db.prepare("SELECT id, substr(content_md, -120) t FROM answers").all();
    let max = 0;
    let pair = null;
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const n = lcsSuffix(rows[i].t, rows[j].t);
        if (n > max) {
          max = n;
          pair = [rows[i].id, rows[j].id];
        }
      }
    }
    report("db: 任意两回答末 120 字最长公共后缀 ≤ 20", max <= 20, `max=${max} pair=${pair ? pair.join("/") : "-"}`);
  }

  // --- 3) 0 评论回答不得声称评论区/读者互动 ----------------------------------
  {
    const c = db
      .prepare(
        `SELECT COUNT(*) c FROM answers
         WHERE comment_count = 0
           AND (content_md LIKE '%评论区有人%' OR content_md LIKE '%有读者提醒%')`
      )
      .get().c;
    report("db: 无评论回答不虚构互动", c === 0, `违规=${c}`);
  }

  // --- 4) seed 源侧：收尾句池 ≥12、每条 40-90 字、无禁用串 ---------------------
  {
    const src = fs.readFileSync(SEED_FILE, "utf8");
    const m = src.match(/const ANSWER_TAILS = \{[\s\S]*?\n\};/);
    if (!m) {
      report("seed: ANSWER_TAILS 池存在且合规", false, "未找到 const ANSWER_TAILS 池");
    } else {
      const sentences = [...m[0].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]);
      const badLen = sentences.filter((s) => [...s].length < 40 || [...s].length > 90);
      const banned = BANNED.filter((b) => m[0].includes(b));
      const ok =
        sentences.length >= 12 && badLen.length === 0 && banned.length === 0;
      report(
        "seed: ANSWER_TAILS 池 ≥12、40-90 字、无禁用串",
        ok,
        `句数=${sentences.length} 越界=${badLen.length} 禁用串=${banned.join(",") || "无"}`
      );
    }
  }

  // --- 5) API 抽样：8 条回答不得残留旧模板尾巴 --------------------------------
  {
    const ids = db
      .prepare("SELECT id FROM answers WHERE is_deleted = 0 ORDER BY random() LIMIT 8")
      .all()
      .map((r) => r.id);
    let bad = 0;
    let detail = "";
    for (const id of ids) {
      const res = await fetch(`${API}/answers/${id}`);
      const data = await res.json().catch(() => ({}));
      const md = data && data.answer && data.answer.content_md;
      if (res.status !== 200 || typeof md !== "string" || OLD_TAIL_RE.test(md)) {
        bad++;
        detail += ` #${id}(status=${res.status})`;
      }
    }
    report("api: 抽样 8 条回答无旧尾巴", bad === 0, `抽检=${ids.length} 命中=${bad}${detail}`);
  }

  db.close();

  const pass = results.filter(Boolean).length;
  console.log(`${pass}/${results.length}`);
  if (pass !== results.length) process.exit(1);
}

main().catch((e) => {
  console.error(`FAIL 断言执行异常: ${e.message || e}`);
  process.exit(1);
});
