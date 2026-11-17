const express = require("express");
const { getDb } = require("../db");
const { requireAuth } = require("../auth");
const { badRequest } = require("../util");

const router = express.Router();

// 正整数参数归一：非整数/非正数一律视为参数非法（400）。
function toPosInt(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// POST /invites {question_id, invitee_id} — 登录用户在某问题下发出「邀请回答」。
// 幂等：(question_id, inviter_id, invitee_id) 唯一，重复提交命中既存行返回
// already:true 且不重复计数；不能邀请自己；问题/受邀者不存在同样按 400 处理
// （受邀人候选列表走 /search?type=user，测试账号过滤口径已在搜索侧生效）。
router.post("/", requireAuth, (req, res) => {
  const questionId = toPosInt(req.body && req.body.question_id);
  const inviteeId = toPosInt(req.body && req.body.invitee_id);
  if (!questionId || !inviteeId) return badRequest(res, "参数不合法");
  if (inviteeId === req.user.id) return badRequest(res, "不能邀请自己");

  const db = getDb();
  const question = db.prepare("SELECT id FROM questions WHERE id = ?").get(questionId);
  if (!question) return badRequest(res, "问题不存在");
  const invitee = db.prepare("SELECT id FROM users WHERE id = ?").get(inviteeId);
  if (!invitee) return badRequest(res, "用户不存在");

  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO question_invites (question_id, inviter_id, invitee_id)
       VALUES (?, ?, ?)`
    )
    .run(questionId, req.user.id, inviteeId);
  const invited_count = db
    .prepare(
      "SELECT COUNT(*) c FROM question_invites WHERE question_id = ? AND inviter_id = ?"
    )
    .get(questionId, req.user.id).c;
  res.json({ ok: true, invited_count, already: inserted.changes === 0 });
});

// GET /invites?question_id= — 当前用户在该问题下已发出的邀请 invitee_id 列表，
// 供前端在重新打开邀请弹层时恢复「已邀请」态。
router.get("/", requireAuth, (req, res) => {
  const questionId = toPosInt(req.query.question_id);
  if (!questionId) return badRequest(res, "参数不合法");
  const rows = getDb()
    .prepare(
      `SELECT invitee_id FROM question_invites
       WHERE question_id = ? AND inviter_id = ? ORDER BY invitee_id`
    )
    .all(questionId, req.user.id);
  res.json({ invitee_ids: rows.map((r) => r.invitee_id) });
});

module.exports = router;
