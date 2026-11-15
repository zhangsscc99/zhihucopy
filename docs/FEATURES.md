# FEATURES — zhihucopy 增量清单

规则：每跳做 4 条（互不重叠区域）；勾选时追加 `✅ (YYYY-MM-DD lane)`。

## 品牌与视觉（最高优先，先于一切功能）
- [x] Z900 品牌改名：全站「知海」→「知乎（仿）」（页面 title、顶部 logo 文案、页脚、meta description、空态文案） ✅ (2026-11-15 devin)
  verify: node scripts/assert/brand.mjs
  risk: low
- [x] Z901 视觉仿知乎：白底 + 知乎蓝 #0066FF 主色 + 灰阶层级，顶部固定搜索栏（居中、圆角输入框、右侧提问按钮），内容区白卡细边框、无重阴影 ✅ (2026-11-15 devin)
  verify: node scripts/assert/style-tokens.mjs
  risk: low
- [x] Z902 首页信息流卡片刻仿知乎：问题标题（18px/加粗）→ 摘要两行截断 → 底部元信息（回答数·关注者·浏览）→ 话题胶囊（灰底圆角小字，接口返回时渲染）；右侧无图占位（纯文本卡） ✅ (2026-11-15 devin)
  verify: node scripts/assert/feed-card.mjs
  risk: low
- [x] Z903 问题详情页排版仿知乎：标题大号、关注按钮、回答卡片（作者行 头像+昵称+一句话简介 → 正文 → 赞同/反对/评论/收藏/分享 栏） ✅ (2026-11-15 devin)
  verify: node scripts/assert/question-layout.mjs
  risk: low
- [x] Z904 话题页与话题胶囊：话题页头部（名称+简介+关注+讨论数）、内容流、相关话题 ✅ (2026-11-15 devin)
  verify: node scripts/assert/topic-page.mjs
  risk: med
- [x] Z905 顶部导航与右侧栏仿知乎：左侧 logo+导航（首页/发现/等你来答）、右侧栏（热榜 Top10 带排名色块） ✅ (2026-11-15 devin)
  verify: node scripts/assert/nav-rail.mjs
  risk: low

## 产品体验巡检（每轮必做一条）
- [x] Z950 巡检：用 Playwright 走完「首页→问题→回答→点赞→评论→通知→搜索」全链路，记录任何死路/无反馈/数值不回写，写入 docs/PRODUCT-REVIEW.md ✅ (2026-11-15 subagent)
  verify: node scripts/assert/journey.mjs
  risk: low

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
- [x] Z012 收藏夹 CRUD + 收藏/取消 ✅ (2026-11-15 devin)
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
- [x] Z020 关注用户/话题/问题接口 ✅ (2026-11-15 opencode)
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
- [x] Z031 话题页接口（简介、关注、内容流） ✅ (2026-11-15 devin)
  verify: node scripts/assert/topics.mjs
  risk: med
- [ ] Z032 前端：搜索页（分类 tab、结果高亮、空态）
  verify: node scripts/e2e/search.mjs
  risk: med
- [ ] Z033 前端：话题页
  verify: node scripts/e2e/topic.mjs
  risk: low

## M4 通知与治理
- [x] Z040 通知接口（产生、未读数、全部已读、类型筛选） ✅ (2026-11-15 opencode)
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

## 产品体验待办（巡检生成）

来源：`docs/PRODUCT-REVIEW.md` 轮次 2026-11-15 14:20。

- [x] Z951 详情页回答卡片补「赞同」按钮：调 `POST /api/votes`（后端已就绪），点击后计数 +1 且按钮变蓝，再点取消回退，未登录引导登录 ✅ (2026-11-15 devin)
  verify: grep -rq '/votes' client/src && grep -rq 'vote_up' client/src/pages/Question.tsx
  risk: high
