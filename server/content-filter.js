// content-filter.js — 自动化测试产物识别（巡检/e2e/assert/验收脚本创建的内容）。
//
// 生产库实况：大量回归脚本往库里灌了 `搜索验收-*`、`[assert] q-*`、`巡检：*` 等
// 标题的问题，以及 `assert-*`/`e2e-*`/`巡检*` 昵称、`*@test.dev` 邮箱的账号。
// Z1001 线上实测的演化形态（前缀/子串规则漏掉的）：`…链路验证<uniq 去连字符>`、
// `第N轮巡检：…`、标题尾部 `srch<随机串>`、昵称 `用户<随机串>`/`巡检<随机串>`。
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

// 标题方括号前缀（历史脚本形态：`[assert] q-*` 等；`[t]` 是 Z983 起统一标记）。
const TITLE_BRACKETS = ["[e2e]", "[assert]", "[review]", "[probe]", "[test]", "[t]"];

// 标题正则：朴素前缀/子串表达不了的形态。全部大小写敏感 —— 产物随机串恒为小写，
// 借此排除 "100-mw"、"-MW1000" 这类真实写法（旧版裸 `-mw` 子串会误伤它们）。
//   -mw[a-z0-9]{4,}        run 标记段（-mwi1ooge/-mwhts5gs）；须 ≥4 位才判，边界精确
//   验证[a-z0-9]{8,}        「…链路验证<uniq 去连字符>」（问题关注链路验证qmwi5d99186yg？）
//   第?[数]+\s*轮巡检        「第六轮巡检」「6 轮巡检」（「第」与内嵌空白可有可无）
//   复盘 <token> ？          自动化复盘残留收尾形态（Z1045 返修；线上实测
//                          「首屏性能复盘 6935 ？」「前端性能复盘 h5t7a51m ？」）：
//                          「复盘」+ 空格 + 全小写拉丁/数字 token（6–10 位，
//                          或纯数字 ≥4 位）+ 空格 + 问号收尾（或 token 直接收尾）。
//                          token 只含小写字母数字，「项目复盘：我们做对了什么？」
//                          「复盘 Q3 目标」这类真实标题不命中。
const TITLE_REGEXES = [
  /-mw[a-z0-9]{4,}/,
  /验证[a-z0-9]{8,}/,
  /第?\s*[0-9一二三四五六七八九十]+\s*轮巡检/,
  /复盘[ 　]+(?:[a-z0-9]{6,10}|[0-9]{4,})[ 　]*[?？]?\s*$/,
];

// 标题尾部全小写随机串：`[a-z][a-z0-9]{9,}` 落在结尾（允许再跟一个标点），
// 且须串内含数字、标题长 > 12 才判定 —— 三重收窄：
//   · 长度门槛 >12 与含数字：排除「What is CAP theorem?」这类纯词典词尾；
//   · 串长 ≥10（而非 8）：断言脚本的真实侧命名会以 8–9 位随机后缀收尾
//     （rid()=9 位、Date.now().toString(36)=8 位），真实产物 token ≥13。
const TITLE_TAIL_RUN_RE = /([a-z][a-z0-9]{9,})[?？!！.。…\s]*$/;

// 昵称前缀（大小写不敏感）。`e2e`/`probe` 不要求分隔符（`e2e-mwi…`/`e2euser`/`probe2`
// 都算）；`巡检` 无分隔符（`巡检c41o`/`巡检用户`）。`review` 不在此列 —— 见下行。
const NICK_PREFIXES = [
  "assert-",
  "assert_",
  "e2e",
  "probe",
  "搜索验收-",
  "验收-",
  "巡检",
];

// 边界前缀：`review` 仅当其后紧跟字符不是英文字母时才算测试号
// （review_mwi…/review-x 命中；reviewer_zhang/reviews 这类真名形态豁免）。
const NICK_BOUNDED_PREFIXES = ["review"];

