#!/bin/bash
# 把当前 data/zhihu.db 打包成可直接提交的种子库（脱敏后仍保留结构与站点内容）
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/seed
rm -f data/seed/zhihu-seed.db.gz
sqlite3 data/zhihu.db ".backup '/tmp/zhihu-seed.db'"
gzip -9 -c /tmp/zhihu-seed.db > data/seed/zhihu-seed.db.gz
rm -f /tmp/zhihu-seed.db
ls -lh data/seed/zhihu-seed.db.gz
