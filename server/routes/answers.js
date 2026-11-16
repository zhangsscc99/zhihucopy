const express = require("express");
const { getDb } = require("../db");
const { parsePage, pageResult, badRequest } = require("../util");
const { requireAuth } = require("../auth");
const { testUserSql, testQuestionSql } = require("../content-filter");
const { isCollected } = require("./collections");

const router = express.Router();

// 个人页「该用户的回答」统一口径：未删除 + 作者非测试账号 + 所属问题非测试内容。
// users.js 的 stats.answers / stats.vote_up 复用同一段 SQL，保证计数与列表一致。
const AUTHOR_ANSWERS_SQL = `
  FROM answers a
  JOIN users u ON u.id = a.author_id
  JOIN questions q ON q.id = a.question_id
  JOIN users qu ON qu.id = q.author_id
  WHERE a.author_id = ? AND a.is_deleted = 0
    AND ${testUserSql("u")} AND ${testQuestionSql("q", "qu")}`;

function answerRow(a) {
  return {
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
    author: {
      id: a.author_id,
      nickname: a.author_nickname,
      avatar_url: a.author_avatar,
      bio: a.author_bio,
    },
  };
}

// 有人回答别人的问题时，给问题作者插一条通知（自问自答不产生）。
// 由发布回答的路由（questions.js POST /questions/:id/answers）在同一事务内调用。
// target 指向具体回答（target_type='answer', target_id=<answers.id>），
// 这样同一人重复回答同一问题时，各条通知的 payload 各自定位自己的回答。
function notifyQuestionAuthor(db, questionId, actorId, answerId) {
  if (!answerId || !Number.isInteger(answerId)) return null;
  const q = db
    .prepare("SELECT id, author_id FROM questions WHERE id = ?")
    .get(questionId);
  if (!q || q.author_id === actorId) return null;
  const info = db
    .prepare(
      `INSERT INTO notifications (user_id, type, actor_id, target_type, target_id)
       VALUES (?, 'answer', ?, 'answer', ?)`
    )
    .run(q.author_id, actorId, answerId);
  return info.lastInsertRowid;
}

// GET /answers?author=<id>&page=&limit= — 某用户可见的回答列表（个人页口径）。
router.get("/", (req, res) => {
  const authorId = parseInt(req.query.author, 10);
  if (!Number.isInteger(authorId) || authorId <= 0) {
    return badRequest(res, "author 参数不合法");
  }
  const { page, limit, offset } = parsePage(req);
  const db = getDb();
  const items = db
    .prepare(
      `SELECT a.*, q.title AS question_title,
              u.id AS author_id, u.nickname AS author_nickname,
              u.avatar_url AS author_avatar, u.bio AS author_bio
       ${AUTHOR_ANSWERS_SQL}
       ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`
    )
    .all(authorId, limit, offset)
    .map(answerRow);
  const total = db
    .prepare(`SELECT COUNT(*) c ${AUTHOR_ANSWERS_SQL}`)
    .get(authorId).c;
  res.json(pageResult(items, total, page, limit));
});

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
      is_collected: isCollected(db, req.user && req.user.id, a.id),
    },
  });
});

// DELETE /answers/:id — 只能删除自己的回答（管理员可删任意），软删除且幂等。
router.delete("/:id", requireAuth, (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return badRequest(res, "回答 id 无效");
  const id = Number(req.params.id);

  const db = getDb();
  const a = db.prepare("SELECT * FROM answers WHERE id = ?").get(id);
  if (!a) return res.status(404).json({ error: "回答不存在" });

  const isOwner = a.author_id === req.user.id;
  if (!isOwner && !req.user.is_admin) {
    return res.status(403).json({ error: "只能删除自己的回答" });
  }

  if (a.is_deleted) {
    return res.json({ ok: true, id, already_deleted: true });
  }

  db.transaction(() => {
    db.prepare("UPDATE answers SET is_deleted = 1 WHERE id = ? AND is_deleted = 0").run(id);
    db.prepare(
      `UPDATE questions SET answer_count =
         (SELECT COUNT(*) FROM answers WHERE question_id = ? AND is_deleted = 0)
       WHERE id = ?`
    ).run(a.question_id, a.question_id);
  })();

  res.json({ ok: true, id, deleted: true });
});

module.exports = router;
module.exports.notifyQuestionAuthor = notifyQuestionAuthor;
module.exports.AUTHOR_ANSWERS_SQL = AUTHOR_ANSWERS_SQL;
