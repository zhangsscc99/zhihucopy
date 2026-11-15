// Z041 — 举报接口 + 自动折叠（≥3 次举报 → is_collapsed）。
import { ok, req, register, expect, main, uniq } from "./lib.mjs";

main("reports", async () => {
  const author = await register();
  const { question } = await ok("POST", "/questions", { token: author.token, body: { title: `[assert] ${uniq("q")}?`, detail_md: "" } });
  const { answer } = await ok("POST", `/questions/${question.id}/answers`, { token: author.token, body: { content_md: "被举报目标回答" } });

  for (let i = 0; i < 3; i++) {
    const reporter = await register();
    const r = await req("POST", "/reports", {
      token: reporter.token,
      body: { target_type: "answer", target_id: answer.id, reason: "spam", detail: `auto report ${i}` },
    });
    expect(r.status < 300, `report ${i} -> ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  }

  const detail = await ok("GET", `/answers/${answer.id}`);
  const a = detail.answer || detail;
  expect(a.is_collapsed === 1 || a.is_collapsed === true, `answer not collapsed after 3 reports (is_collapsed=${a.is_collapsed})`);
});
