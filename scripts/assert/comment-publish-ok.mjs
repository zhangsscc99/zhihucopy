// comment-publish-ok.mjs — Z1226 评论写入守卫验收：走查号发自然语言评论正常入库，
// 正文命中模板规则才拒写（回传规则名），链接 ≥3 拒写；发布失败错误内联在输入框。
//
// 流程（不依赖线上实例，也不污染线上库 —— 同 feed-fixture-guard 模式）：
//   1) 源库（DB_PATH || <repo>/data/zhihu.db || /www/zhihucopy/data/zhihu.db）
//      用 db.backup() 复制到 mktemp 临时库（生产库是 WAL，不能 fs.copyFile）；
//   2) 自起临时 server/index.js（随机 PORT + 临时 DB），跑完 kill + 删临时库。
//   cron 下跑需 `env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE`。
//
// 断言：
//   a. 昵称 走查<6位数字> + @example.com 邮箱注册（is_test=1，复现走查号形态），
//      对 answer#18 连发 3 句自然中文评论 → 全部 201；临时库 comments 表 +3 行，
//      ≥2 条正文可回读。
//      Z1226 读侧本人豁免：带该账号 token 的 GET /comments total 比发前 +3、
//      items 正文找回 ≥2 条；匿名（不带 token）同一请求 total 与发前相同 ——
//      豁免只对本人生效，公共口径（Z1045 userMatchSql 过滤）不变。
//   b. 正文含「走查：测试」→ 403，error 带命中规则名、rule 字段非空；
//      空正文 → 4xx（长度下限）。
//   c. 正文含 3 个 http:// 链接 → 4xx 且 error 提到「链接」。
//   d. 浏览器（登录态，390×844 与 1440×900）：/question/6 首条回答评论框发
//      自然文本 → 成功 toast、form 内无 [role=alert]；page.route 拦截
//      POST /api/comments 回 403 → .answer__comment-form [role=alert] 出现、
//      与 textarea 垂直间距 <24px、position!==fixed、草稿未清空；
//      window.__errs 为空。

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
  console.error("[ASSERT] comment-publish-ok FAIL: 找不到源库（试过 " + candidates.join(", ") + "）");
  process.exit(1);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "z1226-comment-"));
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
console.log(`[comment-publish-ok] 源库 ${SRC_DB} -> 临时库 ${tmpDb}`);

process.env.E2E_BASE = pageBase;
process.env.E2E_API = apiBase;
process.env.DB_PATH = tmpDb;
process.env.E2E_NO_CLEANUP = "1"; // 临时库整锅删，无需逐条清理。

child = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], {
  env: { ...process.env, PORT: String(port), DB_PATH: tmpDb, JWT_SECRET: "z1226-comment-secret" },
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
  console.error("[ASSERT] comment-publish-ok FAIL: 临时 server 未就绪");
  process.exit(1);
}
console.log(`[comment-publish-ok] 临时实例 ${pageBase} (port=${port})`);

const { run, expect, api, uniq } = await import("../e2e/lib.mjs");

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

// 目标资源前置检查：answer#18 必须存在（写侧断言挂点），/question/6 须有 ≥1 条
// 回答（浏览器断言挂点）。源库不含时直接 FAIL 并打印，不静默换目标。
const pre = new Database(tmpDb, { readonly: true });
const a18 = pre.prepare("SELECT id FROM answers WHERE id = 18 AND is_deleted = 0").get();
const q6answers = pre
  .prepare("SELECT id FROM answers WHERE question_id = 6 AND is_deleted = 0 ORDER BY id LIMIT 1")
  .all();
pre.close();
if (!a18) {
  console.error("[ASSERT] comment-publish-ok FAIL: 临时库 answer#18 不存在或已删除");
  process.exit(1);
}
if (q6answers.length === 0) {
  console.error("[ASSERT] comment-publish-ok FAIL: 临时库 /question/6 无可用回答");
  process.exit(1);
}

const SENTENCES = [
  "这个心智模型挺形象的，想请教一下取消订阅和清理定时器有没有先后顺序的讲究？",
  "看完了，收益很大。补充一点：实际项目里把副作用收敛到一个地方管理会省很多麻烦。",
  "请教一下，如果组件在异步回调回来之前就卸载了，这里还需要额外做取消标记吗？",
];

