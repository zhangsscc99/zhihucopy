const { test } = require("node:test");
const assert = require("node:assert");
const Database = require("better-sqlite3");

const {
  isTestTitle,
  isTestNickname,
  isTestContent,
  isTestEmail,
  titleMatchSql,
  userMatchSql,
  questionMatchSql,
  testQuestionSql,
} = require("../content-filter");

// 线上实测漏网形态（2026-11-15 ?tab=new 首屏）—— 必须命中。
const BAD_TITLES = [
  "第六轮巡检：通知文案去重 1794769250582",
  "关注流链路验证qmwi5d97q6w8？",
  "话题关注链路验证qmwi5d98q76cm？",
  "问题关注链路验证qmwi5d99186yg？",
  "前端性能排查记录srchmwi5d5t32510",
  "通知链路验证qmwi5c7hi45i？",
];
const BAD_NICKNAMES = ["用户nmwi5d93041xk", "巡检c41o"];

// 正常形态 —— 不得误杀。
const GOOD_TITLES = [
  "为什么 Rust 的所有权设计更安全？",
  "What is CAP theorem?",
  "2026 年你读过的书",
];
const GOOD_NICKNAMES = ["reviewer_zhang"];

test("isTestTitle: 漏网产物形态全部命中", () => {
  for (const t of BAD_TITLES) assert.equal(isTestTitle(t), true, `未命中: ${t}`);
});

test("isTestTitle: 正常标题不误杀", () => {
  for (const t of GOOD_TITLES) assert.equal(isTestTitle(t), false, `误杀: ${t}`);
  assert.equal(isTestTitle("reviewer_zhang"), false);
});

test("isTestTitle: -mw 边界精确到 ≥4 位小写随机串", () => {
  assert.equal(isTestTitle("回归记录 x-mwi1ooge"), true);
  assert.equal(isTestTitle("回归记录 x-mw"), false);
  assert.equal(isTestTitle("回归记录 x-mw12"), false); // 仅 2 位
  assert.equal(isTestTitle("回归记录 x-mw1234"), true);
  assert.equal(isTestTitle("100-mw 激光器值得买吗"), false); // -mw 后非字母数字
  assert.equal(isTestTitle("记录 x-MWI1OOGE"), false); // 大写不算（随机串恒小写）
});

test("isTestTitle: 「验证」须紧跟 ≥8 位小写随机串", () => {
  assert.equal(isTestTitle("链路验证qmwi5d99186yg？"), true);
  assert.equal(isTestTitle("链路验证abc12345"), true);
  assert.equal(isTestTitle("如何验证一个猜想是否正确？"), false); // 验证后是中文字
  assert.equal(isTestTitle("链路验证 abc12345"), false); // 空格隔开不算「紧跟」（尾串 8 位也不够长）
  assert.equal(isTestTitle("链路验证abc123"), false); // 仅 6 位
  assert.equal(isTestTitle("链路验证 qmwi5d99186yg"), true); // 尾串规则兜住
});

test("isTestTitle: 第N轮巡检形态", () => {
  assert.equal(isTestTitle("第六轮巡检：通知文案去重 1794769250582"), true);
  assert.equal(isTestTitle("第 6 轮巡检报告"), true);
  assert.equal(isTestTitle("六轮巡检记录"), true); // 「第」可有可无
});

test("isTestTitle: 尾部随机串的三重收窄", () => {
  assert.equal(isTestTitle("前端性能排查记录srchmwi5d5t32510"), true);
  assert.equal(isTestTitle("前端性能排查记录srchmwi5d5t32510？"), true);
  // 纯词典词尾（无数字）不判
  assert.equal(isTestTitle("What is kubernetes?"), false);
  // 8–9 位短随机尾（断言脚本真实侧命名）不判
  assert.equal(isTestTitle("Z988 个人主页可见性问题 mwi5d930?"), false);
  assert.equal(isTestTitle("真实问题 r0a1b2c3d？"), false);
  // 标题 ≤12 不判
  assert.equal(isTestTitle("短题a1b2c3d4e5"), false);
});

