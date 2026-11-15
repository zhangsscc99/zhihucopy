// content-filter.js — 自动化测试产物识别（巡检/e2e/assert/验收脚本创建的内容）。
//
// 生产库实况：大量回归脚本往库里灌了 `搜索验收-*`、`[assert] q-*`、`巡检：*` 等
// 标题的问题，以及 `assert-*`/`e2e-*`/`巡检*` 昵称、`*@test.dev` 邮箱的账号。
// 本模块是唯一判定口径：公共读取路径（列表/热榜/搜索/话题流/用户列表/通知）
// 一律用下面的 SQL 片段过滤；详情页故意不过滤，老链接仍可打开。
// scripts/cleanup-test-content.js 复用同一套规则做物理删除。
//
// 注意：本文件在 server/ 根目录，不能放进 routes/ —— 该目录所有 .js 都会被
// app.js 自动挂载成 router，辅助模块放进去会导致启动失败。

// ---- 判定规则（JS 与 SQL 共用这张表，改动请同步两侧） --------------------

// 标题前缀（大小写不敏感）。`巡检` 无分隔符：覆盖「巡检：*」「巡检空态*」「巡检乙*」。
const TITLE_PREFIXES = [
  "assert-",
  "assert_",
  "e2e-",
  "e2e_",
  "probe-",
  "probe_",
  "review-",
  "review_",
  "搜索验收-",
  "验收-",
  "巡检",
];

// 标题方括号前缀（历史脚本形态：`[assert] q-*` 等）。
const TITLE_BRACKETS = ["[e2e]", "[assert]", "[review]", "[probe]", "[test]"];

// 标题包含的子串。`-mw` 是历次测试 run 的标记段（`-mwi1ooge`、`-mwhts5gs` 等），
// 单独成规；也隐含覆盖「含 验收 且含 -mwi 后缀」的组合形态。
const TITLE_CONTAINS = ["-mw"];

// 昵称前缀。`e2e`/`probe`/`review` 不要求分隔符（`e2e-mwi…` 与 `e2euser` 都算）。
const NICK_PREFIXES = [
  "assert-",
  "assert_",
  "e2e",
  "probe",
  "review",
  "搜索验收-",
  "验收-",
  "巡检",
];

// 昵称包含的子串（同 TITLE_CONTAINS 的 run 标记，可兜住 `asker-*`/`prof-*`/
// `answerer-*`/`user-*` 这类不在前缀表里的机器账号）。
const NICK_CONTAINS = ["-mw"];

// 测试邮箱域。example.com/test.local 是约定形态；test.dev/t.dev 是本仓库
// scripts/assert/lib.mjs 等回归脚本实际使用的注册域。
// 注意：example.com 是 scripts/ci-deploy.sh smoke 用户与断言脚本使用的保留域，
// 必须保持可见，不得作为测试内容判据。
const TEST_EMAIL_DOMAINS = ["test.local", "test.dev", "t.dev"];

// ---- JS 判定 ------------------------------------------------------------

function startsWithAny(s, prefixes) {
  const v = String(s || "").toLowerCase();
  return prefixes.some((p) => v.startsWith(p.toLowerCase()));
}

