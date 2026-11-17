#!/usr/bin/env node
// Z1139 — 存量条目断言总跑：依次以子进程运行本车道补齐的断言脚本与既有
// follow-user.mjs，任一非 0 即退出 1；逐项打印 rc 与耗时。
//
// 覆盖条目 → 脚本：
//   Z972  → scripts/assert/mobile-search.mjs
//   Z974  → scripts/assert/notfound-page.mjs
//   Z978  → scripts/assert/login-copy.mjs
//   Z979  → scripts/assert/mobile-nav.mjs
//   Z1019 → scripts/assert/notify-events.mjs
//   Z1020 → scripts/assert/edit-delete.mjs
//   Z1018 → scripts/assert/follow-user.mjs（已存在，只需跑通）
//
// 环境透传：子进程继承本进程 env（API_BASE/E2E_BASE/DB_PATH 等）。
// 用法：env API_BASE=… E2E_BASE=… node scripts/assert/verify-stale-items.mjs

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const SCRIPTS = [
  "mobile-search.mjs",
  "notfound-page.mjs",
  "login-copy.mjs",
  "mobile-nav.mjs",
  "notify-events.mjs",
  "edit-delete.mjs",
  "follow-user.mjs",
];

function runOne(file) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [join(HERE, file)], {
      env: process.env,
      stdio: "inherit",
    });
    child.on("close", (code) => {
      resolve({ file, rc: code ?? 1, ms: Date.now() - t0 });
    });
    child.on("error", (err) => {
      console.error(`[verify-stale] ${file} spawn error: ${err.message || err}`);
      resolve({ file, rc: 1, ms: Date.now() - t0 });
    });
  });
}

async function main() {
  const out = [];
  for (const file of SCRIPTS) {
    console.log(`[verify-stale] ---- ${file} ----`);
    const r = await runOne(file);
    out.push(r);
    console.log(
      `[verify-stale] ${file} rc=${r.rc} ${(r.ms / 1000).toFixed(1)}s ${r.rc === 0 ? "PASS" : "FAIL"}`
    );
  }
  const fails = out.filter((r) => r.rc !== 0);
  console.log("[verify-stale] ---- summary ----");
  for (const r of out) {
    console.log(
      `${r.rc === 0 ? "PASS" : "FAIL"} verify-stale-items ${r.file} rc=${r.rc} ${(r.ms / 1000).toFixed(1)}s`
    );
  }
  console.log(
    `[ASSERT] verify-stale-items ${fails.length ? "FAIL" : "PASS"} — ${out.length - fails.length}/${out.length} scripts rc=0`
  );
  process.exit(fails.length ? 1 : 0);
}

main();
