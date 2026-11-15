// Shared helpers for zhihucopy E2E scripts (playwright-core + system chromium).
//
// Env:
//   E2E_BASE   page base URL        (default http://127.0.0.1:3030/zhihucopy)
//   E2E_API    api base URL         (default <E2E_BASE>/api, or API_BASE env)
//   CHROME     chromium binary path (default: first /root/.cache/ms-playwright/chromium-*/chrome-linux/chrome)
//
// Each script calls run("<name>", async ({page, ...}) => { ... }).
// Exit code 0 = pass, 1 = fail (screenshot saved to /root/logs/e2e-<name>-<ts>.png).

import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BASE = (process.env.E2E_BASE || "http://127.0.0.1:3030/zhihucopy").replace(/\/+$/, "");
export const API = (process.env.E2E_API || process.env.API_BASE || `${BASE}/api`).replace(/\/+$/, "");
export const SHOT_DIR = process.env.E2E_SHOT_DIR || "/root/logs";
export const TOKEN_KEY = "zhihu_token";

let seq = 0;
export function uniq(prefix = "e2e") {
  return `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

export function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = "/root/.cache/ms-playwright";
  for (const d of fs.readdirSync(root).filter((d) => d.startsWith("chromium-")).sort().reverse()) {
    const p = path.join(root, d, "chrome-linux", "chrome");
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`no chromium under ${root}`);
}

export function expect(cond, msg) {
  if (!cond) throw new Error(`assert: ${msg}`);
}

// ---- 产物跟踪 + 退出清理（Z983） ---------------------------------------------
// 经 api()/register() 创建的对象自动记入 owned；run() 结束前还会扫所有页面的
// localStorage token（UI 注册/登录的账号 uid）一并清掉。owned u: 仅当账号命中
// 测试标记/形态才真删（cleanup-artifacts 内有守卫），种子/真实账号不受影响。
// 可用 E2E_NO_CLEANUP=1 关闭（调试时保留现场）。

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLEANUP = path.join(SCRIPT_DIR, "..", "cleanup-artifacts.mjs");
const owned = new Set(); // "u:12" "q:34" "a:56" "c:78" "col:90"
// 会话 -> 该会话创建的对象清单。DB_PATH 缺席时自清理走 API 模式，
// 服务端按「调用者是作者/is_test/管理员」逐 id 裁决，所以必须按会话分组。
const sessions = new Map(); // token -> Set<"k:id">

export function trackOwned(kind, id, token) {
  if (!Number.isInteger(id) || id <= 0) return;
  const key = `${kind}:${id}`;
  owned.add(key);
  if (token) {
    if (!sessions.has(token)) sessions.set(token, new Set());
    sessions.get(token).add(key);
  }
}

const TRACK_POST = [
  [/^\/auth\/register$/, (d) => d.user && ["u", d.user.id]],
  [/^\/questions$/, (d) => d.question && ["q", d.question.id]],
  [/^\/questions\/\d+\/answers$/, (d) => d.answer && ["a", d.answer.id]],
  [/^\/comments$/, (d) => d.comment && ["c", d.comment.id]],
  [/^\/collections$/, (d) => d.collection && ["col", d.collection.id]],
];

function trackResponse(method, p, status, data, reqToken) {
  if (method !== "POST" || status < 200 || status >= 300 || !data) return;
  // 记下本 run 拿到的会话 token（注册/登录响应），供 API 清理作为删除身份。
  if (typeof data.token === "string" && data.token && !sessions.has(data.token)) {
    sessions.set(data.token, new Set());
  }
  for (const [re, pick] of TRACK_POST) {
    if (re.test(p)) {
      const hit = pick(data);
      // 注册响应自带新账号 token，以本人会话记录；其余用发起请求的 token。
      if (hit) trackOwned(hit[0], hit[1], data.token || reqToken);
      return;
    }
  }
}

// UI 注册/登录在页面里留 token —— 解码 JWT payload 拿 uid 进 owned。
export async function trackSessionUsers(browser) {
  try {
    for (const ctx of browser.contexts()) {
      for (const page of ctx.pages()) {
        const t = await page
          .evaluate((k) => localStorage.getItem(k), TOKEN_KEY)
          .catch(() => null);
        if (!t) continue;
        const payload = JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString());
        if (payload && Number.isInteger(payload.uid)) trackOwned("u", payload.uid, t);
      }
    }
  } catch {
    // token 扫描失败不阻塞用例结束。
  }
}

let cleaned = false;
export function cleanupOwned() {
  if (cleaned || !owned.size || process.env.E2E_NO_CLEANUP === "1") return;
  cleaned = true;
  const env = { ...process.env, API_BASE: API };
  // 用例进程拿到 DB_PATH 才透传（= 用例实际连的库）；缺席时子进程走 API 模式，
  // 绝不回落生产库。
  if (process.env.DB_PATH) env.DB_PATH = process.env.DB_PATH;
  if (sessions.size) {
    env.CLEANUP_API_SESSIONS = JSON.stringify(
      Object.fromEntries([...sessions].map(([t, ids]) => [t, [...ids].join(",")]))
    );
  }
  try {
    const out = execFileSync(
      process.execPath,
      [CLEANUP, "--apply", "--older-than=0h", `--only-owned=${[...owned].join(",")}`],
      { env, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 60000 }
    );
    if (out && out.trim()) process.stdout.write(out);
  } catch (e) {
    // 清理失败不影响用例语义：原样打印子进程 stderr/stdout。
    const detail = [e.stderr, e.stdout].filter((s) => s && String(s).trim()).join("\n").trim();
    console.error(`[cleanup] 自清理失败（不影响用例结果）: ${detail || e.message || e}`);
  }
}
process.on("exit", cleanupOwned);

// ---- API helpers (server side of the test, no browser needed) ----
export async function api(method, p, { token, body } = {}) {
  const res = await fetch(API + p, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  trackResponse(method, p, res.status, data, token);
  return { status: res.status, data };
}

export async function apiOk(method, p, opts = {}) {
  const r = await api(method, p, opts);
  expect(r.status >= 200 && r.status < 300, `${method} ${p} -> ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  return r.data;
}

