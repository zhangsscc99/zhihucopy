// comment-success-inline.mjs — Z1232 评论成功反馈内联化验收：成功提示改为
// 输入框下方绿色 role=status 状态条（2s 淡出、非 fixed、不压 article 正文），
// 不再走全局 toast；「发布评论」按钮右缘与 textarea 右缘对齐；新评论 li 带
// data-new="1" 浅蓝高亮且落在评论列表矩形内；390px 无横向溢出、__errs 空。
//
// 流程（同 comment-publish-ok 模式：源库 db.backup() → mktemp 临时库 →
// 自起临时 server，跑完 kill + 删临时库，不污染线上实例）：
//   cron 下跑需 `env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE
//   -u E2E_BASE -u E2E_BASE_URL -u E2E_API`。
//
// 断言（浏览器 390×844，登录态打开 /question/6，展开首条回答评论）：
//   a. 提交自然中文评论（无链接无敏感词）→ POST 201；
//   b. `.answer__comment-form [role=status]` 出现、与 textarea 垂直间距 <24px、
//      getComputedStyle(el).position !== 'fixed'、rect 不与 .answer__body（作者正文）相交；
//      该断言窗口内不出现「评论已发布」toast；
//   c. 新评论 li[data-new]（或 .answer__comment--flash）存在于
//      .answer__comment-list 内，且其 rect 落在列表 rect 范围内；
//   d. 「发布评论」按钮右缘与 textarea 右缘差值 <2px；
//      .answer__comments 容器左右内边距 ≥12px；
//   e. document.body.scrollWidth === 390；
//   f. window.__errs 为空。

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
  console.error("[ASSERT] comment-success-inline FAIL: 找不到源库（试过 " + candidates.join(", ") + "）");
  process.exit(1);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "z1232-comment-"));
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
console.log(`[comment-success-inline] 源库 ${SRC_DB} -> 临时库 ${tmpDb}`);

process.env.E2E_BASE = pageBase;
process.env.E2E_API = apiBase;
process.env.DB_PATH = tmpDb;
process.env.E2E_NO_CLEANUP = "1"; // 临时库整锅删，无需逐条清理。

child = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], {
  env: { ...process.env, PORT: String(port), DB_PATH: tmpDb, JWT_SECRET: "z1232-comment-secret" },
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
  console.error("[ASSERT] comment-success-inline FAIL: 临时 server 未就绪");
  process.exit(1);
}
console.log(`[comment-success-inline] 临时实例 ${pageBase} (port=${port})`);

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

// /question/6 须有 ≥1 条回答（浏览器断言挂点）。源库不含时直接 FAIL。
const pre = new Database(tmpDb, { readonly: true });
const q6answers = pre
  .prepare("SELECT id FROM answers WHERE question_id = 6 AND is_deleted = 0 ORDER BY id LIMIT 1")
  .all();
pre.close();
if (q6answers.length === 0) {
  console.error("[ASSERT] comment-success-inline FAIL: 临时库 /question/6 无可用回答");
  process.exit(1);
}
const answerId = q6answers[0].id;

