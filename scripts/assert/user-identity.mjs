#!/usr/bin/env node
/**
 * scripts/assert/user-identity.mjs — Z1158 用户身份唯一性验收
 *
 * 断言：
 *   1) DB：bio 非空且同 bio 人数 >= 3 的组 = 0；全站昵称重复 = 0；
 *   2) 线上 `?q=阿罗&type=user`：结果 >= 2 时逐行 bio 两两不同，
 *      且每行有「加入 YYYY-MM · 回答 N · 关注者 M」副信息行；
 *   3) 邀请弹窗搜「阿罗」：结果 >= 2 时逐行 bio 互不相同，行内有「回答 N」副信息；
 *   4) 1440 / 390 无横向溢出、window.__errs 为空；
 *   5) --self-test：在副本库植入 8 个同 bio 用户 + 3 个同昵称 → DB 断言必须检出（RC=1）；
 *   6) 反向自检：对未修基线跑本脚本必须 FAIL（组 >= 3 人的同 bio 集群仍在）。
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

const { run, expect, BASE, register, authedPage } = await import("../e2e/lib.mjs");

const DB_PATH = path.resolve(process.env.DB_PATH || path.join(ROOT, "data", "zhihu.db"));
const SELF_TEST = process.argv.includes("--self-test");

function requireFromServer(name) {
  try {
    return require(name);
  } catch {
    return require(require.resolve(name, { paths: [path.join(ROOT, "server")] }));
  }
}
const Database = requireFromServer("better-sqlite3");

// ---------- DB 层：撞车简介 / 重名 ----------
export function dbIdentityReport(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const bioGroups = db
      .prepare(
        `SELECT bio, COUNT(*) c FROM users
          WHERE bio IS NOT NULL AND TRIM(bio) != ''
          GROUP BY bio HAVING c >= 3
          ORDER BY c DESC`
      )
      .all();
    const dupNicks = db
      .prepare(
        `SELECT nickname, COUNT(*) c FROM users GROUP BY nickname HAVING c > 1 ORDER BY c DESC`
      )
      .all();
    return { bioGroups, dupNicks };
  } finally {
    db.close();
  }
}

function checkDb(dbPath) {
  const { bioGroups, dupNicks } = dbIdentityReport(dbPath);
  expect(
    bioGroups.length === 0,
    `同 bio ≥3 人的组仍有 ${bioGroups.length} 组：` +
      bioGroups.slice(0, 5).map((g) => `「${g.bio.slice(0, 12)}…」×${g.c}`).join("、")
  );
  expect(
    dupNicks.length === 0,
    `昵称重复仍有 ${dupNicks.length} 组：` +
      dupNicks.slice(0, 5).map((g) => `${g.nickname}×${g.c}`).join("、")
  );
}

// ---------- self-test：植入撞车数据后必须检出 ----------
if (SELF_TEST) {
  const tmp = path.join(ROOT, "..", "hermes-home", "cache", "scratch", "zhdb", "z1158-selftest.db");
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
  for (let i = 0; i < 8; i++) ins.run(`selftest${i}@test.dev`, `自测同简介${i}`, "同一条简介占位。");
  for (let i = 0; i < 3; i++) ins.run(`selftest-n${i}@test.dev`, "自测重名", "");
  db.close();
  const { bioGroups, dupNicks } = dbIdentityReport(tmp);
  const ok = bioGroups.length > 0 && dupNicks.length > 0;
  console.log(
    `[SELFTEST] 植入 8 个同 bio + 3 个同昵称 → 检出 bio 组 ${bioGroups.length}、重名组 ${dupNicks.length}`
  );
  expect(ok, "self-test 未能检出植入的撞车数据");
  console.log("[SELFTEST] PASS：撞车数据被检出（DB 断言有效）");
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

async function userSearchRows(page) {
  await page.goto(`${BASE}/search?q=${encodeURIComponent("阿罗")}&type=user`, {
    waitUntil: "networkidle",
  });
  await page.waitForSelector(".urow", { timeout: 15000 });
  return page.$$eval(".urow", (rows) =>
    rows.map((r) => ({
      nick: (r.querySelector(".urow__name") || {}).textContent || "",
      bio: (r.querySelector(".urow__bio") || {}).textContent || "",
      meta: (r.querySelector(".urow__meta") || {}).textContent || "",
    }))
  );
}

async function inviteRows(page) {
  await page.goto(`${BASE}/question/6`, { waitUntil: "networkidle" });
  const inviteBtn = page.locator('button:has-text("邀请回答")').first();
  await inviteBtn.waitFor({ state: "visible", timeout: 15000 });
  await inviteBtn.click();
  await page.waitForSelector(".invite__search", { timeout: 10000 });
  await page.fill(".invite__search", "阿罗");
  await page.waitForSelector(".invite__row", { timeout: 15000 });
  return page.$$eval(".invite__row", (rows) =>
    rows.map((r) => ({
      nick: (r.querySelector(".invite__nick") || {}).textContent || "",
      bio: (r.querySelector(".invite__bio") || {}).textContent || "",
      meta: (r.querySelector(".invite__meta") || {}).textContent || "",
    }))
  );
}

run("user-identity", async ({ browser, page }) => {
  checkDb(DB_PATH);

  await page.addInitScript(ERR_HOOK);
  await page.setViewportSize({ width: 1440, height: 900 });

  const rows = await userSearchRows(page);
  expect(rows.length >= 2, `用户搜索结果过少（${rows.length} 行），无法验证区分度`);
  const bios = rows.map((r) => r.bio.trim()).filter(Boolean);
  expect(
    new Set(bios).size === bios.length,
    `用户搜索结果 bio 仍有重复：${JSON.stringify(bios)}`
  );
  const withMeta = rows.filter((r) => /回答\s*\d+/.test(r.meta)).length;
  expect(withMeta === rows.length, `有 ${rows.length - withMeta} 行缺「回答 N」副信息`);
  const withJoin = rows.filter((r) => /加入\s*\d{4}-\d{2}/.test(r.meta)).length;
  expect(withJoin === rows.length, `有 ${rows.length - withJoin} 行缺「加入 YYYY-MM」`);
  console.log(`  搜索「阿罗」：${rows.length} 行，bio 唯一 ${new Set(bios).size}，副信息齐全`);

  const ovf1 = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(ovf1 <= 0, `1440 搜索页横向溢出 ${ovf1}px`);

  // 邀请弹窗只在登录态渲染「邀请回答」，用现场注册的新号打开。
  const { token } = await register();
  const authPage = await authedPage(browser, token);
  await authPage.setViewportSize({ width: 1440, height: 900 });
  await authPage.addInitScript(ERR_HOOK);
  const inv = await inviteRows(authPage);
  expect(inv.length >= 2, `邀请弹窗结果过少（${inv.length} 行）`);
  const invBios = inv.map((r) => r.bio.trim()).filter(Boolean);
  expect(
    new Set(invBios).size === invBios.length,
    `邀请弹窗 bio 仍有重复：${JSON.stringify(invBios)}`
  );
  const invMeta = inv.filter((r) => /回答\s*\d+/.test(r.meta)).length;
  expect(invMeta === inv.length, `邀请弹窗有 ${inv.length - invMeta} 行缺「回答 N」副信息`);
  console.log(`  邀请弹窗：${inv.length} 行，bio 唯一 ${new Set(invBios).size}，副信息齐全`);

  const ovf2 = await authPage.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(ovf2 <= 0, `1440 邀请弹窗横向溢出 ${ovf2}px`);
  const errs = await authPage.evaluate(() => window.__errs || []);
  expect(errs.length === 0, `页面错误：${errs.join(" | ")}`);

  // 390 复检
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const m = await mctx.newPage();
  await m.addInitScript(ERR_HOOK);
  await m.goto(`${BASE}/search?q=${encodeURIComponent("阿罗")}&type=user`, {
    waitUntil: "networkidle",
  });
  await m.waitForSelector(".urow", { timeout: 15000 });
  const ovf3 = await m.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(ovf3 <= 0, `390 搜索页横向溢出 ${ovf3}px`);
  const errs3 = await m.evaluate(() => window.__errs || []);
  expect(errs3.length === 0, `390 页面错误：${errs3.join(" | ")}`);
  await m.close();
  await mctx.close();
});
