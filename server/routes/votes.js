const express = require("express");
const { getDb } = require("../db");
const { requireAuth } = require("../auth");
const { badRequest } = require("../util");
const { applyUpvoteDelta } = require("../salt");
const { grantFor } = require("../badges");

const router = express.Router();

const TARGETS = {
  question: { table: "questions", votesTable: "question_votes", fk: "question_id", notFound: "问题不存在" },
  answer: { table: "answers", votesTable: "votes", fk: "answer_id", notFound: "回答不存在" },
};

function parseParams(target_type, target_id, value, checkValue) {
  if (!TARGETS[target_type]) {
    return "target_type 必须是 question 或 answer";
  }
  const id = Number(target_id);
  if (!Number.isInteger(id) || id <= 0) {
    return "target_id 必须是正整数";
  }
  if (checkValue && ![1, -1, 0].includes(value)) {
    return "value 必须是 1、-1 或 0";
  }
  return null;
}

// POST / — cast/change/cancel a vote. Body: { target_type, target_id, value }
router.post("/", requireAuth, (req, res) => {
  const { target_type, target_id, value } = req.body || {};
  const err = parseParams(target_type, target_id, value, true);
  if (err) return badRequest(res, err);

  const t = TARGETS[target_type];
  const db = getDb();
  const id = Number(target_id);
  const target =
    target_type === "answer"
      ? db.prepare(`SELECT id, author_id FROM answers WHERE id = ? AND is_deleted = 0`).get(id)
      : db.prepare(`SELECT id FROM questions WHERE id = ?`).get(id);
  if (!target) return res.status(404).json({ error: t.notFound });

  const tx = db.transaction(() => {
    const existing = db
      .prepare(`SELECT value FROM ${t.votesTable} WHERE user_id = ? AND ${t.fk} = ?`)
      .get(req.user.id, id);
    const oldVal = existing ? existing.value : 0;
    const newVal = value;
    if (oldVal === newVal) return;

    if (newVal === 0) {
      db.prepare(`DELETE FROM ${t.votesTable} WHERE user_id = ? AND ${t.fk} = ?`).run(req.user.id, id);
    } else {
      db.prepare(
        `INSERT INTO ${t.votesTable} (user_id, ${t.fk}, value) VALUES (?, ?, ?)
         ON CONFLICT(user_id, ${t.fk}) DO UPDATE SET value = excluded.value`
      ).run(req.user.id, id, newVal);
    }

    const du = (oldVal === 1 ? -1 : 0) + (newVal === 1 ? 1 : 0);
    const dd = (oldVal === -1 ? -1 : 0) + (newVal === -1 ? 1 : 0);
    if (du !== 0 || dd !== 0) {
      db.prepare(
        `UPDATE ${t.table} SET vote_up = vote_up + ?, vote_down = vote_down + ? WHERE id = ?`
      ).run(du, dd, id);
    }
    return { du, dd };
  });
  const delta = tx();

  // Z1014: 回答作者盐值（赞同 +2 / 取消 -2，自赞不计）；Z1013: 累计获赞 10 授勋。
  if (target_type === "answer" && delta && target.author_id !== req.user.id) {
    applyUpvoteDelta(target.author_id, delta.du);
    if (delta.du > 0) grantFor(target.author_id, "upvote_10");
  }

  const counts = db.prepare(`SELECT vote_up, vote_down FROM ${t.table} WHERE id = ?`).get(id);
  res.json({ vote: value, voteup_count: counts.vote_up, votedown_count: counts.vote_down });
});

// GET /mine?target_type=&target_id= — current user's vote value (0 if anonymous/none).
router.get("/mine", (req, res) => {
  const { target_type, target_id } = req.query;
  const err = parseParams(target_type, target_id, 0, false);
  if (err) return badRequest(res, err);
  if (!req.user) {
    return res.json({ vote: 0 });
  }
  const t = TARGETS[target_type];
  const row = getDb()
    .prepare(`SELECT value FROM ${t.votesTable} WHERE user_id = ? AND ${t.fk} = ?`)
    .get(req.user.id, Number(target_id));
  res.json({ vote: row ? row.value : 0 });
});

module.exports = router;
