# 知乎仿站（zhihucopy）— 产品与技术 SPEC

> v1.0 ｜ 功能齐全的内容问答社区 ｜ 部署：https://openfolio.uk/zhihucopy ｜ 端口 3030（127.0.0.1）
> 目的：以「仿知乎」为载体，检验 AI 自动化交付完整产品的能力。

---

## 1. 产品范围

仿知乎核心闭环：**提问 → 回答 → 互动 → 发现 → 通知 → 治理**。不做：真实支付、第三方 OAuth、视频、私信（可选后续）。

### 1.1 用户与身份
- 注册（邮箱+密码，bcrypt）、登录（JWT，7 天）、退出、改密码
- 个人主页：头像、昵称、一句话简介、加入时间、关注数/粉丝数/回答数/获赞数
- 关注/取消关注用户；关注/取消关注话题；关注/取消关注问题

### 1.2 内容
- **提问**：标题（≤100 字）、补充说明（Markdown）、话题（1–5 个，可从热门话题选或新建）
- **回答**：Markdown 正文（支持图片 URL 与代码块）、草稿保存、发布、编辑（记录编辑历史）、删除
- **评论**：回答下评论（两级：评论 + 回复）、删除自己的评论
- **投票**：赞成/反对/取消（同一用户对同一回答只能一票）
- **收藏**：收藏回答到收藏夹（默认「我的收藏」），收藏夹 CRUD、可公开/私密

### 1.3 发现
- **关注流**：我关注的人的回答/提问，按时间倒序
- **推荐流**：基于话题兴趣 + 热度（赞数/评论数/时间衰减）的混合排序，冷启动按热度
- **热榜**：每 10 分钟计算的 Top 20（按互动加权）
- **搜索**：问题/回答/用户/话题，SQLite FTS5 全文索引，支持高亮
- **话题页**：话题简介、关注按钮、相关内容流

### 1.4 通知
- 类型：有人回答了我的问题、有人评论我的回答、有人回复我的评论、有人赞我、有人关注我、我的回答被折叠/删除
- 未读数、按类型筛选、全部已读、点击跳转对应内容

### 1.5 治理
- 举报（回答/评论/用户），理由枚举 + 补充说明
- 管理员后台：举报队列、处理（驳回/删除内容/折叠/禁言用户 1–30 天）、操作日志
- 内容折叠：被多人举报的回答自动标记「争议内容」，需点击展开
- 基础反垃圾：同一用户 5 分钟内发帖 > 3 条则限速提示

### 1.6 成长体系
- 每个用户有「盐值」：回答获赞 +2、被采纳 +5、被举报成立 −10
- 等级 = 盐值区间（Lv1–Lv7），等级影响每日提问/回答配额
- 勋章：首次回答、获赞 100、回答 50 条等（展示在主页）

---

## 2. 技术架构

```
浏览器 (React 18 + Vite + TS, base=/zhihucopy/)
        │ HTTPS https://openfolio.uk/zhihucopy
        ▼
portfolio-proxy.js  (/zhihucopy/* → 127.0.0.1:3030，不重写路径)
        ▼
zhihucopy (Express, 127.0.0.1:3030)
   ├─ /zhihucopy/api/*    REST（JWT 中间件）
   ├─ 静态托管 client/dist
   ├─ SQLite（better-sqlite3） + FTS5 全文索引
   └─ 定时任务：热榜计算（10 分钟）、草稿清理（每日）
```

- 认证：JWT（HS256，密钥从 `.env` 读 `JWT_SECRET`），密码 bcrypt
- 上传：暂用图片 URL（不做对象存储）；如做上传则存 `/www/zhihucopy/data/uploads`，限 2MB、类型白名单
- 数据：`/www/zhihucopy/data/zhihu.db`（gitignore）
- 日志：结构化写入 `/www/zhihucopy/logs/app.log`，含请求耗时

---

## 3. 数据模型（SQLite）

- `users`：id, email UNIQUE, password_hash, nickname, avatar_url, bio, salt_value, level, is_admin, muted_until, created_at
- `questions`：id, author_id, title, detail_md, created_at, updated_at, answer_count, follower_count, view_count
- `topics`：id, name UNIQUE, slug, description, follower_count
- `question_topics`：question_id, topic_id (PK 复合)
- `answers`：id, question_id, author_id, content_md, vote_up, vote_down, comment_count, is_collapsed, is_deleted, created_at, updated_at
- `answer_revisions`：id, answer_id, content_md, created_at
- `votes`：user_id, answer_id, value(+1/-1), PK(user_id, answer_id)
- `comments`：id, answer_id, author_id, parent_id, content, is_deleted, created_at
- `follows`：follower_id, target_type(user|topic|question), target_id
- `collections`：id, owner_id, name, is_public
- `collection_items`：collection_id, answer_id
- `notifications`：id, user_id, type, actor_id, target_type, target_id, is_read, created_at
- `reports`：id, reporter_id, target_type, target_id, reason, detail, status(pending|rejected|removed|collapsed), handled_by, created_at
- `mod_logs`：id, admin_id, action, target_type, target_id, note, created_at
- `badges`：id, user_id, code, granted_at
- `answer_fts`（FTS5）：answer_id, title, content（触发器同步）

---

## 4. API 设计（前缀 /zhihucopy/api）