run("comment-success-inline", async ({ browser }) => {
  // 注册一个普通号（自然评论入库 + 浏览器登录态）。
  const email = `${uniq("inline")}@example.com`;
  const reg = await api("POST", "/auth/register", {
    body: { email, password: "inline-pass-123456", nickname: uniq("读者") },
  });
  expect(reg.status === 201, `register -> ${reg.status} ${JSON.stringify(reg.data).slice(0, 200)}`);
  const token = reg.data.token;

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-CN" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  await injectErrs(page);
  await page.addInitScript(([k, t]) => localStorage.setItem(k, t), ["zhihu_token", token]);
  await page.goto(`${pageBase}/question/6`, { waitUntil: "networkidle" });
  await page.locator(".question__title").first().waitFor();

  const firstAnswer = page.locator("li.answer").first();
  await firstAnswer.getByRole("button", { name: /条评论|收起评论/ }).click();
  const form = firstAnswer.locator(".answer__comment-form");
  const input = form.locator("textarea");
  await input.waitFor();

  // 提交自然中文评论（无链接、无敏感词）。
  const text = "这个写法把问题说得很透，读完豁然开朗，感谢分享。";
  const posted = page.waitForResponse(
    (r) => r.url().includes("/api/comments") && r.request().method() === "POST",
    { timeout: 10000 }
  );
  await input.fill(text);
  await form.getByRole("button", { name: "发布评论", exact: true }).click();
  const resp = await posted;
  expect(resp.status() === 201, `POST /comments -> ${resp.status()}，期望 201`);

  // b. 内联 role=status 成功条。
  const status = form.locator('[role=status]');
  await status.waitFor({ timeout: 5000 });
  expect(
    (await page.locator(".toast", { hasText: "评论已发布" }).count()) === 0,
    "评论成功仍走了全局 toast"
  );
  const [taBox, stBox, stPos, bodyRects] = await Promise.all([
    input.boundingBox(),
    status.boundingBox(),
    status.evaluate((el) => getComputedStyle(el).position),
    // 「正文」以 .answer__body 各块级矩形计（整页唯一 <article> 是 .question
    // 容器、天然包含评论流内元素，字面判定无意义；走查缺陷原文是 toast 压
    // 「作者正文」）。
    page.locator(".answer__body").evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      })
    ),
  ]);
  const gap = stBox.y - (taBox.y + taBox.height);
  expect(gap >= -2 && gap < 24, `role=status 与 textarea 垂直间距 ${gap.toFixed(1)}px，期望 <24px`);
  expect(stPos !== "fixed", `role=status position=${stPos}，不应 fixed`);
  const hit = bodyRects.find(
    (r) =>
      !(
        stBox.y + stBox.height <= r.y ||
        stBox.y >= r.y + r.h ||
        stBox.x + stBox.width <= r.x ||
        stBox.x >= r.x + r.w
      )
  );
  expect(!hit, "role=status 矩形与回答正文（.answer__body）矩形相交（压正文）");
  const stColor = await status.evaluate((el) => getComputedStyle(el).color);
  console.log(`  b) role=status 内联成功条（color=${stColor}，间距 ${gap.toFixed(1)}px，pos=${stPos}，不压 article）`);

  // c. 新评论 li 带 data-new / --flash，且在评论列表矩形内。
  const newLi = firstAnswer.locator("li.answer__comment[data-new], li.answer__comment--flash").first();
  await newLi.waitFor({ timeout: 5000 });
  const listRect = await firstAnswer.locator(".answer__comment-list").boundingBox();
  const liRect = await newLi.boundingBox();
  const inside =
    liRect.y >= listRect.y - 1 &&
    liRect.y + liRect.height <= listRect.y + listRect.height + 1 &&
    liRect.x >= listRect.x - 1 &&
    liRect.x + liRect.width <= listRect.x + listRect.width + 1;
  expect(inside, "新评论 li 的 rect 不在评论列表 rect 内");
  console.log("  c) 新评论 li 带 data-new/flash 且位于列表内");

  // d. 「发布评论」按钮右缘与 textarea 右缘差值 <2px；容器内边距 ≥12px。
  const btnBox = await form.getByRole("button", { name: "发布评论", exact: true }).boundingBox();
  const taBox2 = await input.boundingBox();
  const rightDiff = Math.abs((btnBox.x + btnBox.width) - (taBox2.x + taBox2.width));
  expect(rightDiff < 2, `按钮右缘与 textarea 右缘差 ${rightDiff.toFixed(1)}px，期望 <2px`);
  const pads = await firstAnswer.locator(".answer__comments").evaluate((el) => {
    const cs = getComputedStyle(el);
    return [parseFloat(cs.paddingLeft), parseFloat(cs.paddingRight)];
  });
  expect(pads[0] >= 12 && pads[1] >= 12, `.answer__comments 左右内边距 ${pads[0]}/${pads[1]}px，期望 ≥12px`);
  console.log(`  d) 按钮右缘对齐差 ${rightDiff.toFixed(1)}px；容器内边距 ${pads[0]}/${pads[1]}px`);

  // e. 390px 无横向溢出。
  const sw = await page.evaluate(() => document.body.scrollWidth);
  expect(sw === 390, `document.body.scrollWidth=${sw}，期望 390`);

  // f. __errs 空。
  const errs = await page.evaluate(() => window.__errs || []);
  expect(errs.length === 0, `页面错误：${errs.join(" | ")}`);

  await ctx.close();
  console.log(`[comment-success-inline] PASS（answer#${answerId} 下内联成功条 + data-new 高亮 + 右缘对齐）`);
});
