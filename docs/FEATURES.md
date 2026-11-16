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
- [x] Z954 通知页接真实列表与未读角标：`/notifications` 渲染列表、顶部导航显示未读数，进入后标为已读清零（当前为「后续版本上线」占位页） ✅ (2026-11-15 devin)
  verify: grep -rq '/notifications/unread-count' client/src
  risk: med
- [x] Z955 话题胶囊变为链接：`.tag` 改用 `<Link to="/topic/:id">`，新增话题页（名称+简介+关注+讨论数+内容流，当前点击无任何反应）
  verify: grep -rq '/topic/' client/src  # 由 Z904 覆盖 ✅ (2026-11-15 devin)
  risk: med
- [x] Z956 回答正文渲染 Markdown：加粗/列表/行内代码/引用/链接（编辑器文案已承诺支持，当前原样输出 `**` 与 `-`） ✅ (2026-11-15 devin)
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
- [x] Z964 「关注」tab 短路：前端 `tab==="following"` 不发请求直接渲染空列表，已关注问题后仍 0 卡片（API 有数据） ✅ (2026-11-15 由 Z971 一并修复)
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

## 第四轮巡检待办（2026-11-15 16:40，来源 docs/PRODUCT-REVIEW.md）

- [x] Z970 测试数据治理：抽公共 `isTestContent()`（`assert-`/`搜索验收-`/`巡检`/`[e2e]`）套用到 questions 列表、search、话题流，并清理线上库中的测试问题 ✅ (2026-11-15 devin)
  verify: node scripts/assert/test-content-filter.mjs
  risk: med
- [x] Z971 关注流接真实数据：移除 `Home.tsx` 的 `tab==="following"` 短路，接已关注问题接口（Z964 收尾） ✅ (2026-11-15 devin)
  verify: node scripts/assert/feed-following.mjs
  risk: med
- [ ] Z972 移动端搜索入口：390px 下顶部搜索框 width:0 无替代入口，补放大镜图标/全屏搜索层
  verify: node scripts/assert/mobile-search.mjs
  risk: low
- [ ] Z973 登录回跳与动作续做：所有 `navigate("/login")` 带 `next`，登录后回原页并恢复点赞/关注意图
  verify: node scripts/assert/login-next.mjs
  risk: med
- [ ] Z974 404 页返修：区分「内容不存在」与网络错误，补「回首页/搜索/提问」入口（Z967 收尾）
  verify: node scripts/assert/notfound-page.mjs
  risk: low
- [ ] Z975 评论计数常显：评论区展开后「N 条评论」计数消失，展开态保留数量
  verify: node scripts/assert/comment-count.mjs
  risk: low
- [x] Z977 时间统一：7 天内相对时间、更早 `YYYY-MM-DD`，提问/回答/评论同一格式（Z958 收尾） ✅ (2026-11-15 devin)
  verify: node scripts/assert/time-format.mjs
  risk: low
- [ ] Z978 未登录文案去空格：「登录后即可回答」「登录后参与评论」（Z960 收尾）
  verify: node scripts/assert/login-copy.mjs
  risk: low
- [ ] Z979 底部导航 active 唯一：`?tab=hot` 时仅「热榜」带 `aria-current`（Z967 收尾）
  verify: node scripts/assert/mobile-nav.mjs
  risk: low

## 第五轮巡检待办（2026-11-15 17:35，来源 docs/PRODUCT-REVIEW.md 第五轮）

- [ ] Z976 桌面端通知入口 + 未读角标：顶栏/用户菜单加「通知」，角标读 `unread-count`，进 `/notifications` 后标已读
  verify: node scripts/assert/notify-entry.mjs
  risk: med
- [x] Z980 「发现」「等你来答」真实页面：新增 `/unanswered`（`tab=unanswered`，answer_count=0 的问题流）与话题广场入口，顶栏不得再有指向 `/` 或 `/?tab=hot` 的假链接 ✅ (2026-11-15 devin)
  verify: node scripts/assert/nav-targets.mjs
  risk: med
- [ ] Z981 清理测试作者在真实内容下的回答/评论（`巡检c41o` 之类混入 `/question/1`），并重算 questions.answer_count 保持一致
  verify: node scripts/assert/answer-count-consistency.mjs
  risk: med
- [ ] Z982 种子内容扩充：真实问题仅 60 条、搜索「代码质量」只 1 条命中，按现有 seed-data 结构补到 100+ 真实问题（标题+补充说明+3 回答，不得重复）
  verify: node scripts/assert/seed-volume.mjs
  risk: med

