# WORKLOG-Z1110 搜索召回偏窄（FTS 覆盖与分词）

## 只读核对（DB_PATH=/www/zhihucopy/data/zhihu.db）

| 指标 | 数值 |
|---|---|
| questions(title/detail LIKE '%React%') | 2 |
| answers(content LIKE '%React%') | 6（未删除 6） |
| questions(title/detail LIKE '%useEffect%') | 2 |
| answers(content LIKE '%useEffect%') | 6 |
| questions(title/detail LIKE '%数据库%') | 6 |
| answers(content LIKE '%数据库%') | 18（未删除/非测试过滤后 17） |
| questions(title/detail LIKE '%职场%') | 1 |
| answers(content LIKE '%职场%') | 7 |
| answer_fts 行数 vs answers 未删除 | 303 / 302（全量 303，索引无漏建） |
| questions FTS 索引 | 无（question scope 靠 title/detail LIKE + 话题名 EXISTS） |
| FTS5 表结构 | `answer_fts USING fts5(title, content)`，unicode61 默认分词 |

线上接口实测（修复前）：React → counts {question:2, answer:6, user:0}，与 LIKE 基线完全一致。

## 根因判定

**既不是索引漏建，也不是查询侧 LIMIT/分词漏召回。**

- `answer_fts` 行数与 answers 全量对齐（303），无漏索引；且查询路径全部走 LIKE 子串（Z1044 起），FTS 分词器不参与检索，unicode61 对中文整串分词不影响结果。
- 接口 `counts.question` 对四词均 ≥ 只读 LIKE 基线（`数据库`/`职场` 因 Z962 话题名命中为 13/19，属刻意增量）。
- SQLite LIKE 对 ASCII 大小写不敏感：React/react/REACT 实测三态一致（2/6/0）。
- 「偏窄」的真实成分：① 库内含 "React" 字样的问题本就只有 2 条（首页可见的 event loop/设计稿等标题不含 React）；② 回答命中 6 条在「回答」tab，首屏标题只显示问题 scope total=2。
- 顺带发现的真实口径偏差：question scope 未排除 `is_collapsed=1` 的折叠问题（任务口径要求「未折叠」），已修：`qWhere` 补 `q.is_collapsed = 0`（本库当前折叠问题 0 条，计数不变；DB 副本实测折叠题被剔除）。

## 修复前后四词命中数（接口 counts.question / counts.answer）

| 词 | 修复前 | 修复后 | 只读 LIKE 基线（q/a） |
|---|---|---|---|
| React | 2 / 6 | 2 / 6 | 2 / 6 |
| react | 2 / 6 | 2 / 6 | 2 / 6 |
| useEffect | 2 / 6 | 2 / 6 | 2 / 6 |
| 数据库 | 13 / 17 | 13 / 17 | 6 / 18 |
| 职场 | 19 / 7 | 19 / 7 | 1 / 7 |

（counts.question 高于 LIKE 基线的部分 = Z962 所属话题名命中，刻意特性，由 search-page.mjs 锁定；counts.answer 略低于 LIKE 基线 = 未删除 + 测试产物过滤口径。）

## 改动

- `server/routes/search.js`：question scope WHERE 补 `q.is_collapsed = 0`，对齐「未折叠」口径。
- `scripts/assert/search-recall.mjs`：四词 counts.question ≥ 只读 LIKE 计数、answer 命中 >0（基线非 0 时）、React/react/REACT 三态 counts 一致、type=answer total 与 counts.answer 自洽；SQL 侧用 better-sqlite3 只读开 DB_PATH。
- `docs/FEATURES.md`：Z1110 条目 + verify 行。

未做：FTS 重建脚本——answer_fts 无漏索引且检索不走 FTS，不满足「若需重建」前提。未动返回结构、未加依赖、未改表结构。

## 验证

- `bash scripts/verify.sh Z1110` → PASS
- DB 副本（/tmp/z1110.db）+ 本地实例（PORT=3999）：search-recall / search-page / search-scope / search-guard 全 PASS；构造折叠题实测从搜索剔除。
