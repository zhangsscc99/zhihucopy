# WORKLOG-Z1106b — Z1106b/Z1108b 受控写生产库 + 验证

日期：2026-11-17。范围：不改 seed.js 判定逻辑，只把已合入的人设/尾巴修复应用到生产库 `/www/zhihucopy/data/zhihu.db` 并验证。

## 1. 备份

新增 `scripts/backup-db.mjs`（better-sqlite3 `db.backup()`，WAL 一致），产出：

```
[backup-db] /www/zhihucopy/data/zhihu.db -> /www/zhihucopy/data/backups/zhihu-20261117-0802.db
[backup-db] 备份大小: 5394432 bytes (5.14 MiB)
```

apply 过程中脚本自身又各备一份（既有行为）：
`zhihu-20261117080354-authors.db`、`zhihu-20261117080359-tails.db`（各 5394432 bytes）。

## 2. 受控生产开关

新增 `scripts/prod-write-gate.js`：对 `/www/zhihucopy/data/zhihu.db` 的写操作必须同时满足
`--apply` + `--prod` + `ZH_ALLOW_PROD_WRITE=1` + 当日备份（`--backup <path>` 或 `data/backups/zhihu-<YYYYMMDD>-*.db`，
文件非空且 `quick_check=ok`），缺一即 exit(2) 并逐项打印缺项。非生产库维持 `--apply`/`FIX_ALLOW_PROD=1` 原口径；
`--apply` 与 `--dry-run` 互斥。

拒绝路径自证：

```
$ node scripts/fix-answer-authors-by-domain.js --apply
[fix-authors] 拒绝写生产库 /www/zhihucopy/data/zhihu.db，缺 2 项：
  - --prod
  - ZH_ALLOW_PROD_WRITE=1        (exit=2；当日备份经目录扫描命中故不缺)

$ FIX_ALLOW_PROD=1 node scripts/clean-answer-tails.js
[clean-tails] 拒绝写生产库 /www/zhihucopy/data/zhihu.db，缺 3 项：
  - --apply（FIX_ALLOW_PROD=1 不足以解锁生产库）
  - --prod
  - ZH_ALLOW_PROD_WRITE=1        (exit=2)

$ node scripts/clean-answer-tails.js --apply --prod
[clean-tails] 拒绝写生产库 /www/zhihucopy/data/zhihu.db，缺 1 项：
  - ZH_ALLOW_PROD_WRITE=1        (exit=2)
```

## 3. dry-run → apply

```
$ node scripts/fix-answer-authors-by-domain.js
[fix-authors] mode=dry-run db=/www/zhihucopy/data/zhihu.db
[fix-authors] 回答总数=302 需重排=5 无话题跳过=0
  回答 #18 q#6 「写了三年 React，还是没搞懂 useEffect 的清理」: 温故52(data+sci) -> 阿罗(backend)
  回答 #35 q#12 「移动端 H5 在低端安卓机上的卡顿…」: 木子李59(backend) -> 林间有风92(frontend)
  回答 #44 q#15 「什么时候才应该考虑分库分表？…」: 林间有风62(frontend) -> 老周写代码35(backend)
  回答 #102 q#29 「JavaScript 的 this 到底该怎么理解？…」: 半山腰94(data) -> 木子李59(backend)
  回答 #263 q#72 「为什么有些人相处起来很轻松？…」: 夏至未至141(health) -> 余光109(work)

$ node scripts/clean-answer-tails.js --dry-run
[clean-tails] mode=dry-run db=/www/zhihucopy/data/zhihu.db
[clean-tails] 标记命中 2 条；可切(forbidden cat)=1 保留(allowed cat)=1
  answer#18 「写了三年 React…useEffect 的清理函数…」 topic=JavaScript(code)
    切除: …\n\n> 别照抄文里的参数和阈值，那些数字是我这台机器、这份数据上跑出来的，换环境先小流量验证。

$ ZH_ALLOW_PROD_WRITE=1 node scripts/fix-answer-authors-by-domain.js --apply --prod --backup /www/zhihucopy/data/backups/zhihu-20261117-0802.db
[fix-authors] 生产库写闸通过：--apply --prod ZH_ALLOW_PROD_WRITE=1 备份=/www/zhihucopy/data/backups/zhihu-20261117-0802.db
[fix-authors] 已备份: /www/zhihucopy/data/backups/zhihu-20261117080354-authors.db
[fix-authors] apply 完成：改写 5 条 author_id

$ ZH_ALLOW_PROD_WRITE=1 node scripts/clean-answer-tails.js --apply --prod --backup /www/zhihucopy/data/backups/zhihu-20261117-0802.db
[clean-tails] 生产库写闸通过：--apply --prod ZH_ALLOW_PROD_WRITE=1 备份=/www/zhihucopy/data/backups/zhihu-20261117-0802.db
[clean-tails] 写库前备份完成：/www/zhihucopy/data/backups/zhihu-20261117080359-tails.db
[clean-tails] apply 完成：切除 1 条
```

写入面：answers.author_id ×5、answers.content_md ×1；users 表仅经 fixer 既有逻辑按 seed 同口径
重算 salt_value/level（该 UPDATE 属已合入脚本的一部分，未另行手改 users 其它字段）。
幂等复查：两脚本二次 dry-run 均为 0 条计划。

## 4. 验证（生产库）

```
$ DB_PATH=/www/zhihucopy/data/zhihu.db node scripts/assert/seed-bio-consistency.mjs
全库回答=302 判定=302 bio 为空=0 无话题=0
命中=302（其中仅靠 bio 跨域声明=0）错位=0 命中率=100.0%
大类兜底话题命中=0（话题级覆盖 100%）
跨界人设回答=38：全部 ✓（明细略，见 assert 输出）
[ASSERT] seed-bio-consistency PASS (0.0s)

$ DB_PATH=/www/zhihucopy/data/zhihu.db node scripts/assert/answer-tail-domain.mjs
PASS db: code/psy/edu 话题回答无数据免责尾巴 — 违规=0
PASS db: 允许类话题的数据免责尾巴只出现在末段 — 命中=1 居中=0
PASS db: 数据免责尾巴以 `>` 引用收尾 — 命中=1
3/3

$ bash scripts/verify.sh Z1106   → [VERIFY] Z1106 PASS (0.16s)
$ bash scripts/verify.sh Z1108   → [VERIFY] Z1108 PASS (0.16s)
$ node scripts/assert/stats-consistency.mjs → [ASSERT] stats-consistency PASS
```

公网复核（服务 3030，改库即时生效）：

```
$ curl -s 'http://127.0.0.1:3030/zhihucopy/api/questions/6' | grep -o '"nickname":"[^"]*"' | head -5
"nickname":"半山腰214"     ← 首答作者，非温故52
"nickname":"阿罗"          ← answer#18 新作者
"nickname":"山月47"
"nickname":"林间有风"

$ curl -s '.../api/questions/6' | grep -c '别照抄'
0                          ← 跨话题尾巴已切除
```

## 5. 残留错位

无。apply 后两条断言 100%/3-3 PASS，未放宽任何断言阈值或 TOPIC_DOMAINS。
