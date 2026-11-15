// Shared helpers for scripts/assert/*.mjs — HTTP-level acceptance checks.
// Env: API_BASE (default http://127.0.0.1:3030/zhihucopy/api)

import { createRequire } from "node:module";

export const API = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");

let seq = 0;
export function uniq(prefix = "assert") {
  return `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

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
