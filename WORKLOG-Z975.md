# WORKLOG Z975 — 评论计数展开后消失，展开态保留数量

## 结论
展开态按钮保留数量的产品修复（`收起评论（N）`，口径 = `displayCommentCount()`）
此前已由 Z1029/Z1066 合入本分支与 `/www/zhihucopy`，`Question.tsx` 无需再改。
本轮补齐 Z975 的断言面：展开态按钮文本必须正向含当前评论数 + 全页
「N 条评论」计数叶子节点数 ≤1（防独立节点重复 / 屏幕阅读器重复播报）。

## 改了哪些文件
- `scripts/assert/comment-count.mjs`（仅断言，产品代码未动）：
  - 头部契约注释补 Z975 条目。
  - 新增 `countCommentCountNodes(page)`：统计 `body` 下文本命中
    `/\d+\s*条评论/` 的**叶子**节点（父命中且子也命中只计最深一层）。
  - 收起态：计数节点数 `=== 1`；展开后：按钮文本 `includes（${visible}）`
    正向断言 + 计数节点数 `<= 1`；收回后 `=== 1`；重载展开态 `<= 1`。
- `scripts/e2e/vote-comment.mjs`：**未改**。第 60 行已是
  `getByRole("button", { name: /条评论|收起评论|评论/ })` 正则匹配，
  不依赖「收起评论」四字全等，无需同步。
- `client/src/pages/Question.tsx`：未改（`收起评论（${displayCommentCount(a, cs)}）`
  已在，见 1246–1247 行）。

## 验证环境
- DB：`/www/hermes-home/cache/scratch/zhdb/Z975.db`（better-sqlite3 backup）。
- 实例：`PORT=3163 DB_PATH=... node server/index.js`（已按端口收尸）。
- `npm run build`：tsc + vite ✓（dist 433.56 kB）。

## verify 输出
```
$ API_BASE=http://127.0.0.1:3163/zhihucopy/api E2E_BASE=http://127.0.0.1:3163/zhihucopy bash scripts/verify.sh Z975
[VERIFY] Z975 -> node scripts/assert/comment-count.mjs
[E2E] comment-count PASS (3.3s)
[VERIFY] Z975 PASS (4.57s)
RC=0
```

## 三次连跑（对 3163 实例）
```
run 1: [E2E] comment-count PASS (3.4s)  RC=0
run 2: [E2E] comment-count PASS (3.8s)  RC=0
run 3: [E2E] comment-count PASS (4.8s)  RC=0
```

## 基线 FAIL 证据
`/www/zhihucopy` 当前 HEAD 已含展开态计数修复，真正的「未修基线」是
`0dfe3be`（引入 `收起评论（`）之前。取其父提交 `790b267`（彼时展开态
文案为裸 `收起评论`，见 Question.tsx:810）另起 worktree
`/www/hermes-home/cache/scratch/base-Z975`，软链 node_modules、
`npm run build` ✓、`PORT=3164` 起服，跑同一条新断言：

```
$ API_BASE=http://127.0.0.1:3164/zhihucopy/api E2E_BASE=http://127.0.0.1:3164/zhihucopy node scripts/assert/comment-count.mjs
[E2E] comment-count FAIL (3.6s): assert: 展开后计数消失：「收起评论」不匹配 收起评论（N）
RC=1
```

基线 worktree 与 3164 进程均已清理；3030 及其它 316x 未触碰。
