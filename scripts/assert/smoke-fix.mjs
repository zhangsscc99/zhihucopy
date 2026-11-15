// Z065 — ci-deploy.sh：修复 cleanup_smoke 重入时 SMOKE_* unbound 变量 + smoke 纳入 votes/comments。
// 断言：
//   1. bash -n 通过
//   2. cleanup_smoke 函数体内不允许裸 $SMOKE_*/${SMOKE_*} 引用（pm2-restart 会 unset，
//      EXIT trap 重入时裸引用在 set -u 下直接炸 —— 必须写 ${SMOKE_X:-}/${SMOKE_X+x} 形式）
//   3. smoke 段含 /votes 与 /comments 调用
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { expect, main } from "./lib.mjs";

main("smoke-fix", async () => {
  const file = "scripts/ci-deploy.sh";
  execFileSync("bash", ["-n", file]); // syntax
  const src = fs.readFileSync(file, "utf8");

  // extract cleanup_smoke body: from `cleanup_smoke() {` to matching close brace
  const start = src.indexOf("cleanup_smoke()");
  expect(start > 0, "cleanup_smoke function not found");
  const open = src.indexOf("{", start);
  const close = src.indexOf("\n}", open);
  const body = src.slice(open, close > 0 ? close : src.length);

  const bare = body.match(/\$SMOKE_(DB|LOG|PID|PORT)\b|\$\{SMOKE_(DB|LOG|PID|PORT)\}/g) || [];
  expect(bare.length === 0, `unbound-risk SMOKE_* refs in cleanup_smoke: ${[...new Set(bare)].join(", ")}`);

  expect(/votes|\/vote/.test(src) && /comments|\/comments/.test(src), "smoke suite does not exercise votes/comments endpoints");
});
