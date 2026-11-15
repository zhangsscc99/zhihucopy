// Shared helpers for scripts/assert/*.mjs — HTTP-level acceptance checks.
// Env: API_BASE (default http://127.0.0.1:3030/zhihucopy/api)
//
// Z983 自清理：经 req()/register() 创建的对象自动记入 owned 集合，进程退出时
// （正常/异常都算）调 scripts/cleanup-artifacts.mjs --apply --only-owned=… 删掉，
// 不再往库里留产物。可用 ASSERT_NO_CLEANUP=1 关闭（调试时保留现场）。

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const API = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");

let seq = 0;
export function uniq(prefix = "assert") {
  return `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

// ---- 产物跟踪 + 退出清理（Z983） ---------------------------------------------

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

// POST 响应 -> 产物类型。按路径形态取响应里的对象 id。
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

let cleaned = false;
export function cleanupOwned() {
  if (cleaned || !owned.size || process.env.ASSERT_NO_CLEANUP === "1") return;
  cleaned = true;
  const env = { ...process.env, API_BASE: API };
  // 断言进程拿到 DB_PATH 才透传（= 断言实际连的库）；缺席时子进程走 API 模式，
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
    // 清理失败不影响断言语义：原样打印子进程 stderr/stdout，残留交给调度器按标记兜底。
    const detail = [e.stderr, e.stdout].filter((s) => s && String(s).trim()).join("\n").trim();
    console.error(`[cleanup] 自清理失败（不影响断言结果）: ${detail || e.message || e}`);
  }
}
process.on("exit", cleanupOwned);

export function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}

export async function req(method, p, { token, body } = {}) {
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

export async function ok(method, p, opts = {}) {
  const r = await req(method, p, opts);
  expect(r.status >= 200 && r.status < 300, `${method} ${p} -> ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  return r.data;
}

export async function register(nickname = uniq("assert")) {
  const email = `${uniq("assert")}@test.dev`;
  const r = await req("POST", "/auth/register", { body: { email, password: "assert-pass-123", nickname } });
  expect(r.status === 201, `register -> ${r.status}`);
  return { token: r.data.token, user: r.data.user, email };
}

export async function login(email, password) {
  return req("POST", "/auth/login", { body: { email, password } });
}

// better-sqlite3 resolved from server/node_modules (no new dep).
export function db() {
  const requireFromServer = createRequire(new URL("../../server/package.json", import.meta.url));
  const Database = requireFromServer("better-sqlite3");
  const path = process.env.DB_PATH || new URL("../../data/zhihu.db", import.meta.url).pathname;
  return new Database(path, { readonly: true });
}

export async function main(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`[ASSERT] ${name} PASS (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    process.exit(0);
  } catch (e) {
    console.error(`[ASSERT] ${name} FAIL (${((Date.now() - t0) / 1000).toFixed(1)}s): ${e.message || e}`);
    process.exit(1);
  }
}
