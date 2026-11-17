const express = require("express");
const { getDb } = require("../db");
const { publicUser, selfUser, badRequest } = require("../util");
const { requireAuth } = require("../auth");
const { testUserSql, testQuestionSql } = require("../content-filter");
const { authorAnswersSql } = require("./answers");
const {
  AUTHOR_QUESTIONS_WHERE,
  questionRow,
  topicsForQuestions,
} = require("./questions");
const { grantFor, listFor } = require("../badges");

const router = express.Router();

// 分页：兼容 ?limit=&offset= 与 ?page=（verify 与本仓库其它列表接口风格）。
function parseOffsetPage(req) {
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const rawOffset = parseInt(req.query.offset, 10);
  const offset =
    Number.isFinite(rawOffset) && rawOffset >= 0
      ? rawOffset
      : (Math.max(1, parseInt(req.query.page, 10) || 1) - 1) * limit;
  return { limit, offset };
}

function followUserItem(u) {
  return {
    id: u.id,
    nickname: u.nickname,
    avatar_url: u.avatar_url,
    headline: u.bio || "",
    bio: u.bio || "",
  };
}

// 计数与列表共用同一口径：排除测试账号（content-filter）。
function countFollowing(db, userId) {
  return db
    .prepare(
      `SELECT COUNT(*) c FROM follows f JOIN users u ON u.id = f.target_id
       WHERE f.follower_id = ? AND f.target_type = 'user' AND ${testUserSql("u")}`
    )
    .get(userId).c;
}

function countFollowers(db, userId) {
  return db
    .prepare(
      `SELECT COUNT(*) c FROM follows f JOIN users u ON u.id = f.follower_id
       WHERE f.target_type = 'user' AND f.target_id = ? AND ${testUserSql("u")}`
    )
    .get(userId).c;
}

// GET /users?limit=&offset= — 公开用户列表（排除测试账号，口径同其它公共出口）。
// 供断言/巡检批量核对昵称真实性；上限 200，默认 50。
router.get("/", (req, res) => {
  const db = getDb();
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const items = db
    .prepare(
      `SELECT u.id, u.nickname, u.avatar_url, u.bio, u.created_at
       FROM users u WHERE ${testUserSql("u")}
       ORDER BY u.id LIMIT ? OFFSET ?`
    )
    .all(limit, offset);
  res.json({ items });
});

router.get("/:id", (req, res) => {
  const db = getDb();
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "用户不存在" });
  // 计数与列表接口共用同一口径：/questions?author= 与 /answers?author= 的 WHERE。
  // 本人看自己主页（viewer === user.id）放开测试内容过滤 —— 与两个 ?author=
  // 列表的 selfView 判定同源，保证计数与列表一致；访客口径不变。
  const selfView = Boolean(req.user && req.user.id === user.id);
  const authorSql = authorAnswersSql({ selfView });
  const stats = {
    answers: db
      .prepare(`SELECT COUNT(*) c ${authorSql}`)
      .get(user.id).c,
    questions: db
      .prepare(
        `SELECT COUNT(*) c FROM questions q JOIN users u ON u.id = q.author_id
         WHERE ${selfView ? "1=1" : testQuestionSql("q", "u")} AND ${AUTHOR_QUESTIONS_WHERE}`
      )
      .get(user.id).c,
    followers: countFollowers(db, user.id),
    following: countFollowing(db, user.id),
    vote_up: db
      .prepare(`SELECT COALESCE(SUM(a.vote_up), 0) s ${authorSql}`)
      .get(user.id).s,
  };
  const body = { user: publicUser(user), stats, badges: listFor(user.id) };
  // 登录态才回带 is_following（本人 → 该页的关注关系），匿名请求不输出该字段。
  if (req.user) {
    body.is_following = Boolean(
      db
        .prepare(
          "SELECT 1 FROM follows WHERE follower_id = ? AND target_type = 'user' AND target_id = ?"
        )
        .get(req.user.id, user.id)
    );
  }
  res.json(body);
});

