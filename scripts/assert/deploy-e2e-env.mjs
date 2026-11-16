// Z1056 — ci-deploy.sh / report.sh：e2e 门禁钉死本地地址 + preflight 区分环境故障。
// 背景：调度器 shell 继承导出 E2E_BASE=...:3033（无服务），e2e 全 PENDING/FAIL
//       → ci-deploy 连续 3 次误回滚；report.sh 照常写出 PENDING 报告。
// 断言：
//   1. bash -n 通过
//   2. 两脚本都以 export 钉死 E2E_BASE/E2E_API —— 动态实测：提取脚本里的 export
//      行，在 E2E_BASE=http://127.0.0.1:9/zhihucopy 毒环境下执行，必须被改写成本机实例
//   3. e2e 前存在 $E2E_API/health preflight + 中文不可达提示 + 独立 exit 2
//   4. ci-deploy：preflight 失败写 history stage=e2e-preflight 且 NO_ROLLBACK 拦回滚
// 注：ci-deploy.sh 无 --dry-run，无法整脚本跑毒环境实测；「提取 export 行实测覆盖」
//     语义等价（export 无条件覆盖继承值），故不再做整脚本动态断言。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { expect, main } from "./lib.mjs";

main("deploy-e2e-env", async () => {
  for (const f of ["scripts/ci-deploy.sh", "scripts/report.sh"]) {
    execFileSync("bash", ["-n", f]);
    const src = fs.readFileSync(f, "utf8");

    const pin = src.split("\n").filter((l) => /^export E2E_(BASE|API)=/.test(l.trim()));
    expect(pin.length === 2, `${f}: expected 2 'export E2E_*' pin lines, got ${pin.length}`);

    // 动态实测：毒环境（继承的 E2E_BASE/E2E_API 指向无服务端口）下执行 pin 行。
    const prelude = f.includes("ci-deploy")
      ? 'PROD_URL="http://127.0.0.1:3030/zhihucopy/api"'
      : 'LOCAL_HEALTH="http://127.0.0.1:3030/zhihucopy/api/health"';
    const out = execFileSync(
      "bash",
      ["-c", `${prelude}; ${pin.join("; ")}; echo "BASE=$E2E_BASE"; echo "API=$E2E_API"`],
      {
        env: { ...process.env, E2E_BASE: "http://127.0.0.1:9/zhihucopy", E2E_API: "http://127.0.0.1:9/x/api" },
        encoding: "utf8",
      }
    );
    console.log(`  [evidence] ${f} under poisoned env -> ${out.trim().replace(/\n/g, "  ")}`);
    expect(out.includes("BASE=http://127.0.0.1:3030/zhihucopy"), `${f}: E2E_BASE not pinned to local instance`);
    expect(out.includes("API=http://127.0.0.1:3030/zhihucopy/api"), `${f}: E2E_API not pinned to local instance`);

    expect(src.includes('"$E2E_API/health"'), `${f}: missing curl preflight against $E2E_API/health`);
    expect(src.includes("health 非 200"), `${f}: missing Chinese unreachable message`);
    expect(src.includes("exit 2"), `${f}: preflight must fail with distinct exit code 2`);
  }

  const ci = fs.readFileSync("scripts/ci-deploy.sh", "utf8");
  expect(ci.includes("stage=e2e-preflight"), "ci-deploy.sh: missing history 'stage=e2e-preflight'");
  expect(ci.includes("NO_ROLLBACK=1"), "ci-deploy.sh: preflight failure must set NO_ROLLBACK");
  expect(/RESTARTED && ! NO_ROLLBACK/.test(ci), "ci-deploy.sh: rollback path must honor NO_ROLLBACK");

  const code = execFileSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "10", "http://127.0.0.1:3030/zhihucopy/api/health"], { encoding: "utf8" });
  console.log(`  [evidence] live 3030 health -> HTTP ${code.trim()}`);
});
