# 知乎（仿）站点数据种子

`zhihu-seed.db.gz` 是从线上 `data/zhihu.db` 做的一致性快照（sqlite .backup，不是直接拷文件）。

## 内容规模（2026-11-22 快照）
- users 752 / questions 190 / answers 455 / comments 651

## 还原
```bash
gunzip -c data/seed/zhihu-seed.db.gz > data/zhihu.db
```

## 重新生成
```bash
bash scripts/dump-seed.sh
```
