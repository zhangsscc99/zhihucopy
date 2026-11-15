-- 002_question_votes.sql — vote counters on questions + per-user question votes.

ALTER TABLE questions ADD COLUMN vote_up INTEGER NOT NULL DEFAULT 0;
ALTER TABLE questions ADD COLUMN vote_down INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS question_votes (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  question_id INTEGER NOT NULL REFERENCES questions(id),
  value       INTEGER NOT NULL CHECK (value IN (1, -1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_question_votes_question ON question_votes(question_id);
