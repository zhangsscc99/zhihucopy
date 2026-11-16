// Z1069 — 评论域断言加固总闸门（测试基建）。
//
// 两道防线：
//   1) 静态守卫（辅助性质，非真门禁）——直接检查被加固断言文件的源码，
//      确认加固真的落在代码里。注意：此段只是源码字符串 grep，注释里出现
//      同样字符串也能通过，单独不足以作门禁；真正的咬人门禁是第 2 段
//      子进程行为闸门的 RC：
//      · comment-count.mjs：评论计数用「锚定正则 + trimmed 全等」（^2 条评论$），
//        不再是不设防的 includes——否则「12 条评论」会误配通过；
//      · comment-reply-ui.mjs：有 [Z1069] 标记的失败路径段（[role=alert] +
//        textarea 草稿用 inputValue() 读，不用 getByText 假匹配）与
//        「占位行 count>0」正向守卫。
//   2) 行为闸门——依次以子进程跑本域四个断言文件（两个加固 + 两个新增），
//      任一 RC!=0 即整门 FAIL。对未修改基线：reply-draft-race / reply-form-polish
//      断言的是本轮新行为，必然 FAIL → 本门 RC!=0（反向自检成立）。
//
// 环境：API_BASE / E2E_BASE / E2E_API / DB_PATH 原样透传给子进程。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const t0 = Date.now();
const fails = [];
const check = (cond, msg) => {
  if (!cond) fails.push(msg);
};
const src = (name) =>
  fs.readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

// ---- 1) 静态守卫 ----
const countSrc = src("comment-count.mjs");
check(
  /\^\\?\(?\\d\+\)? 条评论\$/.test(countSrc) ||
    countSrc.includes('=== "2 条评论"'),
  "comment-count.mjs 未见锚定计数断言（^N 条评论$ / trimmed 全等）"
);
check(
  countSrc.includes('=== "2 条评论"'),
  "comment-count.mjs 缺 trimmed 全等断言（防「12 条评论」误配）"
);

const replySrc = src("comment-reply-ui.mjs");
check(
  /Z1069/.test(replySrc),
  "comment-reply-ui.mjs 未见 [Z1069] 加固标记（失败路径/占位行正向守卫）"
);
check(
  /inputValue\(\)/.test(replySrc),
  "comment-reply-ui.mjs 失败路径未用 inputValue() 读 textarea 草稿"
);
check(
  /deletedRows\.count\(\)/.test(replySrc) && /> 0/.test(replySrc),
  "comment-reply-ui.mjs 缺「删除占位行 count>0」正向守卫"
);

// ---- 2) 行为闸门：本域断言全绿 ----
const SUITE = [
  "comment-count.mjs",
  "comment-reply-ui.mjs",
  "reply-draft-race.mjs",
  "reply-form-polish.mjs",
];

for (const f of SUITE) {
  const p = fileURLToPath(new URL(`./${f}`, import.meta.url));
  const r = spawnSync(process.execPath, [p], {
    env: process.env,
    encoding: "utf8",
    timeout: 300000,
  });
  const tail = `${r.stdout || ""}${r.stderr || ""}`.trim().split("\n").slice(-3).join("\n");
  if (r.status !== 0) {
    fails.push(`${f} 子断言 FAIL（rc=${r.status}）：${tail.slice(-300)}`);
  } else {
    console.log(`[hardening] ${f} 子断言 PASS`);
  }
}

if (fails.length) {
  console.error(
    `[ASSERT] comment-assert-hardening FAIL (${((Date.now() - t0) / 1000).toFixed(1)}s):\n  - ${fails.join("\n  - ")}`
  );
  process.exit(1);
}
console.log(`[ASSERT] comment-assert-hardening PASS (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(0);
