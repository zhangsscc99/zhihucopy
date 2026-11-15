const express = require("express");
const { getDb } = require("../db");

const router = express.Router();

// GET /answers/:id — single answer with question context.
router.get("/:id", (req, res) => {
  const db = getDb();
  const a = db
    .prepare(
      `SELECT a.*, q.title AS question_title,
              u.id AS author_id, u.nickname AS author_nickname, u.avatar_url AS author_avatar
       FROM answers a
       JOIN users u ON u.id = a.author_id
       JOIN questions q ON q.id = a.question_id
       WHERE a.id = ? AND a.is_deleted = 0`
    )
    .get(req.params.id);
  if (!a) return res.status(404).json({ error: "回答不存在" });
  res.json({
    answer: {
      id: a.id,
      question_id: a.question_id,
      question_title: a.question_title,
      content_md: a.content_md,
      vote_up: a.vote_up,
      vote_down: a.vote_down,
      comment_count: a.comment_count,
      is_collapsed: a.is_collapsed,
      created_at: a.created_at,
      updated_at: a.updated_at,
      author: { id: a.author_id, nickname: a.author_nickname, avatar_url: a.author_avatar },
    },
  });
});

module.exports = router;
