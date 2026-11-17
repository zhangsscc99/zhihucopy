-- 007_question_invites.sql — 「邀请回答」邀请记录（Z1141）。
-- 幂等键 (question_id, inviter_id, invitee_id)：同一邀请人对同一问题下的同一
-- 受邀者只保留一条；POST /api/invites 用 INSERT OR IGNORE 靠它实现幂等。

CREATE TABLE IF NOT EXISTS question_invites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES questions(id),
  inviter_id  INTEGER NOT NULL REFERENCES users(id),
  invitee_id  INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (question_id, inviter_id, invitee_id)
);
CREATE INDEX IF NOT EXISTS idx_question_invites_inviter
  ON question_invites(question_id, inviter_id);
