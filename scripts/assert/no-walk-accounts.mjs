// Z1178 — 「沈舟拾NNNN」走查空号断言：公共用户搜索不可见 + 注册即落 is_test=1。
//
// 契约（与 scripts/hide-walk-accounts.js、server/routes/auth.js 配套）：
//   1) GET /users?q=沈舟拾&limit=50 返回 items.length === 0（存量已软隐藏，
//      新注册落 is_test=1 后被 testUserSql 过滤）；
//   2) 注册探针：以「沈舟拾 + 4 位随机数字」昵称 POST /auth/register 必须
//      返回 201（外部走查任务依赖注册成功，不能 403）且 user.is_test === 1；
//      随后 GET /users?q=<新昵称> 仍为 0 条；探针号保留 is_test=1 落库
//      （不经 lib 自清理物理删 —— 刻意用裸 fetch 注册、退出时跳过 owned 清理）；
//   3) --self-test：复制 DB_PATH 库到临时文件，植入 2 个沈舟拾NNNN 零产出号
//      （is_test=0），跑 hide-walk-accounts.js --apply --db <副本> 后两个号
//      必须 is_test=1；不触碰生产库；
//   4) GET /users?q=review 返回条目不包含 ^沈舟拾\d{4}$ 昵称（走查号的
//      review<6位>@zhihucopy.dev 邮箱不再漏进搜索）。
//
// 逐项打印 PASS/FAIL，任一 FAIL 退出码 1。
//
// 环境：API_BASE 或 BASE（默认 http://127.0.0.1:3030/zhihucopy/api），
//       --base <url> 同效（本地起服验证时指向 127.0.0.1:<port>/api）；
//       DB_PATH（仅 --self-test 的母库用，默认 ../data/zhihu.db）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const requireHere = createRequire(import.meta.url);
const requireFromServer = createRequire(
  path.join(SCRIPT_DIR, "..", "..", "server", "package.json")
);
const { isWalkAccount } = requireHere("../../server/content-filter.js");

// --base / API_BASE / BASE 必须在 ./lib.mjs 顶层固化 API 之前写入 env。
const baseIdx = process.argv.indexOf("--base");
if (baseIdx >= 0 && process.argv[baseIdx + 1]) {
  process.env.API_BASE = process.argv[baseIdx + 1];
} else if (!process.env.API_BASE && process.env.BASE) {
  process.env.API_BASE = process.env.BASE;
}
const { req, ok, expect } = await import("./lib.mjs");

const DB_PATH = path.resolve(
  process.env.DB_PATH || path.join(SCRIPT_DIR, "..", "..", "data", "zhihu.db")
);
const SELF_TEST = process.argv.includes("--self-test");
const RE_WALK_USER = /^沈舟拾\d{4}$/;

const API_BASE = process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api";

let failures = 0;
function check(cond, label, detail = "") {
  if (cond) {
    console.log(`  PASS ${label}`);
  } else {
    failures++;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function liveChecks() {
  console.log("[no-walk-accounts] 提示：基线（清理前/旧注册逻辑）运行本断言应 FAIL");

  // 1) 用户搜索清零。
  const us = await ok("GET", `/users?q=${encodeURIComponent("沈舟拾")}&limit=50`);
  check(
    (us.items || []).length === 0,
    "GET /users?q=沈舟拾 items.length === 0",
    `实得 ${(us.items || []).length} 条：` +
      (us.items || []).map((u) => `${u.nickname}#${u.id}`).join(",")
  );

  // 2) 注册探针：201 + is_test=1，随后搜索不可见。裸 fetch 注册 —— 不进入
  //    lib owned 跟踪，探针号保留 is_test=1 落库（软隐藏，不物理删）。
  const digits = String(1000 + Math.floor(Math.random() * 9000));
  const nick = `沈舟拾${digits}`;
  const email = `review${String(100000 + Math.floor(Math.random() * 900000))}@zhihucopy.dev`;
  const regRes = await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "walk-probe-pass-123", nickname: nick }),
  });
  const regData = await regRes.json().catch(() => ({}));
  check(
    regRes.status === 201 && regData.user,
    `注册探针 ${nick} 返回 201`,
    `status=${regRes.status} body=${JSON.stringify(regData).slice(0, 120)}`
  );
  if (regRes.status === 201 && regData.user) {
    check(
      regData.user.is_test === 1,
      `探针 ${nick} user.is_test === 1`,
      `is_test=${regData.user.is_test}`
    );
    const probe = await ok("GET", `/users?q=${encodeURIComponent(nick)}&limit=50`);
    check(
      (probe.items || []).length === 0,
      `GET /users?q=${nick} items.length === 0`,
      `实得 ${(probe.items || []).length} 条`
    );
  }

  // 4) review 邮箱域搜索不再漏沈舟拾NNNN 空号。
  const rev = await ok("GET", `/users?q=${encodeURIComponent("review")}&limit=50`);
  const leaked = (rev.items || []).filter((u) => RE_WALK_USER.test(u.nickname || ""));
  check(
    leaked.length === 0,
    "GET /users?q=review 不含 ^沈舟拾\\d{4}$ 昵称",
    `泄漏 ${leaked.length} 条：` + leaked.map((u) => `${u.nickname}#${u.id}`).join(",")
  );
}

