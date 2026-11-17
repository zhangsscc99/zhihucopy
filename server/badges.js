// Z1013 勋章系统：规则表 + grantFor(userId, event)。
// 事件：first_question 首个提问 / first_answer 首个回答 / answer_5 满 5 答 /
//       upvote_10 累计获赞 10 / first_follower 首个粉丝。
// 授予幂等：user_badges 主键 (user_id, badge_code)，重复事件 INSERT OR IGNORE。
const { getDb } = require("./db");

const medal = (inner) =>
  `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="6.5" stroke="#0066FF" stroke-width="1.5"/>${inner}</svg>`;

const BADGES = [
  {
    code: "first_question",
    event: "first_question",
    name: "首问",
    label: "首个提问",
    title: "发布了第一个提问",
    description: "提出了第一个问题",
    icon_svg: medal(`<path d="M8 5v3l2 2" stroke="#0066FF" stroke-width="1.5" stroke-linecap="round"/>`),
    check: (db, uid) =>
      db.prepare("SELECT COUNT(*) c FROM questions WHERE author_id = ?").get(uid).c >= 1,
  },
  {
    code: "first_answer",
    event: "first_answer",
    name: "首答",
    label: "首个回答",
    title: "发布了第一个回答",
    description: "写下了第一个回答",
    icon_svg: medal(`<path d="M5 8.5l2 2 4-4" stroke="#0066FF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`),
    check: (db, uid) =>
      db.prepare("SELECT COUNT(*) c FROM answers WHERE author_id = ? AND is_deleted = 0").get(uid).c >= 1,
  },
  {
    code: "answer_5",
    event: "answer_5",
    name: "勤答",
    label: "发布 5 个回答",
    title: "累计发布了 5 个回答",
    description: "累计发布了 5 个回答",
    icon_svg: medal(`<path d="M5 6h6M5 8h6M5 10h4" stroke="#0066FF" stroke-width="1.5" stroke-linecap="round"/>`),
    check: (db, uid) =>
      db.prepare("SELECT COUNT(*) c FROM answers WHERE author_id = ? AND is_deleted = 0").get(uid).c >= 5,
  },
  {
    code: "upvote_10",
    event: "upvote_10",
    name: "十赞",
    label: "收获 10 赞",
    title: "首个回答获得 10 个赞同",
    description: "回答累计获得 10 次赞同",
    icon_svg: medal(`<path d="M8 5l2.2 3.2H9.4V11H6.6V8.2H4.8z" fill="#0066FF"/>`),
    check: (db, uid) =>
      db.prepare("SELECT COALESCE(SUM(vote_up),0) s FROM answers WHERE author_id = ? AND is_deleted = 0").get(uid).s >= 10,
  },
  {
    code: "first_follower",
    event: "first_follower",
    name: "被看见",
    label: "首个粉丝",
    title: "有人关注了你",
    description: "收获了第一个粉丝",
    icon_svg: medal(`<circle cx="8" cy="6.2" r="1.8" fill="#0066FF"/><path d="M4.8 11.5c0-1.8 1.4-2.9 3.2-2.9s3.2 1.1 3.2 2.9" stroke="#0066FF" stroke-width="1.4" stroke-linecap="round"/>`),
    check: (db, uid) =>
      db.prepare("SELECT COUNT(*) c FROM follows WHERE target_type = 'user' AND target_id = ?").get(uid).c >= 1,
  },
];

