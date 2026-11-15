// Z052 — 反垃圾：同一用户 5 分钟内发帖 > 3 条 → 限速提示。
import { req, register, expect, main, uniq } from "./lib.mjs";

main("antispam", async () => {
  const { token } = await register();
  let lastStatus = 0, lastData = {};
  for (let i = 0; i < 4; i++) {
    const r = await req("POST", "/questions", { token, body: { title: `[assert] ${uniq("spam")}?`, detail_md: "" } });
    lastStatus = r.status;
    lastData = r.data;
    if (r.status === 429 || (r.status >= 400 && /频繁|限速|太多|过快|limit/i.test(JSON.stringify(r.data)))) break;
  }
  expect(
    lastStatus === 429 || (lastStatus >= 400 && /频繁|限速|太多|过快|limit/i.test(JSON.stringify(lastData))),
    `4 rapid posts all succeeded (last=${lastStatus}) — no rate limit`
  );
});
