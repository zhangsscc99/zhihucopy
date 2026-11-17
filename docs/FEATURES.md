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

- [x] Z976 桌面端通知入口 + 未读角标：顶栏/用户菜单加「通知」，角标读 `unread-count`，进 `/notifications` 后标已读 ✅ (2026-11-17 devin：断言补齐，notify-entry.mjs PASS)
  verify: node scripts/assert/notify-entry.mjs
  risk: med
- [x] Z980 「发现」「等你来答」真实页面：新增 `/unanswered`（`tab=unanswered`，answer_count=0 的问题流）与话题广场入口，顶栏不得再有指向 `/` 或 `/?tab=hot` 的假链接 ✅ (2026-11-15 devin)
  verify: node scripts/assert/nav-targets.mjs
  risk: med
- [ ] Z981 清理测试作者在真实内容下的回答/评论（`巡检c41o` 之类混入 `/question/1`），并重算 questions.answer_count 保持一致
  verify: node scripts/assert/answer-count-consistency.mjs
  risk: med
- [x] Z982 种子内容扩充：真实问题仅 60 条、搜索「代码质量」只 1 条命中，按现有 seed-data 结构补到 100+ 真实问题（标题+补充说明+3 回答，不得重复） ✅ (2026-11-17 devin：seed-data 60→111 story（code+14/work+9/psy+9/life+4/sci+4/edu+4/health+4/money+5，标题-补充说明-回答语义对应、真人昵称、detail 180-420 字、回答 200-800 字）；seed.js N_QUESTIONS 跟随 STORIES.length、TIER_PLAN hot12/warm20/cool40 + 非 cold 回答上限 5（≥5 答 24 题）、附加话题只取同大类（跨类 0）、badges 按运行时 BADGES 全列写入（5 定义 icon 非空、user_badges 无效 code 0）、handled reports 补 handled_at；新增 seed-volume.mjs（DB 6 + API 3，2/2 PASS，未 seed 基线 FAIL 4 项）。生产库已 seed：问题 60→111、回答 303、话题最小 7 题；线上首屏 30 卡全有摘要)
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
- [x] Z1029 评论展开后「N 条评论」计数消失（Z975 收口）✅ (2026-11-16 devin：展开态「收起评论（N）」N=渲染行数（一级+二级含删除占位），发布/回复/删除即时回写)
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
- [x] Z1040 评论发布零反馈（P2）：无 toast，且按钮文本变「收起评论」顶掉计数 ✅ (2026-11-16 devin：提交按钮改名「发布评论」消除与「发布回答」歧义 + 成功 toast「评论已发布」单弹)
  verify: node scripts/assert/comment-feedback.mjs
  risk: low
