# WORKLOG-Z1094 浏览器后退后头部仍渲染未登录态（P3，状态一致性）

## 根因

`AuthProvider` 只在挂载时跑一次 `GET /api/auth/me`。浏览器「后退」命中上一个历史项时：

- 跨文档回退：旧文档被 bfcache 冻结/复活，React 树保持离开时的 `user=null`，
  顶栏定格在「登录 注册」，直到手动刷新；
- 同文档 popstate / 他标签页改了 `zhihu_token`：React 状态与 localStorage
  脱节，同样不重校验。

## 改动

- `client/src/auth.tsx`：新增串行化 `refresh()`（在途去重 + `userTokenRef`
  记录当前 user 是为哪个 token 解析的）。触发面：挂载 + `location.key`
  变化（含同文档 popstate）+ `pageshow`/`popstate`/`focus`/`visibilitychange`
  /`storage` 监听。语义：无 token → 立即清 user（不保留旧值）；token 存在但
  user 非为它解析 → `GET /api/auth/me`（静默，401 不拽去登录页）；
  校验期间 token 再变 → 自动再来一轮。login/register/logout 同步维护
  `userTokenRef`。
- `client/src/api.ts`：`api()`/`get()` 增加 `ApiOptions.onUnauthorized`
  （默认 true 保持原行为）；401 仍清 token，传 false 时跳过全局
  「跳 /login」处理。导出 `TOKEN_KEY` 供 storage 监听。
- `client/src/components/TopNav.tsx`：auth 解析中（`loading && !user`）渲染
  null 占位而非「登录 注册」，消除错误态闪烁（也修了首屏未登录闪现）。
- `scripts/assert/back-auth-state.mjs`（新，浏览器级）：每个视口（1440/390）
  跑三场景——A) `goto /question/6`（未登录 D1）→ `goto /login?next=…`（D2）
  UI 登录 → replace 回 /question/6 → `goBack()` 落回 D1 → 3s 内
  `.usermenu__trigger` 出现、无登录/注册链接、`aria-label=林间有风`，
  刷新后不变；B) 未登录文档内注入有效 token → pushState+`goBack()` 触发
  popstate → 顶栏翻已登录；反向删 token → popstate → 立即回未登录；
  C) 注入无效 token → reload → 回未登录态。全程 `__errs` 空、无横向溢出、
  `body.innerText > 200`。

## 验证（临时实例 PORT=3164，DB=.backup() 自 /www/zhihucopy/data/zhihu.db）

- `npm run build`：tsc + vite 通过（index-Cdb14wkZ.js）。
- `back-auth-state.mjs` ×3 连跑：**PASS / PASS / PASS**（11.9s / 12.3s / 12.0s）。
- `API_BASE/E2E_BASE=http://127.0.0.1:3164/zhihucopy bash scripts/verify.sh Z1094`：
  **[VERIFY] Z1094 PASS (11.80s)，RC=0**。
- 回归：`login-history-replace.mjs` PASS、`usermenu-a11y-name.mjs` PASS、
  `assert/auth.mjs` PASS、`e2e/auth.mjs` PASS。

## 反向自检（未修基线必须 FAIL）

- 基线：`cp -a /www/zhihucopy` → `/www/hermes-home/cache/scratch/base-Z1094`
  （软链 node_modules、独立 DB `Z1094-base.db`、vite build、PORT=3174），
  断言脚本同文件拷入。
- 结果：**RC=1 FAIL** —
  `[E2E] back-auth-state FAIL (7.9s): page.waitForSelector: Timeout 3000ms
  exceeded. waiting for locator('.usermenu__trigger') to be visible`，
  即场景 A `goBack()` 后顶栏停在「登录 注册」，与线上实测一致。

## 备注

- 未 commit、未 stash、未改 `docs/FEATURES.md`；只动 `/www/zhihucopy-wt/Z1094`。
- bfcache 复活那一下仍短暂显示冻结帧（浏览器恢复的旧像素，非重新渲染），
  JS 恢复后 pageshow→refresh→/auth/me 本地约百毫秒级翻正，满足 1s 要求。
