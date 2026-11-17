#!/usr/bin/env node
// scripts/backup-db.mjs — 把目标库备份到 data/backups/zhihu-<YYYYMMDD>-<HHmm>.db
//
// 用 better-sqlite3 的 db.backup()（等价 sqlite .backup），WAL 内容一并落进
// 备份文件，与在线库读到的视图一致。完成后打印备份路径与文件大小。
//
// 用法：
//   node scripts/backup-db.mjs                 # 备份默认 <repo>/data/zhihu.db
//   DB_PATH=/path/zhihu.db node scripts/backup-db.mjs
//   node scripts/backup-db.mjs --out <path>    # 自定义输出路径

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const requireFromServer = createRequire(new URL("../server/package.json", import.meta.url));
const Database = requireFromServer("better-sqlite3");

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DB_PATH = path.resolve(process.env.DB_PATH || path.join(repoRoot, "data", "zhihu.db"));

const argv = process.argv.slice(2);
const outIdx = argv.indexOf("--out");

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

const backupPath =
  outIdx >= 0 && argv[outIdx + 1]
    ? path.resolve(argv[outIdx + 1])
    : path.join(path.dirname(DB_PATH), "backups", `zhihu-${stamp()}.db`);

fs.mkdirSync(path.dirname(backupPath), { recursive: true });

const db = new Database(DB_PATH, { readonly: true });
await db.backup(backupPath);
db.close();

const size = fs.statSync(backupPath).size;
console.log(`[backup-db] ${DB_PATH} -> ${backupPath}`);
console.log(`[backup-db] 备份大小: ${size} bytes (${(size / 1024 / 1024).toFixed(2)} MiB)`);
