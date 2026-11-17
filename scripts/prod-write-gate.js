"use strict";
// scripts/prod-write-gate.js — 生产库受控写闸（Z1106b/Z1108b）
//
// 对 /www/zhihucopy/data/zhihu.db 的写操作必须同时满足：
//   1) 命令行含 --apply（FIX_ALLOW_PROD=1 只够解锁非生产库，不算数）
//   2) 命令行含 --prod（显式声明目标是生产库）
//   3) 环境变量 ZH_ALLOW_PROD_WRITE=1
//   4) 当日备份已存在：--backup <path> 指定，或 data/backups/ 下存在
//      zhihu-<YYYYMMDD>-*.db（文件非空且 quick_check 通过才算数）
// 缺一即拒绝并逐项打印缺什么；非生产库（worktree/临时副本）不触发本闸，
// 维持原 --apply / FIX_ALLOW_PROD=1 口径。

const fs = require("fs");
const path = require("path");

const PROD_DB = "/www/zhihucopy/data/zhihu.db";

function pad(n) {
  return String(n).padStart(2, "0");
}
function todayStamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}
function isToday(d = new Date(), file) {
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return file >= dayStart && file < dayStart + 86400000;
}
function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? path.resolve(v) : null;
}

// 找当日备份：--backup <path> 优先；缺省时扫 <db目录>/backups/zhihu-<today>-*.db。
function findTodayBackup(argv, dbPath) {
  const today = todayStamp();
  const explicit = argValue(argv, "--backup");
  if (explicit) return explicit;
  const dir = path.join(path.dirname(dbPath), "backups");
  if (!fs.existsSync(dir)) return null;
  const cands = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(`zhihu-${today}-`) && f.endsWith(".db"))
    .sort();
  return cands.length ? path.join(dir, cands[cands.length - 1]) : null;
}

// 备份须：存在、非空、当日（文件名 zhihu-<today>-* 或 mtime 在今天）、quick_check ok。
function validateBackup(backupPath, Database) {
  if (!backupPath || !fs.existsSync(backupPath)) return "不存在";
  const st = fs.statSync(backupPath);
  if (!st.size) return "文件为空";
  const named = path.basename(backupPath).startsWith(`zhihu-${todayStamp()}-`);
  if (!named && !isToday(new Date(), st.mtimeMs)) return "非当日备份";
  try {
    const b = new Database(backupPath, { readonly: true, fileMustExist: true });
    const ok = b.pragma("quick_check", { simple: true });
    b.close();
    if (ok !== "ok") return `quick_check=${ok}`;
  } catch (e) {
    return `不可读: ${e.message || e}`;
  }
  return null;
}

/**
 * @returns {"dry-run"|"apply"} 是否写库；对生产库条件不齐时打印缺项并 exit(2)。
 */
function resolveWriteMode({ argv, env, dbPath, scriptName, Database }) {
  const apply = argv.includes("--apply") || env.FIX_ALLOW_PROD === "1";
  if (apply && argv.includes("--dry-run")) {
    console.error(`[${scriptName}] --apply 与 --dry-run 不能同时用`);
    process.exit(2);
  }
  if (!apply) return "dry-run";
  if (path.resolve(dbPath) !== PROD_DB) return "apply";

  const missing = [];
  if (!argv.includes("--apply")) missing.push("--apply（FIX_ALLOW_PROD=1 不足以解锁生产库）");
  if (!argv.includes("--prod")) missing.push("--prod");
  if (env.ZH_ALLOW_PROD_WRITE !== "1") missing.push("ZH_ALLOW_PROD_WRITE=1");

  const backupPath = findTodayBackup(argv, path.resolve(dbPath));
  let backupBad = null;
  if (!backupPath) {
    missing.push("当日备份（--backup <path> 或 data/backups/zhihu-<YYYYMMDD>-*.db）");
  } else {
    backupBad = validateBackup(backupPath, Database);
    if (backupBad) missing.push(`当日备份校验未过（${backupPath}: ${backupBad}）`);
  }

  if (missing.length) {
    console.error(
      `[${scriptName}] 拒绝写生产库 ${PROD_DB}，缺 ${missing.length} 项：\n` +
        missing.map((m) => `  - ${m}`).join("\n")
    );
    process.exit(2);
  }
  console.log(`[${scriptName}] 生产库写闸通过：--apply --prod ZH_ALLOW_PROD_WRITE=1 备份=${backupPath}`);
  return "apply";
}

module.exports = { PROD_DB, resolveWriteMode };
