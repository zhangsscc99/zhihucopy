const express = require("express");
const { getDb } = require("../db");
const { parsePage, pageResult } = require("../util");
const { requireAuth } = require("../auth");
const { testQuestionSql } = require("../content-filter");

const router = express.Router();

const AUTHOR_COLS = "u.id AS author_id, u.nickname AS author_nickname, u.avatar_url AS author_avatar";

function topicRow(t) {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    description: t.description,
    follower_count: t.follower_count,
    question_count: t.question_count,
  };
}

function questionRow(q) {
  return {
    id: q.id,
    title: q.title,
    detail_md: q.detail_md,
    created_at: q.created_at,
    updated_at: q.updated_at,
    answer_count: q.answer_count,
    follower_count: q.follower_count,
    view_count: q.view_count,
    author: { id: q.author_id, nickname: q.author_nickname, avatar_url: q.author_avatar },
  };
}

// key 可以是话题 id 或 slug。
function findTopic(db, key) {
  if (/^\d+$/.test(String(key))) {
    return db.prepare("SELECT * FROM topics WHERE id = ?").get(Number(key));
  }
  return db.prepare("SELECT * FROM topics WHERE slug = ? OR name = ?").get(key, key);
}

// GET /topics — 话题列表（?sort=followers|questions&page=&limit=）
router.get("/", (req, res) => {
  const { page, limit, offset } = parsePage(req);
  const db = getDb();
  const order =
    req.query.sort === "questions"
      ? "question_count DESC, t.id ASC"
      : "t.follower_count DESC, t.id ASC";
  const items = db
    .prepare(
      `SELECT t.*, (SELECT COUNT(*) FROM question_topics qt
                    JOIN questions q ON q.id = qt.question_id
                    JOIN users u ON u.id = q.author_id
                    WHERE qt.topic_id = t.id AND ${testQuestionSql("q", "u")}) AS question_count
       FROM topics t ORDER BY ${order} LIMIT ? OFFSET ?`
    )
    .all(limit, offset)
    .map(topicRow);
  const total = db.prepare("SELECT COUNT(*) c FROM topics").get().c;
  res.json(pageResult(items, total, page, limit));
});

// GET /topics/:key — 话题简介 + 该话题下的问题内容流（?limit=&offset= 或 ?page=&limit=）
router.get("/:key", (req, res) => {
  const db = getDb();
  const t = findTopic(db, req.params.key);
  if (!t) return res.status(404).json({ error: "话题不存在" });

  // 支持 ?offset=（内容流风格）与 ?page= 两种分页入参。
  const { limit } = parsePage(req);
  const hasOffset = req.query.offset !== undefined;
  const offset = hasOffset
    ? Math.max(0, parseInt(req.query.offset, 10) || 0)
    : parsePage(req).offset;
  const page = Math.floor(offset / limit) + 1;

  const sort = req.query.sort === "new" ? "new" : "hot";
  const order =
    sort === "new"
      ? "q.created_at DESC"
      : "(q.answer_count * 3 + q.follower_count * 2 + q.view_count) DESC, q.created_at DESC";

  const items = db
    .prepare(
      `SELECT q.*, ${AUTHOR_COLS} FROM questions q
       JOIN users u ON u.id = q.author_id
       JOIN question_topics qt ON qt.question_id = q.id
       WHERE qt.topic_id = ? AND ${testQuestionSql("q", "u")}
       ORDER BY ${order} LIMIT ? OFFSET ?`
    )
    .all(t.id, limit, offset)
    .map(questionRow);
  const total = db
    .prepare(
      `SELECT COUNT(*) c FROM question_topics qt
       JOIN questions q ON q.id = qt.question_id
       JOIN users u ON u.id = q.author_id
       WHERE qt.topic_id = ? AND ${testQuestionSql("q", "u")}`
    )
    .get(t.id).c;

  const question_count = total;
  const topic = topicRow({ ...t, question_count });
  if (req.user) {
    topic.is_following = !!db
      .prepare(
        "SELECT 1 FROM follows WHERE follower_id = ? AND target_type = 'topic' AND target_id = ?"
      )
      .get(req.user.id, t.id);
  }
  const result = pageResult(items, total, page, limit);
  if (hasOffset) result.has_more = offset + items.length < total;
  res.json({ topic, ...result });
});

// POST /topics/:key/follow — 关注话题（幂等）。
router.post("/:key/follow", requireAuth, (req, res) => {
  const db = getDb();
  const t = findTopic(db, req.params.key);
  if (!t) return res.status(404).json({ error: "话题不存在" });
  db.transaction(() => {
    const info = db
      .prepare(
        "INSERT OR IGNORE INTO follows (follower_id, target_type, target_id) VALUES (?, 'topic', ?)"
      )
      .run(req.user.id, t.id);
    if (info.changes > 0) {
      db.prepare("UPDATE topics SET follower_count = follower_count + 1 WHERE id = ?").run(t.id);
    }
  })();
  const topic = db.prepare("SELECT * FROM topics WHERE id = ?").get(t.id);
  res.json({ topic: { ...topicRow({ ...topic, question_count: undefined }), is_following: true } });
});

// DELETE /topics/:key/follow — 取消关注（幂等）。
router.delete("/:key/follow", requireAuth, (req, res) => {
  const db = getDb();
  const t = findTopic(db, req.params.key);
  if (!t) return res.status(404).json({ error: "话题不存在" });
  db.transaction(() => {
    const info = db
      .prepare(
        "DELETE FROM follows WHERE follower_id = ? AND target_type = 'topic' AND target_id = ?"
      )
      .run(req.user.id, t.id);
    if (info.changes > 0) {
      db.prepare(
        "UPDATE topics SET follower_count = MAX(follower_count - 1, 0) WHERE id = ?"
      ).run(t.id);
    }
  })();
  const topic = db.prepare("SELECT * FROM topics WHERE id = ?").get(t.id);
  res.json({ topic: { ...topicRow({ ...topic, question_count: undefined }), is_following: false } });
});

module.exports = router;
