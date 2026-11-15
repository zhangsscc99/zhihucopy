-- 004_test_artifacts.sql — 自动化产物机器标记（Z983）。
-- assert/e2e/巡检脚本注册一律走专属测试邮箱域（@test.dev 等，见
-- server/content-filter.js 的 TEST_EMAIL_DOMAINS）。注册时把 is_test 落 1，
-- 之后该账号创建的问题/回答/评论/收藏经 author_id/owner_id 关联即可机器识别，
-- 不再依赖标题/昵称形态猜测（历史形态规则仍保留，兼容存量产物）。

ALTER TABLE users ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_users_is_test ON users(is_test);
