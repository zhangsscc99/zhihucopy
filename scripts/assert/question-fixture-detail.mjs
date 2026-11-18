// Z1219 — 夹具问题详情页不得当「真」返回验收：详情 404 + answer_count 同源。
//
// 流程（与 feed-fixture-guard 同一自包含口径，不依赖线上实例、不污染线上库）：
//   1) 源库（DB_PATH || <repo>/data/zhihu.db || /www/zhihucopy/data/zhihu.db）
//      用 db.backup() 复制到 mktemp 临时库；
//   2) 对临时库跑 scripts/mark-fixtures.js --apply（幂等，保证 is_fixture=1 就位）；
//   3) 自起临时 server/index.js（随机 PORT + 临时 DB），跑完连锅端掉。
//   cron 下跑需 `env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE`。
//
// 断言：
//   a) GET /api/questions/1647 返回 404，响应体与不存在 id 完全一致
//      （同走既有 NotFound 路径）；/answers 与 /related 子资源同样 404；
//   b) 首页/热榜前 20 条中抽样 5 条真实问题（is_fixture=0）：
//      详情 question.answer_count === /questions/:id/answers 的 total；
//   c) Playwright 390×844 直接打开 /question/1647 → NotFound 页
//      （main 文案命中 /(不存在|找不到|没有找到)/，可点出口 ≥2），
//      window.__errs 为空；
//   d) 脚本不创建任何对象，临时库整锅删 —— 连跑两次结果一致。

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const Database = createRequire(new URL("../../server/package.json", import.meta.url))(
  "better-sqlite3"
);

const FIXTURE_QID = Number(process.env.FIXTURE_QID || 1647);

// ---- 临时实例：复制源库 → mark-fixtures --apply → 起 server ------------------

const candidates = [
  process.env.DB_PATH,
  path.join(ROOT, "data", "zhihu.db"),
  "/www/zhihucopy/data/zhihu.db",
].filter(Boolean);
const SRC_DB = candidates.find((p) => fs.existsSync(p));
if (!SRC_DB) {
  console.error("[ASSERT] question-fixture-detail FAIL: 找不到源库（试过 " + candidates.join(", ") + "）");
  process.exit(1);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "z1219-fixture-"));
const tmpDb = path.join(tmpDir, "zhihu.db");
const port = 23000 + Math.floor(Math.random() * 20000);
const apiBase = `http://127.0.0.1:${port}/zhihucopy/api`;
const pageBase = `http://127.0.0.1:${port}/zhihucopy`;

let child = null;
function teardown() {
  try { if (child) child.kill("SIGKILL"); } catch {}
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}
process.on("exit", teardown);
process.on("SIGINT", () => { teardown(); process.exit(130); });

// 复制源库（backup 口径，WAL 一并落进副本）。
const src = new Database(SRC_DB, { readonly: true });
await src.backup(tmpDb);
src.close();
console.log(`[fixture-detail] 源库 ${SRC_DB} -> 临时库 ${tmpDb}`);

// 对临时库回填夹具标记（幂等；保证 FIXTURE_QID 在副本上确为 is_fixture=1）。
const mark = execFileSync(
  process.execPath,
  [path.join(ROOT, "scripts", "mark-fixtures.js"), "--apply", "--db", tmpDb],
  { encoding: "utf8" }
);
process.stdout.write(mark);

const fxRow = new Database(tmpDb, { readonly: true })
  .prepare("SELECT is_fixture FROM questions WHERE id = ?")
  .get(FIXTURE_QID);
if (!fxRow || fxRow.is_fixture !== 1) {
  console.error(
    `[ASSERT] question-fixture-detail FAIL: 临时库中问题 ${FIXTURE_QID} ` +
      (fxRow ? `is_fixture=${fxRow.is_fixture}` : "不存在") +
      "，无法作为夹具用例（可用 FIXTURE_QID 覆盖）"
  );
  process.exit(1);
}

// assert/lib.mjs 与 e2e/lib.mjs 都在 import 时读 env —— 先设好再 dynamic import。
process.env.API_BASE = apiBase;
process.env.E2E_BASE = pageBase;
process.env.E2E_API = apiBase;
process.env.DB_PATH = tmpDb;
process.env.ASSERT_NO_CLEANUP = "1"; // 本断言不创建任何对象，临时库整锅删。
process.env.E2E_NO_CLEANUP = "1";

child = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], {
  env: { ...process.env, PORT: String(port), DB_PATH: tmpDb, JWT_SECRET: "fixture-detail-secret" },
  stdio: ["ignore", "pipe", "inherit"],
});
child.stdout.on("data", () => {});
let up = false;
for (let i = 0; i < 150 && !up; i++) {
  if (child.exitCode !== null) break;
  try {
    const r = await fetch(`${apiBase}/health`);
    up = r.ok;
  } catch { /* not yet */ }
  if (!up) await new Promise((r) => setTimeout(r, 200));
}
if (!up) {
  console.error("[ASSERT] question-fixture-detail FAIL: 临时 server 未就绪");
  process.exit(1);
}
console.log(`[fixture-detail] 临时实例 ${pageBase} (port=${port})`);

