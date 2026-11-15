const express = require("express");
const { getDb } = require("../db");
const { parsePage, pageResult } = require("../util");
const { questionRow } = require("./questions");
const { testQuestionSql } = require("../content-filter");

const router = express.Router();

const AUTHOR_COLS =
  "u.id AS author_id, u.nickname AS author_nickname, u.avatar_url AS author_avatar, u.bio AS author_bio";

// LIKE 元字符转义，关键词按普通子串匹配。
function likePattern(q) {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// 命中词附近的纯文本摘要（结果卡片用；前端另做高亮）。
function snippet(md, q) {
  const text = String(md || "")
    .replace(/[#>*`\-[\]()!]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i === -1) return text.length > 90 ? text.slice(0, 90) + "…" : text;
  const start = Math.max(0, i - 30);
  const end = Math.min(text.length, i + q.length + 60);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

// match_rank → 命中来源：标题 > 摘要 > 话题名。
const MATCHED = { 1: "title", 2: "detail", 3: "topic" };

// GET /search?q=&page=&limit=&type=question — 按关键词搜问题（标题/详情/所属话题名子串匹配）。
// 说明：库内 FTS5 仅有 answer_fts（索引回答，缺答案的问题无法命中），且不得改表结构，
// 故问题检索用 LIKE。TODO: type=answer|user|topic 分类检索（落地时同样要套
// content-filter：问题用 testQuestionSql，用户结果用 testUserSql 排除测试账号）。
router.get("/", (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 100);
  const { page, limit, offset } = parsePage(req);
  const type = String(req.query.type || "question");
  if (!q || type !== "question") {
    return res.json(pageResult([], 0, page, limit));
  }
  const pat = likePattern(q);
  const db = getDb();
  // 话题名命中用 EXISTS 子查询而非 JOIN，避免一题多话题时重复行影响分页与 total。
  const where = `${testQuestionSql("q", "u")} AND (
    q.title LIKE ? ESCAPE '\\' OR q.detail_md LIKE ? ESCAPE '\\' OR
    EXISTS (SELECT 1 FROM question_topics qt JOIN topics t ON t.id = qt.topic_id
            WHERE qt.question_id = q.id AND t.name LIKE ? ESCAPE '\\')
  )`;
  const rows = db
    .prepare(
      `SELECT q.*, ${AUTHOR_COLS},
         CASE WHEN q.title LIKE ? ESCAPE '\\' THEN 1
              WHEN q.detail_md LIKE ? ESCAPE '\\' THEN 2
              ELSE 3 END AS match_rank
       FROM questions q
       JOIN users u ON u.id = q.author_id
       WHERE ${where}
       ORDER BY match_rank ASC, q.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(pat, pat, pat, pat, pat, limit, offset);

  // 结果卡需要展示话题胶囊：一次性捞回本页问题的话题（id/name/slug），避免逐题查询。
  const ids = rows.map((r) => r.id);
  const topicsByQ = new Map();
  if (ids.length) {
    for (const t of db
      .prepare(
        `SELECT qt.question_id, t.id, t.name, t.slug FROM question_topics qt
         JOIN topics t ON t.id = qt.topic_id
         WHERE qt.question_id IN (${ids.map(() => "?").join(",")})`
      )
      .all(...ids)) {
      const arr = topicsByQ.get(t.question_id) || [];
      arr.push({ id: t.id, name: t.name, slug: t.slug });
      topicsByQ.set(t.question_id, arr);
    }
  }

  const items = rows.map((row) => ({
    ...questionRow({ ...row, topics: topicsByQ.get(row.id) || [] }),
    snippet: snippet(row.detail_md, q),
    matched: MATCHED[row.match_rank],
  }));
  const total = db
    .prepare(
      `SELECT COUNT(*) c FROM questions q JOIN users u ON u.id = q.author_id WHERE ${where}`
    )
    .get(pat, pat, pat).c;
  res.json(pageResult(items, total, page, limit));
});

module.exports = router;
