# FEATURES — zhihucopy 增量清单

规则：每跳做 4 条（互不重叠区域）；勾选时追加 `✅ (YYYY-MM-DD lane)`。

## M0 基座
- [ ] Z001 项目骨架：Express + better-sqlite3 + React/Vite/TS，base=/zhihucopy，port 3030
  verify: test -f server/index.js && test -f client/dist/index.html && curl -sf http://127.0.0.1:3030/zhihucopy/api/health | grep -q '"ok":true'
  risk: low
- [ ] Z002 数据库 schema 与迁移脚本（SPEC 第 3 节全部表 + FTS5 触发器）
  verify: node scripts/assert/schema.mjs
  risk: high
- [ ] Z003 认证：注册/登录/JWT 中间件/bcrypt/GET me
  verify: node scripts/assert/auth.mjs
  risk: high
- [ ] Z004 提问接口 POST /questions + 列表 GET /questions
  verify: node scripts/assert/questions.mjs
  risk: med
- [ ] Z005 回答接口 POST /answers + 列表 + 详情
  verify: node scripts/assert/answers.mjs
  risk: med
- [ ] Z006 前端应用壳：路由、布局、请求层、鉴权态、错误 toast
  verify: node scripts/e2e/home.mjs
  risk: med

## 优先级最高：让它看起来像真产品
- [x] Z000 种子数据脚本 `scripts/seed.js`：30 个用户（含头像 URL）、20 个话题、60 个问题、180 个回答（真实中文内容，长度 200–800 字，覆盖编程/职场/生活/科学等话题）、500+ 条评论、随机投票、通知与热榜数据；可重复执行（幂等，先清空再灌） ✅ (2026-11-15 opencode)
- [x] Z000c 种子内容按问题对齐：`scripts/seed-data/*.js` 里 60 个 story（标题+补充说明+3 条回答），detail 与回答只针对本标题、全局不重复 ✅ (2026-11-15 devin)
- [x] Z000b 首页与列表页空态/加载态：骨架屏、加载更多、到底提示、空结果显示引导 ✅ (2026-11-15 opencode)

## M1 互动
- [x] Z010 投票接口（赞/踩/取消，唯一约束，事务更新计数） ✅ (2026-11-15 devin)
- [x] Z011 评论接口（两级、删除自己） ✅ (2026-11-15 opencode)
- [ ] Z012 收藏夹 CRUD + 收藏/取消
  verify: node scripts/assert/collections.mjs
  risk: med
- [ ] Z013 前端：问题详情页（回答列表、排序、投票按钮、评论区）
  verify: node scripts/e2e/vote-comment.mjs
  risk: med
- [ ] Z014 前端：提问页 + Markdown 编辑器 + 话题选择
  verify: node scripts/e2e/ask-editor.mjs
  risk: med
- [ ] Z015 前端：回答编辑器（实时预览、草稿本地保存）
  verify: node scripts/e2e/answer-editor.mjs
  risk: med

## M2 关系与流
- [ ] Z020 关注用户/话题/问题接口
  verify: node scripts/assert/follows.mjs
  risk: med
- [ ] Z021 关注流 /feed/following（分页游标）
  verify: node scripts/assert/feed-following.mjs
  risk: med
- [ ] Z022 推荐流 /feed/recommended（话题兴趣 + 热度衰减混合排序）
  verify: node scripts/assert/feed-recommended.mjs
  risk: med
- [ ] Z023 热榜计算（10 分钟定时 + /feed/hot）
  verify: node scripts/assert/hot.mjs
  risk: med
- [ ] Z024 前端：首页三 tab（关注/推荐/热榜）+ 无限滚动
  verify: node scripts/e2e/home.mjs
  risk: low
- [ ] Z025 前端：个人主页（资料、统计、回答列表、关注/粉丝）
  verify: node scripts/e2e/profile.mjs
  risk: low

## M3 搜索与话题
- [ ] Z030 FTS5 搜索接口（问题/回答/用户/话题，高亮片段）
  verify: node scripts/assert/search.mjs
  risk: med
- [ ] Z031 话题页接口（简介、关注、内容流）
  verify: node scripts/assert/topics.mjs
  risk: med
- [ ] Z032 前端：搜索页（分类 tab、结果高亮、空态）
  verify: node scripts/e2e/search.mjs
  risk: med
- [ ] Z033 前端：话题页
  verify: node scripts/e2e/topic.mjs
  risk: low

## M4 通知与治理
- [ ] Z040 通知接口（产生、未读数、全部已读、类型筛选）
  verify: node scripts/assert/notifications.mjs
  risk: med
- [ ] Z041 举报接口 + 自动折叠规则（≥3 次举报）
  verify: node scripts/assert/reports.mjs
  risk: med
- [ ] Z042 管理后台接口（举报队列、处理、禁言、统计）
  verify: node scripts/assert/admin-api.mjs
  risk: high
- [ ] Z043 前端：通知页（分组、跳转原文）
  verify: node scripts/e2e/notifications.mjs
  risk: med
- [ ] Z044 前端：管理员后台（举报列表、处理弹窗、用户禁言）
  verify: node scripts/e2e/admin.mjs
  risk: high

## M5 成长与打磨
- [ ] Z050 盐值/等级计算 + 每日配额限制
  verify: node scripts/assert/salt.mjs
  risk: med
- [ ] Z051 勋章系统（授予规则、主页展示）
  verify: node scripts/assert/badges.mjs
  risk: med
- [ ] Z052 反垃圾：发帖限速、重复内容检测
  verify: node scripts/assert/antispam.mjs
  risk: med
- [ ] Z053 UI 打磨：骨架屏、空态、加载状态、错误文案
  verify: node scripts/e2e/home.mjs
  risk: low
- [ ] Z054 可访问性：焦点态、对比度、reduced-motion
  verify: node scripts/e2e/a11y.mjs
  risk: low

## 运维
- [x] Z060 scripts/ci-deploy.sh（build→迁移→smoke→restart→复检） ✅ (2026-11-15 devin)
- [x] Z061 scripts/rollback.sh ✅ (2026-11-15 opencode)
- [x] Z062 结构化日志 + 请求耗时中间件 ✅ (2026-11-15 devin)
- [ ] Z063 部署前自动备份数据库到 `data/backups/zhihu-YYYYMMDD-HHmm.db`（保留最近 7 份），rollback 支持可选恢复；ci-deploy 增加 `--dry-run`
  verify: bash -n scripts/ci-deploy.sh && grep -q -- '--dry-run' scripts/ci-deploy.sh && grep -q 'data/backups/zhihu-' scripts/ci-deploy.sh
  risk: high
- [x] Z064 种子冷热分层：部分问题只有 1 条回答、低浏览，让首页/热榜呈现真实冷热差（当前每题固定 3 条） ✅ (2026-11-15 devin)
- [ ] Z065 修复 ci-deploy.sh 退出陷阱 `SMOKE_DB: unbound variable`（cleanup_smoke 重入时变量已置空），并把 votes/comments 接口纳入 smoke 流程
  verify: node scripts/assert/smoke-fix.mjs
  risk: med
- [ ] Z066 前端：问题详情页接入投票与评论（Question.tsx 用 /votes 与 /comments，两级评论渲染、发表、删除自己的）
  verify: node scripts/e2e/vote-comment.mjs
  risk: med