export async function register(nickname = uniq("e2e")) {
  const email = `${uniq("e2e")}@test.dev`;
  const password = "e2e-pass-123456";
  const r = await api("POST", "/auth/register", { body: { email, password, nickname } });
  expect(r.status === 201, `register -> ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  return { token: r.data.token, user: r.data.user, email, password };
}

// ---- browser helpers ----
export async function launch() {
  return chromium.launch({
    executablePath: chromePath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
}

export async function newPage(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "zh-CN" });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  return page;
}

// Seed localStorage token before app JS runs, then the SPA boots authenticated.
export async function authedPage(browser, token) {
  const page = await newPage(browser);
  await page.addInitScript(([k, t]) => localStorage.setItem(k, t), [TOKEN_KEY, token]);
  return page;
}

export async function uiLogin(page, email, password) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  // SPA navigate("/") 落到 ${BASE}（无尾斜杠）；对尾斜杠/查询串宽容匹配。
  const esc = BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page.waitForURL(new RegExp(`^${esc}/?([?#].*)?$`), { timeout: 15000 });
}

// Find one question that already has answers (for vote/comment tests).
export async function questionWithAnswers() {
  const list = await apiOk("GET", "/questions?tab=hot&limit=50");
  const q = (list.items || []).find((it) => it.answer_count > 0);
  expect(q, "no seeded question with answers found");
  const detail = await apiOk("GET", `/questions/${q.id}`);
  expect(detail.answers && detail.answers.length > 0, `question ${q.id} has no answers in detail`);
  return detail;
}

// ---- runner ----
export async function run(name, fn) {
  const started = Date.now();
  let browser, page;
  try {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    browser = await launch();
    page = await newPage(browser);
    await fn({ browser, page });
    console.log(`[E2E] ${name} PASS (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    await trackSessionUsers(browser);
    await browser.close();
    process.exit(0);
  } catch (e) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const shot = path.join(SHOT_DIR, `e2e-${name}-${ts}.png`);
    try {
      if (page) await page.screenshot({ path: shot, fullPage: true });
      console.error(`[E2E] ${name} screenshot: ${shot}`);
    } catch {
      console.error(`[E2E] ${name} screenshot failed`);
    }
    console.error(`[E2E] ${name} FAIL (${((Date.now() - started) / 1000).toFixed(1)}s): ${e.message || e}`);
    if (browser) {
      await trackSessionUsers(browser);
      await browser.close().catch(() => {});
    }
    process.exit(1);
  }
}
