const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "";
if (!JWT_SECRET) {
  console.warn("[zhihucopy] JWT_SECRET is not set — using an insecure development secret.");
}
const SECRET = JWT_SECRET || "dev-insecure-secret";

function signToken(user) {
  return jwt.sign({ uid: user.id }, SECRET, { expiresIn: "7d" });
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    nickname: u.nickname,
    avatar_url: u.avatar_url,
    bio: u.bio,
    salt_value: u.salt_value,
    level: u.level,
    is_admin: u.is_admin,
    created_at: u.created_at,
  };
}

function parsePage(req) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

function pageResult(items, total, page, limit) {
  return { items, total, has_more: page * limit < total };
}

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

module.exports = { signToken, publicUser, parsePage, pageResult, badRequest, SECRET };