let seeded = false;
function ensureSeeded(db) {
  if (seeded) return;
  const tableExists = (name) =>
    !!db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?")
      .get(name);
  const cols = tableExists("badges")
    ? db.prepare("PRAGMA table_info(badges)").all().map((c) => c.name)
    : [];
  // 兼容：旧版 badges 是授予记录表（含 user_id、无 name），改名保留为
  // badge_grants_legacy；user_badges 的外键若因此指错表，一并重建。
  const badgesLegacy = cols.length && !cols.includes("name");
  const ubBadFk =
    tableExists("user_badges") &&
    db.prepare("PRAGMA foreign_key_list(user_badges)").all().some(
      (fk) => fk.table !== "badges" && fk.table !== "users"
    );
  if (badgesLegacy || ubBadFk) {
    // SQLite 改名会重绑外键：关 FK、事务内换表、拷数据。
    db.pragma("foreign_keys = OFF");
    db.transaction(() => {
      if (badgesLegacy) {
        db.exec("ALTER TABLE badges RENAME TO badge_grants_legacy");
      }
      if (tableExists("user_badges")) {
        db.exec("ALTER TABLE user_badges RENAME TO user_badges_old");
      }
      db.exec(`CREATE TABLE IF NOT EXISTS badges (
        code        TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        icon_svg    TEXT NOT NULL DEFAULT '',
        rule        TEXT NOT NULL DEFAULT ''
      )`);
      db.exec(`CREATE TABLE user_badges (
        user_id     INTEGER NOT NULL REFERENCES users(id),
        badge_code  TEXT NOT NULL REFERENCES badges(code),
        granted_at  TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, badge_code)
      )`);
      db.exec("CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges(user_id, granted_at DESC)");
      if (tableExists("user_badges_old")) {
        db.exec("INSERT OR IGNORE INTO user_badges SELECT user_id, badge_code, granted_at FROM user_badges_old");
        db.exec("DROP TABLE user_badges_old");
      }
    })();
    db.pragma("foreign_keys = ON");
  }
  // upsert 而非 IGNORE：徽章改名/改描述时老库里的 badges 行一并刷新。
  const ins = db.prepare(
    `INSERT INTO badges (code, name, description, icon_svg, rule) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET name=excluded.name, description=excluded.description,
       icon_svg=excluded.icon_svg, rule=excluded.rule`
  );
  for (const b of BADGES) ins.run(b.code, b.name, b.description, b.icon_svg, b.event);
  // 旧授予表仍存在时，把 code 匹配的记录并入 user_badges。
  const legacy = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='badge_grants_legacy'")
    .get();
  if (legacy) {
    db.exec(`INSERT OR IGNORE INTO user_badges (user_id, badge_code, granted_at)
             SELECT user_id, code, granted_at FROM badge_grants_legacy
             WHERE code IN (SELECT code FROM badges)`);
  }
  seeded = true;
}

// 触发入口：事件发生后调用，满足条件的勋章即授予（幂等）。
function grantFor(userId, event) {
  const db = getDb();
  ensureSeeded(db);
  const grant = db.prepare(
    "INSERT OR IGNORE INTO user_badges (user_id, badge_code) VALUES (?, ?)"
  );
  for (const b of BADGES) {
    if (b.event !== event) continue;
    try {
      if (b.check(db, userId)) grant.run(userId, b.code);
    } catch {
      // 勋章失败不阻塞主流程
    }
  }
}

// 某用户的勋章列表，按授予时间倒序。
// label/title 是 Z1123 补的展示字段：label 为可读全称（不再用缩写），
// title 为完整中文说明（悬停提示）。不入库，按 code 在读取时从 BADGES 合并，
// 未知 code 时 label 置 null，前端兜底显示 code 原文。
function listFor(userId) {
  const db = getDb();
  ensureSeeded(db);
  const meta = new Map(BADGES.map((b) => [b.code, b]));
  return db
    .prepare(
      `SELECT b.code, b.name, b.description, b.icon_svg, ub.granted_at
       FROM user_badges ub JOIN badges b ON b.code = ub.badge_code
       WHERE ub.user_id = ? ORDER BY ub.granted_at DESC, b.code`
    )
    .all(userId)
    .map((r) => {
      const m = meta.get(r.code);
      return {
        ...r,
        label: m ? m.label : null,
        title: m ? m.title : r.description || r.code,
      };
    });
}

module.exports = { grantFor, listFor, BADGES };
