# WORKLOG-Z1111 — 作者主页空落点（内容厚度）

分支 feat/Z1111，基线 main。未 commit。

## 新增接口

`GET /users/:id/highlights?limit=5`（`server/routes/users.js`，公开接口，未登录同口径）

响应：

```json
{
  "followed_questions": [ /* questionRow：id/title/answer_count/topics/author/...，与问题列表条目同构 */ ],
  "upvoted_answers": [
    { "answer_id", "question_id", "question_title", "snippet", "vote_up", "created_at", "author": {id, nickname, avatar_url} }
  ]
}
```

- 各 ≤ limit（默认 5，clamp 1–10）。
- followed_questions：`follows` 表 `target_type='question'`，按 `f.created_at DESC` 取最近；
  topics 走 `topicsForQuestions` 批量 IN 查询（无 N+1）。
- upvoted_answers：`votes` 表 `value=1`（本库 votes 只指向 answer），JOIN
  answers/questions/users 一次取全（无 N+1）；排除 `is_deleted`；
  snippet 服务端剥 markdown + 压空白，总长 ≤60（截断留位给省略号）。
- 内容过滤与 `GET /users/:id` stats 同源：`testQuestionSql` 过滤测试内容，
  页主本人查看（selfView）放开。
- 注：任务给出的备选 `GET /users/:id/following` 已存在（返回关注的「用户」，
  follows.mjs 在用），故采用任务允许的合并接口 `/highlights`。

## 空态渲染条件（`client/src/pages/Profile.tsx`）

- `ProfileAnswers` 列表为空 → 挂 `ProfileAnswersEmpty`，取
  `/users/:id/highlights?limit=5`（仅此分支发请求，有回答的主页零额外往返）。
- 请求中 → Spinner；接口失败或两块均无数据 → 原 `Empty`（「还没有回答」+
  原有 CTA，profile-empty-cta 契约不变）。
- 任一块有数据 → 渲染 `TA 最近关注的问题`（链 `/question/:id`）与
  `TA 最近赞同的回答`（链 `/question/:qid#answer-:aid`）两节，
  页尾保留原 CTA 按钮；「还没有回答」文案不出现（不与链接并存）。
- 条目复用 `.plist/.plist__item/.plist__link` + `feed__title/feed__excerpt/feed__meta`；
  新增 `.phl__title`（16px/500）与 `.phl__actions`（顶部分隔线 CTA 行），
  无新色值，全走现有 token（`--surface/--line/--radius/--ink-*/--accent`）。

## 断言

新增 `scripts/assert/profile-empty-fallback.mjs`：

- 候选用户扫描：CANDIDATES（prod 快照中 0 回答但有轨迹的种子号，首选 214）
  → `/users/:id` stats.answers===0 → `/users/:id/highlights` 验证非空；
  接口 404（基线）仍当选交页面断言。全不命中 → fixture：注册测试号
  关注 2 问题 + 赞同 2 回答，finally 清理自己的 follow/vote。
- 页面断言：anon@1440 全量（`main a[href*="/question/"]` ≥3、
  「还没有回答」与链接不并存、`__errs` 空、`innerText>300`、无横向溢出）
  → 390 复验 → 登录态 1440 链接数与未登录一致。
- 回归点：有回答用户（扫到 user3/id=3）`.plist__item` ≥1 且 `.phl__sec` = 0。

## 验证结果

- `npm run build`（client）：tsc + vite 通过。
- 临时实例：`PORT=3161 DB_PATH=/www/hermes-home/cache/scratch/zhdb/Z1111.db
  node server/index.js`（DB 经 better-sqlite3 `.backup()` 从 prod 复制）。
- `API_BASE=…3161… E2E_BASE=…3161… node scripts/assert/profile-empty-fallback.mjs`
  → **PASS (8.3s)**。
- 回归：`profile-empty-cta` PASS (8.1s)；`e2e/profile` PASS (3.2s)；
  `follows` PASS (2.0s)。
- 人工截图复核 /u/214：1440 双块各 5 条可点 + CTA 行，右栏不变；
  390 单列无溢出。

## 基线反向自检

```
$ API_BASE=https://openfolio.uk/zhihucopy/api \
  E2E_BASE=https://openfolio.uk/zhihucopy \
  node scripts/assert/profile-empty-fallback.mjs
[ASSERT] profile-empty-fallback FAIL (1.8s): anon1440: main a[href*="/question/"] = 0，要求 ≥3（无补内容块）
RC=1
```

预期内 FAIL：线上 `/u/214` 仍是纯空态（`回答 0` + 「浏览 TA 的提问」），
`main` 内问题链接数 0。截图 `/root/logs/profile-empty-fallback-1794906492023.png`。
