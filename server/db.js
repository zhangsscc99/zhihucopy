const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");
const DEFAULT_DB_PATH = path.join(__dirname, "..", "data", "zhihu.db");

let db = null;

function migrate(d) {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();
  const current = d.pragma("user_version", { simple: true });
  for (const file of files) {
    const version = Number(file.split("_")[0]);
    if (version <= current) continue;
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
