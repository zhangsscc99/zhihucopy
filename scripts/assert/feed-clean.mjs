// Z957 — 公共问题列表/热榜不得出现自动化产物标题。
// 静态断言：content-filter 模块存在且 questions.js 在列表查询与 COUNT 查询都套了过滤；
// 运行时断言：GET /questions?tab=new|hot 返回的 items 无测试产物标题/作者。
// 注意：cron 下跑本脚本需 `env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE`。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const API = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
// 与线上过滤同一判定口径（server/content-filter.js 是 CJS，用 createRequire 引入）。
const { isTestTitle, isTestNickname } = createRequire(import.meta.url)(
  "../../server/content-filter.js"
);

function fail(msg) {
  console.error(`[feed-clean] FAIL: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(ROOT, "server/content-filter.js"))) {
  fail("server/content-filter.js not found");
}
const src = fs.readFileSync(path.join(ROOT, "server/routes/questions.js"), "utf8");
if (!/content-filter/.test(src)) {
  fail("questions.js does not import ../content-filter");
}
// 语义校验（推荐形态）：conds 首项就是测试产物过滤片段，list 与 COUNT 两条 SQL
// 插值同一个 ${where} —— 口径一定一致，与拼接细节解耦。
const condsFirst = /\bconds\s*=\s*\[\s*testQuestionSql\(/.test(src);
const whereFromConds = /\bwhere\s*=\s*conds\.join\(/.test(src);
const listShared = /FROM questions q\s+JOIN users u ON u\.id = q\.author_id\s+WHERE \$\{where\}/.test(src);
const countShared = /SELECT COUNT\(\*\) c FROM questions q\s+JOIN users u ON u\.id = q\.author_id\s+WHERE \$\{where\}/.test(src);
const semanticOk = condsFirst && whereFromConds && listShared && countShared;
// 宽松兜底：仍是「两条 SQL 各自插 ${testQuestionSql("…")}」的旧写法也算过。
const inlineUses = (src.match(/\$\{testQuestionSql\("/g) || []).length;
const countInline = /SELECT COUNT\(\*\) c FROM questions q\s+JOIN users u ON u\.id = q\.author_id\s+WHERE \$\{testQuestionSql\("/.test(src);
const legacyOk = inlineUses >= 2 && countInline;
if (!semanticOk && !legacyOk) {
  fail(
    `testQuestionSql 未同时约束 list 与 COUNT —— ` +
      `condsFirst=${condsFirst} sharedWhere=${whereFromConds && listShared && countShared} inline=${inlineUses}x`
  );
}

let n = 0;
for (const tab of ["new", "hot"]) {
  const res = await fetch(`${API}/questions?tab=${tab}&limit=30`);
  if (!res.ok) fail(`GET /questions?tab=${tab}&limit=30 -> ${res.status}`);
  const items = (await res.json()).items || [];
  for (const it of items) {
    n++;
    if (isTestTitle(it.title)) {
      fail(`tab=${tab} leaked test title: ${JSON.stringify(it.title)}`);
    }
    if (it.author && isTestNickname(it.author.nickname)) {
      fail(`tab=${tab} leaked test author: ${JSON.stringify(it.author.nickname)}`);
    }
  }
}
console.log(`[feed-clean] ok (n=${n})`);
