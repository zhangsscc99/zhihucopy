// scripts/assert/comment-variety.mjs — Z1147 评论区语料多样性断言（数据级 + API 双口径）
//
// 契约：
//   a) DB 全量：is_deleted=0 的 answer 评论，同一 answer 下重复文案 = 0
//      （GROUP BY target_id, TRIM(content)）。
//   b) DB 全量：全站同一句占用率 ≤15%（最高频文案条数 / 存活评论总数）。
//   c) 抽样 ≥20 条公开可见评论（作者/正文未被公共过滤）：
//      - 万能句白名单（seed-data/comments.js GENERIC_WHITELIST 精确匹配）
//        命中率 ≤20%，命中明细逐条打印；
//      - 单条正文长度 ≥6 字；
//      - API 双口径：GET /comments?target_type=answer&target_id=N 返回该 id
//        且正文与 DB 一致。
//
// --self-test：把 DB_PATH 指向的库复制到临时文件，在同一 answer 植入两条
//   同文案评论，checkVariety 必须 FAIL（未 FAIL 则自检失败）。
//
// 环境：DB_PATH（默认 <repo>/data/zhihu.db，只读打开）、API_BASE（默认 :3030）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, main } from "./lib.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const requireFromServer = createRequire(new URL("../../server/package.json", import.meta.url));
const Database = requireFromServer("better-sqlite3");
const { testCommentSql } = requireFromServer("./content-filter.js");
const { GENERIC_WHITELIST } = createRequire(import.meta.url)("../seed-data/comments.js");

const DB_PATH = path.resolve(
  process.env.DB_PATH || path.join(SCRIPT_DIR, "..", "..", "data", "zhihu.db")
);
const API = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
const SELF_TEST = process.argv.includes("--self-test");

const WL = new Set(GENERIC_WHITELIST);
const SAMPLE_N = 24;

function openDb(p, readonly = true) {
  return new Database(p, { readonly });
}

