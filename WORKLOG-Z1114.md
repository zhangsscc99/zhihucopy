# WORKLOG-Z1114 推荐流话题多样性（内容厚度，P2）

## 重排算法（一句话）

候选全集按原序（`created_at DESC, id DESC` 全序）读入 → 纯函数内存重排
（limit 滑窗内单类 ≤50% 封顶 + 非技术七大类首窗保底各 1 条·槽位均撒 +
同 topic 前三条露过面即让位/禁三连，规则逐级放宽防卡死）→ 按页切片，
同一 page 多次请求结果完全一致。

## 前后对比（/feed/recommended?limit=20 首屏）

| 口径 | 修复前（基线） | 修复后 |
|---|---|---|
| tech_ratio | **0.70**（14/20 技术） | **0.30**（6/20） |
| 非技术大类数 | 5（work/life/sci/psy/edu，全挤在 15 名后） | **7 全到位**（+health/money） |
| diversity 字段 | 无 | `{tech_ratio, categories{8键}, guaranteed_missing:[]}` |
| 同 topic 三连 | — | 0 处 |
| 首屏前 14 条 | 全技术 | T/生活/T/职场/心理/T/科学/教育/健康/理财 交错 |

page=2 同口径滑窗仍维持 tech_ratio=0.5，深翻页不再退回纯技术流。

## 改动

- `server/feed-diversity.js`（新）：纯函数模块。话题→大类复用
  `scripts/persona-domains.js` 的 `TOPIC_DOMAINS`（取话题域表第一个非技术域，
  frontend/backend/data/language 并入 tech；20 个种子话题逐一核对与
  `seed.js TOPICS.cat` 一致，`统计学→sci` 正确）。无话题/自建话题用作者
  bio 域兜底，仍不识别归 `other`（不占保底、不进 categories 键、仍受配额）。
- `server/routes/feed.js`：`/recommended` 一次 SQL 取全候选 + 一次 IN 取话题
  （每题上限 5，出参仍截前 3），内存重排后切片；响应加 `diversity`，
  `items`/`total`/`has_more`/`page` 契约不变。following/hot 未动。
- `client/src/pages/Home.tsx`：推荐 tab 数据源 `/questions?tab=new` →
  `/feed/recommended`（此前 feed.js 注释自称「同源」但前端其实没接；
  `tab=new` 本身行为不变）。
- `scripts/assert/feed-diversity.mjs`（新）：API 级（items=20、tech_ratio≤0.5、
  非技术大类≥4、topic 三连=0、两次请求 id 序一致、按条目独立复算大类
  与 diversity.categories 对齐）+ 浏览器级（干净上下文 1440×900 首屏
  20 卡 ≥4 粒非技术胶囊、innerText>500、__errs 空、无溢出；390×844 同检）。

## 验证（临时实例 PORT=3164，DB=.backup() 自 /www/zhihucopy/data/zhihu.db）

- `feed-diversity.mjs`：**PASS** — tech_ratio=0.30，非技术 7 类，
  missing=[]，id 序两次一致；桌面首屏胶囊 29 粒 / 非技术 22 粒；
  mobile 溢出 0px。
- 回归：`feed-recommended.mjs` PASS、`feed-following.mjs` PASS、
  `e2e/home.mjs` PASS；附跑 `feed-topic-pills.mjs` PASS；
  `server npm test` 38/38 PASS。
- **反向自检（基线 https://openfolio.uk/zhihucopy）：RC=1 FAIL** —
  「响应缺 diversity.tech_ratio（疑似未修基线；按条目复算 tech 占比 0.70）」，
  与任务给出的 0.7 实测一致。
- 性能（`curl -w %{time_total}` ×5，/feed/recommended?limit=20）：
  基线 :3030 ≈ 5–9ms → 新实现 :3164 ≈ 11–17ms（121 候选全取+内存重排的
  固定开销 ~6ms，无 N+1，量级可接受）。

## 备注

- `content-residue.mjs` 在本库副本与未修基线 :3030 上**同因 FAIL**（断言
  写死「前 20 条含 id 339」，该题已从生产库删除）——既有测试债，与本改动
  无关，未动。
- 未 commit、未 stash、未改 docs/FEATURES.md。临时实例 :3164 仍在跑，
  需要时 `DB_PATH=/www/hermes-home/cache/scratch/zhdb/Z1114.db` 复现。
