const express = require("express");
const { getDb } = require("../db");
const { publicUser, selfUser, badRequest } = require("../util");
const { requireAuth } = require("../auth");
const { testUserSql, testQuestionSql } = require("../content-filter");
const { AUTHOR_ANSWERS_SQL } = require("./answers");
const { AUTHOR_QUESTIONS_WHERE } = require("./questions");
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

router.get("/:id", (req, res) => {
  const db = getDb();
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "用户不存在" });
  // 计数与列表接口共用同一口径：/questions?author= 与 /answers?author= 的 WHERE。
  const stats = {
    answers: db
      .prepare(`SELECT COUNT(*) c ${AUTHOR_ANSWERS_SQL}`)
      .get(user.id).c,
    questions: db
      .prepare(
        `SELECT COUNT(*) c FROM questions q JOIN users u ON u.id = q.author_id
         WHERE ${testQuestionSql("q", "u")} AND ${AUTHOR_QUESTIONS_WHERE}`
      )
      .get(user.id).c,
    followers: countFollowers(db, user.id),
    following: countFollowing(db, user.id),
    vote_up: db
      .prepare(`SELECT COALESCE(SUM(a.vote_up), 0) s ${AUTHOR_ANSWERS_SQL}`)
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
  if (inserted.changes) grantFor(target.id, "first_follower");

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
