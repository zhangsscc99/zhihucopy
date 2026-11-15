-- 006_reports_admin.sql — 举报工单终态 + 自动折叠（Z1012）。
-- 001 的 reports.status CHECK 只认 pending/rejected/removed/collapsed 且没有
-- handled_at；这里照 003 的方式重建表，终态收敛为 pending/handled/rejected：
--   removed / collapsed -> handled（handled_at 回填 created_at）
-- 历史 reason（harassment/misinformation/plagiarism 等）归并为 'other'，
-- target_type 仅保留 question/answer/comment。
-- 另给 questions/comments 补 is_collapsed（answers 在 001 已有），
-- ≥3 条 pending 举报时由服务端置 1 自动折叠。

CREATE TABLE reports_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('question', 'answer', 'comment')),
  target_id   INTEGER NOT NULL,
  reason      TEXT NOT NULL DEFAULT 'other'
              CHECK (reason IN ('spam', 'abuse', 'illegal', 'other')),
  detail      TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'handled', 'rejected')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  handled_at  TEXT,
  handled_by  INTEGER REFERENCES users(id)
);

INSERT INTO reports_new (id, reporter_id, target_type, target_id, reason, detail,
                         status, created_at, handled_at, handled_by)
SELECT id, reporter_id, target_type, target_id,
       CASE WHEN reason IN ('spam', 'abuse', 'illegal', 'other') THEN reason ELSE 'other' END,
       detail,
       CASE status WHEN 'pending' THEN 'pending' WHEN 'rejected' THEN 'rejected' ELSE 'handled' END,
       created_at,
       CASE WHEN status IN ('removed', 'collapsed') THEN created_at ELSE NULL END,
       handled_by
FROM reports
WHERE target_type IN ('question', 'answer', 'comment');

DROP TABLE reports;

ALTER TABLE reports_new RENAME TO reports;

CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_type, target_id);

ALTER TABLE questions ADD COLUMN is_collapsed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE comments  ADD COLUMN is_collapsed INTEGER NOT NULL DEFAULT 0;
