// comment-count-api.mjs — Z1227 评论计数三套口径合一 + GET /comments limit 分页验收。
//
// 契约：
//   a. GET /api/comments 的 total = 通过公共可见过滤（testCommentSql，含本人
//      豁免分支）且 is_deleted=0 的全部行数（含各级回复），不含删除占位行；
//      total 与 limit 无关。
//   b. limit（1–100 正整数）作用于顶层评论条数，children 一并返回；非法
//      limit（0/负数/非数字/>100）→ 400 {error}。响应带 page/page_size/has_more。
//   c. 页面「N 条评论」与「收起评论（N）」一律取 total；展开→收起→再展开不跳变。
//
// 流程（不依赖线上实例，也不污染线上库 —— 同 comment-publish-ok 模式）：
//   1) 源库（DB_PATH || <repo>/data/zhihu.db || /www/zhihucopy/data/zhihu.db）
//      用 db.backup() 复制到 mktemp 临时库（生产库是 WAL，不能 fs.copyFile）；
//   2) 自起临时 server/index.js（随机 PORT + 临时 DB），跑完 kill + 删临时库。
//   cron 下跑需 `env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE`。
//
// 断言覆盖 3 个 target：answer#18（库内既有评论）、question#1（脚本内用种子
// 号补 2 条留言）、自建 answer（3 顶层 + 1 二级回复 + 1 发后即删带存活子回复，
// 期望 total=5、顶层=4）。可见留言一律种子号 user5@zhihucopy.dev 发，内容
// 标记纯数字避开正文过滤规则。连跑 2 次结果一致（临时库每次全新复制）。

import { spawn } from "node:child_process";
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

// ---- 临时实例：复制源库 → 起 server ----------------------------------------

const candidates = [
  process.env.DB_PATH,
  path.join(ROOT, "data", "zhihu.db"),
  "/www/zhihucopy/data/zhihu.db",
].filter(Boolean);
const SRC_DB = candidates.find((p) => fs.existsSync(p));
if (!SRC_DB) {
  console.error("[ASSERT] comment-count-api FAIL: 找不到源库（试过 " + candidates.join(", ") + "）");
  process.exit(1);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "z1227-comment-"));
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

const src = new Database(SRC_DB, { readonly: true });
await src.backup(tmpDb);
src.close();
console.log(`[comment-count-api] 源库 ${SRC_DB} -> 临时库 ${tmpDb}`);

process.env.E2E_BASE = pageBase;
process.env.E2E_API = apiBase;
process.env.DB_PATH = tmpDb;
process.env.E2E_NO_CLEANUP = "1"; // 临时库整锅删，无需逐条清理。

child = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], {
  env: { ...process.env, PORT: String(port), DB_PATH: tmpDb, JWT_SECRET: "z1227-comment-secret" },
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
  console.error("[ASSERT] comment-count-api FAIL: 临时 server 未就绪");
  process.exit(1);
}
console.log(`[comment-count-api] 临时实例 ${pageBase} (port=${port})`);

const { run, expect, register, authedPage, api, apiOk, uniq } = await import(
  "../e2e/lib.mjs"
);

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
const pageErrs = (page) => page.evaluate(() => window.__errs || []);

// 目标资源前置检查：answer#18 与 question#1 必须存在（断言挂点），源库不含
// 时直接 FAIL 并打印，不静默换目标。
const pre = new Database(tmpDb, { readonly: true });
const a18 = pre.prepare("SELECT id FROM answers WHERE id = 18 AND is_deleted = 0").get();
const q1 = pre.prepare("SELECT id FROM questions WHERE id = 1").get();
const u5 = pre.prepare("SELECT id FROM users WHERE email = 'user5@zhihucopy.dev'").get();
pre.close();
if (!a18) {
  console.error("[ASSERT] comment-count-api FAIL: 临时库 answer#18 不存在或已删除");
  process.exit(1);
}
if (!q1 || !u5) {
  console.error("[ASSERT] comment-count-api FAIL: 临时库 question#1 或种子号 user5 不存在");
  process.exit(1);
}

const RE_CLOSED = /^(\d+) 条评论$/;
const RE_OPEN = /^收起评论（(\d+)）$/;