test("isTestNickname: 产物昵称命中，正常昵称不误杀", () => {
  for (const n of BAD_NICKNAMES) assert.equal(isTestNickname(n), true, `未命中: ${n}`);
  for (const n of GOOD_NICKNAMES) assert.equal(isTestNickname(n), false, `误杀: ${n}`);
  assert.equal(isTestNickname("z985usermwi5d930"), false);
  assert.equal(isTestNickname("真人nmwi5d93041xk"), false);
});

test("isTestNickname: review 前缀须边界（reviewer 真名豁免）", () => {
  assert.equal(isTestNickname("reviewer_zhang"), false);
  assert.equal(isTestNickname("reviews"), false);
  assert.equal(isTestNickname("ReviewerLi"), false);
  assert.equal(isTestNickname("review_mwi5d9"), true);
  assert.equal(isTestNickname("review-mwi5d9"), true);
  assert.equal(isTestNickname("review2"), true); // 数字非字母，算边界
  assert.equal(isTestNickname("e2euser"), true); // 既有口径不变
  assert.equal(isTestNickname("probe2"), true);
});

test("isTestNickname: 用户<随机串> 与 巡检<随机串>", () => {
  assert.equal(isTestNickname("用户nmwi5d93041xk"), true);
  assert.equal(isTestNickname("用户abc12345"), true);
  assert.equal(isTestNickname("用户反馈收集员"), false);
  assert.equal(isTestNickname("巡检c41o"), true);
  assert.equal(isTestNickname("巡检用户"), true); // 前缀规则
});

test("isTestContent / isTestEmail", () => {
  assert.equal(isTestContent("What is CAP theorem?", "reviewer_zhang"), false);
  assert.equal(isTestContent("关注流链路验证qmwi5d97q6w8？", "阿明"), true);
  assert.equal(isTestContent("普通问题？", "用户nmwi5d93041xk"), true);
  assert.equal(isTestEmail("a@test.dev"), true);
  assert.equal(isTestEmail("a@example.com"), false); // 保留域必须可见
});

// ---- JS ↔ SQL 口径一致：同一张样本表两侧判定必须相同 ----------------------

test("titleMatchSql/userMatchSql 与 JS 判定口径一致", () => {
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE tq(title TEXT);" +
      "CREATE TABLE tu(nickname TEXT, email TEXT, is_test INTEGER DEFAULT 0)"
  );
  const insQ = db.prepare("INSERT INTO tq(title) VALUES (?)");
  const insU = db.prepare("INSERT INTO tu(nickname, email) VALUES (?, ?)");
  const titles = [...BAD_TITLES, ...GOOD_TITLES, "reviewer_zhang", "记录 x-mw", "Z988 个人主页可见性问题 mwi5d930?"];
  const users = [
    ...BAD_NICKNAMES.map((n) => [n, "x@zhihucopy.dev"]),
    ...GOOD_NICKNAMES.map((n) => [n, "x@zhihucopy.dev"]),
    ["assert-x1", "x@zhihucopy.dev"],
    ["阿明", "a@test.dev"],
    ["review_mw01", "x@zhihucopy.dev"],
    ["阿明二号", "a@example.com"],
  ];
  for (const t of titles) insQ.run(t);
  for (const [n, e] of users) insU.run(n, e);

  const sqlTitles = new Set(
    db.prepare(`SELECT title FROM tq WHERE ${titleMatchSql("title")}`).all().map((r) => r.title)
  );
  for (const t of titles) {
    assert.equal(sqlTitles.has(t), isTestTitle(t), `title SQL/JS 不一致: ${t}`);
  }

  const sqlUsers = new Set(
    db.prepare(`SELECT nickname FROM tu u WHERE ${userMatchSql("u", { isTest: false })}`).all().map((r) => r.nickname)
  );
  for (const [n, e] of users) {
    const js = isTestNickname(n) || isTestEmail(e);
    assert.equal(sqlUsers.has(n), js, `user SQL/JS 不一致: ${n} <${e}>`);
  }
  db.close();
});

test("testQuestionSql/questionMatchSql 形态与用法兼容", () => {
  const s = testQuestionSql("q", "u");
  assert.match(s, /^NOT \(/);
  assert.match(s, /GLOB/); // 新兜底规则已进 SQL 片段
  const q = questionMatchSql("q");
  assert.match(q, /^\(/);
  assert.ok(!q.includes("u.nickname"), "不传 uAlias 时不应引用用户列");
});
