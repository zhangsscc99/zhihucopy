# WORKLOG-Z1106 — 种子作者 bio 与作答领域口吻一致

## 根因

`scripts/persona-domains.js` 的 `DOMAINS_BY_CAT.code = [frontend, backend, data]`，
`温故: ["data","sci"]`，于是「统计出身做增长的温故52 在 `/question/6` 教
React useEffect」被旧断言 `seed-persona-domain.mjs` 判命中 —— 假绿。
修复方式：判定口径从「大类」下沉到「话题」。

## 改动文件

| 文件 | 改动 |
|---|---|
| `scripts/persona-domains.js` | 新增 `TOPIC_DOMAINS`（话题名→可接受域），覆盖生产库 `topics` 表全部 20 个话题（`select id,name from topics order by id` 核对一致），逐条注释归域理由；前端类话题绝不含 `data`（JavaScript 相邻域=backend/Node.js；Python/数据库允许 data）。`acceptedDomains()` 改为话题优先、大类兜底；新增 `topicCovered` / `acceptedForTopics`（返回 `viaTopic`/`viaCat`/`unknown` 供兜底计数）/ `authorFitsTopic`；`DOMAINS_BY_CAT.code` 剔除 `data`（仅作兜底）。 |
| `scripts/seed.js` | 启动校验：TOPICS 全量必须进 TOPIC_DOMAINS（缺则抛错）；`fitsCat` 改走 `authorFitsTopic`（话题级优先），questionPlan 存 `topicName`，派作者/显式作者校验同一口径。 |
| `scripts/fix-answer-authors-by-domain.js` | 复用话题级口径：问题可接受域=其话题 TOPIC_DOMAINS 并集；question_topics 实际用到的话题未覆盖 TOPIC_DOMAINS → 直接抛错（不许退回大类口径）。默认 dry-run；`--apply` 或 `FIX_ALLOW_PROD=1` 才写库；写 `/www/zhihucopy/data/zhihu.db` 一律拒绝（只允许 worktree/临时副本）。同域候选不足 → 打印候选池明细（占用原因）并抛错，不静默跳过。 |
| `scripts/assert/seed-bio-consistency.mjs`（新增） | 全库（DB_PATH 只读，默认 `./data/zhihu.db`）判定「作者领域 ∩ 问题话题可接受域 ≠ ∅」须 =100%；大类兜底命中单列且须 =0；温故*/半山腰*/南山南* 跨界人设逐条列出；「仅靠 bio 跨域声明命中」单独计数（bio 关键词命中即视为显式跨域声明，否则错位须改派）；bio 空占比 <10%。 |
| `scripts/assert/seed-persona-domain.mjs` | 同步下沉到话题级（`acceptedForTopics`），兜底命中单列且须=0；其余口径（全库、显式 author 单列=0、空 bio <10%）不变。 |
| `docs/FEATURES.md` | Z1106 勾选完成。 |
| 数据（不入库） | worktree `data/zhihu.db`（gitignored 副本）已 apply 修复；`/tmp/z1106-fixed.db` 同步验证。 |

## 自证（旧库 FAIL → 修完 PASS）

### 1) 基线：旧库断言 FAIL

```
$ cp /www/zhihucopy/data/zhihu.db /tmp/z1106-base.db
$ DB_PATH=/tmp/z1106-base.db node scripts/assert/seed-bio-consistency.mjs
全库回答=303 判定=302 bio 为空=1 无话题=0
命中=297（其中仅靠 bio 跨域声明=0）错位=5 命中率=98.3%
大类兜底话题命中=0（话题级覆盖 100%）
跨界人设回答=40：
  ✗ #18 温故52[data+sci] on q#6<JavaScript>
  ✓ #23 半山腰[data] on q#8<编程/Python>
  ✓ #73 半山腰[data] on q#21<JavaScript/Python>
  ✓ #79 半山腰[data] on q#23<JavaScript/Python/数据库>
  ✓ #82 半山腰[data] on q#24<编程/Python/数据库>
  ✓ #83 温故[data+sci] on q#24<编程/Python/数据库>
  ✗ #102 半山腰94[data] on q#29<JavaScript>
  ✓ #111 温故202[data+sci] on q#31<职场/职业规划/面试>
  ✓ #113 温故202[data+sci] on q#32<职场>
  ✓ #142 半山腰34[data] on q#40<职场/面试>
  ✓ #146 半山腰[data] on q#41<职场/职业规划>
  ✓ #157 温故[data+sci] on q#43<职场/职业规划>
  ✓ #160 温故82[data+sci] on q#44<职场/职业规划/面试>
  ✓ #162 温故202[data+sci] on q#44<职场/职业规划/面试>
  ✓ #172 半山腰[data] on q#46<职场/职业规划/面试>
  ✓ #176 半山腰[data] on q#47<职场/职业规划/面试>
  ✓ #213 南山南55[health] on q#57<科学/统计学>
  ✓ #218 半山腰[data] on q#59<科学/统计学>
  ✓ #220 温故[data+sci] on q#60<科学/统计学>
  ✓ #223 半山腰124[data] on q#61<统计学>
  ✓ #224 温故[data+sci] on q#61<统计学>
  ✓ #226 温故[data+sci] on q#62<科学/统计学>
  ✓ #230 温故[data+sci] on q#63<科学/统计学>
  ✓ #231 温故112[data+sci] on q#63<科学/统计学>
  ✓ #232 南山南[health] on q#63<科学/统计学>
  ✓ #235 南山南115[health] on q#64<科学/统计学>
  ✓ #236 南山南[health] on q#64<科学/统计学>
  ✓ #239 温故[data+sci] on q#65<科学/统计学>
  ✓ #241 半山腰[data] on q#65<科学/统计学>
  ✓ #254 南山南85[health] on q#69<心理学/情绪管理>
  ✓ #284 温故[data+sci] on q#92<教育/学习方法>
  ✓ #285 温故[data+sci] on q#93<学习方法>
  ✓ #286 南山南[health] on q#94<健康/睡眠>
  ✓ #288 南山南[health] on q#96<健康/睡眠>
  ✓ #292 南山南[health] on q#100<健康/睡眠>
  ✓ #295 南山南[health] on q#103<健康/睡眠>
  ✓ #297 温故[data+sci] on q#105<理财>
  ✓ #298 半山腰64[data] on q#106<理财>
  ✓ #300 温故[data+sci] on q#108<理财>
  ✓ #302 温故[data+sci] on q#110<理财>
  错位 #18 温故52[data+sci] bio「统计出身，现在做增长。」 on q#6<JavaScript>[frontend+backend]
  错位 #35 木子李59[backend] bio「刚转行做测试，还在补基础。」 on q#12<前端开发>[frontend]
  错位 #44 林间有风62[frontend] bio「前端工程师，关注可访问性。」 on q#15<数据库>[backend+data]
  错位 #102 半山腰94[data] bio「数据分析师，喜欢把不确定说清楚。」 on q#29<JavaScript>[frontend+backend]
  错位 #263 夏至未至141[health] bio「护士，值夜班第七年。」 on q#72<人际关系>[psy+edu+life+work]
[ASSERT] seed-bio-consistency FAIL (0.0s): 人设-话题命中率 98.3% < 100%（错位 5/302）；错位回答须改派同域作者或在 users.bio 显式补跨域声明
```