async function checkVariety(db, { skipApi = false } = {}) {
  // a) 全量：同一 answer 下重复文案 = 0。
  const dups = db
    .prepare(
      `SELECT target_id AS aid, TRIM(content) AS c, COUNT(*) AS n
       FROM comments
       WHERE is_deleted = 0 AND target_type = 'answer'
       GROUP BY target_id, TRIM(content)
       HAVING n > 1
       ORDER BY aid`
    )
    .all();
  for (const d of dups) {
    console.error(`  同答重复 answer#${d.aid} ×${d.n}：「${String(d.c).slice(0, 32)}」`);
  }
  expect(
    dups.length === 0,
    `is_deleted=0 评论仍有 ${dups.length} 组同一 answer 重复文案（见上）`
  );

  // b) 全量：全站同一句占用率 ≤15%。
  const total = db
    .prepare("SELECT COUNT(*) n FROM comments WHERE is_deleted = 0 AND target_type = 'answer'")
    .get().n;
  const top = db
    .prepare(
      `SELECT COUNT(*) n, content FROM comments
       WHERE is_deleted = 0 AND target_type = 'answer'
       GROUP BY TRIM(content) ORDER BY n DESC LIMIT 1`
    )
    .get();
  const share = total ? top.n / total : 0;
  console.log(
    `  全站最高频句占用 ${top.n}/${total} = ${(share * 100).toFixed(1)}%：「${String(top.content).slice(0, 30)}」`
  );
  expect(share <= 0.15, `单句全站占用率 ${(share * 100).toFixed(1)}% > 15%`);

  // c) 抽样 ≥20 条公开可见评论：白名单 ≤20%、长度 ≥6、API 双口径一致。
  const rows = db
    .prepare(
      `SELECT c.id, c.target_id AS aid, c.content
       FROM comments c JOIN users u ON u.id = c.author_id
       WHERE c.is_deleted = 0 AND c.target_type = 'answer' AND ${testCommentSql("c", "u")}
       ORDER BY c.id`
    )
    .all();
  // 抽样：先每个 answer 取一条覆盖更多回答，再按 id 顺序补足到 SAMPLE_N。
  const sample = [];
  const picked = new Set();
  const seenAid = new Set();
  for (const r of rows) {
    if (sample.length >= SAMPLE_N) break;
    if (!seenAid.has(r.aid)) {
      seenAid.add(r.aid);
      picked.add(r.id);
      sample.push(r);
    }
  }
  for (const r of rows) {
    if (sample.length >= SAMPLE_N) break;
    if (!picked.has(r.id)) {
      picked.add(r.id);
      sample.push(r);
    }
  }
  expect(sample.length >= 20, `可抽样公开评论不足 20 条（${sample.length}）`);

  const wlHits = sample.filter((r) => WL.has(String(r.content || "").trim()));
  for (const h of wlHits) {
    console.error(`  万能句命中 #${h.id} answer#${h.aid}：「${String(h.content).trim()}」`);
  }
  const wlRate = wlHits.length / sample.length;
  expect(
    wlRate <= 0.2,
    `抽样 ${sample.length} 条万能句命中 ${wlHits.length} 条（${(wlRate * 100).toFixed(0)}% > 20%）`
  );

  const tooShort = sample.filter((r) => [...String(r.content || "").trim()].length < 6);
  for (const s of tooShort) {
    console.error(`  过短评论 #${s.id} answer#${s.aid}：「${String(s.content).trim()}」`);
  }
  expect(tooShort.length === 0, `抽样有 ${tooShort.length} 条评论短于 6 字（见上）`);

  if (!skipApi) {
    const aids = [...new Set(sample.map((r) => r.aid))];
    const apiById = new Map();
    for (const aid of aids) {
      const res = await fetch(`${API}/comments?target_type=answer&target_id=${aid}`);
      const data = await res.json().catch(() => ({}));
      expect(res.status === 200, `GET /comments answer#${aid} -> ${res.status}`);
      for (const it of data.items || []) {
        apiById.set(it.id, it.content);
        for (const ch of it.children || []) apiById.set(ch.id, ch.content);
      }
    }
    const missing = sample.filter(
      (r) => !apiById.has(r.id) || apiById.get(r.id) !== r.content
    );
    for (const m of missing) {
      console.error(`  API 双口径不符 #${m.id} answer#${m.aid}：「${String(m.content).slice(0, 30)}」`);
    }
    expect(missing.length === 0, `API 双口径 ${missing.length}/${sample.length} 条不一致（见上）`);
    console.log(
      `  抽样 ${sample.length} 条覆盖 ${aids.length} 个 answer：白名单 ${wlHits.length} 条、过短 0、API 双口径一致`
    );
  } else {
    console.log(`  抽样 ${sample.length} 条：白名单 ${wlHits.length} 条、过短 0（API 校验跳过）`);
  }
}

main("comment-variety", async () => {
  if (!SELF_TEST) {
    const db = openDb(DB_PATH);
    try {
      await checkVariety(db);
    } finally {
      db.close();
    }
    return;
  }

  // --self-test：临时副本上植入同 answer 重复评论两条，断言必须 FAIL。
  const tmp = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "z1147-selftest-")),
    "zhihu.db"
  );
  fs.copyFileSync(DB_PATH, tmp);
  const db = openDb(tmp, false);
  try {
    const target = db
      .prepare(
        `SELECT target_id aid FROM comments
         WHERE is_deleted = 0 AND target_type = 'answer'
         GROUP BY target_id ORDER BY COUNT(*) DESC LIMIT 1`
      )
      .get();
    const author = db.prepare("SELECT id FROM users WHERE is_test = 0 LIMIT 1").get();
    const probe = `自检探针重复句 ${Date.now()}`;
    const ins = db.prepare(
      "INSERT INTO comments (target_type, target_id, author_id, content, is_deleted) VALUES ('answer', ?, ?, ?, 0)"
    );
    ins.run(target.aid, author.id, probe);
    ins.run(target.aid, author.id, probe);
    let failed = false;
    try {
      await checkVariety(db, { skipApi: true });
    } catch (e) {
      failed = true;
      console.log(`  self-test: 植入同答重复后断言如期 FAIL（${e.message.slice(0, 90)}）`);
    }
    expect(failed, "self-test 失败：植入两条同 answer 重复评论后断言没有 FAIL");
  } finally {
    db.close();
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  }
});
