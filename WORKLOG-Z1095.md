# WORKLOG-Z1095 — 通知文案「与你互动了」过于含糊

## 根因
`client/src/pages/Notifications.tsx` 的 `ACTION_TEXT` 与
`server/routes/notifications.js` 的 `EVENT_LABELS` 只覆盖
agree/vote/comment/follow/answer。生产库 `notifications.type` 实况
（`select distinct type, count(*) from notifications group by type`）：

```
agree 6 | answer 26 | comment 36 | follow 39 | moderation 7 | reply 26 | vote 26
```

`reply`（26 条，种子「回复了回答下的评论」）与 `moderation`（7 条，管理员
处理回答）均无映射 → `event_label=null` → 前端落到兜底「与你互动了」。

## 改动文件
- `client/src/pages/Notifications.tsx`
  - `ACTION_TEXT` 补 `reply: "回复了你的评论"`、`moderation: "处理了你的回答"`；
    优先级 `n.event_label || ACTION_TEXT[n.type] || "与你互动了"` 不变，
    兜底只留真正未知类型。
  - `TypeIcon` 补 `replied`（回弯箭头）、`moderated`（盾牌）两个内联 SVG，
    沿用 stroke=currentColor / strokeWidth 1.7 / viewBox 24 规格，无第三方库。
- `server/routes/notifications.js`
  - `EVENT_LABELS` 补 `reply: ["replied", "回复了你的评论"]`、
    `moderation: ["moderated", "处理了你的回答"]`，服务端与前端同口径。
- `scripts/assert/notification-copy.mjs`（新增，浏览器级）
  - 从 DB_PATH 挑「有 reply、类型 ⊆ 已覆盖集合」的种子号
    （`user<id>@zhihucopy.dev` / `zhihu123456`），实测选中 user25
    （agree/comment/reply/answer/vote 五类全覆盖）；
  - API：`GET /notifications` 每个 item 的 `event_label` 非空、不含「互动」、
    ∈ 白名单；reply 项必须恰好是「回复了你的评论」；
  - 浏览器：1440×900 与 390×844 各一遍 `/notifications`，每行 `.ntf__action`
    ∈ 白名单、无「互动」、含一行「回复了你的评论」、`window.__errs` 为空、
    无横向溢出、非白屏。

## 既有断言同步检查
`grep -rn "互动" scripts/`：无任何 e2e/assert 依赖旧兜底文案，无冲突契约。
`notify-detail.mjs` 原要求 event_label 非空 —— 补全映射后生产库全部 type
均有 label，口径收紧而非放宽。

## Verify 输出（端口 3162，DB 副本 Z1095.db）
```
$ API_BASE=http://127.0.0.1:3162/zhihucopy/api E2E_BASE=http://127.0.0.1:3162/zhihucopy \
  DB_PATH=/www/hermes-home/cache/scratch/zhdb/Z1095.db bash scripts/verify.sh Z1095
[VERIFY] Z1095 -> node scripts/assert/notification-copy.mjs
[notification-copy] 受体=user25@zhihucopy.dev types=reply,answer,vote,agree,comment items=7 两视口文案白名单/无「互动」/reply 文案全部通过
[E2E] notification-copy PASS (2.7s)
[VERIFY] Z1095 PASS (3.96s)
RC=0
```

## 基线 FAIL 证据
未修基线 `/www/hermes-home/cache/scratch/base-Z1095`
（`/www/zhihucopy` 无修复副本 + 软链 node_modules + `npm run build` +
拷入同一断言脚本），端口 3172，DB 副本 `Z1095-base.db`：

```
$ API_BASE=http://127.0.0.1:3172/zhihucopy/api E2E_BASE=http://127.0.0.1:3172/zhihucopy \
  DB_PATH=/www/hermes-home/cache/scratch/zhdb/Z1095-base.db node scripts/assert/notification-copy.mjs
[E2E] notification-copy FAIL (5.7s): assert: 通知 #59 (type=reply) event_label 为空
RC=1
```
失败原因符合预期：基线服务端 `EVENT_LABELS` 无 `reply` → `event_label=null`，
API 断言第一关即 FAIL（前端同步也会落回「与你互动了」）。

## 其它验证
- `npm run build`（根目录）：tsc --noEmit + vite build 通过。
- `server: npm test`：38/38 通过。
- 临时实例 3162/3172 已按端口收尸；未动 3030 及其它 worktree；
  未改 `docs/FEATURES.md`、未 commit、未 stash。
