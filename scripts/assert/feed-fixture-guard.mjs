// feed-fixture-guard.mjs — Z1204 读路径过滤验收：首屏/问题页不再出现历史夹具。
//
// 流程（不依赖线上实例，也不污染线上库）：
//   1) 源库（DB_PATH || <repo>/data/zhihu.db || /www/zhihucopy/data/zhihu.db）
//      用 db.backup() 复制到 mktemp 临时库；
//   2) 对临时库跑 scripts/mark-fixtures.js --apply（含备份、幂等回填）；
//   3) 自起临时 server/index.js（随机 PORT + 临时 DB），跑完连锅端掉。
//   cron 下跑需 `env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE`。
//
// 断言（390×844 与 1440×900 各一次，未登录）：
//   1. GET /feed/recommended?limit=20 与 /feed/hot 的 items 中
//      is_fixture===1 命中数 = 0（列表 item 须带 is_fixture 字段）；
//   2. 首屏第一张问题卡标题不匹配 /走查问题\d+？|场景的提问 [a-z0-9]{6,}|^测试/，
//      作者名不匹配 /真人nm|巡检用户|mw[a-z0-9]{6,}$/；
//   3. /question/1647（若过滤后 0 条回答则换任一仍有 ≥1 条回答的问题）
//      回答正文不匹配 /^回答正文 \d+$|巡检回答|巡检问题|走查记录/；
//   4. 页面 document.body.innerText 不匹配 /走查问题\d+？|mw[a-z0-9]{6,}|真人nm/；
//   5. window.__errs 为空。

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

// ---- 临时实例：复制源库 → mark-fixtures --apply → 起 server ------------------

const candidates = [
  process.env.DB_PATH,
  path.join(ROOT, "data", "zhihu.db"),
  "/www/zhihucopy/data/zhihu.db",
].filter(Boolean);
const SRC_DB = candidates.find((p) => fs.existsSync(p));
if (!SRC_DB) {
  console.error("[ASSERT] feed-fixture-guard FAIL: 找不到源库（试过 " + candidates.join(", ") + "）");
  process.exit(1);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "z1204-fixture-"));
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
console.log(`[feed-fixture-guard] 源库 ${SRC_DB} -> 临时库 ${tmpDb}`);

// 对临时库回填夹具标记（--apply 目标非生产库，写闸按临时库口径放行）。
const mark = execFileSync(
  process.execPath,
  [path.join(ROOT, "scripts", "mark-fixtures.js"), "--apply", "--db", tmpDb],
  { encoding: "utf8" }
);
process.stdout.write(mark);

// e2e/lib.mjs 在 import 时读 env —— 先设好再 dynamic import。
process.env.E2E_BASE = pageBase;
process.env.E2E_API = apiBase;
process.env.DB_PATH = tmpDb;
process.env.E2E_NO_CLEANUP = "1"; // 本断言不创建任何对象，临时库整锅删。

child = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], {
  env: { ...process.env, PORT: String(port), DB_PATH: tmpDb, JWT_SECRET: "fixture-guard-secret" },
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
  console.error("[ASSERT] feed-fixture-guard FAIL: 临时 server 未就绪");
  process.exit(1);
}
console.log(`[feed-fixture-guard] 临时实例 ${pageBase} (port=${port})`);

const { run, expect, apiOk } = await import("../e2e/lib.mjs");

// ---- 命中规则（与任务书/mark-fixtures.js 同一组正则） -------------------------
const CARD_TITLE_RE = /走查问题\d+？|场景的提问 [a-z0-9]{6,}|^测试/;
const CARD_NICK_RE = /真人nm|巡检用户|mw[a-z0-9]{6,}$/;
const ANSWER_BODY_RE = /^回答正文 \d+$|巡检回答|巡检问题|走查记录/;
const BODY_TEXT_RE = /走查问题\d+？|mw[a-z0-9]{6,}|真人nm/;

function injectErrs(page) {
  return page.addInitScript(() => {
    const w = window;
    w.__errs = [];
    w.addEventListener("error", (e) => w.__errs.push(`error:${e.message}`));
    w.addEventListener("unhandledrejection", (e) =>
      w.__errs.push(`rejection:${e.reason && e.reason.message ? e.reason.message : e.reason}`)
    );
  });
}

