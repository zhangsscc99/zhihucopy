# WORKLOG-Z1115 昵称批量生成感（内容真实感，P1）

## 问题

生产库 370 账号里 215 个昵称是「汉语名 + 1–3 位数字」（`陈默31`/`林间有风32`/
`半山腰64`/`沈青224`，seed.js clone 后缀 `${i+1}`），另 1 个拉丁后缀
（`沈知微gbw`），加上断言脚本残留的 `真人nmw…`/`z985user…` 随机尾账号——
实测非测试口径账号可疑形态 294/353 = **83.3%**，出现在信息流卡、回答、
通知作者行，是全站最明显的机器生成感。

## 改动文件

| 文件 | 内容 |
|---|---|
| `scripts/nickname-pool.js`（新） | 昵称池唯一来源：`CLONE_ALIASES`（30 原型 × 7 个真实感别名，与新 seed 第 1–7 轮 clone 一一对应）、`GENERIC_POOL`（142 个通用真实感昵称）、`isSuspiciousNickname`（可疑形态 = `[0-9]{1,4}$` 或 `[a-z]{2,4}$`，与断言/修复脚本同正则）。加载即校验：2–6 字、无数字/拉丁、全池唯一、不与原型重名。 |
| `scripts/seed.js` | clone 命名 `nick + ${i+1}` → `cloneNickname(nick, floor(i/30))`；原型用户（i<30）不变。email/头像 seed 等其余逻辑未动。 |
| `scripts/persona-domains.js` | 新增 `ALIAS_TO_BASE`（别名→原型，加载校验别名表键 ⊆ PERSONA_DOMAINS）与 `personaBaseOf()`（剥数字尾 → 本名 → 别名三级还原）；`domainsOf` 改走 personaBaseOf。**领域分配不变**：别名 clone 仍命中原型领域。 |
| `scripts/assert/seed-bio-consistency.mjs` | `persona` 判定与 `CROSS_PERSONAS` 名单改用 `personaBaseOf`（兼容数字尾与别名两种形态）。 |
| `scripts/fix-nicknames.js`（新） | 幂等改名：默认 dry-run（只读打开库，打印计划 + 前 20 条 old→new）；`--apply`/`FIX_ALLOW_PROD=1` 写非生产库；生产库走 `prod-write-gate`（--apply --prod ZH_ALLOW_PROD_WRITE=1 + 当日备份）。写前 `.backup()` 到 `data/backups/zhihu-<ts>-nicknames.db`。种子 clone 按 CLONE_ALIASES 映射（与新 seed 一致，人设不漂移），其余可疑名走 GENERIC_POOL 确定性挑选（`id*13` 起步环形扫占用）。**跳过**：admin、content-filter 判定的测试账号（改名会让其逃出残留治理口径）、`z1044user*` purge 白名单。只改 `users.nickname`（回答/通知/投票按 user_id 关联）。 |
| `scripts/assert/nickname-realism.mjs`（新） | 三层：DB 侧（非测试口径账号可疑比例 ≤2%，分母剔除 is_test/测试形态/测试邮箱——它们被公共出口过滤且由残留治理负责）；API 侧（`/questions?limit=30`、`/feed/recommended` 的 `items[].author.nickname` 无可疑形态且非空样）；浏览器侧（1440/390 各一次，首屏 `.feed__item .feed__author-name` 前 15 个无可疑形态、`window.__errs` 空、无横向溢出）。逐项收集后统一 FAIL/PASS。 |

## 验证（临时实例 PORT=3161，DB=.backup() 副本 `/www/hermes-home/cache/scratch/zhdb/Z1115.db`）

```
$ DB_PATH=…/Z1115.db node scripts/fix-nicknames.js --apply
[fix-nicknames] 用户=370 待改名=294（种子 clone 210 / 通用池 84） 跳过: 测试账号 13 白名单 0 admin 0
  u:31 陈默31 -> 陈默然 / u:32 林间有风32 -> 林晚风 / u:34 半山腰34 -> 半山听雨 …
[fix-nicknames] 已备份: data/backups/zhihu-20261117100328-nicknames.db
[fix-nicknames] apply 完成：改写 294 个昵称
# 第二次跑：待改名=0（幂等）
```