// 赞同回答的摘要：剥 markdown 标记后压缩空白，总长 ≤ n（截断留 1 字位给省略号）。
function snippetOf(md, n = 60) {
  const text = String(md || "")
    .replace(/[#>*`\-[\]()!]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > n ? text.slice(0, n - 1) + "…" : text;
}

// GET /users/:id/highlights?limit=5 — 0 回答主页的空态补内容（Z1111）：
// 该用户最近关注的问题 + 最近赞同的回答，一次请求带回两块、各 ≤limit 条。
// 公开数据（未登录同口径）；测试内容过滤与 /users/:id stats 同源
// （selfView = 页主本人时放开），关注问题的话题走 topicsForQuestions 批量取，
// 赞同回答一次 JOIN 取全，均无 N+1。
router.get("/:id/highlights", (req, res) => {
  const db = getDb();
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "用户不存在" });
  const limit = Math.min(10, Math.max(1, parseInt(req.query.limit, 10) || 5));
  const selfView = Boolean(req.user && req.user.id === user.id);
  // authorAlias = 该查询里「问题作者」users JOIN 的别名（两个查询别名不同）。
  const publicQ = (authorAlias) =>
    selfView ? "" : `AND ${testQuestionSql("q", authorAlias)}`;

  const qRows = db
    .prepare(
      `SELECT q.*, u.id AS author_id, u.nickname AS author_nickname,
              u.avatar_url AS author_avatar, u.bio AS author_bio
       FROM follows f
       JOIN questions q ON q.id = f.target_id
       JOIN users u ON u.id = q.author_id
       WHERE f.follower_id = ? AND f.target_type = 'question' ${publicQ("u")}
       ORDER BY f.created_at DESC, f.target_id DESC LIMIT ?`
    )
    .all(user.id, limit);
  const topicsByQ = topicsForQuestions(
    db,
    qRows.map((r) => r.id)
  );
  const followed_questions = qRows.map((r) =>
    questionRow({ ...r, topics: topicsByQ.get(r.id) || [] })
  );

  const upvoted_answers = db
    .prepare(
      `SELECT a.id AS answer_id, a.question_id, q.title AS question_title,
              a.content_md, a.vote_up, a.created_at,
              u.id AS author_id, u.nickname AS author_nickname,
              u.avatar_url AS author_avatar
       FROM votes v
       JOIN answers a ON a.id = v.answer_id
       JOIN questions q ON q.id = a.question_id
       JOIN users u ON u.id = a.author_id
       JOIN users qu ON qu.id = q.author_id
       WHERE v.user_id = ? AND v.value = 1 AND a.is_deleted = 0 ${publicQ("qu")}
       ORDER BY v.created_at DESC, v.answer_id DESC LIMIT ?`
    )
    .all(user.id, limit)
    .map((r) => ({
      answer_id: r.answer_id,
      question_id: r.question_id,
      question_title: r.question_title,
      snippet: snippetOf(r.content_md),
      vote_up: r.vote_up,
      created_at: r.created_at,
      author: {
        id: r.author_id,
        nickname: r.author_nickname,
        avatar_url: r.author_avatar,
      },
    }));

  res.json({ followed_questions, upvoted_answers });
});