async function apiGet(p) {
  const r = await fetch(apiBase + p);
  expect(r.ok, `GET ${p} -> ${r.status}`);
  return r.json();
}

// 挑一个过滤后仍有 ≥1 条回答的问题：优先 /question/1647，否则热榜里找。
async function pickQuestionWithAnswers() {
  const d1647 = await apiGet("/questions/1647").catch(() => null);
  if (d1647 && (d1647.answers || []).length > 0) return d1647;
  const hot = await apiGet("/feed/hot");
  for (const it of hot.items || []) {
    if (it.answer_count > 0) {
      const d = await apiGet(`/questions/${it.id}`);
      if ((d.answers || []).length > 0) return d;
    }
  }
  return null;
}

run("feed-fixture-guard", async ({ browser }) => {
  // ---- API 层：items 全 is_fixture=0 且无夹具标题/作者 ----
  for (const p of ["/feed/recommended?limit=20", "/feed/hot"]) {
    const data = await apiGet(p);
    const items = data.items || [];
    expect(items.length > 0, `${p} 空列表`);
    const flagged = items.filter((it) => it.is_fixture === 1);
    expect(
      flagged.length === 0,
      `${p} 泄漏夹具 ${flagged.length} 条：${flagged.map((i) => `#${i.id} ${i.title}`).join(" | ")}`
    );
    for (const it of items) {
      expect(it.is_fixture === 0, `${p} item#${it.id} 未带 is_fixture=0 字段`);
      expect(!CARD_TITLE_RE.test(it.title || ""), `${p} 夹具标题：${JSON.stringify(it.title)}`);
      expect(
        !(it.author && CARD_NICK_RE.test(it.author.nickname || "")),
        `${p} 夹具作者：${JSON.stringify(it.author && it.author.nickname)}`
      );
    }
    console.log(`  API ${p}: items=${items.length} 夹具=0`);
  }

  // ---- 问题详情：回答正文无夹具 ----
  const detail = await pickQuestionWithAnswers();
  expect(detail, "找不到过滤后仍有回答的问题");
  const qid = detail.question && detail.question.id;
  for (const a of detail.answers) {
    expect(
      !ANSWER_BODY_RE.test(a.content_md || ""),
      `/question/${qid} 夹具回答：${JSON.stringify((a.content_md || "").slice(0, 50))}`
    );
  }
  console.log(`  /question/${qid}: answers=${detail.answers.length} 夹具正文=0`);

  // ---- 页面层：390×844 与 1440×900 首屏 ----
  for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const ctx = await browser.newContext({ viewport: vp, locale: "zh-CN" });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    await injectErrs(page);
    await page.goto(pageBase + "/", { waitUntil: "networkidle" });
    await page.locator(".feed__item").first().waitFor({ state: "visible" });

    const first = await page.evaluate(() => {
      const item = document.querySelector(".feed__item");
      return {
        title: item && item.querySelector(".feed__title")
          ? item.querySelector(".feed__title").textContent.trim()
          : "",
        author: item && item.querySelector(".feed__author-name")
          ? item.querySelector(".feed__author-name").textContent.trim()
          : "",
        body: document.body.innerText,
      };
    });
    expect(!CARD_TITLE_RE.test(first.title), `首屏首卡夹具标题：${JSON.stringify(first.title)}`);
    expect(!CARD_NICK_RE.test(first.author), `首屏首卡夹具作者：${JSON.stringify(first.author)}`);
    const bodyHit = first.body.match(BODY_TEXT_RE);
    expect(!bodyHit, `首屏 innerText 命中夹具「${bodyHit && bodyHit[0]}」(${vp.width}px)`);
    const errs = await page.evaluate(() => window.__errs || []);
    expect(errs.length === 0, `页面错误(${vp.width}px)：${errs.join(" | ")}`);
    console.log(
      `  ${vp.width}×${vp.height}: 首卡「${first.title.slice(0, 30)}」作者=${first.author} innerText 夹具=0 __errs=0`
    );
    await ctx.close();
  }
});