```
$ bash scripts/verify.sh Z1115   （API_BASE/E2E_BASE/DB_PATH 指向 :3161）
  DB: 非测试账号 353，可疑昵称 0（0.0%）
  API /questions?limit=30: 30 条，可疑作者名 0
  API /feed/recommended: 20 条，可疑作者名 0
  desktop1440: 首屏作者名 15 个，可疑 0；溢出 0px，__errs 0
  mobile390:   首屏作者名 15 个，可疑 0；溢出 0px，__errs 0
[E2E] nickname-realism PASS (6.1s)
[VERIFY] Z1115 PASS (7.31s)   RC=0
```

回归：`seed-bio-consistency.mjs`（修复后副本）命中率 **100%**、跨界面人设
`温故知新/半坡/南山有木` 等别名照常归入跨界人设名单；新 seed（既有 schema
副本全量重灌）240 用户 0 可疑、0 重名，`seed-persona-domain.mjs
DATA_SOURCE=db` 判定 298 命中 100%（显式 author 语料 169 条错位 0）；
`server npm test` 38/38 PASS。

## 反向自检（未修基线）

基线副本 `/www/hermes-home/cache/scratch/base-Z1115`（`cp -a /www/zhihucopy`，
node_modules 软链、build 一次、PORT=3171、DB=副本内未修库）跑同一条断言：

```
  DB: 非测试账号 353，可疑昵称 294（83.3%）
  FAIL: DB 可疑昵称比例 83.3% > 2%（294/353）
  FAIL: /questions?limit=30 作者名含可疑形态 24 条: 半山腰214 简宁238 …
  FAIL: /feed/recommended 作者名含可疑形态 15 条: 半山腰214 林间有风32 …
  FAIL: desktop1440 首屏作者名含可疑形态: 半山腰214 林间有风32 …（11/15）
  FAIL: mobile390 首屏作者名含可疑形态（11/15）
[E2E] nickname-realism FAIL (6.6s): nickname-realism 5 项未过
RC=1
```

## 生产库 apply 计划（dry-run，未实际写）

```
$ DB_PATH=/www/zhihucopy/data/zhihu.db node scripts/fix-nicknames.js
[fix-nicknames] mode=dry-run db=/www/zhihucopy/data/zhihu.db
[fix-nicknames] 用户=370 待改名=294（种子 clone 210 / 通用池 84） 跳过: 测试账号 13 白名单 0 admin 0
  u:31 陈默31 -> 陈默然      u:36 苏晚36 -> 苏晚舟        u:41 南栀41 -> 南栀北巷
  u:32 林间有风32 -> 林晚风   u:37 不加班的周五37 -> 周五不加班  u:42 一叶知秋42 -> 知秋
  u:33 阿澈33 -> 澈然       u:38 白露38 -> 白露为霜       u:43 周吴郑王43 -> 郑人买履
  u:34 半山腰34 -> 半山听雨   u:39 何人在此39 -> 何人        u:44 沈青44 -> 沈青禾
  u:35 老周写代码35 -> 老周   u:40 麦田守望40 -> 麦田老师     u:45 顾言45 -> 顾言西
  … 其余 274 条略（含 u:600 沈知微gbw → 通用池名、真人nmw…/z985user… 残留号 → 通用池名）
[fix-nicknames] dry-run：将改写 294 个昵称（加 --apply 生效）
```

写生产库需受控写闸：`node scripts/fix-nicknames.js --apply --prod --backup <path>`
+ `ZH_ALLOW_PROD_WRITE=1`（脚本自身还会再 `.backup()` 到 `data/backups/`）。

## 备注

- 跳过的 13 个「测试账号」是 content-filter 口径（`e2e-mw…`/`asker-mw…`/
  `is_test=1`）：改名会使其逃出公共出口过滤与残留清理，属于故意保留。
- 84 个通用池改名对象 = `沈知微gbw` + `真人nmw…`/`z985user…`/`z1028user…`/
  `走查员…` 等断言残留号——它们本就不被 content-filter 识别（昵称、邮箱均
  不命中），改名不降低任何可检测性，且同样是机器感来源。
- 新 clone 别名与 seed 第 1–7 轮一一对应（`陈默31`=`CLONE_ALIASES[陈默][0]`），
  存量改名与重新 seed 收敛到同一套名字；人设领域经 `personaBaseOf` 还原，
  Z1103/Z1106 两条领域断言在修复库上均 100% 通过。
- 未 commit、未 stash、未改 docs/FEATURES.md；临时实例 :3161 已收尸。