// 昵称正则（大小写敏感，同 TITLE_REGEXES 口径）：
//   -mw[a-z0-9]{4,}    run 标记段（兜住 asker-*/prof-*/answerer-* 等机器账号）
//   用户[a-z0-9]{8,}    「用户<uniq 去连字符>」批量注册号（用户nmwi5d93041xk）
//   巡检[a-z0-9]{2,}    「巡检c41o」小号（开头的 巡检 已被前缀规则覆盖，此处兜中缀）
//   ^rv6[a-z0-9]{3,}    「rv6<随机串>」第六轮巡检注册号（rv6s8vbt9/rv6q6cvo4）；
//                       锚定开头 + ≥3 位小写字母数字，不误伤含 rv6 的真名中缀
const NICK_REGEXES = [
  /-mw[a-z0-9]{4,}/,
  /用户[a-z0-9]{8,}/,
  /巡检[a-z0-9]{2,}/,
  /^rv6[a-z0-9]{3,}/,
];

// 测试邮箱域。example.com/test.local 是约定形态；test.dev/t.dev 是本仓库
// scripts/assert/lib.mjs 等回归脚本实际使用的注册域。
// 注意：example.com 是 scripts/ci-deploy.sh smoke 用户与断言脚本使用的保留域，
// 必须保持可见，不得作为测试内容判据。
const TEST_EMAIL_DOMAINS = ["test.local", "test.dev", "t.dev"];

// ---- 正文（评论/回答 body）判定（Z1045） ------------------------------------
// 线上实测漏网形态：真实问题/回答的评论区里「评论回写验证 rv6-<ts>」
// 「评论功能验证 comment-ui-<n>」「巡检第N轮：…」一类自动化评论。
// 规则口径比裸子串更严：中文标记是脚本固定文案原样串；拉丁标记必须带
// 「-连字符 + ≥2 位小写字母数字」后缀才判，正文里出现单词 comment/rv6 不误杀。
const BODY_MARKERS = [
  "评论回写验证",
  "评论功能验证",
  "回写验证",
  "巡检评论",
  "评论巡检",
  "巡检回答",
];

// 正文正则（大小写敏感，同 TITLE_REGEXES 口径）：
//   comment-ui-[a-z0-9]{2,}       「comment-ui-2007」UI 巡检标记
//   rv6-[a-z0-9]{4,}              「rv6-1794768549189」run 标记段
//   -mw[a-z0-9]{4,}               run 标记段（「待删除评论 d-mwi02d9s-14dw」）
//   第?[数]+\s*轮巡检              「第六轮巡检/第 6 轮巡检」
//   巡检第?[数]+\s*轮              语序相反形态（「巡检第七轮：评论功能验证」）
const BODY_REGEXES = [
  /comment-ui-[a-z0-9]{2,}/,
  /rv6-[a-z0-9]{4,}/,
  /-mw[a-z0-9]{4,}/,
  /第?\s*[0-9一二三四五六七八九十]+\s*轮巡检/,
  /巡检第?\s*[0-9一二三四五六七八九十]+\s*轮/,
];

// ---- JS 判定 ------------------------------------------------------------

