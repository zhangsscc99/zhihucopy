// scripts/assert/comment-variety.mjs — 评论区语料多样性断言（数据级 + API 双口径）
// Z1147 建、Z1152 收紧：万能句白名单 ≤5%、全站单句占用 ≤8%、同一句跨题
// ≤3 个 question、抽样「指向回答具体概念」占比 ≥60%。
//
// 契约：
//   a) DB 全量：is_deleted=0 的 answer 评论，同一 answer 下重复文案 = 0
//      （GROUP BY target_id, TRIM(content)）。
//   b) DB 全量：全站同一句占用率 ≤8%（最高频文案条数 / 存活评论总数）；
//      且同一句出现在 ≤3 个不同 question 下。
//   b2) 抽样 5 个问题（按存活评论数取前 5），取该题下全部 is_deleted=0
//      评论，同一 question 内相同文案出现次数 ≤1（Z1152b：读者连刷同题
//      多条回答不撞句）；失败打印问题 id 与句子前 20 字。
//   c) 抽样 30 条公开可见评论（作者/正文未被公共过滤）：
//      - 万能句白名单（seed-data/comments.js GENERIC_WHITELIST 精确匹配）
//        命中率 ≤5%，命中明细逐条打印；
//      - 「指向回答具体概念」占比 ≥60%，判据：评论与所属回答正文有 ≥4 字
//        连续重合，或命中该回答所属大类的领域名词表（DOMAIN_NOUNS）；
//        命中率无论过不过线都打印（改前库应明显低于 60%，作反向自检证据）；
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
const reqHere = createRequire(import.meta.url);
const { GENERIC_WHITELIST, isAnchored } = reqHere("../seed-data/comments.js");
const { TOPICS } = reqHere("../seed.js");

const DB_PATH = path.resolve(
  process.env.DB_PATH || path.join(SCRIPT_DIR, "..", "..", "data", "zhihu.db")
);
const API = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
const SELF_TEST = process.argv.includes("--self-test");

