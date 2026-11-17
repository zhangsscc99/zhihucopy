# WORKLOG-Z1140 — 话题归属错标：审计 + 修正 + 断言

## 背景

第三十四轮走查：信息流「JavaScript」胶囊进 `/topic/2`，首条竟是「Python 项目
从脚本长成服务…」（q9），同页还有 GIL（q23）、爬虫商用（q21）、接私活（q20）、
Redis 选型（q27）。生产库核查：topic2 硬错标 5 题、topic5 硬错标 3 题
（q4/q17/q24）、topic4 硬错标 1 题（q14）。形态：每题 2–3 个标签通常只有
一个准，其余是种子分配错位。

## 交付物

### 1. `scripts/audit-topic-tags.mjs`（默认 dry-run）

- `TOPIC_KEYWORDS`：20 个话题各 ≥6 词；英文别名小写归一（javascript/js/
  react/node/typescript/event loop/promise/this/useeffect/hooks…），
  拉丁词按词边界匹配（防 `robots.txt` 误中短词），中文按子串。
- 判据：标签在 `title + detail_md` 未命中该话题任何关键词 → 「可疑」。
- 输出：逐行 `q<id> 标签 命中=…/未命中 正常|可疑→将删|可疑→无替代保留`，
  按话题汇总 可疑/总数/可疑率，末行全站合计。
- 退出码：dry-run 恒 0；`--check` 且全站可疑率 >10% → 1。

### 2. `--apply [--prod]` 修正

- 只删「可疑且同题另有命中标签」的 `question_topics` 行；全部未命中的题
  一行不删、单列「无替代，需人工判断」（本次为 0）。
- apply 前 `db.backup()` 到 `<db目录>/backups/zhihu-<YYYYMMDD-HHmm>-topic-tags.db`；
  生产库走 `prod-write-gate`（--apply --prod ZH_ALLOW_PROD_WRITE=1 + 当日备份）；
  单事务；幂等（二次 apply 0 行）；只动 `question_topics`。

### 3. `scripts/assert/topic-attribution.mjs`

1. 全站可疑率 ≤10%（import `auditDb`，不复制逻辑）；
2. `/api/topics/2?limit=30` 不含 q9/q20/q21/q23/q27、`/api/topics/5` 不含
   q4/q17/q24（2026-11-17 走查确认的硬错标，注释写明）；
3. 非测试作者问题 0 话题 = 0（q448/q946 两条 is_test 残题本就无话题，不计入）；
4. 浏览器级 1440×900 + 390×844 `/topic/2`：`.feed__item` ≥10、渲染标题无
   Python/GIL/Redis/接私活、`__errs` 空、`scrollWidth-clientWidth === 0`；
5. `--self-test`：临时库植入 (q1→JavaScript) 必检出可删、干净副本 q1 零误报，
   用后删除临时库。

## 实测记录

- 修正前审计：59/253 = **23.3%** 可疑，按话题最高 数据库 44.4%、职业规划 41.7%、
  面试/Python 38.5%。
- 反向自检：对未修正库（main 的 `data/zhihu.db` 快照）跑断言 FAIL：
  `全站话题可疑率 23.3% > 10%`（第一步即 FAIL）。
- 本地副本 apply：删 59 行；二次 apply：0 行（幂等）。
- **生产库 apply**：`ZH_ALLOW_PROD_WRITE=1 --apply --prod`，删 59 行，
  备份 `/www/zhihucopy/data/backups/zhihu-20261117-1800-topic-tags.db`。
- 修后：`/api/topics/2` 19→13 题、`/api/topics/5` 18→10 题；全站可疑率 0%。
- 断言：DB/API/双端浏览器/self-test 全 PASS；`cd server && npm test` 38/38；
  `bash scripts/verify.sh Z1140` PASS。

## 删除明细（59 行，按话题）

数据库 -8（q4,q17,q23,q24,q552,q556,q561,q564）；JavaScript -6
（q9,q10,q20,q21,q23,q27）；
Python -5（q2,q553,q558,q562,q565）；前端 -5（q3,q14,q18,q20,q561）；
编程 -5（q8,q11,q13,q248,q559）；面试 -5（q30,q31,q42,q46,q47）；
职业规划 -5（q35,q41,q44,q46,q249）；统计学 -4（q57,q63,q64,q65）；
人际 -3（q66,q68,q70）；睡眠 -3（q94,q96,q100）；情绪 -2（q66,q73）；
健康 -2（q99,q102）；职场/收纳/生活/科学/心理/教育 各 -1。

## 边界保留（命中即不删，防误杀）

q9 保留「数据库」（detail「改个数据库地址」命中）；q18 保留「数据库」
（「函数跟数据库、RPC 搅在一起」）；q22 保留「前端」（「带页面的管理系统」）；
q33/q34/q40 保留「面试」（detail 提到「简历」）；q48 保留「家居收纳」
（「收拾屋子」）；q92 保留「教育」（提到「考试」）。这些边界行都打印了命中词，
可复核。

## 说明

- 未改前端视觉、未改表结构、未动回答/评论/关注；question_topics 之外零写入。
- worktree `data/zhihu.db` 为生产库副本，已独立 apply 同等 59 行。