## 第六轮待办（2026-11-15 17:55，来自 Z970/Z971 集成审查与实测）

- [x] Z983 自动化产物自清理：assert/e2e 脚本结束后删除自己创建的问题/回答/账号（本轮清理前生产库 271 题中 211 题、662 账号中 415 个是历史产物；新断言仍在往里灌「关注流链路验证…」这类真实形态标题，过滤规则抓不到） ✅ (2026-11-15 devin)
  verify: node scripts/assert/no-residue.mjs
  risk: med
- [ ] Z984 content-filter 规则收窄 + 性能：裸前缀 `e2e`/`probe`/`review` 与子串 `-mw` 会误杀 `reviewer_zhang` 这类真实昵称，需加分隔符边界（如 `-mw[a-z0-9]{4,}`）；questions 列表每行约 26 个 LIKE + COLLATE NOCASE 且 title 无索引，量级上升前需换标记列
  verify: node scripts/assert/content-filter-precision.mjs
  risk: med
- [x] Z985 计数口径统一：`server/routes/users.js` 的 `stats.questions` 仍是裸 COUNT（其它计数已套 testUserSql），个人页数字与列表不一致 ✅ (2026-11-15 devin)
  verify: node scripts/assert/stats-consistency.mjs
  risk: low

## 第七轮待办（2026-11-15 19:10，来源 docs/PRODUCT-REVIEW.md 第六轮 Playwright 实测）

- [x] Z1001 首页信息流彻底去测试数据 ✅ (2026-11-15 devin)：`is_test` 标记 + 「随机串/`*验证<随机>`」兜底规则，推荐/热榜/等你来答/搜索默认全过滤；清理库中存量造数（实测推荐首屏 20 卡中 13 卡是 e2e 产物，移动首屏 10 条中 8 条）
  verify: node scripts/assert/feed-clean.mjs
  risk: med
- [ ] Z1002 「邀请回答」死按钮：要么接用户搜索 + 邀请记录，要么置灰并给「即将上线」提示（实测点击后 URL/滚动/DOM 全无变化）
  verify: node scripts/assert/invite-answer.mjs
  risk: med
- [x] Z1003 收藏功能落地：`GET /api/collections` 当前 404；回答卡「收藏」点击无任何状态回写。补表/接口 + 「已收藏」态 ✅ (2026-11-15 devin)
  verify: node scripts/assert/collect.mjs
  risk: med
- [ ] Z1004 404 统一组件：真 404 状态码 + 正确归因 + ≥2 出口，覆盖 question/user/topic/route（实测四种表现，其中三种 `main` 内 0 个可点元素且文案写「请检查网络」）
  verify: node scripts/assert/notfound-page.mjs
  risk: low
- [ ] Z1005 移动端搜索入口（Z972 重启）：390px 顶栏放大镜 → 全屏搜索层（连续第三轮无入口）
  verify: node scripts/assert/mobile-search.mjs
  risk: low
- [ ] Z1006 搜索质量兜底：<2 字符或纯标点走空态并提示最少字数（实测 `?q=？` 返回 73 条）
  verify: node scripts/assert/search-guard.mjs
  risk: low
- [x] Z1007 通知条目可区分：事件类型图标 + 内容摘要片段（两条同作者通知文案相同） ✅ (2026-11-15 devin)
  verify: node scripts/assert/notify-detail.mjs
  risk: low
- [ ] Z1008 交互反馈文案：分享后「链接已复制」toast；评论发布按钮改「发布评论」（实测同页两个「发布」，误点会写成新回答）
  verify: node scripts/assert/action-feedback.mjs
  risk: low
- [ ] Z1009 登录/注册表单可访问性：input 补 `label`/`aria-label`/`name`
  verify: node scripts/assert/form-a11y.mjs
  risk: low
- [ ] Z1010 桌面右栏补第二模块（关注的话题 / 等你来答），消除首屏右下 200px+ 空白
  verify: node scripts/assert/right-rail.mjs
  risk: low
- [ ] Z1011 未登录动作回跳：点赞/关注/回答前跳转带 `next`，登录后恢复原意图（旧 P2-1 连续多轮未落地）
  verify: node scripts/assert/login-next.mjs
  risk: med

## 第七轮已合入（2026-11-15 19:35，本轮 devin 车道）

