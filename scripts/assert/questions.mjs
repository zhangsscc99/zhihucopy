// Z004 — 提问接口 POST /questions + 列表 GET /questions。
import { ok, req, register, expect, main, uniq } from "./lib.mjs";

main("questions", async () => {
  const { token } = await register();
  const title = `[assert] ${uniq("q")} — 提问接口验收？`;
  const { question } = await ok("POST", "/questions", { token, body: { title, detail_md: "assert probe", topic_ids: [] } });
  expect(question.id > 0, "no question id returned");

  const list = await ok("GET", "/questions?tab=new&limit=10");
  expect(list.items.some((q) => q.id === question.id), "new question not in tab=new list");

  const detail = await ok("GET", `/questions/${question.id}`);
  expect(detail.question.title === title, "detail title mismatch");

  const noAuth = await req("POST", "/questions", { body: { title: "x" } });
  expect(noAuth.status === 401, `POST /questions without token -> ${noAuth.status}, expected 401`);
});
