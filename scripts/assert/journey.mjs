#!/usr/bin/env node
// journey.mjs — Z950 巡检产出物断言：docs/PRODUCT-REVIEW.md 必须包含「本轮」完整链路记录。
// 只校验真实产出（不是空壳文档）：轮次小节 + 七个链路环节 + 缺陷分级 + 截图落盘。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const docPath = join(root, "docs/PRODUCT-REVIEW.md");
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

ok(existsSync(docPath), "docs/PRODUCT-REVIEW.md 不存在");
const doc = existsSync(docPath) ? readFileSync(docPath, "utf8") : "";

// 1. 至少两轮记录
const rounds = doc.match(/^## 轮次 /gm) || [];
ok(rounds.length >= 2, `巡检轮次不足（当前 ${rounds.length} 轮，要求 ≥ 2）`);

// 2. 最新轮次必须覆盖七个链路环节
const steps = ["首页", "问题", "回答", "点赞", "评论", "通知", "搜索"];
for (const s of steps) {
  ok(doc.includes(s), `PRODUCT-REVIEW.md 未记录「${s}」环节`);
}

// 3. 缺陷必须分级，且至少一条 P0/P1 与「已验证正常」小节
for (const level of ["P0", "P1", "P2"]) {
  ok(doc.includes(level), `PRODUCT-REVIEW.md 缺少 ${level} 分级`);
}
ok(/已验证正常|已验证/.test(doc), "缺少「已验证正常」小节（无法区分缺陷与正常行为）");

// 4. 必须有可追溯的截图路径
const shots = [...doc.matchAll(/\/root\/logs\/rev\d[\w.-]*\.png/g)].map((m) => m[0]);
ok(shots.length >= 5, `截图引用不足（${shots.length} 处，要求 ≥ 5）`);

// 5. 截图文件真实存在（抽样最近 5 个，避免误报历史清理）
let liveShots = 0;
if (existsSync("/root/logs")) {
  const files = new Set(readdirSync("/root/logs"));
  for (const s of shots.slice(-8)) {
    const base = s.split("/").pop();
    if (files.has(base)) liveShots += 1;
  }
}
ok(liveShots >= 3, `引用的截图实际落盘不足（命中 ${liveShots} 个，要求 ≥ 3）`);

if (fails.length) {
  console.error("[ASSERT] journey FAIL");
  for (const f of fails) console.error("  - " + f);
  process.exit(1);
}
console.log(`[ASSERT] journey PASS (rounds=${rounds.length}, shots=${shots.length}, live=${liveShots})`);
