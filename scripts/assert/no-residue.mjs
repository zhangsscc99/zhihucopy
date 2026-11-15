// no-residue.mjs — Z983 闭环验收：自动化产物「创建 → 清理 → 断言无残留」。
//
// 两种跑法：
//   1) 默认（推荐，不依赖线上）：本脚本自起一个临时 server/index.js，挂
//      mktemp 出来的临时库，跑完整闭环后连锅端掉。
//   2) 外部实例：同时给 API_BASE 与 DB_PATH（或 --db=）时，直接打那个实例。
//      只给 API_BASE 不给 DB_PATH 没意义 —— 清理脚本要对同一个库动手。
//
// 覆盖：is_test 机器标记生效 → 标记清理（标题不含任何测试词也删）→
//       --only-owned 自清理 → owned 守卫不误删真实账号 → 真实对象无损、
//       questions.answer_count 等反范式计数一致。

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const CLEANUP = path.join(ROOT, "scripts", "cleanup-artifacts.mjs");

// ---- 实例准备：自起临时 server，或接外部实例 -----------------------------------

const dbArg = (process.argv.find((a) => a.startsWith("--db=")) || "").slice(5) || null;
const externalApi = process.env.API_BASE;
const externalDb = dbArg || process.env.DB_PATH || null;

// 本脚本自己显式调用 cleanup-artifacts 做闭环验证，关掉 lib 的退出自清理，
// 避免退出时对已删临时库再跑一遍空扫。
process.env.ASSERT_NO_CLEANUP = "1";

let tmpDir = null;
let child = null;
let apiBase;
let dbPath;

if (externalApi && externalDb) {
  apiBase = externalApi.replace(/\/+$/, "");
  dbPath = path.resolve(externalDb);
  process.env.API_BASE = apiBase;
  process.env.DB_PATH = dbPath;
  console.log(`[no-residue] 外部实例模式 API=${apiBase} DB=${dbPath}`);
} else {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "z983-noresidue-"));
  dbPath = path.join(tmpDir, "zhihu.db");
  const port = 23000 + Math.floor(Math.random() * 20000);
  apiBase = `http://127.0.0.1:${port}/zhihucopy/api`;
  // lib.mjs 在 import 时读 env —— 先设好再 dynamic import。
  process.env.API_BASE = apiBase;
  process.env.DB_PATH = dbPath;
  console.log(`[no-residue] 临时实例模式 port=${port} DB=${dbPath}`);
  child = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], {
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath, JWT_SECRET: "noresidue-secret" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  child.stdout.on("data", () => {});
  let up = false;
  for (let i = 0; i < 150 && !up; i++) {
    if (child.exitCode !== null) break;
    try {
      const r = await fetch(`${apiBase}/health`);
      up = r.ok;
    } catch {
      /* not yet */
    }
    if (!up) await new Promise((r) => setTimeout(r, 200));
  }
  if (!up) {
    child.kill("SIGKILL");
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.error("[ASSERT] no-residue FAIL: 临时 server 未就绪");
    process.exit(1);
  }
}

const { req, ok, register, expect, main, db } = await import("./lib.mjs");

// 真实侧命名必须避开测试形态：uniq() 的 ts36 段含 "-mw" 会命中 contains 规则，
// 用无连字符的随机串（也证明被删靠的是 is_test 标记而非标题猜测）。
const rid = () => `r${Math.random().toString(36).slice(2, 10)}`;

function cleanup(args) {
  execFileSync(process.execPath, [CLEANUP, ...args], {
    env: { ...process.env, DB_PATH: dbPath },
    stdio: ["ignore", "inherit", "inherit"],
  });
}

