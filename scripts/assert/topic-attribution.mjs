#!/usr/bin/env node
// topic-attribution.mjs — Z1140 话题归属错标修正 混合断言。
//
//   DB 级（DB_PATH，缺省 <repo>/data/zhihu.db，只读打开）：
//     1) 直接 import scripts/audit-topic-tags.mjs 的 auditDb（不复制逻辑），
//        全站话题「可疑归属率」≤ 10%；
//     3) 每道题至少保留一个话题：非测试作者的问题不存在 0 话题行。
//        （q448/q946 是 e2e/assert 脚本留的 is_test 残题，本就无话题，
//          属另一条数据卫生口径，不计入本断言。）
//   API 级（API_BASE，缺省 http://127.0.0.1:3030/zhihucopy/api）：
//     2) GET /topics/2?limit=30 的 items 不出现 q9/q20/q21/q23/q27；
//        GET /topics/5?limit=30 不出现 q4/q17/q24。
//        —— 这几个 id 是 2026-11-17 第三十四轮真实走查确认的硬错标：
//           Python 工程化/接私活/Python 爬虫/Python GIL/Redis 选型 挂在
//           JavaScript 下，event loop/Code Review 冲突/pandas 性能 挂在
//           数据库 下。
//   浏览器级（E2E_BASE，缺省 API_BASE 去 /api；不登录干净上下文）：
//     4) 1440×900 与 390×844 打开 /topic/2：.feed__item ≥ 10；
//        渲染出的 .feed__title 不含 「Python」「GIL」「Redis」「接私活」；
//        window.__errs 为空；横向溢出 scrollWidth-clientWidth === 0。
//   --self-test：把 DB 复制到临时文件，植入一条已知错标（q1 → JavaScript，
//     topic_id=2），auditDb 必须把它判为可疑且可删；另取一份不植入的副本，
//     q1 的审计行必须 0 可疑（检出率/误报率双向自检）。用后删除临时库。
//
// Env: API_BASE / E2E_BASE / DB_PATH / CHROME。
// 反向自检：对未修正库（main 的 data/zhihu.db 快照）跑本断言必须 FAIL ——
//   DB 级可疑率 23.3%（59/253）> 10%，第一步即 FAIL。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { ok, expect } from "./lib.mjs";
import { auditDb } from "../audit-topic-tags.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(
  process.env.DB_PATH || path.join(SCRIPT_DIR, "..", "..", "data", "zhihu.db")
);
const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
const BASE = (process.env.E2E_BASE || API_BASE.replace(/\/api$/, "")).replace(/\/+$/, "");
process.env.E2E_BASE ||= BASE;
// e2e/lib.mjs 顶层按 env 求值 BASE，须在赋值后动态引入。
const { run } = await import("../e2e/lib.mjs");

const requireFromServer = createRequire(new URL("../../server/package.json", import.meta.url));
const Database = requireFromServer("better-sqlite3");

// 2026-11-17 走查确认的硬错标 id（注释见文件头）。
const BANNED_IN_JS = new Set([9, 20, 21, 23, 27]);
const BANNED_IN_DB = new Set([4, 17, 24]);
const BANNED_WORDS = /python|gil|redis|接私活/i;

function openDb(p, opts = { readonly: true }) {
  return new Database(p, opts);
}

// ---------- DB 级 ----------
function checkDb() {
  expect(fs.existsSync(DB_PATH), `DB 不存在: ${DB_PATH}`);
  const db = openDb(DB_PATH);
  try {
    const report = auditDb(db);
    console.log(
      `  audit: 可疑 ${report.site.suspicious}/${report.site.total} = ` +
        `${(report.site.rate * 100).toFixed(1)}%（阈值 ≤10%）`
    );
    expect(
      report.site.rate <= 0.1,
      `全站话题可疑率 ${(report.site.rate * 100).toFixed(1)}% > 10%` +
        (report.unreplaceable.length
          ? `；另有无替代题 ${report.unreplaceable.length} 道`
          : "")
    );

    // 每题 ≥1 话题（测试作者的残题不计入，见文件头注释）。
    const orphans = db
      .prepare(
        `SELECT q.id FROM questions q
         JOIN users u ON u.id = q.author_id
         LEFT JOIN question_topics qt ON qt.question_id = q.id
         WHERE u.is_test = 0 AND qt.question_id IS NULL
         GROUP BY q.id ORDER BY q.id`
      )
      .all()
      .map((r) => r.id);
    const skipped = db
      .prepare(
        `SELECT COUNT(*) c FROM questions q JOIN users u ON u.id = q.author_id
         LEFT JOIN question_topics qt ON qt.question_id = q.id
         WHERE u.is_test = 1 AND qt.question_id IS NULL`
      )
      .get().c;
    console.log(`  0 话题题（非测试作者）: ${orphans.length}；另有测试残题 ${skipped} 道不计入`);
    expect(orphans.length === 0, `存在 0 话题的题: q${orphans.slice(0, 10).join(",q")}`);
  } finally {
    db.close();
  }
}