// ---- --self-test：副本库植入 2 个空号 -> hide --apply --db -> 必须隐藏 ------
function selfTest() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "z1178-selftest-"));
  const tmp = path.join(tmpDir, "zhihu.db");
  fs.copyFileSync(DB_PATH, tmp);
  const Database = requireFromServer("better-sqlite3");
  const db = new Database(tmp);
  const ids = [];
  try {
    const ins = db.prepare(
      `INSERT INTO users (email, password_hash, nickname, is_test, created_at)
       VALUES (?, 'x', ?, 0, datetime('now'))`
    );
    for (let i = 0; i < 2; i++) {
      const info = ins.run(`st${Date.now()}${i}@zhihucopy.dev`, `沈舟拾${7000 + i}`);
      ids.push(Number(info.lastInsertRowid));
    }
    const seeded = db
      .prepare("SELECT nickname FROM users WHERE id IN (?, ?)")
      .all(ids[0], ids[1]);
    expect(
      seeded.every((r) => isWalkAccount(r) && RE_WALK_USER.test(r.nickname)),
      "self-test 植入失败：昵称未命中走查口径"
    );
    db.close();

    const out = execFileSync(
      process.execPath,
      [path.join(SCRIPT_DIR, "..", "hide-walk-accounts.js"), "--apply", "--db", tmp],
      { env: { ...process.env, DB_PATH: tmp }, encoding: "utf8", timeout: 120000 }
    );
    process.stdout.write(out);

    const db2 = new Database(tmp, { readonly: true });
    try {
      const rows = db2
        .prepare("SELECT id, nickname, is_test FROM users WHERE id IN (?, ?)")
        .all(ids[0], ids[1]);
      for (const r of rows) {
        check(r.is_test === 1, `self-test ${r.nickname}#${r.id} is_test === 1`, `is_test=${r.is_test}`);
      }
      // 幂等二跑：0 条需处理。
      const out2 = execFileSync(
        process.execPath,
        [path.join(SCRIPT_DIR, "..", "hide-walk-accounts.js"), "--apply", "--db", tmp],
        { env: { ...process.env, DB_PATH: tmp }, encoding: "utf8", timeout: 120000 }
      );
      check(/0 条需处理/.test(out2), "self-test 幂等二跑输出 0 条需处理", out2.trim().slice(-120));
    } finally {
      db2.close();
    }
  } finally {
    try { db.close(); } catch {}
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  if (failures === 0) console.log("[ASSERT] no-walk-accounts --self-test PASS");
}

async function run() {
  if (SELF_TEST) {
    selfTest();
  } else {
    await liveChecks();
  }
  if (failures > 0) {
    console.error(`[ASSERT] no-walk-accounts FAIL（${failures} 项）`);
    process.exit(1);
  }
  console.log(`[ASSERT] no-walk-accounts PASS`);
  process.exit(0);
}

run().catch((e) => {
  console.error(`[ASSERT] no-walk-accounts FAIL: ${e.message || e}`);
  process.exit(1);
});
