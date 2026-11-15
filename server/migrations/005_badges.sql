-- 005_badges.sql — Z1013 勋章系统：勋章定义 + 用户授予记录。

CREATE TABLE IF NOT EXISTS badges (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon_svg    TEXT NOT NULL DEFAULT '',
  rule        TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS user_badges (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  badge_code  TEXT NOT NULL REFERENCES badges(code),
  granted_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, badge_code)
);
CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges(user_id, granted_at DESC);