// ---------- API 级 ----------
async function checkApi() {
  const js = await ok("GET", "/topics/2?limit=30");
  const jsIds = new Set((js.items || []).map((i) => i.id));
  const jsBad = [...BANNED_IN_JS].filter((id) => jsIds.has(id));
  expect(jsBad.length === 0, `/topics/2 仍含硬错标 q${jsBad.join(",q")}`);

  const dbf = await ok("GET", "/topics/5?limit=30");
  const dbIds = new Set((dbf.items || []).map((i) => i.id));
  const dbBad = [...BANNED_IN_DB].filter((id) => dbIds.has(id));
  expect(dbBad.length === 0, `/topics/5 仍含硬错标 q${dbBad.join(",q")}`);
  console.log(`  api: /topics/2 ${jsIds.size} 条、/topics/5 ${dbIds.size} 条，硬错标均缺席`);
}

// ---------- 浏览器级 ----------
async function checkPage(browser, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: "zh-CN" });
  try {
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(`${BASE}/topic/2`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".feed__item", { timeout: 15000 });

    const n = await page.evaluate(() => document.querySelectorAll(".feed__item").length);
    expect(n >= 10, `${width}px：/topic/2 .feed__item ${n} < 10`);

    const badTitles = await page.evaluate((re) => {
      const rx = new RegExp(re, "i");
      return [...document.querySelectorAll(".feed__item .feed__title")]
        .map((el) => el.textContent.trim())
        .filter((t) => rx.test(t));
    }, BANNED_WORDS.source);
    expect(
      badTitles.length === 0,
      `${width}px：/topic/2 信息流标题仍含错标词: ${badTitles.slice(0, 3).join(" | ")}`
    );

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow === 0, `${width}px：横向溢出 ${overflow}px`);

    const errs = await page.evaluate(() => window.__errs || []);
    expect(errs.length === 0, `${width}px：window.__errs ${errs.length} 条: ${errs.slice(0, 3).join(" | ")}`);
    console.log(`  ${width}x${height}: feed__item=${n}，无错标词，无溢出，__errs=0`);
  } finally {
    await ctx.close();
  }
}

// ---------- --self-test ----------
async function selfTest() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "z1140-audit-"));
  const cleanCopy = path.join(tmpDir, "clean.db");
  const plantCopy = path.join(tmpDir, "plant.db");
  try {
    expect(fs.existsSync(DB_PATH), `DB 不存在: ${DB_PATH}`);
    const src = openDb(DB_PATH);
    await src.backup(cleanCopy);
    await src.backup(plantCopy);
    src.close();

    // 不植入：q1 的审计行必须 0 可疑（无误报）。
    const clean = openDb(cleanCopy);
    const cleanReport = auditDb(clean);
    clean.close();
    const cleanBad = cleanReport.rows.filter((r) => r.question_id === 1 && r.suspicious);
    expect(cleanBad.length === 0, `self-test 干净副本 q1 已有 ${cleanBad.length} 条可疑（误报）`);

    // 植入 q1 → JavaScript(topic_id=2)：必须被检出且可删（q1 的 编程 命中兜底）。
    const planted = openDb(plantCopy, {});
    planted.prepare("INSERT OR IGNORE INTO question_topics (question_id, topic_id) VALUES (1, 2)").run();
    const plantReport = auditDb(planted);
    planted.close();
    const hit = plantReport.rows.find((r) => r.question_id === 1 && r.topic === "JavaScript");
    expect(hit && hit.suspicious, "self-test 植入 (q1,JavaScript) 未被审计检出");
    expect(
      plantReport.deletions.some((d) => d.question_id === 1 && d.topic_id === 2),
      "self-test 植入行未进入可删集（q1 应有 编程 命中兜底）"
    );
    console.log("  self-test: 干净副本 q1 无误报；植入 (q1,JavaScript) 被检出且可删");
    console.log("[ASSERT] topic-attribution --self-test PASS");
    process.exit(0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

if (process.argv.includes("--self-test")) {
  selfTest().catch((e) => {
    console.error(`[ASSERT] topic-attribution --self-test FAIL: ${e.message || e}`);
    process.exit(1);
  });
} else {
  run("topic-attribution", async ({ browser }) => {
    checkDb();
    await checkApi();
    await checkPage(browser, 1440, 900);
    await checkPage(browser, 390, 844);
  });
}