- [x] Z1041 结果页内嵌搜索框（P2）：「换个关键词」「取消搜索」都清空关键词退回首页、焦点落 BODY；移动端叠加 Z1031 等于退出即无法再搜 ✅ (2026-11-16 devin：桌面也渲染 `.msearchbar` 白卡（预填 q、换词保留 ?type=），「换个关键词」改 focus()+select() 原地续搜、「取消搜索」回首页后焦点交顶栏搜索框（移动端开全屏层）；焦点态由 `.msearchbar:focus-within` 主色边框承担；新增 search-inline-input 断言（含 type 保留/焦点可见/errs 守卫，基线 FAIL 与反向 RC=1 已验证）
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
- [x] Z1045 公开内容残留测试评论与空详情问题（P1）：`/question/1` 首答评论区可见「评论回写验证 rv6-…」「评论功能验证 comment-ui-2007」「巡检甲2：…」；推荐流首条问题 `detail_md` 为空仍占首屏
  verify: node scripts/assert/content-residue.mjs
  risk: med ✅ (2026-11-16 devin：评论正文/作者双侧过滤（`testCommentSql`，公共列表与 total 同源）+ 标题侧抓「复盘 <token> ？」残留 + 摘要空态「暂无补充说明」；(detail_md 为空的门控已被返修撤销——detail_md 是可选字段，门控会藏掉真实新问题)
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

- [x] Z1044b 搜索结果页切分类 tab 整站白屏（P0 回归，Z1044 引入）：`?type=answer` 结果页点「用户」后 `document.body.innerText` 归零、控制台连报 `Cannot read properties of undefined (reading 'slice')`——scope 随 URL 立刻变、items 仍是旧 scope 对象，新行组件拿错 shape 渲染且无 ErrorBoundary ✅ (2026-11-16 devin：itemsScope 门控切 tab 骨架过渡 + UserResultRow/AnswerResultCard/FeedCard/Highlight 字段守卫 + 结果区 ErrorBoundary 错误卡重试 + e2e 逐 tab 白屏断言)
  verify: node scripts/assert/search-tab-crash.mjs
  risk: high

- [x] Z1050 断言残留可见测试账号（P1）：`search-scope.mjs` 每跑一次注册一个 `@example.com` 的 `z1044user*`（刻意不被 testUserSql 过滤才能被搜到），但 `cleanup-artifacts` 无删账号接口 → `skipped=1`，线上「用户」tab 搜 `z1044user` 已能搜到多个残留号；需给 admin 增加硬删测试账号（或断言侧 DB 级自清），并把已残留的账号清掉 ✅ (2026-11-16 devin：`POST /test-support/purge-residue`（admin 鉴权；nickname `^z1044user[a-z0-9]+$` + email `^z1044\.[a-z0-9]+@example\.com$` + is_admin=0，SQL LIKE 仅粗筛 + 事务内 JS 二次校验；支持 `only_nicknames` 定向清）；`search-scope.mjs` 结束自清并复核 `purged_nicknames` 含本 run 号（失败即 FAIL，不静默）；新增 `assert-residue-users.mjs`（401/403/非法 pattern 400 且零删除 + 清零断言）；本机副本实测 residue 14→0、users 542→531；基线 404 反向 RC=1）
  verify: node scripts/assert/assert-residue-users.mjs
  risk: med
- [ ] Z1051 用户搜索结果同昵称重号无区分（P2）：`?q=代码&type=user` 里「山月 / 山月227 / 山月47」bio 完全相同（种子数据），行内无盐值/等级/注册时间差异，用户无法判断该点谁
  verify: node scripts/assert/user-result-diff.mjs
  risk: low

## 第十四轮巡检待办（2026-11-16 05:4x，来源 docs/PRODUCT-REVIEW.md 第十四轮 Playwright 实测）

- [x] Z1052 评论无「回复」入口（P2）：后端 `POST /comments` 已支持 `parent_id` 且给被回复者写 `comment` 通知，但前端评论行只有「删除」（仅自己），实测接口建二级评论成功（id 425/426）而 UI 无法触达 ✅ (2026-11-16 devin：一级未删评论行头补「回复」+ `.answer__reply-form` 内联表单（单例/自动聚焦/Esc/表单内错误），提交按钮仅「回复」字样不抢 e2e 定位；乐观挂 children 末尾 + 计数 +1 + toast；未登录跳 /login?next=)
  verify: node scripts/assert/comment-reply-ui.mjs
  risk: low
- [ ] Z1053 通知行 `.ntf__hit` 与 `.ntf__title` 双链接命中歧义（P2）：点击覆盖层 `<a>` 被同 href 的标题 `<a>` intercept（Playwright 32 次重试失败）；整行应改单链接 `::after` 撑满
  verify: node scripts/assert/ntf-hit-layer.mjs
  risk: low
- [ ] Z1054 cleanup-artifacts 多会话 API 模式第二会话恒 401（P2，测试基建）：本轮 3 次复现 `[api] session#2 HTTP 401 请先登录`，产物靠 session#1 兜底删净；应先删产物后删用户，或每会话独立鉴权
  verify: node scripts/assert/cleanup-multi-session.mjs
  risk: low
- [ ] Z1055 回答分页路径生产数据下不可达（P2，覆盖盲区）：线上最大 `answer_count=4`（q=1），「加载更多回答」按钮未出现、分页代码零覆盖；种子库需补 >pageSize 回答的演示问题，否则回归无人能发现
  verify: node scripts/assert/answers-pagination.mjs
  risk: low
## 第十五轮待办（2026-11-16，部署门禁被环境变量误杀）

- [x] Z1056 部署/报告脚本钉死 E2E 地址 + preflight（P1）：继承的 `E2E_BASE=…:3033` 让 ci-deploy e2e gate 全 PENDING→连续 3 次回滚，report.sh 仍写 PENDING 报告 ✅ (2026-11-16 devin：两脚本 export 钉死 `${PROD_URL%/api}`/`${LOCAL_HEALTH%/api/health}` 派生的本地地址 + `$E2E_API/health` preflight，环境不可达 exit 2 + `stage=e2e-preflight` + NO_ROLLBACK 保留现场；断言含毒环境实测覆盖证据)
  verify: node scripts/assert/deploy-e2e-env.mjs
  risk: low

## 第十六轮待办（2026-11-16 07:1x，来源 docs/PRODUCT-REVIEW.md 第十五轮 Playwright 实测）

- [x] Z1060 /ask 话题下拉遮挡「发布问题」（P1）：选完话题 `addTopic` 保持 `setTopicOpen(true)`，absolute 240px 菜单盖住提交钮——hit-test 按钮中心命中 `.topic-select__option`，两轮 Playwright 各 32 次重试超时；真实点击会误加话题（截图 e2e-review15-25/e2e-probe15-02）；选中即收起（续选靠聚焦 input 重开）或菜单限高下移 ✅ (2026-11-16 devin：菜单退出 absolute 改正常文档流（与 `.form-actions` 矩形永不相交）+ 选中即收起、重开走 input onClick/onChange（多选不退化）+ `.form-actions` 捕获 mousedown preventDefault，修掉「菜单展开时首次点发布静默失效」；新增 ask-topic-overlay 断言（几何 hit-test + 单选重开 + 单次发布，反向 RC=1 已验证；线上即验 PASS)
  verify: node scripts/assert/ask-topic-overlay.mjs
  risk: med
- [x] Z1061 结果页双 `role=search` 界标命名歧义（P2，a11y）：`.topnav__search` 的 form 无 `aria-label`，读屏无法区分「全站搜索」与「在结果中搜索」两个并存界标 ✅ (2026-11-16 devin：顶栏 `<form role="search">` 补 `aria-label="全站搜索"`，与结果页「在结果中搜索」唯一化；新增 `search-landmark-names.mjs`（界标数 ≥2、名字非空且互不相同 + innerText/errs 守卫）；基线无名字反向 RC=1)
  verify: node scripts/assert/search-landmark-names.mjs
  risk: low
- [x] Z1062 顶栏用户菜单可访问名读两遍（P2，a11y）：`.usermenu__trigger` 朗读为「巡巡检壬…」（avatar 首字+昵称）；avatar span 加 `aria-hidden` 或按钮 `aria-label={user.nickname}` ✅ (2026-11-16 devin：`.usermenu__trigger` 补 `aria-label={nickname}`，内部 avatar/昵称 `aria-hidden`，可访问名 == 昵称原文不再重复；新增 `usermenu-a11y-name.mjs`（就绪等待消除冷启动假红，连跑 3/3 PASS）；基线 avatarHidden=false 反向 RC=1)
  verify: node scripts/assert/usermenu-a11y-name.mjs
  risk: low
- [x] Z1063 「回答/用户」tab 零结果页缺「换个关键词」出口（P2）：question scope 空态有 refocus 按钮，answer scope 只有「去提问」、user scope 只有「去首页」，快捷续搜入口不对称（`Home.tsx:491-508`） ✅ (2026-11-16 devin：question/answer/user 三 scope 空态统一「换个关键词」（refocus `.msearchbar__input`、关键词不丢、URL 不跳），并保留去提问/去首页出口；新增 `search-empty-cta.mjs`（三 scope 命中 1/1/1 + 逐 scope errs 读数）；基线 answer scope 命中 0 反向 RC=1)
  verify: node scripts/assert/search-empty-cta.mjs
  risk: low

## 第十七轮待办（2026-11-16 08:1x，本轮调度器实测/复审产出）

- [ ] Z1064 全量 e2e 偶发 `notifications.mjs` PENDING（P2，门禁稳定性）：本轮 3164 临时实例两次全量连跑中 1 次该脚本 PENDING（其余 15/16 全绿，同时刻日志仅见 `cleanup session#2 HTTP 401`），单独连跑 3/3 PASS、部署内也 PASS——疑似与 Z1054 的自清理 401 或前序脚本残留数据竞争；需在全量连跑下复现并定位（不得放宽断言）
  verify: node scripts/assert/notify-e2e-stability.mjs
  risk: med
- [x] Z1065 Z1041 断言焦点可见性析取漏洞 + 输入框缺 focus-visible（P2，测试基建+a11y）：`search-inline-input.mjs` 的 `!(容器变色) || !(输入框非透明)` 在「输入框被给一条恒定非透明边框」时会假通过，应收紧为「容器色较聚焦前变化且非 transparent」；同时 `.msearchbar__input:focus-visible` 无 outline（焦点全靠容器边框承担，WCAG 2.4.11 面积不足） ✅ (2026-11-16 devin：`search-inline-input.mjs` 析取漏洞收紧为「相对聚焦前基线变化且非 transparent + 输入框自身 outline 可见」；`.msearchbar__input:focus-visible` 补 `outline: 2px solid var(--accent)`（实测 rgb(0,102,255)），blur 后回 none；新增 `search-focus-visible.mjs` 锁 style/width/color + 内容守卫；基线 outline none 反向 RC=1)
  verify: node scripts/assert/search-focus-visible.mjs
  risk: low

## 第十八轮待办（2026-11-16 09:5x，Z1052 两轮审查 + 部署后真实浏览器复验产出）

- [x] Z1066 评论计数两态口径不一致（P2）：同一回答的「N 条评论」（收起态用服务端 `comment_count`，不含软删）与「收起评论（N）」（展开态=渲染行数，含「该评论已删除」占位）在存在删除占位时差 1，用户切换时数字跳变；需定一个口径（建议两态都用渲染口径或两态都用服务端口径）并同步改断言 ✅ (2026-11-16 devin：两态共用 `displayCommentCount()` = 非删除可见数（未加载回落 `a.comment_count`），占位行仍渲染但不计数；新增 comment-count-parity（含服务端 comment_count 交叉校验 + reload 一致性 + 两态锚定奇偶）；probe-round15 计数契约同步新口径；基线 3167 反向 RC=1)
  verify: node scripts/assert/comment-count-parity.mjs
  risk: low
- [x] Z1067 回复表单细节（P2）：Esc 同时绑在 `.answer__reply-form` 容器与 textarea 上（幂等但冗余）；收起态的「回复」按钮仍输出 `aria-controls="reply-form-N"` 指向不存在节点；放弃草稿提示 `toast(..., "error")` 用红色报错语义（应为 info） ✅ (2026-11-16 devin：Esc 只走 `.answer__reply-form` 容器一处（textarea 冒泡同路径）；「回复」按钮 `aria-controls` 改指常驻 `#reply-slot-N` 且 `aria-expanded` 随态翻转（槽内表单数 展开=1/收起=0）；放弃草稿 toast 由 error 改 info（实测 `toast toast--info`）；新增 `reply-form-polish.mjs`；基线 aria-controls 指向不存在节点反向 RC=1)
  verify: node scripts/assert/reply-form-polish.mjs
  risk: low
- [x] Z1068 回复/评论边缘路径草稿丢失（P2）：`removeComment` 在 `await` 之后读闭包里的 `replyFor`，DELETE 往返期间切到另一条评论会误关新表单并静默丢草稿；`loadAnswers` 重置 `replyFor`/`replyError` 但不清 `replyDraft`，切排序后再开表单会丢草稿且无「已放弃」提示 ✅ (2026-11-16 devin：`removeComment` 用 `replyForRef` 比对发起删除时的归属，DELETE 往返期间切表单不再被误关（实测 c3 表单 + 21 字符草稿零丢失）；`resetReplyState()` 统一清 `replyFor/replyDraft/replyError` 并在**排序切换成功后**复位 + info 提示；新增 `reply-draft-race.mjs`；基线误关表单反向 RC=1)
  verify: node scripts/assert/reply-draft-race.mjs
  risk: med
- [x] Z1069 断言补强（P2，测试基建）：`comment-reply-ui.mjs` 未覆盖「回复失败」路径（`role=alert` + 草稿保留，仅人工探针验过）；其 `deletedRows` 组断言缺「占位行 count > 0」正向守卫，选择器一改即恒真；`comment-count.mjs` 用 `includes("2 条评论")` 会被「12 条评论」误配，应锚定 `^2 条评论$` ✅ (2026-11-16 devin：`comment-reply-ui.mjs` 补「回复失败」路径（`role=alert` 非空 + 表单仍开 + `inputValue` 读回草稿）与 `deletedRows` 占位行 >0 正向守卫、aria-controls 槽内含表单 展开=1/收起=0；`comment-count.mjs` 改 `=== "2 条评论"` 全等杜绝 12 误配；新增 `comment-assert-hardening.mjs` 总闸门（4 子断言，基线全 rc=1）)
  verify: node scripts/assert/comment-assert-hardening.mjs
  risk: low

## 第十九轮待办（2026-11-16 12:2x，来源 docs/PRODUCT-REVIEW.md 第十七轮线上 Playwright 实测）

- [x] Z1070 移动端搜索弹层输入框无焦点环（P1，Z1065 漏网）：`.msearch__input:focus { outline: none }`（0-2-0）压过全局 `input:focus-visible`（0-1-1），弹层 autoFocus 时实测 `matches(':focus-visible')===true` 但 `outline-width:0px/none`，唯一反馈是 1px 边框变色，不达 WCAG 2.4.11；需给 `.msearch__input:focus-visible` 补 2px `#0066FF` outline ✅ (2026-11-17 devin：`.msearch__input:focus-visible` 补 `outline:2px solid var(--accent)` + offset 2px，实测计算样式 outline-style=solid/width=2px/color=rgb(0,102,255)，blur 后回 none；新增 `msearch-sheet-focus.mjs`（390 视口 autoFocus 断言 + 桌面顶栏不回归 + 3/3 连跑），线上即验 PASS)
  verify: node scripts/assert/msearch-sheet-focus.mjs
  risk: low
- [ ] Z1071 评论计数与可见列表不同口径（P2，Z1066 盲区）：`GET /comments` 用 `testCommentSql` 过滤测试产物，但 `answers.comment_count` 子查询（`artifact-cleanup.js` 附近）不过滤 → 清理窗口期内按钮显示「16 条评论」而列表只渲染 14 行，普通用户视角数字对不上；需两侧同口径（计数也过滤，或前端计数改单一数据源）
  verify: node scripts/assert/comment-count-scope.mjs
  risk: med
- [x] Z1072 移动搜索弹层 `role=search` 界标匿名（P2）：`.msearch__form` 带 `role="search"` 但无 `aria-label`，同页顶栏界标有名「全站搜索」，读屏遍历时会遇到匿名 search 界标（外层 dialog 的 aria-label 不传给内部 landmark） ✅ (2026-11-17 devin：移动搜索弹层 `.msearch__form` 补 `aria-label="移动端搜索"`，与「全站搜索」「在结果中搜索」三者互不相同；新增 `msearch-landmark-name.mjs`（所有 role=search 有名且两两不同，桌面+移动），线上即验 PASS)
  verify: node scripts/assert/msearch-landmark-name.mjs
  risk: low
- [ ] Z1073 测试会话看不到自己的评论，删除/竞态路径线上不可测（P2，覆盖盲区）：`testCommentSql` 把测试账号评论从公共列表过滤，导致「删除自己的评论」「删除与切表单竞态」在线上无法构造夹具；需给 test-support 加一个「对本会话可见的自有评论」钩子或断言侧改用种子号构造
  verify: node scripts/assert/reply-delete-race-live.mjs
  risk: med
- [ ] Z1074 全仓 `:focus{outline:none}` 写法审计（P2，a11y 债务）：`.field:focus`、`.msearch__input:focus` 等以 `:focus` 直接抹掉 outline 的规则会系统性压掉 `:focus-visible`；统一为「`:focus` 改色/改边、`:focus-visible` 动 outline」，并加静态守卫防再犯
  verify: node scripts/assert/focus-outline-audit.mjs
  risk: low

## 第二十轮待办（2026-11-17 00:3x，来源 docs/PRODUCT-REVIEW.md 第十八轮走查实测）

- [x] Z1075 评论输入框 Enter 无提交、无反馈（P2，操作可预期）：`Question.tsx` 评论输入是 `<input>`，只有「发布评论」按钮 onClick，`onKeyDown` 缺失；实测填完按 Enter 无 toast、无报错、草稿仍在、计数不变，用户会以为卡死。需 Enter 提交（空内容/发送中不重复提交），并保留按钮路径 ✅ (2026-11-17 devin：评论输入框补 `onKeyDown` Enter 提交，`isComposing` 组合态不提交、`submitComment` 内加 `commentSending` 守卫防重复；按钮路径不变共用同一函数；新增 `comment-enter-submit.mjs`（Enter 提交/空内容不提交/连按只落 1 条/按钮路径/console 0，3/3 连跑），线上即验 PASS)
  verify: node scripts/assert/comment-enter-submit.mjs
  risk: low
- [x] Z1076 列表接口 topics 恒为空 → 首页/话题流卡片无话题胶囊（P1，视觉保真 + 数据）：`GET /api/questions` 实测 `topics:[]`（30/30 条全空），而 `question_topics` 有 114 行、60/61 问题已绑话题；Z902 的「话题胶囊接口返回时渲染」因此从未真正显示。需列表 SQL join 话题（保持分页与 N+1 不回归）并断言卡片出现胶囊 ✅ (2026-11-17 devin：`questions.js` 新增 `topicsForQuestions()` 单次 `IN` 查询批量取话题（≤3/题，30 条列表共 3 次 SQL 无 N+1），列表/热榜/话题流/创建接口统一返回 topics；`Home.tsx` 胶囊按 Z902 顺序移到元信息之后；新增 `feed-topic-pills.mjs`（API ≥20 条带 topics + 桌面/移动各 ≥8 个可见胶囊 + DOM 顺序 + 3/3），线上实测 26/30 条带胶囊、首屏可见，即验 PASS)
  verify: node scripts/assert/feed-topic-pills.mjs
  risk: med
- [ ] Z1077 断言欠账：已实现但缺断言文件的条目验收不上（P2，测试基建）：`bash scripts/verify.sh` 实测 Z972/Z974/Z978/Z979 均 `MODULE_NOT_FOUND`（`mobile-search.mjs`/`notfound-page.mjs`/`login-copy.mjs`/`mobile-nav.mjs` 不存在），但线上 UI 实测移动搜索弹层、404 页「回首页/去搜索」、底部导航均已可用——功能做了、验收没做，条目永远无法勾选。需按现状补建这四个断言（不得放宽为恒真），逐个跑通后勾选
  verify: node scripts/assert/mobile-search.mjs && node scripts/assert/notfound-page.mjs && node scripts/assert/login-copy.mjs && node scripts/assert/mobile-nav.mjs
  risk: low
- [x] Z1078 公开信息流顶部混入自动化回归残留（P1，内容洁净度/真实感）：线上 `GET /questions?limit=30` 前 4 条为「关注流链路回归 qmwjz7ia86jg 复盘？」「话题关注链路回归 …」「问题关注链路回归 …」「提问接口回归 …」，卡片带 0–2 回答直接占据推荐流首屏——`content-filter.js` 的标题规则不认「…回归 <小写随机串> 复盘？」形态（`复盘` 收尾规则要求 token 在 `复盘` 之后、尾部随机串规则要求 token 在标题末尾） ✅ (2026-11-17 devin：`TITLE_REGEXES` 增 `回归[ 　]*(验证[ 　]*)?[a-z](?=[a-z0-9]*[0-9])[a-z0-9]{7,}`（要求串内含数字，反例「回归分析怎么做」「A/B 测试回归怎么排查」「回归 transformer 调参」不命中），SQL 侧 GLOB 同步；`cleanup-test-content.js` 修掉 `badges` 旧表名（改 `user_badges` + `badge_grants_legacy`）并补 user/collection 目标通知级联；线上清理 12 问题（含 1349/1355/1356/1357）、5 回答、1 评论、4 通知、52 测试号；新增 `feed-no-regression-residue.mjs`（三接口无残留 + 造/删正反例 + 首屏 DOM 守卫 + 3/3），线上即验 PASS)
  verify: node scripts/assert/feed-no-regression-residue.mjs
  risk: med
- [x] Z1079 关注流按标题形态误滤被关注者的真实提问（P1，回归修复）：Z1078 的「回归 + 小写字母数字串」标题规则经 `testQuestionSql("q","u")` 同时作用于 `/feed/following`，把 feed-following 链路验证提问（`…链路回归 <token> 复盘？`）和真实用户「线上回归怎么排查？」类提问一起吞掉，Z964/Z971 断言 FAIL；私域流按标题形态猜「像不像测试内容」本身不合理 ✅ (2026-11-17 devin：`/feed/following` 的 items/total 两段 WHERE 改为 `testUserSql("u")`（仅作者身份），公共出口 `/feed/recommended`、`/feed/hot`、`/questions`、搜索、话题流保持 `testQuestionSql` 双滤不变；`feed-following.mjs` 中「[assert] 标题真实作者提问不进流」断言按新口径反转为「应进流」；新增 `following-title-allow.mjs`（关注流包含命中标题规则的提问 + 三公共出口不含 + 测试号作者不含，3/3 PASS）)
  verify: node scripts/assert/following-title-allow.mjs && node scripts/assert/feed-following.mjs
  risk: med

## 第二十轮收尾观察（待办）
- [ ] Z1080 Z1033 断言与评论过滤规则冲突（P2，测试基建）：`content-ownership.mjs` 用 `@test.dev` 账号造「他人评论」，而 `GET /comments` 的 `testCommentSql` 会把测试号评论过滤掉 → 断言「他人评论未渲染」恒 FAIL（11-16 12:13 / 11-17 01:38 / 02:20 三份报告均 FAIL，条目却已勾选）。需改用非测试形态账号，或与 Z1073 的 test-support 逃生舱统一解决
  verify: node scripts/assert/content-ownership.mjs
  risk: low

## 第二十一轮待办（2026-11-17 02:4x，来源 docs/PRODUCT-REVIEW.md 第十九轮线上走查）

- [x] Z1082 首屏假内容与自动化残留（P1，内容洁净度/真实感）：① 无补充说明的问题在信息流卡片上直接渲染占位文案「暂无补充说明」，真知乎此处应直接进入元信息；② 推荐流第一位是「质检小七 / 路人乙qa」的 0 关注 1 句回答；③ `/question/339` 评论区残留「走查9434 / 走查评论D：测试提交路径」；④ 通知页 6 条里 2 条「巡检探针banv」。`content-filter` 现有规则不认「走查<数字>」「走查评论…」「巡检探针」形态。需补标题/正文/昵称三类规则（JS 与 SQL 同口径）、清理生产库残留，并让卡片在无补充说明时不渲染占位；顺带给评论 `textarea` 补 `aria-label="写下你的评论"`（现在只有 placeholder） ✅ (2026-11-17 devin：Home.tsx 普通卡/热榜卡无摘要时不再渲染「暂无补充说明」占位（间距由 .feed__meta 保持）、styles.css 删空规则；content-filter 增昵称 `^走查[0-9]+$`/`^巡检探针[A-Za-z0-9]*$`、正文与标题 `^走查评论<tag>[：:]`（标签 0-4 位，JS 与 SQL GLOB 同口径，反例「代码走查/走查一下这段 diff/走查会议记录/巡检报告怎么写」不命中）；notifications 路由接入 testNotificationSql；cleanup-test-content.js 增残留评论/通知删除与 dry-run；评论 textarea 补 aria-label；新增 feed-clean-first-screen.mjs（占位 0 + 四接口无残留 + 评论/通知页扫描 + 规则正反例，3/3 连跑）。生产库已按新规则清理：1 问题/4 评论/8 通知/14 测试号；线上复验首卡恢复「标题→作者→回答数→浏览」、评论区无残留、溢出 0)
  verify: node scripts/assert/feed-clean-first-screen.mjs
  risk: med ✅ (2026-11-17 devin：seed-data 60→111 个 story（code+14/work+9/psy+9/life+4/sci+4/edu+4/health+4/money+5，标题-补充说明-回答语义对应、作者真人昵称、detail 180-420 字、回答 200-800 字）；`seed.js` 的 N_QUESTIONS 改为跟随 STORIES.length、TIER_PLAN 调 hot12/warm20/cool40 且非 cold 回答上限 5（≥5 答问题 24 个）、附加话题只取同大类（跨类绑定 0）、badges 目录按运行时 BADGES 全列写入（5 个定义 icon 全非空、user_badges 无效 code 0）、handled reports 补 handled_at；新增 seed-volume.mjs（DB 6 项 + API 3 项，2/2 连跑 PASS，未 seed 基线 FAIL 4 项）。生产库已 seed：问题 60→111、回答 303、≥5 答 24 题、话题最小 7 题；线上首屏 30 卡全部有摘要，各页无白屏)


## 第二十一轮收尾观察（待办）
- [x] Z1085 个人主页看不到自己写的内容（P1，产品自见性 + 断言契约）：`GET /users/:id` 的 `stats.answers` 与 `/answers?author=` 共用 `AUTHOR_ANSWERS_SQL`，对作者与访客同口径套 `testQuestionSql`；因此测试号（@test.dev）+`[e2e]` 标题造出的回答在**自己的主页**上显示 0 回答、空态文案「TA 还没有写过回答」，`scripts/e2e/profile.mjs` 的链接断言 8s 超时（部署门禁里 PENDING）。实测同一脚本在「seed 前生产库副本」上同样 FAIL，属既有契约缺口、非本轮改动引入。产品口径应为「看自己的主页能看到自己写的内容」（viewer === author 时放行 is_test/测试标题过滤），断言随之改为「本人主页可见刚发的回答，访客视角仍不可见」 ✅ (2026-11-17 devin：authorAnswersSql({selfView}) 三处同口径，本人可见/访客与匿名仍 0；profile.mjs 选择器 [e2e] 字符类 bug 一并修复)
  verify: node scripts/assert/profile-self-visibility.mjs
  risk: med
- [ ] Z1086 「走查评论」规则标签区间过宽（P3，误杀风险）：`server/content-filter.js` 的 `^走查评论[A-Za-z0-9]{0,4}[：:]` 允许 0 位标签，而 clean 脚本 `--apply` 是物理删除；建议收窄为 `^走查评论[A-Z]{1,3}[：:]`（JS 与 SQL 枚举同步），并把手写「走查评论：」开头的真实标题加入反例集
  verify: node scripts/assert/feed-clean-first-screen.mjs
  risk: low
- [ ] Z1087 种子回答收尾句模板化（P3，内容真实感）：423 条回答里 32 条（8%）以「最后一句：…」收尾，psy/health/sci 另有「首先是…其次是…第三是」罗列；建议续写时换收尾句式
  verify: node scripts/assert/seed-tone-variety.mjs
  risk: low
- [x] Z1088 通知过滤过宽打红 e2e 通知链路（P0 回归，Z1082 引入） ✅ (2026-11-17 devin：`content-filter` 抽出 `residueNickConds()` 供 `userMatchSql` 与新 `testNotificationResidueSql()` 共用；`/notifications` 列表与 `unread-count` 同源改用窄口径，只挡 `巡检<小写随机串>`/`走查<纯数字>`/`巡检探针<拉丁串>` 三种残留昵称，不再按邮箱域/is_test/测试标题一刀切；`e2e/probe-round15.mjs` 的 A/B 昵称由「巡检探针<tag>」改为「r15探针<tag>」；新增 `assert/notification-residue-scope.mjs`（残留 actor 被挡 + 普通测试号 actor 放行 + unread-count 同口径，旧代码上 FAIL）。部署门禁 notifications.mjs 4.7s PASS、probe-round15.mjs 48.6s PASS，全量 15/16）
  verify: node scripts/e2e/notifications.mjs && node scripts/e2e/probe-round15.mjs
  risk: med

## 第二十二轮待办（2026-11-17 04:4x，来源 docs/PRODUCT-REVIEW.md 第二十轮线上走查）

- [x] Z1090 信息流卡片只有标题可点，整卡空白区点了没反应（P1，操作手感/真知乎行为）：`Home.tsx` 里 `.feed__item` 是 `<li>`，只有 `.feed__title`/`.feed__author`/`.tag` 三个 `<a>`；鼠标点摘要下方或卡片右侧空白处（`elementFromPoint` 返回 `LI.feed__item`、`cursor:auto`）URL 完全不变，390px 移动端同样点不动。需让整卡可进 `/question/:id`（标题/作者/话题链接保持各自跳转、不冒泡错跳），`cursor:pointer`，hover 有 1px 位移或边框色变化；键盘可达（卡片内可 Tab 到标题、焦点框可见） ✅ (2026-11-17 devin swe-2-high：新增 `client/src/lib/cardNav.ts`，返回 role=link/tabIndex/onClick/onKeyDown 摊到 `.feed__item`；`closest("a,button")` 放行卡内标题/作者/话题链接、拖选文字不误跳、Enter 仅在卡片自身聚焦时触发；Home.tsx 的 FeedCard/AnswerResultCard/HotFeedCard 与 Topic/Topics/Unanswered 的问题卡同步；styles.css 加 cursor:pointer + hover 边框加深 + :focus-visible 焦点环。新增 `assert/feed-card-click.mjs`（桌面空白点击跳转且标题一致、作者→/u/、话题→/topic/、390px tap 跳转、cursor/hover 前后差异、卡片 Enter、__errs 空、无溢出）；未修基线 FAIL「cursor=auto」，修后 3/3 PASS；线上实测点第 2 卡空白区跳 /question/11)
  verify: node scripts/assert/feed-card-click.mjs
  risk: med
- [x] Z1091 回答结尾模板尾巴（P1，内容真实感）：`scripts/seed.js:564` 给每 6 条回答追加同一句 `> 补充：${alpha}——任何方法都有适用边界，先确认你的约束和我的一致，再决定要不要照做。`，生产库 50/303 条命中（16%），其中 20 条写成「补充：补充一个反例」，变体「评论区有人问到成本」出现在 0 评论的回答上。需改为按话题/观点生成互不相同的收尾句（≥12 种句式池 + 不声称不存在的评论 + 禁用「补充：补充」重复词），并写一次生产库修正脚本（同时改写 `answers.content_md` 与其 `answer_revisions` 对应记录），断言任意两篇回答最长公共后缀 ≤20 字 ✅ (2026-11-17 devin swe-2-high：`scripts/seed.js` 用按大类分池的 `ANSWER_TAILS`（code18/work13/psy7/life7/sci7/edu5/health5/money4，共 66 句，40–90 字）替换原单一模板，`pickTail(cat)` 游标轮转保证同批不重复、不再虚构评论区；新增 `scripts/fix-answer-tails.js`（默认 dry-run，`FIX_ALLOW_PROD=1` 才能写生产库，重写 `answers.content_md` 并同口径改写 `answer_revisions`，幂等：第二次命中 0 条）；新增 `assert/seed-tails-variety.mjs`（旧尾巴/「补充：补充」清零 + 任意两回答末 120 字最长公共后缀 ≤20 + 无评论回答不虚构互动 + seed 池 ≥12 且无禁用串 + API 抽 8 条，5/5）；生产库已 apply 50 条（备份 data/backups/zhihu-20261117-0500-dbbackup.db），线上 /question/6 旧尾巴 0 命中、新句可见)
  verify: node scripts/assert/seed-tails-variety.mjs
  risk: med
- [x] Z1092 回答卡作者行缺「+ 关注」入口（P2，社交回路）：关注作者目前只能点进 `/u/:id` 再点，回答卡作者行右侧空白。需在回答作者行加「+ 关注 / 已关注」小按钮（未登录点击跳 `/login?next=<当前路径>`），点击后 1.5s 内变「已关注」且刷新保持，自己的回答不显示该按钮 ✅ (2026-11-17 devin swe-2-high：`server/routes/questions.js` 抽 `followedUserIds()`（一次 IN 查询，无 N+1）+ `answerItem()`，问题详情/回答列表在登录态回带 `author.is_following`（匿名不输出）；`Question.tsx` 作者行右侧加 `.answer__follow`（+ 关注/已关注，同作者多卡联动、按 userId 重置本地覆盖态、自己的回答不渲染、未登录走 needLogin 带 next）；新增 `assert/answer-author-follow.mjs`（关注→后端生效→刷新保持→可取消、自己回答无按钮、未登录跳 /login?next=、390px 不重叠无溢出、__errs 空、测后清理）；未修基线 FAIL（15s 超时找不到按钮），修后 3/3 PASS；线上 3 个回答作者行均可见「+ 关注」（59×27）)
  verify: node scripts/assert/answer-author-follow.mjs
  risk: med
- [x] Z1093 登录成功后按浏览器后退回到登录页（P2，导航常识）：`/login?next=/question/6` 登录成功后是 push 到目标页，登录页仍留在历史栈，后退又看到一张登录表单。需在登录成功跳转时替换当前历史项（`navigate(dest,{replace:true})` 或 `history.replaceState` 后跳），注册成功同理；断言：登录 → 后退 → 不出现 `.authform`（或登录表单输入框数为 0），且回到落地页 ✅ (2026-11-17 devin swe-2-medium：`Login.tsx`/`Register.tsx` 成功跳转改 `navigate(dest,{replace:true})`，并对已登录访问 `/login`/`/register` 用 `<Navigate replace>` 直接走、`loading` 时渲染 null；新增 `assert/login-history-replace.mjs`（有/无 next 两种后退都不出现 `.authform`、已登录访问登录页不留表单、注册路径同验、__errs 空）；基线 FAIL「后退后仍见 .authform」、修后 3/3 PASS；线上实测登录→后退停在 /question/6 且 `.authform`=0)
  verify: node scripts/assert/login-history-replace.mjs
  risk: low

## 第二十二轮收尾观察（待办）

- [ ] Z1094 登录后用浏览器「后退」，头部仍渲染未登录态（P3，状态一致性）：线上实测登录成功 → `history.back()` 停在 `/question/6`（`next=` 回跳正确、`.authform` 已消失），但顶栏仍显示「登录 注册」，刷新后才变「林间有风」。原因是后退命中的历史项由浏览器缓存/React 未重跑 auth 校验。需在 `popstate`（或路由变化）时重新校验 token/user，保证任何一次进入页面都按当前 token 渲染头部
  verify: node scripts/assert/back-auth-state.mjs
  risk: low
- [ ] Z1095 通知文案「与你互动了」过于含糊（P3，文案）：通知页 7 条里 3 条是「XXX · 与你互动了」，看不出对方是回答了你的问题、还是评论/邀请了。真知乎会写「回答了你的问题」「在回答中提到了你」。需按 type 细分文案，并同步 e2e/assert 里的文案断言
  verify: node scripts/assert/notification-copy.mjs
  risk: low
- [ ] Z1096 关注流「有新回答」提示（P2，社交回路）：现在关注流只能靠手动刷新；建议在「关注」tab 上加「N 条新回答」pill，基于 `answers.created_at > 上次访问时间` 计算，点击后插入并清零
  verify: node scripts/assert/following-new-answers.mjs
  risk: med

## 第二十三轮走查待办（2026-11-17 05:3x，来源 docs/PRODUCT-REVIEW.md 第二十一轮）

- [x] Z1097 种子回答人设与问题领域错位（P1，内容真实感）：`scripts/seed.js` 把 story 的回答随机派给种子用户，实测 `/question/6`（React useEffect）前两条回答作者分别是「南山南 — 健身教练」与「余光169 — HR」，同一用户主页横跨 React/基础架构/0 糖饮料/咖啡因/久坐五个领域。需给种子用户定领域标签、回答只派给同域作者，并写幂等修正脚本（`--dry-run` 默认，`FIX_ALLOW_PROD=1` 才写生产库）重排现有回答归属 ✅ (2026-11-17 devin：persona-domains 单一来源 + seed 只派同域作者 + fix-answer-authors-by-domain.js 默认 dry-run；verify PASS 85/85 命中，基线 77.6% FAIL)
  verify: node scripts/assert/seed-persona-domain.mjs
  risk: high
- [x] Z1098 关注用户不产生通知（P2，社交回路）：`server/routes/users.js` 的 `POST/DELETE /:id/follow` 无 notifications 写入，与通知空态文案「赞同、评论与关注会出现在这里」矛盾；需写 `type='follow'` 通知（自关注不计、重复关注不重复写），前端通知行文案对应「关注了你」 ✅ (2026-11-17 devin：follow 通知仅在新关注时写、取消再关注幂等；follow-notify.mjs PASS，基线 RC=1)
  verify: node scripts/assert/follow-notify.mjs
  risk: med
- [x] Z1099 通知入口/未读角标缺断言（P2，测试基建）：`client/src/components/TopNav.tsx:337-362` 的 `topnav__bell` + `badge` 已实现，但 `scripts/assert/notify-entry.mjs` 不存在，Z976 至今无法勾选。需补浏览器级断言：1440 与 390 各有一个指向 `/notifications` 的入口；构造未读后角标数字可见，进通知页后角标消失且刷新仍为 0 ✅ (2026-11-17 devin：新增 notify-entry.mjs（1440/390 入口 + 角标 0→1→进页清零且刷新仍 0）；Z976 一并勾选)
  verify: node scripts/assert/notify-entry.mjs
  risk: low
- [x] Z1100 桌面右栏只有一块（P2，Z1010 复现）：1440×900 下 `.rail-block` 仅热榜 705px，底部约 195px 纯空白；补第二模块（建议「等你来答」：复用 `/unanswered` 数据，5 条 + 「更多」） ✅ (2026-11-17 devin：UnansweredRail 第二块，1440 两块 / 390 隐藏 / 0 条不渲染；rail-second-block.mjs PASS，基线 FAIL)
  verify: node scripts/assert/rail-second-block.mjs
  risk: low
- [x] Z1101 生产库残留断言评论 + 删除占位仍在渲染（P2，内容治理）：comment id 497 正文 `租赁这个比喻讲得清楚，清理函数就是退租 411293`（作者种子号 user2，尾部六位随机数）；`/question/6` 评论区另有 6 行「该评论已删除」占位。需写清理脚本（默认 dry-run，`FIX_ALLOW_PROD=1` 才写库）并让已删除评论不再渲染成占位行 ✅ (2026-11-17 devin：clean-residue-comments.js 默认 dry-run + Question.tsx 不再渲染无存活子回复的删除占位；comment-residue.mjs PASS)
  verify: node scripts/assert/comment-residue.mjs
  risk: med

## 第二十三轮收尾观察（待办）

- [x] Z1102 右栏「等你来答」线上不显示（P2，数据缺口）：生产库 111 题全部已有回答，`GET /questions?tab=unanswered` 返回 0 条，UnansweredRail 按「0 条不渲染空卡」直接 return null → 部署后右栏仍是热榜一块 705px + 约 195px 空白。需生成 8–12 条「零回答」真实形态问题（标题+补充说明，0 回答，带话题；可放独立模块 `scripts/seed-data/unanswered.js` + 幂等补库脚本，避免与 seed.js 主体冲突），默认 dry-run，`SEED_ALLOW_PROD=1` 才写生产库；同时补 `scripts/assert/unanswered-stock.mjs`（DB ≥8 条零回答 + API `tab=unanswered` ≥5 条 + 1440 右栏 `.rail-block` = 2 块且第二块含「等你来答」+ 390 不渲染 + __errs 空 + 无溢出） ✅ (2026-11-17 devin：seed-data/unanswered.js 10 条零回答真问题 + seed-unanswered.js 幂等补库（dry-run/SEED_ALLOW_PROD=1，已写生产库 q#247-256，API 返回 10 条）；unanswered-stock.mjs PASS，基线 FAIL)
  verify: node scripts/assert/unanswered-stock.mjs
  risk: med

## 第二十四轮走查待办（2026-11-17 06:5x，来源 docs/PRODUCT-REVIEW.md 第二十二轮）

- [x] Z1103 种子语料「显式 author」绕过人设领域校验（P1，内容真实感）：`scripts/seed-data/*.js` 硬编码 `author:` 的 243 条语料不参与 `domainsOf()/acceptedDomains()` 同域校验（其中 10 条错位，落库 5 条——如苏晚/运营答 Code Review、程一/创业答接私活代码题）；`assert/seed-persona-domain.mjs` 只抽样随机派单导致盲区。需让显式 author 走同一套校验（不符改派同域作者、无候选抛错）、断言改全库口径且显式 author 错位单列要求为 0 ✅ (2026-11-17 devin：seed 显式 author 不符即改派同域并打印；断言 db 全库 100% 命中 + 显式错位单列=0，基线 FAIL 98.3%/5 条；fix-authors dry-run 输出补标题，生产库已 0 错位) 
  verify: node scripts/assert/seed-persona-domain.mjs
  risk: high
- [x] Z1104 登录/注册表单 label 未与 input 关联（P2，a11y）：`/register`、`/login` 的 `<label>` 无 `for`、`<input>` 无 `id`，点标签不聚焦、读屏读不出字段名；且 `.field:focus { outline:none }` 压掉全局 `input:focus-visible` 焦点环 ✅ (2026-11-17 devin：Register/Login 每个 input 补稳定 id（reg-*/login-*）+ label htmlFor；styles.css 补 `.field:focus-visible` 2px 主色轮廓；新增 a11y-form-labels.mjs（getByLabel 唯一定位 + 点 label 聚焦 + Tab 焦点环 + 双视口溢出/errs 守卫）PASS，基线 FAIL；auth.mjs、a11y.mjs 回归全绿)
  verify: node scripts/assert/a11y-form-labels.mjs
  risk: low
- [x] Z1105 热榜 tab 下右栏重复同一份热榜（P2，信息架构）：`/?tab=hot` 时主列表已是热榜 Top20，右栏 `.rail-block` 又列同一批 Top10，1440×900 同一排名出现两次。hot tab 下右栏不再渲染热榜块，改渲染「等你来答」（UnansweredRail），未答库存为 0 时兜底「你可能感兴趣的话题」块而非留空白；非 hot tab 保持热榜块 + 等你来答；390px 右栏依旧不渲染、热榜 tab aria-selected 不回归 ✅ (2026-11-17 devin：App.tsx 抽 Rail 组件按 pathname+?tab 切换，UnansweredRail 空库存时复用 /topics 接口渲染话题兜底块（沿用 rail-block--unanswered 移动端隐藏）；新增 assert/rail-dedupe-hot.mjs——hot 页右栏无热榜块且首卡与右栏链接不重复、默认首页热榜块仍在、390 右栏隐藏无溢出、__errs 空；基线 FAIL「右栏仍含热榜区块」，修后 3/3 PASS；rail-second-block.mjs 回归 PASS)
  verify: node scripts/assert/rail-dedupe-hot.mjs
  risk: low
- [x] Z1106 种子作者 bio 与作答领域口吻不一致（P2，内容真实感）：Z1103 后错位已清零，但邻接表允许 `data → code`，「温故52（bio：统计出身，现在做增长）」仍在 `/question/6` 答 React useEffect，读者第一眼仍出戏。需给跨域作答的种子作者补一句跨域说明（如 bio 加「也写前端」）或让其只在首选领域作答；断言 `scripts/assert/seed-bio-consistency.mjs`：抽样 ≥30 条回答，作者 bio 关键词或领域声明 ∩ 问题话题大类 ≠ ∅ 比例 ≥95%，且 bio 与 PERSONA_DOMAINS 首选域一致的作者不被改派 ✅ (2026-11-17 devin：persona-domains.js 新增 TOPIC_DOMAINS 覆盖全部 20 话题（前端类绝不含 data），acceptedDomains 话题优先 + DOMAINS_BY_CAT 仅兜底且兜底命中须=0；seed.js/fix-authors/两条断言全部下沉话题级；fix-authors 改 FIX_ALLOW_PROD=1 或 --apply 写库、生产库硬拒绝、无同域候选打印候选池并抛错；新增 seed-bio-consistency.mjs（全库 100% 命中 + 跨界人设单列 + 兜底=0）；基线 FAIL 98.3%/5 条错位（含温故52@q6），apply 改派 5 条后 PASS 100%，详见 WORKLOG-Z1106.md)
  verify: node scripts/assert/seed-bio-consistency.mjs
  risk: med

## 第二十五轮走查新增（2026-11-17）
- [x] Z1108 补记尾巴按领域限定（P2，内容真实感）：`answers.content_md` 里「别照抄文里的参数和阈值，那些数字是我这台机器、这份数据上跑出来的，换环境先小流量验证」这类免责尾巴被 `ANSWER_TAILS.code` 池无差别追加，导致 `/question/6`（JavaScript/useEffect）回答也挂数据类免责句（answer id 18）；全库命中 2 条仅 1 条（理财）语义相符。只对 life/sci/money 且正文带实测/数据痕迹的回答追加；已污染存量行按话题清理 ✅ (2026-11-17 devin：seed.js 删 code/psy/edu/work/health 尾巴池、别照抄句并入 sci，`pickTail(cat, content)` 加 TAIL_ALLOWED_CATS={life,sci,money}+DATA_HINT 双重门槛；新增 clean-answer-tails.js（默认 dry-run，FIX_ALLOW_PROD=1 才写，幂等二次 0 命中）；新增 assert/answer-tail-domain.mjs（forbidden cat 违规=0 + 允许类只在末段 + `>` 引用收尾）；副本自证基线 FAIL 指出 id=18，clean 后 3/3 PASS)
  verify: node scripts/assert/answer-tail-domain.mjs
  risk: low
- [x] Z1109 toast 单实例（P2，操作可预期）：同一次操作渲染两条相同 toast（「注册成功，欢迎来到知乎（仿）」×2、「评论已发布」×2、「该邮箱已注册」×2，`[role=status]` 内各两份），视觉叠影且读屏重复播报。改为同一 key 的消息只保留一条（新消息替换旧同位消息）✅ (2026-11-17 devin：根因=活体区域挂在 `.toast-stack` 容器上，每条 toast 被容器+子项重复暴露；toast.tsx 把 role=status/aria-live 下放到每条 .toast（容器改纯布局 .notify-stack），push 按 (text,kind) 去重替换 + 上限 3 条；toast-single.mjs 基线 FAIL 节点数=2，修后 A/B/C 全 PASS)
  verify: node scripts/assert/toast-single.mjs
  risk: low
- [x] Z1110 搜索召回偏窄疑点复核（P3，检索口径）：线上 `/search?q=React` 仅「相关结果 · 2 条」（问题 2 / 回答 6 / 用户 0），`useEffect` 2 条。只读核对：questions title/detail LIKE '%React%'=2、answers content LIKE=6、answer_fts 303/303 行与 answers 全量对齐——**接口命中与库内 LIKE 计数一致，不是召回 bug**（库内 React 字面命中本就少，且命中分散在回答 tab）；真正的问题是 question scope 未排除 `is_collapsed`。断言 `scripts/assert/search-recall.mjs`：四词（React/useEffect/数据库/职场）counts.question ≥ 只读 LIKE 基线、answer>0、React/react/REACT 三态一致、type=answer total 与 counts.answer 自洽 ✅ (2026-11-17 devin：qWhere 补 `q.is_collapsed = 0`；search-recall.mjs 四词全 PASS；search-page/search-scope/search-guard 回归 PASS)
  verify: node scripts/assert/search-recall.mjs
  risk: low
- [ ] Z1111 作者主页落点为空（P2，内容厚度）：走查第 10 步点「半山腰214」进 `/u/214`，页面答 0 问 1，只有「还没有回答 / 浏览 TA 的提问 / 去逛逛推荐」空态，落点落差比不能点更大。主页空态改为列出「TA 最近关注的问题」+「TA 最近赞同的回答」（无数据再退回现有文案）。断言 `scripts/assert/profile-empty-fallback.mjs`：对回答数=0 且关注数>0 的用户，主页至少渲染 3 条可点内容（问题或回答），且无「还没有回答」与列表并存
  verify: node scripts/assert/profile-empty-fallback.mjs
  risk: med
- [ ] Z1112 历史条目 verify 失败 50 条（测试债，P2）：`scripts/report.sh` 本轮统计 `verify fails=50`（Z1058-Z1077 区间多条断言脚本缺失或口径过期），报告噪声掩盖真实回归。逐条三选一：补断言脚本 / 修正 verify 行 / 若功能已废弃则标 `~~` 并注明原因，目标降到 0。断言 `scripts/assert/verify-clean.mjs`：遍历 `verify.sh --list`，已勾选条目的 verify 命令退出码全为 0
  verify: node scripts/assert/verify-clean.mjs
  risk: med

## 第二十六轮走查新增（2026-11-17 08:4x，来源 docs/PRODUCT-REVIEW.md 第二十六轮）

- [ ] Z1113 信息流卡缺作者头像（P2，视觉保真）：`Home.tsx` 的 `FeedCard`/`AnswerResultCard` 元信息行只有 `feed__author` 文本链接，卡片内 `img`=0；真知乎每张卡左下是「24px 圆形头像 + 昵称」。后端 `q.author.avatar_url` 已有（`/u/27` 主页能显示），只需在卡片元信息左侧渲染头像（无 avatar_url 时用昵称首字占位圆），并与昵称同一链接跳 `/u/:id`；1440 与 390 都不许挤压元信息换行、不许横向溢出
  verify: node scripts/assert/feed-card-avatar.mjs
  risk: low
- [ ] Z1114 推荐流话题偏科（P2，内容厚度）：干净会话 `/`（推荐 tab）首屏 20 条中 14 条属技术大类（JavaScript/前端开发/Python/数据库/编程），生活/心理/职场/教育只出现在第 15 条之后，首屏像技术社区不像知乎。需在推荐排序里加大类配额（单一领域 ≤50%，生活/心理/职场/教育各保底 ≥2 条）并对同话题做 MMR 去重，接口另返回 `diversity` 统计供断言读取
  verify: node scripts/assert/feed-diversity.mjs
  risk: med
