# WORKLOG-Z1108 — 数据免责尾巴按话题限定 + 清理跨话题误挂

## 问题

`/question/6`（JavaScript，useEffect 清理函数）回答结尾挂着
「> 别照抄文里的参数和阈值，那些数字是我这台机器、这份数据上跑出来的，换环境先小流量验证。」
——数据/实验类免责尾巴混在 `ANSWER_TAILS.code` 池里，被无差别追加到 code 话题回答上。
全库 `别照抄|小流量验证|我这份数据` 命中 2 条：id=18（code，误挂）、id=300（money，相符）。

## 改动文件

- `scripts/seed.js`
  - `ANSWER_TAILS` 只保留 `life / sci / money` 三个池；删掉 `code / psy / edu / work / health` 池；
    「别照抄文里的参数和阈值…」「以上数字都是中位数…」两句并入 `sci`（语义属数据/实验类）。
  - `pickTail(cat, content)` 增加双重门槛：`TAIL_ALLOWED_CATS={life,sci,money}` +
    `DATA_HINT`（正文须含数字/数据/样本/实测/比例/成本/收益/%/倍），不满足返回 `null`，调用处跳过追加。
- `scripts/clean-answer-tails.js`（新）：幂等切除「话题 ∈ {code, psy, edu} 且正文含免责标记」的行；
  默认 dry-run 打印 id/问题标题/话题/切除文本，`FIX_ALLOW_PROD=1` 才写库。
- `scripts/assert/answer-tail-domain.mjs`（新）：① {code,psy,edu} 话题下标记条数=0 且列违规 id；
  ② 允许类话题标记只许出现在末段；③ 末段须 `>` 引用收尾。`DB_PATH` 默认 `./data/zhihu.db`，readonly。
- `docs/FEATURES.md`：补 Z1108 条目，`verify: node scripts/assert/answer-tail-domain.mjs`。
- `data/zhihu.db`：worktree 开发库已对 answer#18 执行切除（同脚本）。

## 自证（真实运行输出）

### 基线（/tmp/z1108-base.db，生产库原样拷贝）— 必须 FAIL 且指出 id=18

```
$ DB_PATH=/tmp/z1108-base.db node scripts/assert/answer-tail-domain.mjs
FAIL db: code/psy/edu 话题回答无数据免责尾巴 — 违规=1 ids=18
PASS db: 允许类话题的数据免责尾巴只出现在末段 — 命中=1 居中=0
PASS db: 数据免责尾巴以 `>` 引用收尾 — 命中=1
2/3
```

### dry-run 命中行

```
$ DB_PATH=/tmp/z1108-base.db node scripts/clean-answer-tails.js
[clean-tails] mode=dry-run db=/tmp/z1108-base.db
[clean-tails] 标记命中 2 条；可切(forbidden cat)=1 保留(allowed cat)=1
  answer#18 「写了三年 React，还是没搞懂 useEffect 的清理函数，能举个真会出 bug 的例子吗？」 topic=JavaScript(code)
    切除: …\n\n> 别照抄文里的参数和阈值，那些数字是我这台机器、这份数据上跑出来的，换环境先小流量验证。
[clean-tails] dry-run：不改库（FIX_ALLOW_PROD=1 生效）
```

（id=300「理财」(money) 命中标记但属允许类，保留。）

### apply 后（/tmp/z1108-fixed.db）— 必须 PASS

```
$ DB_PATH=/tmp/z1108-fixed.db FIX_ALLOW_PROD=1 node scripts/clean-answer-tails.js
[clean-tails] apply 完成：切除 1 条
$ DB_PATH=/tmp/z1108-fixed.db node scripts/assert/answer-tail-domain.mjs
PASS db: code/psy/edu 话题回答无数据免责尾巴 — 违规=0
PASS db: 允许类话题的数据免责尾巴只出现在末段 — 命中=1 居中=0
PASS db: 数据免责尾巴以 `>` 引用收尾 — 命中=1
3/3
```

### 幂等：二次 apply 命中 0 条

```
[clean-tails] 标记命中 1 条；可切(forbidden cat)=0 保留(allowed cat)=1
[clean-tails] apply 完成：切除 0 条
```

### 新灌种子验证（/tmp/z1108-seed.db，未触生产库）

`DB_PATH=/tmp/z1108-seed.db node scripts/seed.js` 全量重灌后断言 3/3 PASS；
10 条尾巴全部落在 life/sci/money 话题末段（如 answer#234 科学/统计学「喝咖啡提神」→ 别照抄句；
answer#222/228 统计学 → sci 池；answer#186-210 家居收纳 → life 池；answer#300 理财 → money 池），
code/psy/edu 话题 0 条尾巴。

### verify.sh

```
$ bash scripts/verify.sh Z1108
[VERIFY] Z1108 -> node scripts/assert/answer-tail-domain.mjs
PASS db: code/psy/edu 话题回答无数据免责尾巴 — 违规=0
PASS db: 允许类话题的数据免责尾巴只出现在末段 — 命中=1 居中=0
PASS db: 数据免责尾巴以 `>` 引用收尾 — 命中=1
3/3
[VERIFY] Z1108 PASS (0.15s)
```

## 备注

- answer#18 切除后结尾落在正文原句（「……生产环境大概率也没问题。」），正文其余部分未动。
- `scripts/fix-answer-tails.js`（Z1091 一次性脚本）引用 `ANSWER_TAILS`，缺失大类走 `life` 兜底，已 apply 过无需再跑。
- 生产库 `/www/zhihucopy/data/zhihu.db` 本次未写；如需上线修复，在生产副本上跑
  `DB_PATH=/www/zhihucopy/data/zhihu.db FIX_ALLOW_PROD=1 node scripts/clean-answer-tails.js`。
- worktree `data/zhihu.db` 是旧 badges 表结构（server 启动时迁移），seed 自检用迁移过的库副本。
