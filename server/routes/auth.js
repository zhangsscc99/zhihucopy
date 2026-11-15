const express = require("express");
const bcrypt = require("bcryptjs");
const { getDb } = require("../db");
const { signToken, publicUser, badRequest } = require("../util");
const { requireAuth } = require("../auth");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post("/register", (req, res) => {
  const { email, password, nickname } = req.body || {};
  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return badRequest(res, "邮箱格式不正确");
  }
  if (typeof password !== "string" || password.length < 6 || password.length > 72) {
    return badRequest(res, "密码需要 6–72 个字符");
  }
  if (typeof nickname !== "string" || !nickname.trim() || nickname.trim().length > 24) {
    return badRequest(res, "昵称需要 1–24 个字符");
  }
  const db = getDb();
  const normalized = email.trim().toLowerCase();
  if (db.prepare("SELECT id FROM users WHERE email = ?").get(normalized)) {
    return res.status(409).json({ error: "该邮箱已注册" });
  }
  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare("INSERT INTO users (email, password_hash, nickname) VALUES (?, ?, ?)")
    .run(normalized, hash, nickname.trim());
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

router.post("/login", (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== "string" || typeof password !== "string") {
    return badRequest(res, "请输入邮箱和密码");
  }
  const user = getDb()
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "邮箱或密码不正确" });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = router;
