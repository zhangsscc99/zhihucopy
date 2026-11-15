const express = require("express");
const { getDb } = require("../db");
const { publicUser, badRequest } = require("../util");
const { requireAuth } = require("../auth");

const router = express.Router();

router.get("/:id", (req, res) => {
  const db = getDb();
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "用户不存在" });
  const stats = {
    answers: db
      .prepare("SELECT COUNT(*) c FROM answers WHERE author_id = ? AND is_deleted = 0")
      .get(user.id).c,
    questions: db
      .prepare("SELECT COUNT(*) c FROM questions WHERE author_id = ?")
      .get(user.id).c,
    followers: db
      .prepare("SELECT COUNT(*) c FROM follows WHERE target_type = 'user' AND target_id = ?")
      .get(user.id).c,
    following: db
      .prepare("SELECT COUNT(*) c FROM follows WHERE follower_id = ?")
      .get(user.id).c,
    vote_up: db
      .prepare(
        "SELECT COALESCE(SUM(vote_up), 0) s FROM answers WHERE author_id = ? AND is_deleted = 0"
      )
      .get(user.id).s,
  };
  res.json({ user: publicUser(user), stats });
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
  res.json({ user: publicUser(user) });
});

module.exports = router;