- [x] Z986 断言/巡检自清理真正生效：spawn 用 `process.execPath`、显式传 `DB_PATH`，无 DB 权限时走 `--api` 模式（新增 `POST /api/test-support/cleanup`，requireAuth + 只删 owned/is_test 产物）；`feed-clean` 静态规则改为语义校验（list 与 COUNT 共用 `${where}`） ✅ (2026-11-15 devin)
  verify: node scripts/assert/no-residue.mjs
  risk: med
- [x] Z987 用户公开接口脱敏 + 个人主页内容化：`publicUser` 只出 id/nickname/avatar_url/bio/created_at（email/salt_value/level/is_admin 走 `selfUser`）；`/u/:id` 新增「回答/提问」tab（接 Z985 的 `GET /answers?author=`），统计与列表互证 ✅ (2026-11-15 devin)
  verify: node scripts/assert/user-public.mjs
  risk: med

## 既有断言红灯（非本轮回归，基线 7f81b95 同样失败）

- [x] Z1012 举报接口缺失：`GET /api/admin/reports`、`POST /api/reports` 均 404（reports.mjs / admin-api.mjs 红） ✅ (2026-11-15 devin)
  verify: node scripts/assert/reports.mjs
  risk: med
- [x] Z1013 勋章系统：首个回答后授予 first_answer（另有 first_question/answer_5/upvote_10/first_follower），主页展示徽章 ✅ (2026-11-15 devin)
  verify: node scripts/assert/badges.mjs
  risk: med
- [x] Z1014 盐值/等级：获赞 +2 / 取消 -2（下限 0，自赞不计），level 按盐值分档并随变化更新 ✅ (2026-11-15 devin)
  verify: node scripts/assert/salt.mjs
  risk: low
- [x] Z1015 发帖限速未生效：4 连发全 201（antispam.mjs 红） ✅ (2026-11-15 devin)
  verify: node scripts/assert/antispam.mjs
  risk: med
- [x] Z1016 ci-deploy smoke 未覆盖 votes/comments（smoke-fix.mjs 红） ✅ (2026-11-15 devin)
  verify: node scripts/assert/smoke-fix.mjs
  risk: low
## 第八轮待办（2026-11-15 20:35，来源 docs/PRODUCT-REVIEW.md 第七轮 Playwright 实测）

- [x] Z1017 /ask 编辑器与话题选择 + 回答编辑器预览/草稿持久化 + /admin 后台页 + e2e lib/probe-extra 修复（原 4 条既有 e2e 红灯，基线同样红） ✅ (2026-11-15 devin)
  verify: node scripts/e2e/ask-editor.mjs && node scripts/e2e/answer-editor.mjs && node scripts/e2e/admin.mjs && node scripts/e2e/probe-extra.mjs
  risk: med

- [ ] Z1018 他人主页无「关注」按钮：`/u/:id` 头部只有 回答/提问 两 tab，「关注 N / 粉丝 M」是纯文本不可点，全站无法关注用户（P1）
  verify: node scripts/assert/follow-user.mjs
  risk: med
- [ ] Z1019 通知只覆盖「回答我的问题」：赞同/评论/关注均不产生通知，与空态文案「赞同、评论与关注会出现在这里」不符（P1）
  verify: node scripts/assert/notify-events.mjs
  risk: med
- [ ] Z1020 自己的内容无编辑/删除入口：自己的回答只有 赞同/反对/评论/收藏/分享，自己的评论 0 个按钮（P1）
  verify: node scripts/assert/edit-delete.mjs
  risk: med
- [x] Z1021 收藏后无处查看：收藏夹无页面路由（`/collections/:id` 不存在），个人主页无「收藏」tab，收藏仍半闭环（P0 残留） ✅ (2026-11-15 devin)
  verify: node scripts/assert/collection-page.mjs
  risk: med
- [x] Z1022 热榜与推荐无区分度：热榜卡片无排名色块/热度分/上升标记，样式与推荐流相同（P2） ✅ (2026-11-15 devin)
  verify: node scripts/assert/hot-rank.mjs
  risk: low
- [x] Z1023 未登录点「写回答」完全无反应：无 toast、无跳转，引导文案在 2000px 外视口外（P1，Z1011 收尾） ✅ (2026-11-15 devin)
  verify: node scripts/assert/answer-login-cta.mjs
  risk: low
- [ ] Z1024 404 返回 HTTP 200（软 404）：`/question/999999`、`/u/999999`、`/nonexistent` 均 200，不利监控/SEO（Z1004 收尾）
  verify: node scripts/assert/notfound-status.mjs
  risk: low

