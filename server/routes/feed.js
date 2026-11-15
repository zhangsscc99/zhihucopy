const express = require("express");
const { getDb } = require("../db");
const { parsePage } = require("../util");
const { requireAuth } = require("../auth");
const { SPAM_TITLE_RE, questionRow } = require("./questions");

const router = express.Router();

const AUTHOR_COLS =
  "u.id AS author_id, u.nickname AS author_nickname, u.avatar_url AS author_avatar, u.bio AS author_bio";

// 关注流候选集：四路来源 UNION ALL，每行带一个时间戳，外层 GROUP BY 问题去重后按 MAX(ts) 倒序。
//   1. 关注的人提的问题（ts = 提问时间）
//   2. 关注的人写的回答所属的问题（ts = 回答时间，已删回答不算动态）
//   3. 关注的话题下的问题（ts = 提问时间）
//   4. 关注的问题（ts = 最近动态 = max(更新时间, 最新回答时间)）
// 「我的关注」都走 follows 主键前缀 (follower_id, target_type)；
// 反向 JOIN 走 idx_questions_author / idx_answers_author / idx_qt_topic，全程无 N+1。
const FOLLOWING_CANDIDATES = `
  SELECT q.id AS qid, q.created_at AS ts
  FROM follows f
  JOIN questions q ON q.author_id = f.target_id
  WHERE f.follower_id = ? AND f.target_type = 'user'

  UNION ALL

  SELECT a.question_id AS qid, a.created_at AS ts
  FROM follows f
  JOIN answers a ON a.author_id = f.target_id AND a.is_deleted = 0
  WHERE f.follower_id = ? AND f.target_type = 'user'

  UNION ALL

  SELECT qt.question_id AS qid, q.created_at AS ts
  FROM follows f
  JOIN question_topics qt ON qt.topic_id = f.target_id
  JOIN questions q ON q.id = qt.question_id
  WHERE f.follower_id = ? AND f.target_type = 'topic'

  UNION ALL

  SELECT q.id AS qid,
         MAX(q.updated_at,
             COALESCE((SELECT MAX(a.created_at) FROM answers a
                       WHERE a.question_id = q.id AND a.is_deleted = 0),
                      q.updated_at)) AS ts
  FROM follows f
  JOIN questions q ON q.id = f.target_id
  WHERE f.follower_id = ? AND f.target_type = 'question'
`;

// GET /feed/following?page=&limit= — 本人关注内容流，item 与 GET /questions 列表项一致。
// 需登录（与 notifications/votes 一致：未登录 401）；自动化产物标题同样被过滤。
router.get("/following", requireAuth, (req, res) => {
  const { page, limit, offset } = parsePage(req);
  const db = getDb();
  const uid = req.user.id;

  const items = db
    .prepare(
      `SELECT q.*, ${AUTHOR_COLS}, MAX(c.ts) AS activity_ts
       FROM (${FOLLOWING_CANDIDATES}) c
       JOIN questions q ON q.id = c.qid
       JOIN users u ON u.id = q.author_id
       WHERE NOT ${SPAM_TITLE_RE}
       GROUP BY c.qid
       ORDER BY activity_ts DESC, c.qid DESC
       LIMIT ? OFFSET ?`
    )
    .all(uid, uid, uid, uid, limit, offset)
    .map(questionRow);

  const total = db
    .prepare(
      `SELECT COUNT(*) AS c FROM (
         SELECT c.qid FROM (${FOLLOWING_CANDIDATES}) c
         JOIN questions q ON q.id = c.qid
         WHERE NOT ${SPAM_TITLE_RE}
         GROUP BY c.qid
       )`
    )
    .get(uid, uid, uid, uid).c;

  res.json({ items, total, has_more: page * limit < total, page });
});

// GET /feed/recommended?page=&limit= — 推荐流（与首页「推荐」tab 同源的最新问题列表，无需登录）。
router.get("/recommended", (req, res) => {
  const { page, limit, offset } = parsePage(req);
  const db = getDb();
  const items = db
    .prepare(
      `SELECT q.*, ${AUTHOR_COLS} FROM questions q
       JOIN users u ON u.id = q.author_id
       WHERE NOT ${SPAM_TITLE_RE}
       ORDER BY q.created_at DESC, q.id DESC LIMIT ? OFFSET ?`
    )
    .all(limit, offset)
    .map(questionRow);
  const total = db
    .prepare(`SELECT COUNT(*) c FROM questions q WHERE NOT ${SPAM_TITLE_RE}`)
    .get().c;
  res.json({ items, total, has_more: page * limit < total, page });
});

// GET /feed/hot — 热榜 Top20（与 /questions?tab=hot 同序：回答*3 + 关注*2 + 浏览）。
router.get("/hot", (_req, res) => {
  const items = getDb()
    .prepare(
      `SELECT q.*, ${AUTHOR_COLS} FROM questions q
       JOIN users u ON u.id = q.author_id
       WHERE NOT ${SPAM_TITLE_RE}
       ORDER BY (q.answer_count * 3 + q.follower_count * 2 + q.view_count) DESC, q.created_at DESC
       LIMIT 20`
    )
    .all()
    .map(questionRow);
  res.json({ items });
});

module.exports = router;
