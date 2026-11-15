const express = require("express");
const { getDb } = require("../db");
const { parsePage, pageResult, badRequest } = require("../util");
const { requireAuth } = require("../auth");
const { notifyQuestionAuthor } = require("./answers");

const router = express.Router();

const AUTHOR_COLS =
  "u.id AS author_id, u.nickname AS author_nickname, u.avatar_url AS author_avatar, u.bio AS author_bio";

// 自动化产物（巡检/e2e/assert 脚本创建的问题）不进公共列表与热榜；详情页不受限，老链接仍可打开。
const SPAM_TITLE_RE =
  "(q.title LIKE '巡检：%' OR q.title LIKE '[e2e]%' OR q.title LIKE '[assert]%' OR q.title LIKE '[review]%' OR q.title LIKE '[probe]%')";

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
    author: {
      id: q.author_id,
      nickname: q.author_nickname,
      avatar_url: q.author_avatar,
      bio: q.author_bio,
    },
    topics: q.topics || [],
  };
}

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

const ANSWER_SELECT = `
  SELECT a.*, q.title AS question_title, ${AUTHOR_COLS}
  FROM answers a
  JOIN users u ON u.id = a.author_id
  JOIN questions q ON q.id = a.question_id`;

// POST /questions — create a question.
router.post("/", requireAuth, (req, res) => {
  const { title, detail_md, topic_ids } = req.body || {};
  if (typeof title !== "string" || !title.trim() || title.trim().length > 100) {
    return badRequest(res, "标题需要 1–100 个字符");
  }
  if (detail_md !== undefined && (typeof detail_md !== "string" || detail_md.length > 20000)) {
    return badRequest(res, "补充说明过长");
  }
  const ids = Array.isArray(topic_ids)
    ? topic_ids.filter((t) => Number.isInteger(t)).slice(0, 5)
    : [];

  const db = getDb();
  const created = db.transaction(() => {
    const info = db
      .prepare("INSERT INTO questions (author_id, title, detail_md) VALUES (?, ?, ?)")
      .run(req.user.id, title.trim(), detail_md || "");
    const qid = info.lastInsertRowid;
    if (ids.length) {
      const exists = db.prepare("SELECT id FROM topics WHERE id = ?");
      const link = db.prepare(
        "INSERT OR IGNORE INTO question_topics (question_id, topic_id) VALUES (?, ?)"
      );
      for (const tid of ids) if (exists.get(tid)) link.run(qid, tid);
    }
    return qid;
  })();

  const q = db
    .prepare(
      `SELECT q.*, ${AUTHOR_COLS} FROM questions q JOIN users u ON u.id = q.author_id WHERE q.id = ?`
    )
    .get(created);
  res.status(201).json({ question: questionRow(q) });
});

// GET /questions?tab=hot|new&page=&limit=
router.get("/", (req, res) => {
  const tab = req.query.tab === "hot" ? "hot" : "new";
  const { page, limit, offset } = parsePage(req);
  const db = getDb();
  const order =
    tab === "hot"
      ? "(q.answer_count * 3 + q.follower_count * 2 + q.view_count) DESC, q.created_at DESC"
      : "q.created_at DESC";
  const items = db
    .prepare(
      `SELECT q.*, ${AUTHOR_COLS} FROM questions q
       JOIN users u ON u.id = q.author_id
       WHERE NOT ${SPAM_TITLE_RE}
       ORDER BY ${order} LIMIT ? OFFSET ?`
    )
    .all(limit, offset)
    .map(questionRow);
  const total = db
    .prepare(`SELECT COUNT(*) c FROM questions q WHERE NOT ${SPAM_TITLE_RE}`)
    .get().c;
  res.json(pageResult(items, total, page, limit));
});

// GET /questions/:id — detail + first 5 answers.
router.get("/:id", (req, res) => {
  const db = getDb();
  const q = db
    .prepare(
      `SELECT q.*, ${AUTHOR_COLS} FROM questions q JOIN users u ON u.id = q.author_id WHERE q.id = ?`
    )
    .get(req.params.id);
  if (!q) return res.status(404).json({ error: "问题不存在" });
  db.prepare("UPDATE questions SET view_count = view_count + 1 WHERE id = ?").run(q.id);

  const topics = db
    .prepare(
      `SELECT t.id, t.name FROM topics t
       JOIN question_topics qt ON qt.topic_id = t.id WHERE qt.question_id = ?`
    )
    .all(q.id);
  const answers = db
    .prepare(
      `${ANSWER_SELECT}
       WHERE a.question_id = ? AND a.is_deleted = 0
       ORDER BY a.vote_up DESC, a.created_at ASC LIMIT 5`
    )
    .all(q.id)
    .map(answerRow);

  const followed = req.user
    ? !!db
        .prepare(
          "SELECT EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND target_type = 'question' AND target_id = ?) AS followed"
        )
        .get(req.user.id, q.id).followed
    : false;

  res.json({ question: { ...questionRow({ ...q, topics }), followed }, answers });
});