function containsAny(s, subs) {
  const v = String(s || "").toLowerCase();
  return subs.some((p) => v.includes(p.toLowerCase()));
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// JS 侧正则仅用于对外导出（脚本/测试可直接复用），判定走 startsWith/contains。
const TEST_TITLE_PATTERNS = [
  ...TITLE_PREFIXES.map((p) => new RegExp(`^${escapeRe(p)}`, "i")),
  ...TITLE_BRACKETS.map((p) => new RegExp(`^${escapeRe(p)}`, "i")),
  ...TITLE_CONTAINS.map((p) => new RegExp(escapeRe(p), "i")),
];
const TEST_NICK_PATTERNS = [
  ...NICK_PREFIXES.map((p) => new RegExp(`^${escapeRe(p)}`, "i")),
  ...NICK_CONTAINS.map((p) => new RegExp(escapeRe(p), "i")),
];

function isTestTitle(title) {
  return startsWithAny(title, TITLE_PREFIXES.concat(TITLE_BRACKETS)) ||
    containsAny(title, TITLE_CONTAINS);
}

function isTestNickname(nickname) {
  return startsWithAny(nickname, NICK_PREFIXES) || containsAny(nickname, NICK_CONTAINS);
}

function isTestEmail(email) {
  const v = String(email || "").toLowerCase();
  const at = v.lastIndexOf("@");
  return at >= 0 && TEST_EMAIL_DOMAINS.includes(v.slice(at + 1));
}

// 问题卡片级判定：标题像测试产物，或作者昵称像测试账号。
function isTestContent(title, nickname) {
  return isTestTitle(title) || isTestNickname(nickname);
}

// ---- SQL 片段（供路由直接拼接；返回的是完整条件串，含 NOT） ---------------

// LIKE 字面值转义：\_ \% \\，配合 ESCAPE '\'。前缀匹配（'foo%'）才能走索引。
function likeLit(s) {
  return String(s).replace(/[\\%_]/g, (c) => `\\${c}`);
}

function likePrefix(col, prefix) {
  return `${col} LIKE '${likeLit(prefix)}%' ESCAPE '\\' COLLATE NOCASE`;
}

function likeContains(col, sub) {
  return `${col} LIKE '%${likeLit(sub)}%' ESCAPE '\\' COLLATE NOCASE`;
}

function likeSuffix(col, suffix) {
  return `${col} LIKE '%${likeLit(suffix)}' ESCAPE '\\' COLLATE NOCASE`;
}

// 标题是测试产物的正向条件（不带 NOT）。
function titleMatchSql(titleCol) {
  const conds = [
    ...TITLE_PREFIXES.map((p) => likePrefix(titleCol, p)),
    ...TITLE_BRACKETS.map((p) => likePrefix(titleCol, p)),
    ...TITLE_CONTAINS.map((p) => likeContains(titleCol, p)),
  ];
  return `(${conds.join(" OR ")})`;
}

// 用户是测试账号的正向条件（昵称形态或测试邮箱域；不带 NOT）。
function userMatchSql(userAlias = "u") {
  const u = userAlias;
  const conds = [
    ...NICK_PREFIXES.map((p) => likePrefix(`${u}.nickname`, p)),
    ...NICK_CONTAINS.map((p) => likeContains(`${u}.nickname`, p)),
    ...TEST_EMAIL_DOMAINS.map((d) => likeSuffix(`${u}.email`, `@${d}`)),
  ];
  return `(${conds.join(" OR ")})`;
}

// 问题是测试产物的正向条件：标题匹配；传了 userAlias 时作者匹配也算。
// 需要 `JOIN users <uAlias> ON <uAlias>.id = <qAlias>.author_id` 才传第二个参。
function questionMatchSql(qAlias = "q", uAlias = null) {
  const conds = [titleMatchSql(`${qAlias}.title`)];
  if (uAlias) conds.push(userMatchSql(uAlias));
  return `(${conds.join(" OR ")})`;
}

// 供 WHERE 直接拼接的否定片段（task 约定：返回 NOT (...) 串）。
function testQuestionSql(qAlias = "q", uAlias = null) {
  return `NOT ${questionMatchSql(qAlias, uAlias)}`;
}

function testUserSql(uAlias = "u") {
  return `NOT ${userMatchSql(uAlias)}`;
}

// 通知过滤：actor 是测试账号，或 target 指向测试问题/测试问题下的回答。
// 用法：conds.push(testNotificationSql("n")) —— 返回 NOT (...) 完整片段。
function testNotificationSql(nAlias = "n") {
  const n = nAlias;
  return `NOT (
    EXISTS (SELECT 1 FROM users na WHERE na.id = ${n}.actor_id AND ${userMatchSql("na")})
    OR (${n}.target_type = 'question' AND EXISTS (
      SELECT 1 FROM questions nq JOIN users nu ON nu.id = nq.author_id
      WHERE nq.id = ${n}.target_id AND ${questionMatchSql("nq", "nu")}))
    OR (${n}.target_type = 'answer' AND EXISTS (
      SELECT 1 FROM answers nx
      JOIN questions nq ON nq.id = nx.question_id
      JOIN users nu ON nu.id = nq.author_id
      WHERE nx.id = ${n}.target_id AND ${questionMatchSql("nq", "nu")}))
  )`;
}

module.exports = {
  TEST_TITLE_PATTERNS,
  TEST_NICK_PATTERNS,
  TEST_EMAIL_DOMAINS,
  isTestTitle,
  isTestNickname,
  isTestEmail,
  isTestContent,
  titleMatchSql,
  userMatchSql,
  questionMatchSql,
  testQuestionSql,
  testUserSql,
  testNotificationSql,
};
