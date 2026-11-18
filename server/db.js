const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");
const DEFAULT_DB_PATH = path.join(__dirname, "..", "data", "zhihu.db");

let db = null;

// 008_fixtures 的 is_fixture 列：SQLite ALTER TABLE ADD COLUMN 不支持
// IF NOT EXISTS，写成幂等补列 —— PRAGMA table_info 先判再补。表还没建
// （首迁 001 之前）时跳过，下一条文件执行前会再判，保证 008 建索引时列已就位。
function ensureFixtureColumns(d) {
  for (const table of ["questions", "answers"]) {
    const exists = d
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table);
    if (!exists) continue;
    const has = d
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .some((c) => c.name === "is_fixture");
    if (!has) {
      d.exec(`ALTER TABLE ${table} ADD COLUMN is_fixture INTEGER NOT NULL DEFAULT 0`);
    }
  }
}

function migrate(d) {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();
  const current = d.pragma("user_version", { simple: true });
  for (const file of files) {
    const version = Number(file.split("_")[0]);
    if (version <= current) continue;
    ensureFixtureColumns(d);
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    d.transaction(() => {
      d.exec(sql);
      d.pragma(`user_version = ${version}`);
    })();
  }
}

function getDb() {
  if (!db) {
    const dbPath = process.env.DB_PATH || DEFAULT_DB_PATH;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    migrate(db);
  }
  return db;
}

// Test helper: point at a fresh database and run migrations.
function resetForTests(dbPath) {
  if (db) {
    db.close();
    db = null;
  }
  process.env.DB_PATH = dbPath;
  return getDb();
}

module.exports = { getDb, resetForTests };