run("comment-count-api", async ({ browser }) => {
  const op = await register(uniq("op"));
  const login = await api("POST", "/auth/login", {
    body: { email: "user5@zhihucopy.dev", password: "zhihu123456" },
  });
  expect(login.status === 200, `seed login -> ${login.status}`);
  const me = login.data;

  // ---- 夹具：自建 question+answer；question#1 补 2 条种子号顶层评论 ----
  const tag = String(Date.now()).slice(-6);
  const { question } = await apiOk("POST", "/questions", {
    token: op.token,
    body: { title: `[e2e] ${uniq("q")} — 评论计数/分页口径验收`, detail_md: "Z1227 验收用问题。" },
  });
  const { answer } = await apiOk("POST", `/questions/${question.id}/answers`, {
    token: op.token,
    body: { content_md: "回答正文：Z1227 计数/分页断言挂点。" },
  });
  const aid = answer.id;

  for (const body of [`q${tag}a`, `q${tag}b`]) {
    await apiOk("POST", "/comments", {
      token: me.token,
      body: { target_type: "question", target_id: 1, body },
    });
  }

  // 自建回答：3 顶层 + 1 二级回复 + 1 发后即删（带 1 存活子回复 → 占位行）。
  // 可见非删除行 = 3 + 1 + 1 = 5；顶层条数（含占位）= 4。
  const { comment: top1 } = await apiOk("POST", "/comments", {
    token: me.token,
    body: { target_type: "answer", target_id: aid, body: `1${tag}` },
  });
  await apiOk("POST", "/comments", {
    token: me.token,
    body: { target_type: "answer", target_id: aid, body: `2${tag}` },
  });
  await apiOk("POST", "/comments", {
    token: me.token,
    body: { target_type: "answer", target_id: aid, body: `3${tag}` },
  });
  await apiOk("POST", "/comments", {
    token: me.token,
    body: { target_type: "answer", target_id: aid, parent_id: top1.id, body: `r${tag}` },
  });
  const { comment: doomed } = await apiOk("POST", "/comments", {
    token: me.token,
    body: { target_type: "answer", target_id: aid, body: `d${tag}` },
  });
  await apiOk("POST", "/comments", {
    token: me.token,
    body: { target_type: "answer", target_id: aid, parent_id: doomed.id, body: `dr${tag}` },
  });
  await apiOk("DELETE", `/comments/${doomed.id}`, { token: me.token });

  const targets = [
    { type: "answer", id: 18, label: "answer#18" },
    { type: "question", id: 1, label: "question#1" },
    { type: "answer", id: aid, label: `answer#${aid}（自建）` },
  ];

  // ---- a/b. 三个 target：limit=1 → 1 条顶层 + page/page_size/has_more ----
  for (const t of targets) {
    const base = `${apiBase}/comments?target_type=${t.type}&target_id=${t.id}`;
    const all = await api("GET", `/comments?target_type=${t.type}&target_id=${t.id}`);
    expect(all.status === 200, `${t.label} 全量 GET -> ${all.status}`);
    const topCount = (all.data.items || []).length;
    expect(topCount >= 1, `${t.label} 顶层评论数为 ${topCount}，期望 ≥1（夹具/库应满足）`);
    expect(
      all.data.has_more === false && all.data.page === 1,
      `${t.label} 无 limit 时 page=${all.data.page} has_more=${all.data.has_more}，期望 page=1 has_more=false`
    );

    const r = await fetch(`${base}&limit=1`);
    const d = await r.json();
    expect(r.status === 200, `${t.label} limit=1 -> ${r.status}`);
    expect(d.items.length === 1, `${t.label} limit=1 items.length=${d.items.length}，期望 1`);
    expect(
      d.page === 1 && d.page_size === 1 && typeof d.has_more === "boolean",
      `${t.label} 缺分页字段：page=${d.page} page_size=${d.page_size} has_more=${d.has_more}`
    );
    expect(
      d.has_more === (d.total > 1),
      `${t.label} has_more=${d.has_more} ≠ total>1（total=${d.total}）`
    );
    expect(
      d.has_more === (topCount > 1),
      `${t.label} has_more=${d.has_more} ≠ 顶层数>1（顶层=${topCount}）`
    );
    // total 与分页无关：带 limit 与不带的 total 相同。
    expect(
      d.total === all.data.total,
      `${t.label} limit=1 total=${d.total} ≠ 全量 total=${all.data.total}`
    );
    // limit 作用顶层、children 一并带出：自建回答首条顶层带 1 条二级回复。
    if (t.id === aid) {
      expect(
        d.total === 5,
        `${t.label} total=${d.total}，期望 5（删除占位行不计入）`
      );
      expect(
        Array.isArray(d.items[0].children) && d.items[0].children.length === 1,
        `${t.label} limit=1 首条顶层 children=${JSON.stringify(d.items[0].children)}，期望 1 条`
      );
      // offset 生效：offset=1&limit=1 → 第二条顶层，page=2。
      const r2 = await fetch(`${base}&limit=1&offset=1`);
      const d2 = await r2.json();
      expect(
        r2.status === 200 && d2.page === 2 && d2.items.length === 1 && d2.items[0].id !== d.items[0].id,
        `${t.label} limit=1&offset=1 异常：status=${r2.status} page=${d2.page} id=${d2.items[0] && d2.items[0].id}`
      );
    }
    console.log(`  a) ${t.label} total=${d.total} 顶层=${topCount} limit=1 -> items=1 has_more=${d.has_more}`);
  }

  // ---- b. 非法 limit/offset → 400 {error} ----
  for (const bad of ["limit=0", "limit=-1", "limit=abc", "limit=101", "offset=-1", "offset=abc"]) {
    const r = await fetch(`${apiBase}/comments?target_type=answer&target_id=${aid}&${bad}`);
    const d = await r.json();
    expect(
      r.status === 400 && typeof d.error === "string" && d.error.length > 0,
      `非法参数 ${bad} -> ${r.status} ${JSON.stringify(d).slice(0, 120)}，期望 400 {error}`
    );
  }
  console.log("  b) 非法 limit/offset 均 400 带 error");

  // ---- c. 浏览器：页面计数 === API total，展开/收起/再展开不跳变 ----
  const apiTotal = (await apiOk("GET", `/comments?target_type=answer&target_id=${aid}`)).total;

  const page = await authedPage(browser, me.token);
  await injectErrs(page);
  await page.goto(`${pageBase}/question/${question.id}`);
  await page.locator(".question__title").first().waitFor();

  const bodyLen = await page.evaluate(() => document.body.innerText.length);
  expect(bodyLen > 200, `页面内容过少：innerText=${bodyLen}`);

  const ans = page.locator(`#answer-${aid}`);
  const toggle = ans.getByRole("button", { name: /条评论|收起评论/ });
  const readClosed = async () => {
    const text = (await toggle.innerText()).trim();
    const m = RE_CLOSED.exec(text);
    expect(m !== null, `收起态文案异常：「${text}」`);
    return Number(m[1]);
  };
  const readOpen = async () => {
    const text = (await toggle.innerText()).trim();
    const m = RE_OPEN.exec(text);
    expect(m !== null, `展开态文案异常：「${text}」`);
    return Number(m[1]);
  };

  const closed1 = await readClosed();
  expect(closed1 === apiTotal, `收起态 N=${closed1} ≠ API total=${apiTotal}`);
  await toggle.click();
  await ans.locator("li.answer__comment").first().waitFor();
  const open1 = await readOpen();
  expect(open1 === apiTotal, `展开态 N=${open1} ≠ API total=${apiTotal}`);
  await toggle.click();
  const closed2 = await readClosed();
  expect(closed2 === open1, `收起后 N=${closed2} ≠ 展开时 ${open1}`);
  await toggle.click();
  await ans.locator("li.answer__comment").first().waitFor();
  const open2 = await readOpen();
  expect(open2 === closed2, `再展开 N=${open2} ≠ ${closed2}，计数跳变`);
  console.log(`  c) 页面计数 N=M=${apiTotal} === API total；展开/收起/再展开不跳变`);

  const errs = await pageErrs(page);
  expect(errs.length === 0, `页面错误：${errs.join(" | ")}`);
});