- [x] Z952 详情页回答卡片补评论区：`GET/POST /api/comments` 两级评论渲染与发表，发布后立即出现在列表顶部并 +1 ✅ (2026-11-15 devin)
  verify: grep -rq '/comments' client/src
  risk: high
- [x] Z953 顶部搜索生效：`/?q=` 真正参与检索，展示「"关键词" 的相关结果 · N 条」、命中高亮与无结果空态（新增只读 GET /api/search） ✅ (2026-11-15 devin)
  verify: node scripts/assert/search-page.mjs
  risk: med
- [ ] Z954 通知页接真实列表与未读角标：`/notifications` 渲染列表、顶部导航显示未读数，进入后标为已读清零（当前为「后续版本上线」占位页）
  verify: grep -rq '/notifications/unread-count' client/src
  risk: med
- [x] Z955 话题胶囊变为链接：`.tag` 改用 `<Link to="/topic/:id">`，新增话题页（名称+简介+关注+讨论数+内容流，当前点击无任何反应）
  verify: grep -rq '/topic/' client/src  # 由 Z904 覆盖 ✅ (2026-11-15 devin)
  risk: med
- [ ] Z956 回答正文渲染 Markdown：加粗/列表/行内代码/引用/链接（编辑器文案已承诺支持，当前原样输出 `**` 与 `-`）
  verify: grep -q 'react-markdown\|marked' client/package.json
  risk: med
- [x] Z957 推荐/热榜过滤测试数据：服务端排除 `^\[e2e\]`、`^\[assert\]`、`^巡检：` 类标题，推荐流不再由自动化产物占据首屏（当前前 10 条中 8 条为测试问题） ✅ (2026-11-15 devin)
  verify: grep -rq 'e2e' server/routes/questions.js
  risk: med
- [ ] Z958 统一时间显示：7 天内用「x 分钟/小时前」相对时间，更早用 `YYYY-MM-DD`，提问与回答同一格式（当前同页并存 `2026/11/14` 与 `2026/11/15 11:26:05`）
  verify: grep -rq '分钟前\|小时前' client/src
  risk: low
- [x] Z959 详情页补信息层：作者头像+一句话简介、「关注问题」按钮、回答底部收藏/分享栏（对齐 Z903 排版规格） ✅ (2026-11-15 devin)
  verify: grep -q '关注' client/src/pages/Question.tsx
  risk: med
- [ ] Z960 修正未登录引导文案与搜索框可用性：去掉「登录 后」的多余空格；搜索框补放大镜图标、提交按钮与清除按钮
  verify: grep -q '登录后即可回答' client/src/pages/Question.tsx
  risk: low
- [x] Z962 搜索命中话题名：`/api/search?q=编程` 返回空（只匹配标题/摘要，不含所属话题名），是常见搜索意图的漏召回
  verify: node scripts/assert/search-page.mjs
  risk: med
- [ ] Z964 「关注」tab 短路：前端 `tab==="following"` 不发请求直接渲染空列表，已关注问题后仍 0 卡片（API 有数据）
  verify: node scripts/assert/feed-following.mjs
  risk: med
- [ ] Z965 评论可达性：自己的评论无删除入口（后端 DELETE /comments/:id 已可用）；e2e vote-comment 契约要求评论输入框在回答卡内可直接定位（当前需先点「评论」展开）
  verify: node scripts/assert/comment-owner.mjs
  risk: med
- [ ] Z967 移动端与细节：390px 顶部搜索框 width:0 无替代入口；底部导航「首页/热榜」同时 aria-current（`to="/?tab=hot"` 缺 `end`）；404 页把「不存在」当网络故障且无返回入口
  verify: node scripts/assert/mobile-nav.mjs
  risk: low
- [x] Z961 详情页回答分页：`answer_count>5` 时回答只渲染 5 条且无入口，用户新发布的回答刷新即消失（P0） ✅ (2026-11-15 devin)
  verify: node scripts/assert/answer-pagination.mjs
  risk: med
