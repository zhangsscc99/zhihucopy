-- 001_init.sql — zhihucopy base schema (SPEC §3) + FTS5 sync triggers.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nickname      TEXT NOT NULL,
  avatar_url    TEXT NOT NULL DEFAULT '',
  bio           TEXT NOT NULL DEFAULT '',
  salt_value    INTEGER NOT NULL DEFAULT 0,
  level         INTEGER NOT NULL DEFAULT 1,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  muted_until   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS topics (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL UNIQUE,
  slug           TEXT NOT NULL DEFAULT '',
  description    TEXT NOT NULL DEFAULT '',
  follower_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS questions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id      INTEGER NOT NULL REFERENCES users(id),
  title          TEXT NOT NULL,
  detail_md      TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  answer_count   INTEGER NOT NULL DEFAULT 0,
  follower_count INTEGER NOT NULL DEFAULT 0,
  view_count     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_questions_author  ON questions(author_id);
CREATE INDEX IF NOT EXISTS idx_questions_created ON questions(created_at DESC);

CREATE TABLE IF NOT EXISTS question_topics (
  question_id INTEGER NOT NULL REFERENCES questions(id),
  topic_id    INTEGER NOT NULL REFERENCES topics(id),
  PRIMARY KEY (question_id, topic_id)
);
CREATE INDEX IF NOT EXISTS idx_qt_topic ON question_topics(topic_id);

CREATE TABLE IF NOT EXISTS answers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id   INTEGER NOT NULL REFERENCES questions(id),
  author_id     INTEGER NOT NULL REFERENCES users(id),
  content_md    TEXT NOT NULL,
  vote_up       INTEGER NOT NULL DEFAULT 0,
  vote_down     INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  is_collapsed  INTEGER NOT NULL DEFAULT 0,
  is_deleted    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_answers_question ON answers(question_id);
CREATE INDEX IF NOT EXISTS idx_answers_author   ON answers(author_id);
CREATE INDEX IF NOT EXISTS idx_answers_created  ON answers(created_at DESC);

CREATE TABLE IF NOT EXISTS answer_revisions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  answer_id  INTEGER NOT NULL REFERENCES answers(id),
  content_md TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_revisions_answer ON answer_revisions(answer_id);

CREATE TABLE IF NOT EXISTS votes (
  user_id   INTEGER NOT NULL REFERENCES users(id),
  answer_id INTEGER NOT NULL REFERENCES answers(id),
  value     INTEGER NOT NULL CHECK (value IN (1, -1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, answer_id)
);
CREATE INDEX IF NOT EXISTS idx_votes_answer ON votes(answer_id);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  answer_id  INTEGER NOT NULL REFERENCES answers(id),
  author_id  INTEGER NOT NULL REFERENCES users(id),
  parent_id  INTEGER REFERENCES comments(id),
  content    TEXT NOT NULL,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_answer ON comments(answer_id);

CREATE TABLE IF NOT EXISTS follows (
  follower_id INTEGER NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('user', 'topic', 'question')),
  target_id   INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (follower_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_target ON follows(target_type, target_id);

CREATE TABLE IF NOT EXISTS collections (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id  INTEGER NOT NULL REFERENCES users(id),
  name      TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id INTEGER NOT NULL REFERENCES collections(id),
  answer_id     INTEGER NOT NULL REFERENCES answers(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (collection_id, answer_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  type        TEXT NOT NULL,
  actor_id    INTEGER REFERENCES users(id),
  target_type TEXT,
  target_id   INTEGER,
  is_read     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);

CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL,
  target_id   INTEGER NOT NULL,
  reason      TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'rejected', 'removed', 'collapsed')),
  handled_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);

CREATE TABLE IF NOT EXISTS mod_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id    INTEGER NOT NULL REFERENCES users(id),
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   INTEGER,
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS badges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  code       TEXT NOT NULL,
  granted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_badges_user ON badges(user_id);

-- Full-text index over answers (title = parent question title, content = answer body).
CREATE VIRTUAL TABLE IF NOT EXISTS answer_fts USING fts5(title, content);

CREATE TRIGGER IF NOT EXISTS answers_fts_ai AFTER INSERT ON answers BEGIN
  INSERT INTO answer_fts(rowid, title, content)
  VALUES (new.id,
          (SELECT title FROM questions WHERE id = new.question_id),
          new.content_md);
END;

CREATE TRIGGER IF NOT EXISTS answers_fts_au AFTER UPDATE ON answers BEGIN
  DELETE FROM answer_fts WHERE rowid = old.id;
  INSERT INTO answer_fts(rowid, title, content)
  VALUES (new.id,
          (SELECT title FROM questions WHERE id = new.question_id),
          new.content_md);
END;

CREATE TRIGGER IF NOT EXISTS answers_fts_ad AFTER DELETE ON answers BEGIN
  DELETE FROM answer_fts WHERE rowid = old.id;
END;
