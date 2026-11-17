# WORKLOG-Z1109 — toast 单实例（同一次操作不要弹两条）

## 根因

`client/src/toast.tsx` 把 `role="status" aria-live="polite"` 挂在堆栈容器 `.toast-stack` 上，
每条 toast 子项又带 `class="toast …"`。于是走查选择器
`[class*=toast],[role=status]` 对同一条消息命中 **2 个节点**（容器 + 子项），
文本均为 toast 文案 → 「同文案出现两份」、读屏活体区域重复播报。
同时 `push` 无任何去重：同一操作快速重复触发时相同文案会真的叠出第二条黑条（无上限）。

实测（未修复线上构建，场景 A 重复邮箱注册）：
`[role=status],[class*=toast]` 中「该邮箱已注册」可见节点 = **2**
（`.toast-stack` 容器 + `.toast` 子项），`.toast` 子项本身 1 个。

## 修复（最小改动，client/src/toast.tsx + styles.css 各一处）

- `role="status" aria-live="polite"` 从容器下放到每条 `.toast` 子项：
  每条消息一个活体区域，容器退化为纯布局节点（`.toast-stack` → `.notify-stack`，
  不再被 `[class*=toast]`/`[role=status]` 命中），视觉/位置/节奏不变。
- `push` 按 `(text, kind)` 去重：同 key 命中即清掉旧条（连同其 3200ms 计时器）
  再压入新条——1.5s（或存活期内）重复触发只替换不叠加。
- 不同文案可堆叠，上限 3 条，溢出丢最旧。
- 计时器集中在 `timers: Map<id, timeout>` 管理，替换/溢出时正确清理。
- 事件回调路径，与 StrictMode 无关；生产与开发行为一致（无 effect 双跑参与）。

## 改动文件

- `client/src/toast.tsx` — 上述逻辑（唯一实现文件）
- `client/src/styles.css` — `.toast-stack` 选择器改名 `.notify-stack`（样式不变）
- `scripts/assert/toast-single.mjs` — 新增浏览器级断言
- `docs/FEATURES.md` — Z1109 标记 [x]

## 断言（scripts/assert/toast-single.mjs）

- 场景 A：重复邮箱注册 →「该邮箱已注册」可见节点 = 1（error 级）；表单内联错误 ≤1
- 场景 B：种子号发布评论 →「评论已发布」可见节点 = 1；评论按正文找回并删除
- 场景 C：「邀请回答」1.5s 内连点两次 → 同文案可见节点 ≤ 1

### 修复前（线上未修复构建）原始输出

```
$ node scripts/assert/toast-single.mjs
  [scene A] 「该邮箱已注册」匹配节点=2（期望 1），表单内联节点=0
[E2E] toast-single screenshot: /root/logs/e2e-toast-single-2026-11-17T07-54-12-302Z.png
[E2E] toast-single FAIL (2.3s): assert: A:「该邮箱已注册」可见节点数=2，期望 1（双弹/容器重复计？）
RC=1
```

### 修复后（部署 884c082 后）原始输出

```
$ bash scripts/verify.sh Z1109
[VERIFY] Z1109 -> node scripts/assert/toast-single.mjs
  [scene A] 「该邮箱已注册」匹配节点=1（期望 1），表单内联节点=0
  [scene B] 「评论已发布」匹配节点=1（期望 1）
  [scene C] 连点两次「邀请回答」同文案节点=1（期望 ≤1）
[E2E] toast-single PASS (4.0s)
[VERIFY] Z1109 PASS (5.38s)
```

## 其他验证

- `cd client && npx tsc -b --noEmit` → rc=0
- `bash scripts/ci-deploy.sh`（在 /www/zhihucopy main 检出上）：build → smoke →
  pm2 restart → e2e 16/16 PASS → deploy complete: 884c082
