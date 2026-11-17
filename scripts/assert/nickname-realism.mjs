// Z1115 — 昵称「批量生成感」断言：数字/拉丁尾巴不再出现在库、API 与首屏。
//
// 口径（与 scripts/nickname-pool.js isSuspiciousNickname 同一正则）：
//   「可疑形态」= 昵称以 1–4 位数字结尾（陈默31/半山腰64/沈青224），
//   或以 2–4 位小写拉丁字母结尾（沈知微gbw/e2e-mw…）。
//
// 三层检查（全部完成后统一判定，失败项逐条打印）：
//   DB 侧（DB_PATH 可用时）：非测试口径账号里可疑昵称比例 ≤ 2%。
//     「测试口径」= is_test 标记 ∨ content-filter 测试昵称/测试邮箱——
//     这批账号被公共出口过滤、由残留治理（purge/cleanup）负责，改名反而
//     会让它们逃出检测，故不计入本断言分母也不由 fix-nicknames 改名。
//   API 侧：GET /questions?limit=30 与 GET /feed/recommended 的
//     items[].author.nickname 无可疑形态。
//   浏览器侧：1440 与 390 各一次，首屏 .feed__item 的 .feed__author-name
//     文本无可疑形态；window.__errs（error/unhandledrejection/console.error）
//     为空；无横向溢出。
//
// Env: API_BASE（缺省 3030）、E2E_BASE（缺省 API_BASE 去 /api）、DB_PATH。
// 反向自检：未修基线（种子库 215 个数字尾昵称）上必须 FAIL——DB 比例 ~80%、
// API/首屏均出现 `…<数字>` 作者名。
import { createRequire } from "node:module";
import { ok, expect, db } from "./lib.mjs";

const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
const BASE = (process.env.E2E_BASE || API_BASE.replace(/\/api$/, "")).replace(/\/+$/, "");
process.env.E2E_BASE ||= BASE;
// e2e/lib.mjs 顶层按 env 求值 BASE，须在赋值后动态引入。
const { run } = await import("../e2e/lib.mjs");

const requireHere = createRequire(import.meta.url);
const { isTestNickname, isTestEmail } = requireHere("../../server/content-filter.js");
const { isSuspiciousNickname } = requireHere("../nickname-pool.js");

const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.log(`  FAIL: ${msg}`);
};

// 注入 window.__errs 收集 error / unhandledrejection / console.error。
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

// ---- DB 侧 -----------------------------------------------------------------
function checkDb() {
  let d;
  try {
    d = db();
  } catch (e) {
    console.log(`  DB 不可用（${e.message || e}），跳过 DB 侧检查`);
    return;
  }
  const hasIsTest = d
    .prepare("PRAGMA table_info(users)")
    .all()
    .some((c) => c.name === "is_test");
  const idRows = d
    .prepare("SELECT id, nickname, email, is_admin FROM users")
    .all();
  const testIds = hasIsTest
    ? new Set(d.prepare("SELECT id FROM users WHERE is_test = 1").all().map((r) => r.id))
    : new Set();
  d.close();

  let nonTest = 0;
  const sus = [];
  for (const u of idRows) {
    const isTest =
      testIds.has(u.id) || isTestNickname(u.nickname) || isTestEmail(u.email);
    if (isTest) continue;
    nonTest++;
    if (isSuspiciousNickname(u.nickname)) sus.push(u.nickname);
  }
  const ratio = nonTest ? sus.length / nonTest : 1;
  console.log(
    `  DB: 非测试账号 ${nonTest}，可疑昵称 ${sus.length}（${(ratio * 100).toFixed(1)}%）` +
      (sus.length ? ` 例: ${sus.slice(0, 8).join(" ")}` : "")
  );
  if (ratio > 0.02) {
    fail(`DB 可疑昵称比例 ${(ratio * 100).toFixed(1)}% > 2%（${sus.length}/${nonTest}）`);
  }
}

// ---- API 侧 ----------------------------------------------------------------
async function checkApi() {
  for (const p of ["/questions?limit=30", "/feed/recommended"]) {
    const data = await ok("GET", p);
    const items = data.items || [];
    expect(items.length > 0, `${p} 返回 0 条（断言应非恒真）`);
    const bad = items
      .map((it) => it.author && it.author.nickname)
      .filter((n) => isSuspiciousNickname(n));
    console.log(`  API ${p}: ${items.length} 条，可疑作者名 ${bad.length}`);
    if (bad.length) {
      fail(`${p} 作者名含可疑形态 ${bad.length} 条: ${bad.slice(0, 8).join(" ")}`);
    }
  }
}

// ---- 浏览器侧 ---------------------------------------------------------------
async function checkViewport(browser, width, height, tag) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    locale: "zh-CN",
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  await page.addInitScript(ERR_HOOK);
  try {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.waitForSelector(".feed__item, .empty, .errorbox");
    const names = await page.$$eval(".feed__item .feed__author-name", (els) =>
      els.slice(0, 15).map((e) => (e.innerText || "").trim())
    );
    if (!names.length) {
      fail(`${tag} 首屏无 .feed__author-name 作者名（断言应非恒真）`);
    }
    const bad = names.filter((n) => isSuspiciousNickname(n));
    console.log(
      `  ${tag}: 首屏作者名 ${names.length} 个，可疑 ${bad.length}` +
        (bad.length ? `（${bad.slice(0, 6).join(" ")}）` : "")
    );
    if (bad.length) {
      fail(`${tag} 首屏作者名含可疑形态: ${bad.slice(0, 6).join(" ")}`);
    }
    const bodyLen = await page.evaluate(() => (document.body.innerText || "").length);
    if (bodyLen <= 200) fail(`${tag} body 文本仅 ${bodyLen} 字符（疑似白屏）`);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    if (overflow > 1) fail(`${tag} 横向溢出 ${overflow}px`);
    const errs = await page.evaluate(() => window.__errs || []);
    if (errs.length) {
      fail(`${tag} window.__errs ${errs.length} 条: ${errs.slice(0, 3).join(" | ")}`);
    }
    console.log(`  ${tag}: 溢出 ${overflow}px，__errs ${errs.length}`);
  } finally {
    await ctx.close();
  }
}

run("nickname-realism", async ({ browser }) => {
  checkDb();
  await checkApi();
  await checkViewport(browser, 1440, 900, "desktop1440");
  await checkViewport(browser, 390, 844, "mobile390");
  expect(
    failures.length === 0,
    `nickname-realism ${failures.length} 项未过`
  );
});