## 第九轮待办（2026-11-15 22:0x，来源 docs/PRODUCT-REVIEW.md 第八轮 Playwright 实测）

- [x] Z1025 未读角标进入 `/notifications` 后不清零：实测 unread-count 仍为 2，只有手点「全部标为已读」才清零；进入页面即应把当前列表标为已读并回写角标（Z954 回归） ✅ (2026-11-15 devin)
  verify: node scripts/assert/unread-reset.mjs
  risk: med
- [x] Z1026 「关注」tab 是假的：匿名与 0 关注用户都渲染 20 卡推荐流，三个 tab `aria-selected` 全为 false；应该走真实关注流 + 正确的 selected 态 + 未登录引导 ✅ (2026-11-15 devin)
  verify: node scripts/assert/following-tab.mjs
  risk: med
- [x] Z1027 他人主页「关注」按钮（Z1018 收口）：`/u/:id` 的「关注 N / 粉丝 M」是 `<dt>` 纯文本，全站无法关注用户（follow API 已就绪） ✅ (2026-11-15 devin)
  verify: node scripts/assert/follow-user.mjs
  risk: med
- [x] Z1028 搜索纯标点/短词守卫（Z1006 收口）：实测 `?q=？` 返回 61 条、`?q=a` 19 条，应按「无有效词条」走空态并提示最少字数 ✅ (2026-11-15 devin)
  verify: node scripts/assert/search-guard.mjs
  risk: low
- [ ] Z1029 评论展开后「N 条评论」计数消失（Z975 收口）
  verify: node scripts/assert/comment-count.mjs
  risk: low
- [ ] Z1030 断言质量返修：`scripts/assert/answer-login-cta.mjs` 中 `!/登录 后/` 对基线源码恒真（空断言）；`collection-page.mjs` 注释声称断言 `last_collected_at` 但无对应 expect
  verify: node scripts/assert/answer-login-cta.mjs
  risk: low

## 第十轮待办（2026-11-15 22:5x，来源 docs/PRODUCT-REVIEW.md 第十轮 Playwright 实测）

- [x] Z1031 移动端（390×844）零搜索入口（P0）：顶栏搜索 form/input 宽 0、底栏 5 项无搜索，`?q=` 深链结果页也无可见输入框（只能看结果不能改词）；补放大镜图标 → 全屏搜索层，结果页顶部保留可编辑输入框 ✅ (2026-11-16 devin)
  verify: node scripts/assert/mobile-search-entry.mjs
  risk: med
- [x] Z1032 回答发布后在默认排序里沉底且无提示（P1）：发布 8→9 条、当屏可见，刷新后默认排序 5 条里找不到自己的回答，只有切「最新」才有；发布成功后应乐观置顶或自动切「最新」并提示排序 ✅ (2026-11-16 devin：改为「你的回答」固定条 + `?sort=` 深链，default 仍纯赞数序)
  verify: node scripts/assert/answer-publish-visibility.mjs
  risk: med
- [x] Z1033 内容主权：自己的回答只有 赞同/反对/评论/收藏/分享，自己的评论 0 个按钮（P1，Z1020 收口）：补编辑/删除（含确认与计数回写） ✅ (2026-11-16 devin：PATCH /answers/:id + 回答卡「更多操作」内联编辑/二次确认删除 + 评论行删除，计数回写)
  verify: node scripts/assert/content-ownership.mjs
  risk: med
- [x] Z1034 404 归因与出口（P1，Z1004/Z1024 收口）：`/question/99999999`、`/u/99999999` 文案写「请检查网络」且 main 内 0 个可点元素；`/no-such-xyz` 的「回到首页」不是链接；需真 404 状态码 + ≥2 出口 ✅ (2026-11-16 devin：SPA fallback 按路由表/查库分 200/404，统一 NotFound 页 + 回到首页/去搜索双出口)
  verify: node scripts/assert/notfound-cta.mjs
  risk: low
- [ ] Z1035 未登录「写回答」只弹 toast 不跳转（P1，Z1023 残留）：同页匿名赞同/收藏/关注问题都会跳 `/login?next=`，只有写回答不跳；统一带 next 覆盖所有写操作入口
  verify: node scripts/assert/login-next-coverage.mjs
  risk: low
- [ ] Z1036 同一动作弹两个同文案 toast + 「邀请回答」空按钮（P2）：toast 去重；邀请回答改为真实邀请或置灰并提示
  verify: node scripts/assert/toast-dedupe.mjs
  risk: low