// GET /questions/:id/answers?sort=default|newest&page=&limit=
router.get("/:id/answers", (req, res) => {
  const db = getDb();
  const qid = db.prepare("SELECT id FROM questions WHERE id = ?").get(req.params.id);
  if (!qid) return res.status(404).json({ error: "问题不存在" });
  const { page, limit, offset } = parsePage(req);
  const order =
    req.query.sort === "newest"
      ? "a.created_at DESC"
      : "a.vote_up DESC, a.created_at ASC";
  const items = db
    .prepare(
      `${ANSWER_SELECT}
       WHERE a.question_id = ? AND a.is_deleted = 0
       ORDER BY ${order} LIMIT ? OFFSET ?`
    )
    .all(req.params.id, limit, offset)
    .map(answerRow);
  const total = db
    .prepare("SELECT COUNT(*) c FROM answers WHERE question_id = ? AND is_deleted = 0")
    .get(req.params.id).c;
  res.json(pageResult(items, total, page, limit));
});

// POST /questions/:id/answers — publish an answer.
router.post("/:id/answers", requireAuth, (req, res) => {
  const { content_md } = req.body || {};
  if (typeof content_md !== "string" || !content_md.trim() || content_md.length > 50000) {
    return badRequest(res, "回答内容需要 1–50000 个字符");
  }
  const db = getDb();
  const q = db.prepare("SELECT id FROM questions WHERE id = ?").get(req.params.id);
  if (!q) return res.status(404).json({ error: "问题不存在" });

  const aid = db.transaction(() => {
    const info = db
      .prepare(
        "INSERT INTO answers (question_id, author_id, content_md) VALUES (?, ?, ?)"
      )
      .run(q.id, req.user.id, content_md);
    db.prepare(
      "UPDATE questions SET answer_count = answer_count + 1 WHERE id = ?"
    ).run(q.id);
    notifyQuestionAuthor(db, q.id, req.user.id, info.lastInsertRowid);
    return info.lastInsertRowid;
  })();

  const a = db.prepare(`${ANSWER_SELECT} WHERE a.id = ?`).get(aid);
  res.status(201).json({ answer: answerRow(a) });
});

function questionFollowerCount(db, qid) {
  return db.prepare("SELECT follower_count FROM questions WHERE id = ?").get(qid)
    .follower_count;
}

// POST /questions/:id/follow — 关注问题（幂等，只在真正新插入时 follower_count +1）。
router.post("/:id/follow", requireAuth, (req, res) => {
  const db = getDb();
  const q = db.prepare("SELECT id FROM questions WHERE id = ?").get(req.params.id);
  if (!q) return res.status(404).json({ error: "问题不存在" });

  db.transaction(() => {
    const info = db
      .prepare(
        "INSERT OR IGNORE INTO follows (follower_id, target_type, target_id) VALUES (?, 'question', ?)"
      )
      .run(req.user.id, q.id);
    if (info.changes > 0) {
      db.prepare(
        "UPDATE questions SET follower_count = follower_count + 1 WHERE id = ?"
      ).run(q.id);
    }
  })();

  res.json({ following: true, follower_count: questionFollowerCount(db, q.id) });
});

// DELETE /questions/:id/follow — 取消关注（幂等，真的删掉了才 follower_count -1）。
router.delete("/:id/follow", requireAuth, (req, res) => {
  const db = getDb();
  const q = db.prepare("SELECT id FROM questions WHERE id = ?").get(req.params.id);
  if (!q) return res.status(404).json({ error: "问题不存在" });

  db.transaction(() => {
    const info = db
      .prepare(
        "DELETE FROM follows WHERE follower_id = ? AND target_type = 'question' AND target_id = ?"
      )
      .run(req.user.id, q.id);
    if (info.changes > 0) {
      db.prepare(
        "UPDATE questions SET follower_count = MAX(follower_count - 1, 0) WHERE id = ?"
      ).run(q.id);
    }
  })();

  res.json({ following: false, follower_count: questionFollowerCount(db, q.id) });
});

module.exports = router;
module.exports.SPAM_TITLE_RE = SPAM_TITLE_RE;
module.exports.questionRow = questionRow;