function startsWithAny(s, prefixes) {
  const v = String(s || "").toLowerCase();
  return prefixes.some((p) => v.startsWith(p.toLowerCase()));
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 边界前缀：s 以 p 开头且 p 之后的字符不是英文字母（或已到结尾）。
function startsWithBounded(s, prefix) {
  const v = String(s || "");
  if (!v.toLowerCase().startsWith(prefix.toLowerCase())) return false;
  return !/[a-z]/i.test(v[prefix.length] || "");
}

// JS 侧正则仅用于对外导出（脚本/测试可直接复用）；判定走 isTestTitle/isTestNickname。
// TITLE_TAIL_RUN_RE 带长度/含数字附加条件，不折算进模式表。
const TEST_TITLE_PATTERNS = [
  ...TITLE_PREFIXES.map((p) => new RegExp(`^${escapeRe(p)}`, "i")),
  ...TITLE_BRACKETS.map((p) => new RegExp(`^${escapeRe(p)}`, "i")),
  ...TITLE_REGEXES,
];
const TEST_NICK_PATTERNS = [
  ...NICK_PREFIXES.map((p) => new RegExp(`^${escapeRe(p)}`, "i")),
  ...NICK_BOUNDED_PREFIXES.map((p) => new RegExp(`^${escapeRe(p)}(?![a-z])`, "i")),
  ...NICK_REGEXES,
];

function isTestTitle(title) {
  const v = String(title || "");
  if (startsWithAny(v, TITLE_PREFIXES.concat(TITLE_BRACKETS))) return true;
  if (TITLE_REGEXES.some((re) => re.test(v))) return true;
  if (v.length > 12) {
    const m = TITLE_TAIL_RUN_RE.exec(v);
    if (m && /[0-9]/.test(m[1])) return true;
  }
  return false;
}

function isTestNickname(nickname) {
  const v = String(nickname || "");
  if (startsWithAny(v, NICK_PREFIXES)) return true;
  if (NICK_BOUNDED_PREFIXES.some((p) => startsWithBounded(v, p))) return true;
  return NICK_REGEXES.some((re) => re.test(v));
}

function isTestEmail(email) {
  const v = String(email || "").toLowerCase();
  const at = v.lastIndexOf("@");
  return at >= 0 && TEST_EMAIL_DOMAINS.includes(v.slice(at + 1));
}

// 问题卡片级判定：标题像测试产物，或作者昵称像测试账号。
// 第三参 body 可选：评论/回答正文命中 BODY 规则同样算产物。
function isTestContent(title, nickname, body) {
  return (
    isTestTitle(title) ||
    isTestNickname(nickname) ||
    (body !== undefined && isTestBody(body))
  );
}

// 正文级判定：评论/回答 body 命中产物标记（Z1045）。
function isTestBody(body) {
  const v = String(body || "");
  if (!v) return false;
  if (BODY_MARKERS.some((m) => v.includes(m))) return true;
  return BODY_REGEXES.some((re) => re.test(v));
}

// ---- SQL 片段（供路由直接拼接；返回的是完整条件串，含 NOT） ---------------

// LIKE 字面值转义：\_ \% \\，配合 ESCAPE '\'。前缀匹配（'foo%'）才能走索引。
function likeLit(s) {
  return String(s).replace(/[\\%_]/g, (c) => `\\${c}`);
}

function likePrefix(col, prefix) {
  return `${col} LIKE '${likeLit(prefix)}%' ESCAPE '\\' COLLATE NOCASE`;
}

function likeSuffix(col, suffix) {
  return `${col} LIKE '%${likeLit(suffix)}' ESCAPE '\\' COLLATE NOCASE`;
}

// 边界前缀的 SQL 版：LIKE 前缀命中且紧跟字符不是英文字母（同 startsWithBounded）。
// GLOB 区分大小写，[a-zA-Z] 双写覆盖两态；空前缀后缀（串长恰等于前缀）由
// '' NOT GLOB '[a-zA-Z]' 天然放行。
function likeBoundedPrefix(col, prefix) {
  return `(${col} LIKE '${likeLit(prefix)}%' ESCAPE '\\' COLLATE NOCASE AND substr(${col}, ${prefix.length + 1}, 1) NOT GLOB '[a-zA-Z]')`;
}

// 「≥n 位小写字母数字」的 GLOB 形态：单字符类重复 n 次。
const globRun = (n) => "[a-z0-9]".repeat(n);

// 标题是测试产物的正向条件（不带 NOT）。与 isTestTitle 同口径：
//   前缀/括号前缀 LIKE + TITLE_REGEXES 的 GLOB 化 + 尾串近似
//   （结尾 10 连小写字母数字、或再多跟一个标点；末 16 字符内含数字；标题长 >12）。
// GLOB 区分大小写，正好对应 JS 正则的大小写敏感。
function titleMatchSql(titleCol) {
  const t = titleCol;
  const tailRun = `[a-z]${globRun(9)}`;
  const conds = [
    ...TITLE_PREFIXES.map((p) => likePrefix(t, p)),
    ...TITLE_BRACKETS.map((p) => likePrefix(t, p)),
    // -mw run 标记段（≥4 位小写随机串才判）
    `${t} GLOB '*-mw${globRun(4)}*'`,
    // 「验证」紧跟 ≥8 位小写随机串
    `${t} GLOB '*验证${globRun(8)}*'`,
    // 「第N轮巡检」：数字/中文数字紧邻（或隔一个空格）在「轮巡检」之前
    `${t} GLOB '*[0-9一二三四五六七八九十]轮巡检*'`,
    `${t} GLOB '*[0-9一二三四五六七八九十] 轮巡检*'`,
    // 「复盘 <token> ?」自动化复盘残留：token 6–10 位小写字母数字，
    // 或 4–5 位纯数字（≥6 位数字已被字母数字段覆盖）。GLOB 无区间/可选组，
    // 按长度枚举两种收尾：token+空格+？、token 直接收尾。
    ...[6, 7, 8, 9, 10].flatMap((n) => [
      `${t} GLOB '*复盘 ${globRun(n)} [?？]'`,
      `${t} GLOB '*复盘 ${globRun(n)}'`,
    ]),
    ...[4, 5].flatMap((n) => [
      `${t} GLOB '*复盘 ${"[0-9]".repeat(n)} [?？]'`,
      `${t} GLOB '*复盘 ${"[0-9]".repeat(n)}'`,
    ]),
    `(length(${t}) > 12 AND substr(${t}, -16) GLOB '*[0-9]*'
      AND (${t} GLOB '*${tailRun}' OR ${t} GLOB '*${tailRun}[?？!！.。… ]'))`,
  ];
  return `(${conds.join(" OR ")})`;
}

// 用户是测试账号的正向条件（昵称形态、测试邮箱域或 is_test 机器标记；不带 NOT）。
// opts.isTest=false 用于尚未跑 004 迁移的库（清理脚本探测列后降级）。
function userMatchSql(userAlias = "u", opts = {}) {
  const u = userAlias;
  const conds = [
    ...(opts.isTest === false ? [] : [`${u}.is_test = 1`]),
    ...NICK_PREFIXES.map((p) => likePrefix(`${u}.nickname`, p)),
    ...NICK_BOUNDED_PREFIXES.map((p) => likeBoundedPrefix(`${u}.nickname`, p)),
    // run 标记段 / 批量注册「用户<随机串>」/「巡检<随机串>」中缀
    `${u}.nickname GLOB '*-mw${globRun(4)}*'`,
    `${u}.nickname GLOB '*用户${globRun(8)}*'`,
    `${u}.nickname GLOB '*巡检${globRun(2)}*'`,
    // 「rv6<随机串>」第六轮巡检注册号：锚定开头 + ≥3 位小写字母数字
    `${u}.nickname GLOB 'rv6${globRun(3)}*'`,
    ...TEST_EMAIL_DOMAINS.map((d) => likeSuffix(`${u}.email`, `@${d}`)),
  ];
  return `(${conds.join(" OR ")})`;
}

// 问题是测试产物的正向条件：标题匹配；传了 userAlias 时作者匹配也算。
// 需要 `JOIN users <uAlias> ON <uAlias>.id = <qAlias>.author_id` 才传第二个参。
function questionMatchSql(qAlias = "q", uAlias = null, opts = {}) {
  const conds = [titleMatchSql(`${qAlias}.title`)];
  if (uAlias) conds.push(userMatchSql(uAlias, opts));
  return `(${conds.join(" OR ")})`;
}

// 供 WHERE 直接拼接的否定片段（task 约定：返回 NOT (...) 串）。
function testQuestionSql(qAlias = "q", uAlias = null, opts = {}) {
  return `NOT ${questionMatchSql(qAlias, uAlias, opts)}`;
}

function testUserSql(uAlias = "u", opts = {}) {
  return `NOT ${userMatchSql(uAlias, opts)}`;
}

// 评论/回答正文是测试产物的正向条件（不带 NOT）。与 isTestBody 同口径：
//   中文标记走 LIKE 子串；拉丁标记/轮次巡检走 GLOB（区分大小写，对应 JS 口径）。
// comment-ui- 与 rv6- 后缀各要求 ≥2/≥4 位小写字母数字 —— 与 BODY_REGEXES 对齐，
// 防「comment-ui 设计」「rv6-」这类真文形态误伤。
function bodyMatchSql(bodyCol) {
  const b = bodyCol;
  const conds = [
    ...BODY_MARKERS.map(
      (m) => `${b} LIKE '%${likeLit(m)}%' ESCAPE '\\'`
    ),
    `${b} GLOB '*comment-ui-${globRun(2)}*'`,
    `${b} GLOB '*rv6-${globRun(4)}*'`,
    `${b} GLOB '*-mw${globRun(4)}*'`,
    `${b} GLOB '*[0-9一二三四五六七八九十]轮巡检*'`,
    `${b} GLOB '*[0-9一二三四五六七八九十] 轮巡检*'`,
    `${b} GLOB '*巡检第[0-9一二三四五六七八九十]轮*'`,
    `${b} GLOB '*巡检第[0-9一二三四五六七八九十] 轮*'`,
    `${b} GLOB '*巡检[0-9一二三四五六七八九十]轮*'`,
    `${b} GLOB '*巡检[0-9一二三四五六七八九十] 轮*'`,
  ];
  return `(${conds.join(" OR ")})`;
}

// 评论是测试产物的正向条件：正文命中 BODY 规则，或作者命中测试账号口径。
// 需要 `JOIN users <uAlias> ON <uAlias>.id = <cAlias>.author_id`。
function commentMatchSql(cAlias = "c", uAlias = "u", opts = {}) {
  return `(${bodyMatchSql(`${cAlias}.content`)} OR ${userMatchSql(uAlias, opts)})`;
}

// 供 WHERE 拼接的否定片段（同 testQuestionSql/testUserSql 约定）。
function testCommentSql(cAlias = "c", uAlias = "u", opts = {}) {
  return `NOT ${commentMatchSql(cAlias, uAlias, opts)}`;
}

// 通知过滤：actor 是测试账号，或 target 指向测试问题/测试问题下的回答。
// 用法：conds.push(testNotificationSql("n")) —— 返回 NOT (...) 完整片段。
function testNotificationSql(nAlias = "n", opts = {}) {
  const n = nAlias;
  return `NOT (
    EXISTS (SELECT 1 FROM users na WHERE na.id = ${n}.actor_id AND ${userMatchSql("na", opts)})
    OR (${n}.target_type = 'question' AND EXISTS (
      SELECT 1 FROM questions nq JOIN users nu ON nu.id = nq.author_id
      WHERE nq.id = ${n}.target_id AND ${questionMatchSql("nq", "nu", opts)}))
    OR (${n}.target_type = 'answer' AND EXISTS (
      SELECT 1 FROM answers nx
      JOIN questions nq ON nq.id = nx.question_id
      JOIN users nu ON nu.id = nq.author_id
      WHERE nx.id = ${n}.target_id AND ${questionMatchSql("nq", "nu", opts)}))
  )`;
}

module.exports = {
  TEST_TITLE_PATTERNS,
  TEST_NICK_PATTERNS,
  TEST_EMAIL_DOMAINS,
  TITLE_TAIL_RUN_RE,
  isTestTitle,
  isTestNickname,
  isTestEmail,
  isTestContent,
  isTestBody,
  titleMatchSql,
  userMatchSql,
  questionMatchSql,
  bodyMatchSql,
  commentMatchSql,
  testQuestionSql,
  testUserSql,
  testCommentSql,
  testNotificationSql,
};
