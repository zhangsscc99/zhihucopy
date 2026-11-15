const express = require("express");
const { getDb } = require("../db");
const { badRequest } = require("../util");
const { requireAuth } = require("../auth");

const router = express.Router();

const EXCERPT_LEN = 120;
// better-sqlite3 默认 SQLITE_MAX_VARIABLE_NUMBER 远大于 500，但保守截断防止 ids 过长。
const MAX_READ_IDS = 500;

// 通知 payload 由目标对象回查生成（notifications 表本身只有 target_type/target_id）。
//   type='answer' → target_type='answer', target_id=<answers.id>：
//     { question_id, question_title, answer_id, answer_excerpt }
//   type='question'（兼容旧行）→ { question_id, question_title }
// 按目标主键 JOIN，不做「该用户最新一条回答」的反推，避免重复回答时旧通知指向新回答。
function buildPayload(db, n) {
  const payload = {};
  if (!n.target_id) return payload;

  if (n.target_type === "answer") {
    const a = db
      .prepare(
        `SELECT a.id, a.content_md, a.question_id, q.title AS question_title
         FROM answers a
         JOIN questions q ON q.id = a.question_id
         WHERE a.id = ?`
      )
      .get(n.target_id);
    if (a) {
      payload.question_id = a.question_id;
      payload.question_title = a.question_title;
      payload.answer_id = a.id;
      const text = String(a.content_md || "").replace(/\s+/g, " ").trim();
      payload.answer_excerpt =
        text.length > EXCERPT_LEN ? `${text.slice(0, EXCERPT_LEN)}…` : text;
    }
    return payload;
  }

  if (n.target_type === "question") {
    const q = db.prepare("SELECT id, title FROM questions WHERE id = ?").get(n.target_id);
    if (q) {
      payload.question_id = q.id;
      payload.question_title = q.title;
    }
  }
  return payload;
}

function notificationRow(db, n) {
  return {
    id: n.id,
    type: n.type,
    actor: n.actor_id
      ? { id: n.actor_id, nickname: n.actor_nickname, avatar_url: n.actor_avatar }
      : null,
    target: n.target_type ? { type: n.target_type, id: n.target_id } : null,
    payload: buildPayload(db, n),
    is_read: n.is_read === 1,
    created_at: n.created_at,
  };
}

// GET /notifications?type=&unread=&limit=&offset= — 本人通知列表。
//   unread=1 → 只看未读；unread=0 → 只看已读；缺省/其他值 → 不过滤。
router.get("/", requireAuth, (req, res) => {
  const db = getDb();
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const type =
    typeof req.query.type === "string" && req.query.type.trim()
      ? req.query.type.trim()
      : null;

  const unreadParam =
    typeof req.query.unread === "string" ? req.query.unread.trim().toLowerCase() : "";
  let readFilter = null;
  if (unreadParam === "1" || unreadParam === "true") readFilter = "n.is_read = 0";
  else if (unreadParam === "0" || unreadParam === "false") readFilter = "n.is_read = 1";

  const conds = ["n.user_id = ?"];
  const params = [req.user.id];
  if (type) {
    conds.push("n.type = ?");
    params.push(type);
  }
  if (readFilter) conds.push(readFilter);
  const where = conds.join(" AND ");

  const rows = db
    .prepare(
      `SELECT n.*, u.nickname AS actor_nickname, u.avatar_url AS actor_avatar
       FROM notifications n
       LEFT JOIN users u ON u.id = n.actor_id
       WHERE ${where}
       ORDER BY n.created_at DESC, n.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  // total 跟随筛选条件；unread 恒为本人全部未读数（导航角标语义）。
  const total = db
    .prepare(`SELECT COUNT(*) c FROM notifications n WHERE ${where}`)
    .get(...params).c;
  const unread = db
    .prepare("SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND is_read = 0")
    .get(req.user.id).c;

  res.json({ items: rows.map((n) => notificationRow(db, n)), total, unread });
});

// GET /notifications/unread-count — 未读数。
router.get("/unread-count", requireAuth, (req, res) => {
  const count = getDb()
    .prepare("SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND is_read = 0")
    .get(req.user.id).c;
  res.json({ count });
});

// POST /notifications/read — body {all:true} 或 {ids:[...]}，仅标记本人通知。
router.post("/read", requireAuth, (req, res) => {
  const { all, ids } = req.body || {};
  const db = getDb();

  if (all === true) {
    const info = db
      .prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0")
      .run(req.user.id);
    return res.json({ updated: info.changes });
  }

  if (Array.isArray(ids)) {
    const list = [...new Set(ids.filter((v) => Number.isInteger(v) && v > 0))].slice(
      0,
      MAX_READ_IDS
    );
    if (!list.length) return res.json({ updated: 0 });
    const marks = list.map(() => "?").join(",");
    const info = db
      .prepare(
        `UPDATE notifications SET is_read = 1
         WHERE user_id = ? AND is_read = 0 AND id IN (${marks})`
      )
      .run(req.user.id, ...list);
    return res.json({ updated: info.changes });
  }

  return badRequest(res, "参数需要 {all:true} 或 {ids:[...]}");
});

module.exports = router;
module.exports.buildPayload = buildPayload;