const WL = new Set(GENERIC_WHITELIST);
const SAMPLE_N = 30;
const CROSS_Q_CAP = 3;
const OCCUPANCY_CAP = 0.08;
const ANCHOR_MIN = 0.6;
const CAT_BY_TOPIC = new Map(TOPICS.map((t) => [t.name, t.cat]));

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

  // b) 全量：全站同一句占用率 ≤8%；同一句跨题 ≤3 个 question。
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
  expect(share <= OCCUPANCY_CAP, `单句全站占用率 ${(share * 100).toFixed(1)}% > 8%`);

  const cross = db
    .prepare(
      `SELECT COUNT(DISTINCT a.question_id) q, COUNT(*) n, TRIM(c.content) t
       FROM comments c JOIN answers a ON a.id = c.target_id
       WHERE c.is_deleted = 0 AND c.target_type = 'answer'
       GROUP BY TRIM(c.content)
       HAVING q > ${CROSS_Q_CAP}
       ORDER BY q DESC, n DESC`
    )
    .all();
  for (const x of cross.slice(0, 10)) {
    console.error(`  跨题复用 ×${x.q} 题（${x.n} 行）：「${String(x.t).slice(0, 32)}」`);
  }
  if (cross.length > 10) console.error(`  …跨题复用超限另有 ${cross.length - 10} 种句`);
  expect(
    cross.length === 0,
    `仍有 ${cross.length} 种文案出现在 >${CROSS_Q_CAP} 个 question 下（见上）`
  );

  // b2) 抽样 5 个问题（存活评论数前 5，确定性）：同题相同文案 ≤1 次。
  const topQs = db
    .prepare(
      `SELECT a.question_id AS qid, COUNT(*) AS n
       FROM comments c JOIN answers a ON a.id = c.target_id
       WHERE c.is_deleted = 0 AND c.target_type = 'answer'
       GROUP BY a.question_id ORDER BY n DESC, qid LIMIT 5`
    )
    .all();
  let sameQGroups = 0;
  let sameQMax = 0;
  const sameQDup = db.prepare(
    `SELECT TRIM(c.content) AS t, COUNT(*) AS n
     FROM comments c JOIN answers a ON a.id = c.target_id
     WHERE c.is_deleted = 0 AND c.target_type = 'answer' AND a.question_id = ?
     GROUP BY TRIM(c.content) HAVING n > 1 ORDER BY n DESC`
  );
  for (const q of topQs) {
    for (const d of sameQDup.all(q.qid)) {
      sameQGroups++;
      sameQMax = Math.max(sameQMax, d.n);
      console.error(`  同题重复 q#${q.qid} ×${d.n}：「${String(d.t).slice(0, 20)}」`);
    }
  }
  console.log(
    `  同题抽查 ${topQs.length} 题（q#${topQs.map((q) => q.qid).join("、q#")}）：重复组 ${sameQGroups}、最大 ×${sameQMax || 1}`
  );
  expect(
    sameQGroups === 0,
    `抽样 ${topQs.length} 题仍有 ${sameQGroups} 组同一 question 重复文案（最大 ×${sameQMax}，见上）`
  );

  // c) 抽样 30 条公开可见评论：白名单 ≤5%、实指 ≥60%、长度 ≥6、API 双口径。
  const rows = db
    .prepare(
      `SELECT c.id, c.target_id AS aid, c.content, a.content_md,
              (SELECT t.name FROM question_topics qt JOIN topics t ON t.id = qt.topic_id
               WHERE qt.question_id = a.question_id
               ORDER BY qt.topic_id LIMIT 1) AS topic
       FROM comments c
       JOIN answers a ON a.id = c.target_id
       JOIN users u ON u.id = c.author_id
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
    wlRate <= 0.05,
    `抽样 ${sample.length} 条万能句命中 ${wlHits.length} 条（${(wlRate * 100).toFixed(0)}% > 5%）`
  );

  // 实指占比：与回答正文 ≥4 字连续重合，或命中所属大类领域名词表
  // （判据实现与 seed/fix 共用 seed-data/comments.js 的 isAnchored）。
  let anchoredN = 0;
  const unanchored = [];
  for (const r of sample) {
    const text = String(r.content || "").trim();
    const cat = CAT_BY_TOPIC.get(r.topic) || null;
    if (isAnchored(text, cat, r.content_md)) anchoredN++;
    else unanchored.push(r);
  }
  const anchorRate = anchoredN / sample.length;
  console.log(
    `  实指命中率 ${anchoredN}/${sample.length} = ${(anchorRate * 100).toFixed(0)}%` +
      `（判据：与回答正文 ≥4 字重合或命中 ${CAT_BY_TOPIC.size ? "大类" : ""}领域名词表）`
  );
  for (const u of unanchored.slice(0, 8)) {
    console.log(`    无实指 #${u.id} answer#${u.aid} [${u.topic || "?"}]：「${String(u.content).slice(0, 30)}」`);
  }
  if (unanchored.length > 8) console.log(`    …无实指另有 ${unanchored.length - 8} 条`);
  expect(
    anchorRate >= ANCHOR_MIN,
    `抽样 ${sample.length} 条实指命中 ${anchoredN} 条（${(anchorRate * 100).toFixed(0)}% < 60%）`
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
      `  抽样 ${sample.length} 条覆盖 ${aids.length} 个 answer：白名单 ${wlHits.length} 条、实指 ${anchoredN} 条、过短 0、API 双口径一致`
    );
  } else {
    console.log(`  抽样 ${sample.length} 条：白名单 ${wlHits.length} 条、实指 ${anchoredN} 条、过短 0（API 校验跳过）`);
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
    fs.mkdtempSync(path.join(os.tmpdir(), "z1152-selftest-")),
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