router.patch("/me", requireAuth, (req, res) => {
  const { nickname, avatar_url, bio } = req.body || {};
  const db = getDb();
  if (nickname !== undefined) {
    if (typeof nickname !== "string" || !nickname.trim() || nickname.trim().length > 24) {
      return badRequest(res, "昵称需要 1–24 个字符");
    }
    db.prepare("UPDATE users SET nickname = ? WHERE id = ?").run(
      nickname.trim(),
      req.user.id
    );
  }
  if (avatar_url !== undefined) {
    if (typeof avatar_url !== "string" || avatar_url.length > 500) {
      return badRequest(res, "头像链接不合法");
    }
    db.prepare("UPDATE users SET avatar_url = ? WHERE id = ?").run(
      avatar_url,
      req.user.id
    );
  }
  if (bio !== undefined) {
    if (typeof bio !== "string" || bio.length > 200) {
      return badRequest(res, "简介最多 200 字");
    }
    db.prepare("UPDATE users SET bio = ? WHERE id = ?").run(bio, req.user.id);
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  res.json({ user: selfUser(user) });
});

// POST /users/:id/follow — 关注用户（幂等，不能关注自己）。
router.post("/:id/follow", requireAuth, (req, res) => {
  const db = getDb();
  const targetId = parseInt(req.params.id, 10);
  if (!Number.isInteger(targetId)) return badRequest(res, "用户 ID 不合法");
  const target = db.prepare("SELECT id FROM users WHERE id = ?").get(targetId);
  if (!target) return res.status(404).json({ error: "用户不存在" });
  if (target.id === req.user.id) return badRequest(res, "不能关注自己");

  const inserted = db
    .prepare(
      "INSERT OR IGNORE INTO follows (follower_id, target_type, target_id) VALUES (?, 'user', ?)"
    )
    .run(req.user.id, target.id);
  if (inserted.changes) {
    grantFor(target.id, "first_follower");
    // 关注成功给被关注者写一条 follow 通知。取关不删历史通知（与真知乎一致），
    // 所以按 (user_id, actor, target) 先查重 —— 取消再关注不重复发（幂等）。
    // 自关注已在上方 400 拦截，不会走到这里。
    const dup = db
      .prepare(
        `SELECT id FROM notifications
         WHERE user_id = ? AND type = 'follow' AND actor_id = ?
           AND target_type = 'user' AND target_id = ?`
      )
      .get(target.id, req.user.id, target.id);
    if (!dup) {
      db.prepare(
        `INSERT INTO notifications (user_id, type, actor_id, target_type, target_id)
         VALUES (?, 'follow', ?, 'user', ?)`
      ).run(target.id, req.user.id, target.id);
    }
  }

  res.json({
    following: true,
    follower_count: countFollowers(db, target.id),
    following_count: countFollowing(db, req.user.id),
  });
});

// DELETE /users/:id/follow — 取消关注（幂等）。
router.delete("/:id/follow", requireAuth, (req, res) => {
  const db = getDb();
  const targetId = parseInt(req.params.id, 10);
  if (!Number.isInteger(targetId)) return badRequest(res, "用户 ID 不合法");
  const target = db.prepare("SELECT id FROM users WHERE id = ?").get(targetId);
  if (!target) return res.status(404).json({ error: "用户不存在" });

  db.prepare(
    "DELETE FROM follows WHERE follower_id = ? AND target_type = 'user' AND target_id = ?"
  ).run(req.user.id, target.id);

  res.json({
    following: false,
    follower_count: countFollowers(db, target.id),
    following_count: countFollowing(db, req.user.id),
  });
});

// GET /users/:id/following — 该用户关注的人。
router.get("/:id/following", (req, res) => {
  const db = getDb();
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "用户不存在" });
  const { limit, offset } = parseOffsetPage(req);

  const items = db
    .prepare(
      `SELECT u.id, u.nickname, u.avatar_url, u.bio
       FROM follows f JOIN users u ON u.id = f.target_id
       WHERE f.follower_id = ? AND f.target_type = 'user' AND ${testUserSql("u")}
       ORDER BY f.created_at DESC, u.id DESC LIMIT ? OFFSET ?`
    )
    .all(user.id, limit, offset)
    .map(followUserItem);
  const total = countFollowing(db, user.id);
  res.json({ items, total, has_more: offset + items.length < total });
});

// GET /users/:id/followers — 该用户的粉丝。
router.get("/:id/followers", (req, res) => {
  const db = getDb();
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "用户不存在" });
  const { limit, offset } = parseOffsetPage(req);

  const items = db
    .prepare(
      `SELECT u.id, u.nickname, u.avatar_url, u.bio
       FROM follows f JOIN users u ON u.id = f.follower_id
       WHERE f.target_type = 'user' AND f.target_id = ? AND ${testUserSql("u")}
       ORDER BY f.created_at DESC, u.id DESC LIMIT ? OFFSET ?`
    )
    .all(user.id, limit, offset)
    .map(followUserItem);
  const total = countFollowers(db, user.id);
  res.json({ items, total, has_more: offset + items.length < total });
});

module.exports = router;
