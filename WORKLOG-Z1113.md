# WORKLOG Z1113 — 信息流卡补作者头像

## 改动文件
- `client/src/components/FeedAuthor.tsx`（新增）：24px 圆形头像（`avatar_url` 存在时 `<img alt="" loading="lazy">`，否则昵称首字占位）+ 昵称，同处一个 `<Link to="/u/:id">`；`author` 为空返回 null。
- `client/src/pages/Home.tsx`：`FeedCard` / `AnswerResultCard` / `HotFeedCard` 元信息行的纯文本作者链接换成 `<FeedAuthor>`；浏览数 span 加 `.feed__views`。
- `client/src/pages/Topic.tsx`、`client/src/pages/Unanswered.tsx`：同样换 `<FeedAuthor>` + `.feed__views`（Topics.tsx 话题列表无作者行，不涉及）。
- `client/src/styles.css`：`.feed__meta` 改 `align-items:center; flex-wrap:nowrap; white-space:nowrap`（单行不折行）；`.feed__author` 变 inline-flex + `min-width:0`，昵称 `.feed__author-name` 溢出省略；新增 `.feed__avatar`（24×24、radius 50%、`rgba(0,102,255,.08)` 底 + `var(--accent)` 字）；`@media ≤767px` 隐藏 `.feed__views`。
- `scripts/assert/feed-card-avatar.mjs`（新增）：浏览器级断言（`run` from `../e2e/lib.mjs`），覆盖 1440/390 两视口、头像几何（18–32px、radius≥40%）、点头像跳 `/u/:id`、`.feed__meta` ≤28px、`__errs` 为空、正文 >200 字。

## 反向自检（基线 FAIL）
- 目标：main 基线实例 `http://127.0.0.1:3030/zhihucopy`（/www/zhihucopy，branch main）。
- `node scripts/assert/feed-card-avatar.mjs` → **RC=1**
- 失败原因：`assert: 第 1 张卡头像不合格：{"i":0,"hits":0,"ok":false,"why":"no avatar element"}` —— 基线卡内 `img, .avatar` 命中数 0。

## 修后验证（worktree，PORT=3163，DB=/www/hermes-home/cache/scratch/zhdb/Z1113.db，better-sqlite3 `.backup()` 复制）
- `npm run build`（client）：PASS（tsc + vite build，16s）。
- `API_BASE=…:3163 … node scripts/assert/feed-card-avatar.mjs` → **RC=0 PASS (3.2s)**。

## 回归（同 3163 实例）
- `feed-card.mjs` → RC=0 ok
- `style-tokens.mjs` → RC=0 ok
- `feed-card-click.mjs` → RC=0 PASS (8.1s)（整卡跳转/作者链接/话题链接/键盘 Enter 均未破坏）

## 备注
- `cardNav` 的 `closest("a,button")` 放行未动；头像在 `<a>` 内，点击不触发卡片导航（断言 2 已覆盖）。
- 未 commit、未 stash、未改 `docs/FEATURES.md`。