run("comment-publish-ok", async ({ browser }) => {
  // ---- a. 走查号注册 + 3 条自然评论全部入库 ----
  const nick = `走查${String(Math.floor(100000 + Math.random() * 900000))}`;
  const email = `${uniq("walk")}@example.com`;
  const reg = await api("POST", "/auth/register", {
    body: { email, password: "walk-pass-123456", nickname: nick },
  });
  expect(reg.status === 201, `register ${nick} -> ${reg.status} ${JSON.stringify(reg.data).slice(0, 200)}`);
  const token = reg.data.token;

  // 发前基线：匿名 total（本人豁免验收的对照组）。
  const baseList = await api("GET", "/comments?target_type=answer&target_id=18");
  expect(baseList.status === 200, `发前 GET /comments -> ${baseList.status}`);
  const baseTotal = baseList.data.total;

  const posted = [];
  for (const text of SENTENCES) {
    const r = await api("POST", "/comments", {
      token,
      body: { target_type: "answer", target_id: 18, body: text },
    });
    expect(
      r.status === 201 && r.data.comment && r.data.comment.id,
      `走查号发自然评论 -> ${r.status} ${JSON.stringify(r.data).slice(0, 200)}（应 201 入库）`
    );
    posted.push(r.data.comment.id);
  }

  // 入库事实以临时库行为准（公共 GET 对测试作者是过滤口径，见文件头注释）。
  const db = new Database(tmpDb, { readonly: true });
  const rows = db
    .prepare(
      `SELECT c.content FROM comments c
       WHERE c.target_type = 'answer' AND c.target_id = 18 AND c.is_deleted = 0
         AND c.author_id = (SELECT id FROM users WHERE email = ?)`
    )
    .all(email);
  db.close();
  expect(rows.length === 3, `临时库走查号评论数 = ${rows.length}，期望 3`);
  const hitBodies = SENTENCES.filter((s) => rows.some((r) => r.content === s));
  expect(hitBodies.length >= 2, `临时库可回读正文 ${hitBodies.length} 条，期望 ≥2`);

  // 本人豁免（Z1226）：带 token 的 GET total = 发前 +3，items 里找回 ≥2 条正文；
  // 匿名 total 与发前相同（豁免只对本人，公共口径不变）。
  const selfList = await api("GET", "/comments?target_type=answer&target_id=18", { token });
  expect(selfList.status === 200 && selfList.data.total === baseTotal + 3,
    `本人 GET total=${selfList.data.total}，期望 ${baseTotal + 3}（发前 ${baseTotal} +3）`);
  const flat = [];
  const walk = (ns) => ns.forEach((n) => { flat.push(n); walk(n.children || []); });
  walk(selfList.data.items || []);
  const seen = SENTENCES.filter((s) => flat.some((n) => n.content === s));
  expect(seen.length >= 2, `本人 items 找回正文 ${seen.length} 条，期望 ≥2`);
  const anonList = await api("GET", "/comments?target_type=answer&target_id=18");
  expect(anonList.status === 200 && anonList.data.total === baseTotal,
    `匿名 GET total=${anonList.data.total}，期望仍为 ${baseTotal}（公共口径不变）`);
  console.log(`  a) ${nick} 发 3 条自然评论全部 201 入库（本人 GET total=${selfList.data.total} +3、正文找回 ${seen.length}；匿名仍为 ${anonList.data.total}）`);

  // ---- b. 正文模板规则：命中即 403 + 回传规则名；空正文 4xx ----
  const probe = await api("POST", "/comments", {
    token,
    body: { target_type: "answer", target_id: 18, body: "走查：测试提交路径" },
  });
  expect(probe.status === 403, `模板正文 -> ${probe.status}，期望 403`);
  expect(
    typeof probe.data.rule === "string" && probe.data.rule.length > 0,
    `模板正文 403 缺 rule 字段：${JSON.stringify(probe.data).slice(0, 200)}`
  );
  expect(
    String(probe.data.error || "").includes(probe.data.rule),
    `error 未带规则名：${JSON.stringify(probe.data).slice(0, 200)}`
  );
  const empty = await api("POST", "/comments", {
    token,
    body: { target_type: "answer", target_id: 18, body: "   " },
  });
  expect(empty.status >= 400 && empty.status < 500, `空正文 -> ${empty.status}，期望 4xx`);
  console.log(`  b) 模板正文 403 rule=${probe.data.rule}；空正文 ${empty.status}`);

  // ---- c. 链接上限：≥3 个 http(s):// → 4xx 且文案提到「链接」----
  const links = await api("POST", "/comments", {
    token,
    body: {
      target_type: "answer",
      target_id: 18,
      body: "参考 http://a.example/1 和 http://b.example/2 再看 http://c.example/3",
    },
  });
  expect(
    links.status >= 400 && links.status < 500,
    `3 链接正文 -> ${links.status}，期望 4xx`
  );
  expect(
    String(links.data.error || "").includes("链接"),
    `链接超限 error 未提「链接」：${JSON.stringify(links.data).slice(0, 200)}`
  );
  // 边界：恰好 2 个链接不拦。
  const twoLinks = await api("POST", "/comments", {
    token,
    body: {
      target_type: "answer",
      target_id: 18,
      body: "顺便贴两个资料 http://a.example/1 与 http://b.example/2，供参考。",
    },
  });
  expect(twoLinks.status === 201, `2 链接正文 -> ${twoLinks.status}，期望 201 放行`);
  console.log(`  c) 3 链接 ${links.status}（${links.data.error}）；2 链接 ${twoLinks.status}`);

  // ---- d. 浏览器：成功路径无红字；拦截 403 错误内联在输入框 ----
  for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const ctx = await browser.newContext({ viewport: vp, locale: "zh-CN" });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    await injectErrs(page);
    await page.addInitScript(
      ([k, t]) => localStorage.setItem(k, t),
      ["zhihu_token", token]
    );
    await page.goto(`${pageBase}/question/6`, { waitUntil: "networkidle" });
    await page.locator(".question__title").first().waitFor();

    const firstAnswer = page.locator("li.answer").first();
    await firstAnswer.getByRole("button", { name: /条评论|收起评论/ }).click();
    const form = firstAnswer.locator(".answer__comment-form");
    const input = form.locator("textarea");
    await input.waitFor();

    // 成功路径：自然文本 → 成功 toast，form 内不出现 [role=alert]。
    const okText = `这个思路很清晰，受教了 ${Date.now()}`;
    await input.fill(okText);
    await form.getByRole("button", { name: "发布评论", exact: true }).click();
    await page.locator(".toast", { hasText: "评论已发布" }).waitFor({ timeout: 5000 });
    expect(
      (await form.locator("[role=alert]").count()) === 0,
      `成功路径出现 role=alert（${vp.width}px）`
    );

    // 失败路径：仅拦截 POST /api/comments 回 403（GET 列表照常放行）。
    await page.route("**/api/comments", (route) => {
      if (route.request().method() === "POST") {
        route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({
            error: "评论未通过内容校验：命中规则 R2a:走查冒号",
            rule: "R2a:走查冒号",
          }),
        });
      } else {
        route.continue();
      }
    });
    const failText = "走查：这条评论会被拦截";
    await input.fill(failText);
    await form.getByRole("button", { name: "发布评论", exact: true }).click();
    const alert = form.locator("[role=alert]");
    await alert.waitFor({ timeout: 5000 });
    const alertText = (await alert.innerText()).trim();
    expect(alertText.includes("命中规则"), `alert 文案异常：「${alertText}」`);
    // 与 textarea 垂直间距 < 24px、非 fixed 定位。
    const [taBox, alBox, pos] = await Promise.all([
      input.boundingBox(),
      alert.boundingBox(),
      alert.evaluate((el) => getComputedStyle(el).position),
    ]);
    const gap = alBox.y - (taBox.y + taBox.height);
    expect(gap >= 0 && gap < 24, `alert 与 textarea 垂直间距 ${gap.toFixed(1)}px（${vp.width}px）`);
    expect(pos !== "fixed", `alert position=${pos}，不应 fixed`);
    expect(
      (await input.inputValue()) === failText,
      `失败后草稿被清空（${vp.width}px）`
    );
    // 不再用全局错误 toast 报这条评论错误。
    expect(
      (await page.locator(".toast--error").count()) === 0,
      `评论失败仍走了全局错误 toast（${vp.width}px）`
    );

    const errs = await page.evaluate(() => window.__errs || []);
    expect(errs.length === 0, `页面错误(${vp.width}px)：${errs.join(" | ")}`);
    console.log(`  d) ${vp.width}×${vp.height}: 成功 toast 无 alert；403 内联「${alertText}」间距 ${gap.toFixed(1)}px 草稿保留`);
    await ctx.close();
  }
});
