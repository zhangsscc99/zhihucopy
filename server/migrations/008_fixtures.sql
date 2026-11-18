-- 008_fixtures.sql — 历史测试数据「夹具标记」（Z1204）。
--
-- 写入侧守卫（is_test / content-filter 形态规则）挡不住守卫上线前已入库的
-- 历史夹具（「走查问题NNN？」/「真人nm…」账号/「巡检回答 r-…」正文），本轮
-- 改读路径过滤：questions/answers 各加 is_fixture 机器列，公共读路径一律
-- 追加 is_fixture = 0；scripts/mark-fixtures.js 按标题/作者/正文形态回填。
--
-- 列本身是幂等补列（PRAGMA table_info 判断），由 server/db.js 的
-- ensureFixtureColumns() 在每条迁移文件执行前兜底 —— SQLite 的
-- ALTER TABLE ADD COLUMN 不支持 IF NOT EXISTS，写进本文件会让「列已被
-- 外部脚本补过」的库重复 ALTER 而启动失败。本文件只负责索引（幂等）。

CREATE INDEX IF NOT EXISTS idx_questions_is_fixture ON questions(is_fixture);
CREATE INDEX IF NOT EXISTS idx_answers_is_fixture   ON answers(is_fixture);
