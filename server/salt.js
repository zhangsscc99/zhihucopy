// Z1014 盐值/等级：回答被赞同作者 salt_value +2，取消赞同 -2（下限 0），自赞不计。
// 等级分档（随盐值变化即更新 users.level）：
//   Lv1 0–99 / Lv2 100–499 / Lv3 500–1499 / Lv4 1500–4999 / Lv5 5000+
const { getDb } = require("./db");

const LEVEL_TIERS = [0, 100, 500, 1500, 5000];

function levelFor(salt) {
  let lv = 1;
  for (let i = 0; i < LEVEL_TIERS.length; i++) {
    if (salt >= LEVEL_TIERS[i]) lv = i + 1;
  }
  return lv;
}

// deltaUpvotes: 该用户回答的净赞同增量（+1 新赞 / -1 取消赞或转踩）。
function applyUpvoteDelta(authorId, deltaUpvotes) {
  if (!deltaUpvotes) return;
  const db = getDb();
  const saltDelta = deltaUpvotes * 2;
  db.prepare(
    "UPDATE users SET salt_value = MAX(salt_value + ?, 0) WHERE id = ?"
  ).run(saltDelta, authorId);
  const u = db.prepare("SELECT salt_value, level FROM users WHERE id = ?").get(authorId);
  const lv = levelFor(u.salt_value);
  if (lv !== u.level) {
    db.prepare("UPDATE users SET level = ? WHERE id = ?").run(lv, authorId);
  }
}

module.exports = { applyUpvoteDelta, levelFor };
