// Z982 — 种子数据量/厚度断言（数据级 + API 级，不做任何写入）。
//
// 用法:
//   DB_PATH=/path/to/zhihu.db API_BASE=http://127.0.0.1:3162/zhihucopy/api \
//     node scripts/assert/seed-volume.mjs
//
// 数据级（better-sqlite3 只读打开，默认生产库路径）:
//   a. questions 行数 >= 100
//   b. title 重复组数 === 0
//   c. detail_md 重复组数 === 0
//   d. 「>=5 条有效回答的问题数」 >= 20
//   e. bio 或 avatar_url 为空的用户数 === 0
//   f. 每个话题下问题数 >= 4
// API 级（GET /questions?limit=30，需设置 API_BASE）:
//   返回 30 条中 excerpt/detail 非空比例 >= 0.95，且无「暂无补充说明」占位。

import { createRequire } from "node:module";

const DB_PATH = process.env.DB_PATH || "/www/zhihucopy/data/zhihu.db";
const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");

const requireFromServer = createRequire(
  new URL("../../server/package.json", import.meta.url)
);
const Database = requireFromServer("better-sqlite3");

const failures = [];
const check = (name, cond, detail) => {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${name}  (${detail})`);
  if (!cond) failures.push(`${name}: ${detail}`);
};

// ---------- 数据级 ----------
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

const qCount = db.prepare("SELECT COUNT(*) c FROM questions").get().c;
check("questions>=100", qCount >= 100, `questions=${qCount}`);

const dupTitle = db
  .prepare(
    "SELECT COUNT(*) c FROM (SELECT title FROM questions GROUP BY title HAVING COUNT(*)>1)"
  )
  .get().c;
check("title 无重复", dupTitle === 0, `dup_title_groups=${dupTitle}`);

const dupDetail = db
  .prepare(
    "SELECT COUNT(*) c FROM (SELECT detail_md FROM questions GROUP BY detail_md HAVING COUNT(*)>1)"
  )
  .get().c;
check("detail_md 无重复", dupDetail === 0, `dup_detail_groups=${dupDetail}`);

const deepQ = db
  .prepare(
    `SELECT COUNT(*) c FROM (
       SELECT question_id FROM answers WHERE is_deleted = 0
       GROUP BY question_id HAVING COUNT(*) >= 5)`
  )
  .get().c;
check(">=5 回答的问题数>=20", deepQ >= 20, `deep_questions=${deepQ}`);

const unprofiled = db
  .prepare(
    `SELECT COUNT(*) c FROM users
     WHERE bio IS NULL OR TRIM(bio) = ''
        OR avatar_url IS NULL OR TRIM(avatar_url) = ''`
  )
  .get().c;
check("bio/avatar 为空用户数===0", unprofiled === 0, `unprofiled_users=${unprofiled}`);

const sparseTopics = db
  .prepare(
    `SELECT t.name, COUNT(qt.question_id) c
     FROM topics t LEFT JOIN question_topics qt ON qt.topic_id = t.id
     GROUP BY t.id ORDER BY c`
  )
  .all();
const under4 = sparseTopics.filter((r) => r.c < 4);
check(
  "话题问题数>=4",
  under4.length === 0,
  `under4=${under4.length}` +
    (under4.length ? ` [${under4.map((r) => `${r.name}:${r.c}`).join(",")}]` : "")
);

db.close();

// ---------- API 级 ----------
{
  let res = null;
  try {
    res = await fetch(`${API_BASE}/questions?limit=30`);
  } catch (e) {
    check("API GET /questions", false, `无法连接 ${API_BASE}: ${e.message}（请先启动实例或设置 API_BASE）`);
  }
  if (res && !res.ok) {
    check("API GET /questions", false, `status=${res.status}`);
  } else if (res) {
    const data = await res.json().catch(() => ({}));
    const items = data.items || [];
    check("API 返回 30 条", items.length === 30, `items=${items.length}`);
    const text = (q) =>
      (q.excerpt || q.detail_md || q.detail || "").toString().trim();
    const withBody = items.filter((q) => text(q).length > 0).length;
    const ratio = items.length ? withBody / items.length : 0;
    check(
      "excerpt/detail 非空比例>=0.95",
      ratio >= 0.95,
      `nonempty=${withBody}/${items.length}`
    );
    const placeholders = items.filter((q) => text(q).includes("暂无补充说明")).length;
    check("无「暂无补充说明」占位", placeholders === 0, `placeholders=${placeholders}`);
  }
}

if (failures.length) {
  console.error(`\n[ASSERT] seed-volume FAIL (${failures.length} 项)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\n[ASSERT] seed-volume PASS");
process.exit(0);
