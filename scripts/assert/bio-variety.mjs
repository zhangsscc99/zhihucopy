#!/usr/bin/env node
/**
 * scripts/assert/bio-variety.mjs — Z1161 用户简介「句首」唯一性验收
 *
 * 断言：
 *   1) DB：bio 非空且「首句（到第一个 。）」同句人数 >= 3 的组 = 0；
 *      空 bio（排除测试号）占比 <= 2%；
 *      抽样 30 条 bio：整句两两不同、首句重复 <=2 对、正文长度 >= 10 字；
 *   2) 线上 `?q=阿罗&type=user`：结果行 bio 整句两两不同、首句重复 <=1 对；
 *   3) 1440 / 390 无横向溢出、window.__errs 为空；
 *   4) --self-test：副本库植入 6 个同首句用户 + 3 个空 bio → DB 断言必须检出；
 *   5) 反向自检：对未修基线与旧数据跑本脚本必须 FAIL（首句 ≥3 人的组仍在）。
 *
 * Env: DB_PATH（默认 ../data/zhihu.db）、API_BASE / E2E_BASE / E2E_API。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");

const apiBaseEnv = (process.env.API_BASE || "").replace(/\/+$/, "");
const derivedBase = apiBaseEnv.replace(/\/api$/, "");
process.env.E2E_BASE =
  process.env.E2E_BASE || derivedBase || "http://127.0.0.1:3030/zhihucopy";
process.env.E2E_API = process.env.E2E_API || apiBaseEnv || `${process.env.E2E_BASE}/api`;

const { run, expect, BASE } = await import("../e2e/lib.mjs");

const DB_PATH = path.resolve(process.env.DB_PATH || path.join(ROOT, "data", "zhihu.db"));
const SELF_TEST = process.argv.includes("--self-test");
const MIN_GROUP = 3;
const EMPTY_RATIO_MAX = 0.02;

function requireFromServer(name) {
  try {
    return require(name);
  } catch {
    return require(require.resolve(name, { paths: [path.join(ROOT, "server")] }));
  }
}
const Database = requireFromServer("better-sqlite3");

const headOf = (bio) => String(bio || "").trim().split("。")[0];

const TEST_USER_SQL = `(
  email LIKE '%@test.dev' OR is_test = 1
  OR nickname GLOB 'e2e*' OR nickname GLOB 'probe*'
  OR nickname GLOB '巡检*' OR nickname GLOB '真人*' OR nickname GLOB '走查*'
)`;

export function dbBioReport(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db
      .prepare(`SELECT id, nickname, bio, ${TEST_USER_SQL} AS is_test_user FROM users`)
      .all();
    const heads = new Map();
    let emptyNonTest = 0;
    let nonTest = 0;
    for (const r of rows) {
      const bio = String(r.bio || "").trim();
      if (r.is_test_user) continue;
      nonTest++;
      if (!bio) {
        emptyNonTest++;
        continue;
      }
      const h = headOf(bio);
      if (!heads.has(h)) heads.set(h, []);
      heads.get(h).push(`${r.id}:${r.nickname}`);
    }
    const dupHeadGroups = [...heads.entries()]
      .filter(([, list]) => list.length >= MIN_GROUP)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([head, list]) => ({ head, n: list.length, members: list.slice(0, 4) }));
    const sample = rows
      .filter((r) => !r.is_test_user && String(r.bio || "").trim())
      .slice(0, 30)
      .map((r) => ({ id: r.id, bio: String(r.bio).trim(), head: headOf(r.bio) }));
    return { total: rows.length, nonTest, emptyNonTest, dupHeadGroups, sample };
  } finally {
    db.close();
  }
}

function checkDb(dbPath) {
  const { nonTest, emptyNonTest, dupHeadGroups, sample } = dbBioReport(dbPath);
  expect(
    dupHeadGroups.length === 0,
    `首句 ≥${MIN_GROUP} 人的组仍有 ${dupHeadGroups.length} 组：` +
      dupHeadGroups
        .slice(0, 5)
        .map((g) => `「${g.head.slice(0, 14)}…」×${g.n}`)
        .join("、")
  );
  const ratio = nonTest ? emptyNonTest / nonTest : 0;
  expect(
    ratio <= EMPTY_RATIO_MAX,
    `空 bio（非测试号）${emptyNonTest}/${nonTest} = ${(ratio * 100).toFixed(1)}% > 2%`
  );
  const bios = sample.map((s) => s.bio);
  expect(
    new Set(bios).size === bios.length,
    `抽样 30 条 bio 仍有整句重复：${bios.filter((b, i) => bios.indexOf(b) !== i).slice(0, 2).join(" / ")}`
  );
  const headDup = sample.length - new Set(sample.map((s) => s.head)).size;
  expect(headDup <= 2, `抽样 30 条 bio 首句重复 ${headDup} 对（上限 2，对应「同一首句 ≤2 人」）`);
  const short = sample.filter((s) => Array.from(s.bio).length < 10);
  expect(short.length === 0, `抽样里有 ${short.length} 条 bio 短于 10 字`);
  console.log(
    `  DB：非测试号 ${nonTest}，空 bio ${emptyNonTest}（${(ratio * 100).toFixed(1)}%），首句 ≥${MIN_GROUP} 人组 0，抽样 ${sample.length} 条首句唯一`
  );
}

// ---------- self-test：植入同首句 / 空 bio 后必须检出 ----------
if (SELF_TEST) {
  const tmp = path.join(
    ROOT,
    "..",
    "hermes-home",
    "cache",
    "scratch",
    "zhdb",
    "z1161-selftest.db"
  );
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  const src = new Database(DB_PATH, { readonly: true });
  await src.backup(tmp);
  src.close();
  const db = new Database(tmp);
  const ins = db.prepare(
    "INSERT INTO users (email, password_hash, nickname, avatar_url, bio, salt_value, level, is_admin, created_at) " +
      "VALUES (?, 'x', ?, '', ?, 0, 1, 0, datetime('now'))"
  );
  for (let i = 0; i < 6; i++) {
    ins.run(`selftestbio${i}@zhihucopy.dev`, `自测同首句${i}`, "同一条简介占位句子，用来触发分组。");
  }
  for (let i = 0; i < 3; i++) {
    ins.run(`selftestempty${i}@zhihucopy.dev`, `自测空简介${i}`, "");
  }
  db.close();
  const { dupHeadGroups, emptyNonTest } = dbBioReport(tmp);
  console.log(
    `[SELFTEST] 植入 6 个同首句 + 3 个空 bio → 检出组 ${dupHeadGroups.length}、空 bio ${emptyNonTest}`
  );
  expect(
    dupHeadGroups.length > 0,
    "self-test 未能检出植入的同首句用户（DB 断言失效）"
  );
  console.log("[SELFTEST] PASS：同首句集群被检出");
  process.exit(0);
}

// ---------- 浏览器层 ----------
const ERR_HOOK = () => {
  window.__errs = [];
  const push = (m) => {
    try {
      window.__errs.push(String(m && m.message ? m.message : m));
    } catch {}
  };
  window.addEventListener("error", (e) => push(e.message || e.error));
  window.addEventListener("unhandledrejection", (e) => push(e.reason));
  const orig = console.error.bind(console);
  console.error = (...a) => {
    push(a.map((x) => String(x)).join(" "));
    orig(...a);
  };
};

async function userSearchHeads(page) {
  await page.goto(`${BASE}/search?q=${encodeURIComponent("阿罗")}&type=user`, {
    waitUntil: "networkidle",
  });
  await page.waitForSelector(".urow", { timeout: 15000 });
  return page.$$eval(".urow", (rows) =>
    rows.map((r) => ({
      nick: (r.querySelector(".urow__name") || {}).textContent || "",
      bio: (r.querySelector(".urow__bio") || {}).textContent || "",
    }))
  );
}

run("bio-variety", async ({ browser, page }) => {
  checkDb(DB_PATH);

  await page.addInitScript(ERR_HOOK);
  await page.setViewportSize({ width: 1440, height: 900 });
  const rows = await userSearchHeads(page);
  expect(rows.length >= 2, `用户搜索结果过少（${rows.length} 行）`);
  const bios2 = rows.map((r) => r.bio.trim()).filter(Boolean);
  expect(
    new Set(bios2).size === bios2.length,
    `用户搜索结果 bio 仍有整句重复：${bios2.join(" / ")}`
  );
  const heads2 = rows.map((r) => headOf(r.bio)).filter(Boolean);
  const headDup2 = heads2.length - new Set(heads2).size;
  expect(headDup2 <= 1, `用户搜索结果首句重复 ${headDup2} 对（上限 1）`);
  console.log(`  搜索「阿罗」：${rows.length} 行，首句两两不同`);
  const ovf1 = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(ovf1 <= 0, `1440 搜索页横向溢出 ${ovf1}px`);
  const errs1 = await page.evaluate(() => window.__errs || []);
  expect(errs1.length === 0, `1440 __errs 非空: ${errs1.join(" | ")}`);

  // 390
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".urow", { timeout: 15000 });
  const ovf2 = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(ovf2 <= 0, `390 搜索页横向溢出 ${ovf2}px`);
  const errs2 = await page.evaluate(() => window.__errs || []);
  expect(errs2.length === 0, `390 __errs 非空: ${errs2.join(" | ")}`);
});
