// run-all.mjs — 串行跑全部 e2e 脚本并汇总。
//
// 门禁语义：一个脚本是「硬性」(REQUIRED) 的条件是
//   - 它属于核心基线（core: home / auth / ask-answer），或
//   - 它覆盖的 FID 在 docs/FEATURES.md 已全部勾选 [x]（功能声称完成 → 不许回归）
// 非硬性脚本的失败记为 PENDING（功能未宣称完成，如实报告但不阻塞部署）。
// 退出码：有 REQUIRED 失败 → 1；否则 0。
//
// Env: E2E_BASE / E2E_API / E2E_SHOT_DIR 透传给子脚本；--json <file> 输出机器可读汇总。

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const FEATURES = path.join(REPO, "docs", "FEATURES.md");

// script -> 覆盖的 FID（全部勾选才硬性）+ core 基线标记
const MANIFEST = {
  "home.mjs":          { fids: ["Z006", "Z024", "Z053"], core: true },
  "auth.mjs":          { fids: ["Z003"], core: true },
  "ask-answer.mjs":    { fids: ["Z004", "Z005"], core: true },
  "vote-comment.mjs":  { fids: ["Z013", "Z066"] },
  "search.mjs":        { fids: ["Z030", "Z032"] },
  "notifications.mjs": { fids: ["Z040", "Z043"] },
  "ask-editor.mjs":    { fids: ["Z014"] },
  "answer-editor.mjs": { fids: ["Z015"] },
  "profile.mjs":       { fids: ["Z025"] },
  "topic.mjs":         { fids: ["Z031", "Z033"] },
  "admin.mjs":         { fids: ["Z042", "Z044"] },
  "a11y.mjs":          { fids: ["Z054"] },
  // Z1173：第十五轮巡检探针进硬门禁 —— 覆盖评论展开/发布/删除回写链路，
  // Z1169 守卫过宽（is_test 一刀切）曾把它整体打死且 run-all 不报 FAIL。
  "probe-round15.mjs": { core: true, fids: [] },
};

function doneFids() {
  const done = new Set();
  if (fs.existsSync(FEATURES)) {
    for (const line of fs.readFileSync(FEATURES, "utf8").split("\n")) {
      const m = line.match(/^- \[x\]\s+(Z\d+)/i);
      if (m) done.add(m[1]);
    }
  }
  return done;
}

const args = process.argv.slice(2);
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;

const done = doneFids();
const scripts = fs
  .readdirSync(HERE)
  .filter((f) => f.endsWith(".mjs") && !["lib.mjs", "run-all.mjs"].includes(f))
  .sort();

console.log(`[e2e] base=${process.env.E2E_BASE || "http://127.0.0.1:3030/zhihucopy"}  scripts=${scripts.length}`);

const results = [];
for (const s of scripts) {
  const meta = MANIFEST[s] || { fids: [] };
  const required = !!meta.core || (meta.fids.length > 0 && meta.fids.every((f) => done.has(f)));
  const t0 = Date.now();
  const r = spawnSync("node", [path.join(HERE, s)], { encoding: "utf8", env: process.env });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const pass = r.status === 0;
  const shot = ((r.stderr || "") + (r.stdout || "")).match(/screenshot: (\S+\.png)/)?.[1] || "";
  const tail = (r.stdout + r.stderr).trim().split("\n").pop() || "";
  const status = pass ? "PASS" : required ? "FAIL" : "PENDING";
  results.push({ script: s, required, pass, secs, shot, tail });
  console.log(`[e2e] ${s.padEnd(22)} ${status.padEnd(7)} ${secs}s ${required ? "(gate)" : "(pending)"}${shot ? ` shot=${shot}` : ""}`);
  if (!pass && required) console.log(`       ${tail.slice(0, 200)}`);
}

const failReq = results.filter((r) => !r.pass && r.required);
const failOpt = results.filter((r) => !r.pass && !r.required);
console.log(
  `[e2e] summary: ${results.filter((r) => r.pass).length} pass, ${failReq.length} gate-fail, ${failOpt.length} pending`
);
if (failOpt.length) console.log(`[e2e] pending: ${failOpt.map((r) => r.script).join(", ")}`);

if (jsonOut) {
  fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
  fs.writeFileSync(jsonOut, JSON.stringify({ base: process.env.E2E_BASE || null, results }, null, 2));
}
process.exit(failReq.length ? 1 : 0);