## 第十一轮待办（2026-11-15 23:5x，来源 docs/PRODUCT-REVIEW.md 第十一轮 Playwright 实测）

- [x] Z1037 个人主页空态补下一步入口（P1）：0 回答时正文只有「这个人还没有写过回答。」一句纯文本，main 内除三个 tab 外 0 按钮 0 链接 ✅ (2026-11-16 devin：空态双出口 + tab 以 URL 为唯一真源)
  verify: node scripts/assert/profile-empty-cta.mjs
  risk: low
- [x] Z1038 通知补 comment/agree 事件并带 `#answer-` 锚点（P1）：评论他人回答后对方无新通知；通知行 href 无锚点，点进去落在问题页顶部 ✅ (2026-11-16 devin：comment/agree 事件 + 幂等 + 锚点落点（含补拉分页）+ 软删过滤)
  verify: node scripts/assert/notify-comment-anchor.mjs
  risk: med
- [ ] Z1039 浏览量一次访问 +2 且页面与接口不同步（P2）：接口 6→8，同屏文案显示 7
  verify: node scripts/assert/view-count-once.mjs
  risk: low
- [ ] Z1040 评论发布零反馈（P2）：无 toast，且按钮文本变「收起评论」顶掉计数
  verify: node scripts/assert/comment-feedback.mjs
  risk: low
- [ ] Z1041 结果页内嵌搜索框（P2）：「换个关键词」「取消搜索」都清空关键词退回首页、焦点落 BODY；移动端叠加 Z1031 等于退出即无法再搜
  verify: node scripts/assert/search-inline-input.mjs
  risk: low
- [ ] Z1042 「查看全部 N 个回答」展开后不能收起（P2）：5→10 条后按钮消失，页面长度翻倍
  verify: node scripts/assert/answers-collapse.mjs
  risk: low
- [ ] Z1043 「邀请回答」仍是复制链接（P2）：无弹窗无选择器，toast 只是问题 URL
  verify: node scripts/assert/invite-dialog.mjs
  risk: med

## 第十二轮巡检待办（2026-11-16 01:47，来源 docs/PRODUCT-REVIEW.md 第十二轮 Playwright 实测）

- [x] Z1044 搜索范围与 placeholder 承诺不一致（P1）：顶栏 placeholder 写「搜索问题、回答、用户」，实际只匹配问题标题/摘要/话题名——取回答正文片段「的观点：代码质量的核」搜索返回 0 条 ✅ (2026-11-16 devin：/search 新增 type=answer（正文子串+测试过滤+#answer- 锚点）与 type=user（昵称/bio+关注者/回答数），counts 三 scope 常返回；结果页知乎风文本 tab（问题/回答/用户）由 ?type= 驱动，回答卡/用户行复用 feed 视觉)
  verify: node scripts/assert/search-scope.mjs
  risk: med
- [ ] Z1045 公开内容残留测试评论与空详情问题（P1）：`/question/1` 首答评论区可见「评论回写验证 rv6-…」「评论功能验证 comment-ui-2007」「巡检甲2：…」；推荐流首条问题 `detail_md` 为空仍占首屏
  verify: node scripts/assert/content-residue.mjs
  risk: med
- [ ] Z1046 首页「加载更多」无加载反馈（P2）：点击后 1.7s 内 `[class*=skeleton]` 为 0、按钮无 loading 态，用户无法判断是否点中
  verify: node scripts/assert/loadmore-feedback.mjs
  risk: low
- [ ] Z1047 通知锚点在回答数 >50 的问题上落空且文案误报（P2，Z1038 遗留）：补页上限 5 页(50 条) 后仍找不到就显示「该回答可能已被删除」，但回答实际存在（默认序新回答恒在末尾）
  verify: node scripts/assert/anchor-deep-page.mjs
  risk: med
- [ ] Z1048 NotFound 详情透出原始错误串（P2）：服务异常页正文显示英文 `internal` / `Failed to fetch`，需映射为中文友好文案（Z1034 遗留）
  verify: node scripts/assert/notfound-copy.mjs
  risk: low
- [ ] Z1049 ci-deploy 的 E2E 紧跟 pm2 restart，偶发拿到空白页（P2）：2026-11-16 部署时 `notifications.mjs` 截图整页空白、耗时 19.4s 判 PENDING，随后单独复跑 4/4 PASS——旧 hash 资源被替换的竞态，需在 e2e 前加首屏 warmup 或对首屏失败重试一次（不得放宽断言）
  verify: node scripts/assert/deploy-e2e-warmup.mjs
  risk: low