**Auth**
- POST /auth/register {email,password,nickname} → {token,user}
- POST /auth/login {email,password} → {token,user}
- GET  /auth/me → user
- POST /auth/password {old,new}

**用户**
- GET  /users/:id → 公开资料 + 统计
- PATCH /users/me {nickname,avatar_url,bio}
- POST /users/:id/follow | DELETE /users/:id/follow
- GET  /users/:id/answers?page=
- GET  /users/:id/following|followers?page=

**问题/回答**
- POST /questions {title,detail_md,topic_ids[]}
- GET  /questions?tab=hot|new&topic=&page=
- GET  /questions/:id → 详情 + 前 5 个回答
- GET  /questions/:id/answers?sort=default|newest&page=
- POST /questions/:id/answers {content_md}
- GET  /answers/:id
- PATCH /answers/:id {content_md}
- DELETE /answers/:id
- POST /answers/:id/vote {value: 1|-1|0}

**评论/收藏**
- GET  /answers/:id/comments
- POST /answers/:id/comments {content, parent_id?}
- DELETE /comments/:id
- GET  /collections/mine | POST /collections {name,is_public}
- POST /collections/:id/items {answer_id} | DELETE ...

**发现**
- GET /feed/following?page=
- GET /feed/recommended?page=
- GET /feed/hot → Top20
- GET /search?q=&type=question|answer|user|topic&page=

**通知**
- GET /notifications?type=&unread=1
- GET /notifications/unread-count
- POST /notifications/read {ids[]|all}

**举报/管理**
- POST /reports {target_type,target_id,reason,detail}
- GET  /admin/reports?status=pending
- POST /admin/reports/:id/handle {action: reject|remove|collapse|mute, mute_days?}
- GET  /admin/users?q= | POST /admin/users/:id/mute {days}
- GET  /admin/stats → 日活/发帖/举报等基础指标

---

## 5. 前端要求

- **必须遵循 frontend-design skill**（`/www/hermes-home/skills/frontend-design/SKILL.md`）与 `docs/DESIGN.md`
- 视觉方向：**中文知识社区**，干净、克制、以阅读为核心；排版优先于装饰。避免通用 SaaS 卡片套件与霓虹暗色风（那是游戏项目的语言，不要复用）
- 页面：首页（关注/推荐/热榜三 tab）、问题详情、话题页、搜索页、个人主页、通知页、编辑器、管理员后台
- 编辑器：Markdown 实时预览、工具栏（加粗/标题/列表/代码/引用/链接/图片）
- 响应式：桌面 1200px 三栏收敛为移动端单栏，底部导航（首页/热榜/发布/通知/我）
- 状态：加载骨架屏、空态引导、错误提示（说清原因与下一步）
- 可访问性：键盘焦点可见、对比度达标、`prefers-reduced-motion`

---

## 6. 质量门禁

- 后端：`npm test`（node:test）覆盖 auth/vote/feed/权限边界；每个 API 至少 1 条 happy path + 1 条错误路径
- 前端：`npm run build` + `tsc --noEmit` 必须通过
- 部署：`scripts/ci-deploy.sh`（build → 迁移 → smoke → pm2 restart → 复检），失败 `scripts/rollback.sh`
- Smoke 用例（写进脚本）：注册→登录→提问→回答→投票→评论→通知→搜索，全部 2xx

---

### 验收契约（强制，所有 FEATURES 条目必须遵守）

每条待办格式：

```
- [ ] <FID> <一句话功能描述>
  verify: <可执行的验收命令或断言>
  risk: low|med|high
```

`verify:` 要求：
- 后端接口类：`curl -s -X POST <url> -H 'Content-Type: application/json' -d '<body>' | jq -e '<断言>'`（必须能在本地 127.0.0.1 上跑通）
- 前端页面类：`node scripts/e2e/<page>.mjs`（Playwright 断言关键元素与文案，退出码 0 = 通过）
- 数据类：`node scripts/assert/<name>.mjs`（校验不变量，如计数一致）
- 多条断言用 ` && ` 串联；**必须全绿才算完成**

`risk:` 含义：
- `low`：文案、样式、只读展示、种子数据 → 断言过即可自动上线
- `med`：新增接口、业务逻辑 → 自动上线但进入「待人工复核」清单
- `high`：认证、权限、删除、数据迁移、并发 → **必须人工确认后才合并**

统一执行器：`scripts/verify.sh <FID>` 会从 FEATURES.md 抽出该条的 verify 命令并执行，返回 0/非 0。

---

## 7. 里程碑

- **M0** 壳子 + 认证 + 提问/回答读（可浏览、可发一条内容）
- **M1** 投票/评论/收藏
- **M2** 关注关系 + 关注流/推荐流 + 热榜
- **M3** 搜索（FTS5）+ 话题页
- **M4** 通知 + 举报 + 管理后台
- **M5** 成长体系（盐值/等级/勋章）+ 反垃圾 + 编辑器打磨
- **M6** 性能与体验（分页游标、骨架屏、缓存）

---

## 8. 自动化开发机制

cron 每 5 分钟一跳：读 `docs/FEATURES.md` → 选 4 条 → 每条一个 worktree（`/www/zhihucopy-wt/<fid>`）→ 并行开发（奇数 devin SWE-2 / 偶数 OpenCode deepseek）→ 逐条 merge 回 main → 过 `ci-deploy.sh` → 勾选 + 追加新待办 → push。
