-- 002_comments_target.sql — 评论可用于回答或问题（两级：顶层 + 回复）。
-- 001 的 comments 只挂 answer_id，无法承载题目评论，这里重建表：
--   answer_id -> target_type('question'|'answer') + target_id
-- 历史行一律回填为 target_type='answer', target_id=answer_id。

CREATE TABLE comments_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL DEFAULT 'answer' CHECK (target_type IN ('question', 'answer')),
  target_id   INTEGER NOT NULL,
  author_id   INTEGER NOT NULL REFERENCES users(id),
  parent_id   INTEGER REFERENCES comments_new(id),
  content     TEXT NOT NULL,
  is_deleted  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO comments_new (id, target_type, target_id, author_id, parent_id, content, is_deleted, created_at)
SELECT id, 'answer', answer_id, author_id, parent_id, content, is_deleted, created_at
FROM comments
ORDER BY id;

DROP TABLE comments;

ALTER TABLE comments_new RENAME TO comments;

CREATE INDEX IF NOT EXISTS idx_comments_target ON comments(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);