const { req, ok, expect, main } = await import("./lib.mjs");
const { launch } = await import("../e2e/lib.mjs");

const MISSING_RE = /(不存在|找不到|没有找到)/;

function injectErrs(page) {
  return page.addInitScript(() => {
    const w = window;
    w.__errs = [];
    w.addEventListener("error", (e) => w.__errs.push(`error:${e.message}`));
    w.addEventListener("unhandledrejection", (e) =>
      w.__errs.push(`rejection:${e.reason && e.reason.message ? e.reason.message : e.reason}`)
    );
    const origError = console.error;
    console.error = (...args) => {
      w.__errs.push(`console:${args.map(String).join(" ")}`);
      return origError.apply(console, args);
    };
  });
}

main("question-fixture-detail", async () => {
  // ---- a) 夹具详情走既有 NotFound 路径：404 且响应体与不存在 id 完全一致 ----
  const fx = await req("GET", `/questions/${FIXTURE_QID}`);
  const ghost = await req("GET", "/questions/987654321");
  expect(ghost.status === 404, `参照 id 987654321 -> ${ghost.status}（预期 404）`);
  expect(
    fx.status === 404,
    `GET /questions/${FIXTURE_QID} -> ${fx.status} ${JSON.stringify(fx.data).slice(0, 160)}（预期 404）`
  );
  expect(
    JSON.stringify(fx.data) === JSON.stringify(ghost.data),
    `夹具 404 响应体与不存在 id 不一致：${JSON.stringify(fx.data)} vs ${JSON.stringify(ghost.data)}`
  );
  console.log(`  /questions/${FIXTURE_QID}: 404 响应形状与不存在 id 一致`);

  // 详情页数据口子资源同样不得当真返回。
  for (const sub of ["/answers", "/related"]) {
    const r = await req("GET", `/questions/${FIXTURE_QID}${sub}`);
    expect(
      r.status === 404 && JSON.stringify(r.data) === JSON.stringify(ghost.data),
      `GET /questions/${FIXTURE_QID}${sub} -> ${r.status}（预期 404 且形状一致）`
    );
  }
  console.log(`  /questions/${FIXTURE_QID}/{answers,related}: 404 一致`);

  // ---- b) 首页/热榜前 20 条抽样 5 条真实问题：answer_count === answers.total ----
  const pool = new Map();
  for (const p of ["/questions?tab=hot&limit=20", "/questions?tab=new&limit=20"]) {
    for (const it of (await ok("GET", p)).items || []) {
      if (it.is_fixture === 0 && !pool.has(it.id)) pool.set(it.id, it);
    }
  }
  const sample = [...pool.values()].slice(0, 5);
  expect(
    sample.length >= 5,
    `首页/热榜前 20 条可用真实问题不足 5 条（实得 ${sample.length}）`
  );
  for (const it of sample) {
    const detail = await ok("GET", `/questions/${it.id}`);
    const paged = await ok("GET", `/questions/${it.id}/answers?limit=1`);
    expect(
      detail.question.answer_count === paged.total,
      `问题 ${it.id} answer_count=${detail.question.answer_count} ` +
        `!= answers.total=${paged.total}（口径不一致）`
    );
  }
  console.log(
    `  抽样 ${sample.map((i) => i.id).join(",")}：answer_count 与 answers.total 全部同源`
  );

  // ---- c) Playwright 390×844：/question/<fixture> → NotFound 页 ----
  const browser = await launch();
  try {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "zh-CN",
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    await injectErrs(page);

    const resp = await page.goto(`${pageBase}/question/${FIXTURE_QID}`, {
      waitUntil: "domcontentloaded",
    });
    console.log(`  /question/${FIXTURE_QID} http=${resp ? resp.status() : 0}`);

    await page
      .waitForFunction(
        (re) => {
          const m = document.querySelector("main");
          return m && new RegExp(re).test(m.textContent || "");
        },
        MISSING_RE.source,
        { timeout: 10000 }
      )
      .catch(() => {});
    const text = (await page.locator("main").textContent()) || "";
    expect(
      MISSING_RE.test(text),
      `390×844 NotFound 文案缺失，main=${JSON.stringify(text.slice(0, 80))}`
    );

    const exits = await page.locator("main a[href], main button").count();
    expect(exits >= 2, `390×844 NotFound 可点出口 ${exits} < 2`);

    const errs = await page.evaluate(() => window.__errs || []);
    expect(errs.length === 0, `390×844 window.__errs 非空：${errs.slice(0, 3).join(" | ")}`);
    console.log(`  390×844: NotFound 文案命中，出口=${exits}，__errs=0`);
    await ctx.close();
  } finally {
    await browser.close().catch(() => {});
  }
});
