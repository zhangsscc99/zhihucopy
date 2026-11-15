const jwt = require("jsonwebtoken");
const { getDb } = require("./db");
const { SECRET } = require("./util");

function readToken(req) {
  const header = req.headers.authorization || "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

// Attaches req.user when a valid token is present; never rejects.
function optionalAuth(req, _res, next) {
  const token = readToken(req);
  if (token) {
    try {
      const { uid } = jwt.verify(token, SECRET);
      req.user = getDb()
        .prepare("SELECT * FROM users WHERE id = ?")
        .get(uid);
    } catch {
      // Invalid/expired token — treated as anonymous.
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "请先登录" });
  }
  next();
}

module.exports = { optionalAuth, requireAuth };