async function createRealUser() {
  // 非测试域邮箱 + 不含测试形态的昵称 → is_test 必须为 0。
  const email = `real-${rid()}@zhihucopy.dev`;
  const r = await req("POST", "/auth/register", {
    body: { email, password: "real-pass-123", nickname: `真人${rid()}`.slice(0, 24) },
  });
  expect(r.status === 201, `real register -> ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  return { token: r.data.token, user: r.data.user };
}

main("no-residue", async () => {
  const d = db();
  const one = (sql, ...args) => d.prepare(sql).get(...args);
  try {
    // ---- 基线：真实用户 + 真实问题 + 真实回答 ----
    const real = await createRealUser();
    const { question: rq } = await ok("POST", "/questions", {
      token: real.token,
      body: { title: `真实问题 ${rid()}？`, detail_md: "" },
    });
    const { answer: ra } = await ok("POST", `/questions/${rq.id}/answers`, {
      token: real.token,
      body: { content_md: "真实回答" },
    });
    const baseCount = one("SELECT answer_count FROM questions WHERE id = ?", rq.id).answer_count;
    expect(baseCount === 1, `基线 answer_count=${baseCount}，预期 1`);

    // ---- 标记断言：测试域注册落 is_test=1，真实账号落 0 ----
    const test = await register();
    const tRow = one("SELECT is_test FROM users WHERE id = ?", test.user.id);
    expect(tRow && tRow.is_test === 1, `测试注册未落 is_test=1: ${JSON.stringify(tRow)}`);
    const rRow = one("SELECT is_test FROM users WHERE id = ?", real.user.id);
    expect(rRow && rRow.is_test === 0, `真实账号被误标 is_test: ${JSON.stringify(rRow)}`);

    // ---- 产物：标题刻意不含任何测试形态词，证明删除靠的是标记不是猜 ----
    const { question: tq } = await ok("POST", "/questions", {
      token: test.token,
      body: { title: `关注流链路验证 ${rid()}？`, detail_md: "" },
    });
    const { answer: ta } = await ok("POST", `/questions/${tq.id}/answers`, {
      token: test.token,
      body: { content_md: "产物回答" },
    });
    const { comment: tc } = await ok("POST", "/comments", {
      token: test.token,
      body: { target_type: "question", target_id: tq.id, body: "产物评论" },
    });
    expect(one("SELECT COUNT(*) c FROM questions WHERE id = ?", tq.id).c === 1, "产物问题未落库");

    // ---- 标记+形态清理 ----
    cleanup(["--apply", "--older-than=0h"]);

    expect(one("SELECT COUNT(*) c FROM questions WHERE id = ?", tq.id).c === 0, "标记问题未删净");
    expect(one("SELECT COUNT(*) c FROM answers WHERE id = ?", ta.id).c === 0, "标记回答未删净");
    expect(one("SELECT COUNT(*) c FROM comments WHERE id = ?", tc.id).c === 0, "标记评论未删净");
    expect(one("SELECT COUNT(*) c FROM users WHERE id = ?", test.user.id).c === 0, "标记账号未删净");
    const det = await req("GET", `/questions/${tq.id}`);
    expect(det.status === 404, `已删问题详情仍可达 -> ${det.status}`);
    // 真实对象无损 + 计数一致。
    expect(one("SELECT COUNT(*) c FROM users WHERE id = ?", real.user.id).c === 1, "真实账号被误删");
    expect(one("SELECT COUNT(*) c FROM answers WHERE id = ?", ra.id).c === 1, "真实回答被误删");
    const after = one("SELECT answer_count FROM questions WHERE id = ?", rq.id);
    expect(after && after.answer_count === baseCount, `真实问题 answer_count 漂移: ${baseCount} -> ${after && after.answer_count}`);

    // ---- --only-owned 自清理路径（lib 退出时走的就是这条） ----
    const test2 = await register();
    const { question: tq2 } = await ok("POST", "/questions", {
      token: test2.token,
      body: { title: `再来一条 ${rid()}？`, detail_md: "" },
    });
    cleanup(["--apply", "--older-than=0h", `--only-owned=u:${test2.user.id}`]);
    expect(one("SELECT COUNT(*) c FROM questions WHERE id = ?", tq2.id).c === 0, "owned 问题未删净");
    expect(one("SELECT COUNT(*) c FROM users WHERE id = ?", test2.user.id).c === 0, "owned 账号未删净");

    // ---- owned 守卫：显式传真实账号 id 也不得删 ----
    cleanup(["--apply", "--older-than=0h", `--only-owned=u:${real.user.id},q:${rq.id},a:${ra.id}`]);

    // 注意：owned 模式下 q:/a: 是显式对象、不受账号守卫限制 —— 上面这行会真的删掉
    // rq/ra（这正是用例要的对象级语义）。真实账号本身必须活下来。
    expect(one("SELECT COUNT(*) c FROM users WHERE id = ?", real.user.id).c === 1, "owned 守卫失效：真实账号被删");

    d.close();
    if (child) {
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 300));
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  } finally {
    if (child && child.exitCode === null) child.kill("SIGKILL");
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
