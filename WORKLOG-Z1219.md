# WORKLOG-Z1219 — 夹具问题详情页不得当「真」返回

## 根因

Z1204 只在公共**列表** SQL 上补了 `is_fixture = 0`，漏了三处派生口径：

1. `GET /questions/:id` 的取题查询不带 `is_fixture` 条件，夹具问题（如 1647）
   照样 200 返回，历史链接点进来是「4 个回答 + 空列表」的死页。
2. 详情返回的 `answer_count` 直接信 questions 列存计数 —— 该计数仍含已被
   读路径过滤的夹具回答，与 `answers`（`is_deleted=0 AND is_fixture=0`）不同源。
3. 搜索（question/answer/topic 三个 scope）、话题流 `/topics/:key`、
   话题列表 `question_count`、个人页 `stats.questions` 均未加 `is_fixture = 0`，
   夹具问题仍可作为落点出现。
4. SPA fallback 的存在性判定（`spaContentExists`）按裸 `WHERE id = ?` 判，
   `/question/<fixture>` 会回 200 + index.html 而非真 404。

## 改动文件

- `server/routes/questions.js`
  - `GET /:id`：取题查询加 `AND q.is_fixture = 0`，夹具走既有
    `404 { error: "问题不存在" }`（与不存在 id 形状一致）；
    响应 `answer_count` 改为按 `is_deleted=0 AND is_fixture=0` 现算 COUNT，
    与 `answers`/`/:id/answers` 的 `total` 同源。
  - `GET /:id/related`、`GET /:id/answers`、`POST /:id/answers`、
    `POST|DELETE /:id/follow` 的存在性查询统一加 `AND is_fixture = 0`。
- `server/app.js`：`spaContentExists` 问题分支加 `AND is_fixture = 0`，
  `/question/<fixture>` HTTP 状态与不存在 id 一致（404 + index.html）。
- `server/routes/search.js`：qWhere 加 `q.is_fixture = 0`；aWhere 加
  `a.is_fixture = 0 AND q.is_fixture = 0`；topic scope 的 `question_count`
  子查询加 `q.is_fixture = 0`。
- `server/routes/topics.js`：`/topics` 与 `/topics/:key` 的问题计数、
  问题流 rows/total 均加 `q.is_fixture = 0`。
- `server/routes/users.js`：`stats.questions` 加 `q.is_fixture = 0`，
  与 `GET /questions?author=` 列表口径对齐。
- `scripts/assert/question-fixture-detail.mjs`：新增验收脚本（自包含：
  复制源库 → mark-fixtures → 随机端口临时实例 → 断言 → 整锅删）。

接口形状未变（字段名/嵌套不动），无新依赖，未动端口/反代/架构；前端复用
现有 NotFound 页，未新增组件。

## 断言结果

```
node scripts/assert/question-fixture-detail.mjs   # 连跑 2 次
```

两次均 `PASS`（exit 0）：

- `GET /questions/1647` → 404，响应体与不存在 id 完全一致；
  `/questions/1647/answers`、`/questions/1647/related` 同样 404；
- 首页/热榜前 20 条抽样 5 条真实问题（3,6,9,4,1）：
  `answer_count === answers.total` 全过；
- Playwright 390×844 打开 `/question/1647` → HTTP 404、NotFound 文案命中
  （不存在/找不到）、可点出口 = 2、`window.__errs` 为空；
- 脚本零产物：临时库 + 临时实例进程退出即清理，两跑结果一致。

回归：`npm --prefix server test` 57/57 通过。
