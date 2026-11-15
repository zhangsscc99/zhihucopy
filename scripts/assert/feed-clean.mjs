// Z957 — 公共问题列表/热榜不得出现自动化产物标题。
// 静态断言：过滤常量存在且同时用在列表查询与 COUNT 查询；
// 运行时断言：GET /questions?tab=new|hot 返回的 items 无 spam 标题。
// 注意：cron 下跑本脚本需 `env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE`。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const API = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
const BAD_TITLE = /^(巡检：|\[e2e\]|\[assert\]|\[review\]|\[probe\])/;

function fail(msg) {
  console.error(`[feed-clean] FAIL: ${msg}`);
  process.exit(1);
}

const src = fs.readFileSync(path.join(ROOT, "server/routes/questions.js"), "utf8");
if (!/SPAM_TITLE_RE\s*=\s*"[^"]*q\.title LIKE/.test(src)) {
  fail("SPAM_TITLE_RE constant not found in server/routes/questions.js");
}
const spamUses = src.match(/NOT \$\{SPAM_TITLE_RE\}/g) || [];
if (spamUses.length < 2) {
  fail(`SPAM_TITLE_RE used ${spamUses.length}x in queries — need it in both list and COUNT`);
}
if (!/SELECT COUNT\(\*\) c FROM questions q WHERE NOT \$\{SPAM_TITLE_RE\}/.test(src)) {
  fail("COUNT(*) query does not apply SPAM_TITLE_RE — totals would diverge from items");
}

let n = 0;
for (const tab of ["new", "hot"]) {
  const res = await fetch(`${API}/questions?tab=${tab}&limit=30`);
  if (!res.ok) fail(`GET /questions?tab=${tab}&limit=30 -> ${res.status}`);
  const items = (await res.json()).items || [];
  for (const it of items) {
    n++;
    if (BAD_TITLE.test(it.title || "")) {
      fail(`tab=${tab} leaked spam title: ${JSON.stringify(it.title)}`);
    }
  }
}
console.log(`[feed-clean] ok (n=${n})`);