按要求打印出了温故52 答 /question/6（回答 #18）。**exit=1，确认假绿复现。**

### 2) 修复（dry-run 列表 5 条 → apply 改写 5 条）

```
$ cp /tmp/z1106-base.db /tmp/z1106-fixed.db
$ DB_PATH=/tmp/z1106-fixed.db node scripts/fix-answer-authors-by-domain.js   # dry-run
[fix-authors] mode=dry-run db=/tmp/z1106-fixed.db
[fix-authors] 回答总数=303 需重排=5 无话题跳过=1
  回答 #18 q#6 「写了三年 React，还是没搞懂 useEffect 的清理」: 温故52(data+sci) -> 阿罗(backend)
  回答 #35 q#12 「移动端 H5 在低端安卓机上的卡顿，有哪些是能靠代码解决的？」: 木子李59(backend) -> 林间有风92(frontend)
  回答 #44 q#15 「什么时候才应该考虑分库分表？我见过很多团队数据量不大就先做了」: 林间有风62(frontend) -> 老周写代码35(backend)
  回答 #102 q#29 「JavaScript 的 this 到底该怎么理解？为什么每」: 半山腰94(data) -> 木子李59(backend)
  回答 #263 q#72 「为什么有些人相处起来很轻松？他们的沟通方式有什么共同点？」: 夏至未至141(health) -> 余光109(work)
[fix-authors] dry-run：将改写 5 条（加 --apply 生效）

$ DB_PATH=/tmp/z1106-fixed.db FIX_ALLOW_PROD=1 node scripts/fix-answer-authors-by-domain.js
[fix-authors] mode=apply db=/tmp/z1106-fixed.db
[fix-authors] 回答总数=303 需重排=5 无话题跳过=1
  …（同上 5 条计划）
[fix-authors] 已备份: /www/zhihucopy-wt/Z1106/data/backups/zhihu-20261117075346-authors.db
[fix-authors] apply 完成：改写 5 条 author_id
```

### 3) 修后：断言 PASS

```
$ DB_PATH=/tmp/z1106-fixed.db node scripts/assert/seed-bio-consistency.mjs
全库回答=303 判定=302 bio 为空=1 无话题=0
命中=302（其中仅靠 bio 跨域声明=0）错位=0 命中率=100.0%
大类兜底话题命中=0（话题级覆盖 100%）
跨界人设回答=38：（38 条全 ✓，无 ✗；#18/#102 已改派同域作者）
[ASSERT] seed-bio-consistency PASS (0.0s)
```

## 汇总

- dry-run 列表条数：**5**（与 apply 改写条数一致，无静默跳过）
- 实际改写回答：**5** 条 author_id（#18 → 阿罗、#35 → 林间有风92、#44 → 老周写代码35、#102 → 木子李59、#263 → 余光109）
- 无话题跳过：1 条回答（问题无任何 topic 绑定，不计入判定）
- 走「改派」路径 5 条；「bio 补跨域声明」路径 0 条（同域候选充足，无须改 bio）
- 生产库 `/www/zhihucopy/data/zhihu.db` **未写入**（脚本硬拒绝）；worktree 内 `data/zhihu.db` 副本已同步 apply

## 回归

- `npm --prefix server test`：38/38 PASS
- `DATA_SOURCE=db node scripts/assert/seed-persona-domain.mjs`（修后库）：PASS，命中 302/302，显式 author 语料 170 条错位 0；同断言在基线库 FAIL 98.3%/5 条（与 seed-bio-consistency 错位清单一致，口径已同源）
- `bash scripts/verify.sh Z1106`：`[VERIFY] Z1106 PASS`
- `node --check` 全部改动文件通过
