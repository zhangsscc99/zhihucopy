// Z004 — 提问接口 POST /questions + 列表 GET /questions。
// 注意：列表会过滤测试产物（content-filter），因此用真实形态账号与标题验证链路。
import { ok, req, expect, main, uniq } from "./lib.mjs";

main("questions", async () => {
  const nickname = `用户${uniq("n").replace(/-/g, "")}`.slice(0, 24);
  const email = `${uniq("real")}@zhihucopy.dev`;
  const reg = await req("POST", "/auth/register", {
    body: { email, password: "assert-pass-123", nickname },
  });
  expect(reg.status === 201, `register -> ${reg.status}`);
  const token = reg.data.token;
  const title = `提问接口链路验证${uniq("q").replace(/-/g, "")}？`;
  const { question } = await ok("POST", "/questions", { token, body: { title, detail_md: "assert probe", topic_ids: [] } });
  expect(question.id > 0, "no question id returned");

  const list = await ok("GET", "/questions?tab=new&limit=10");
  expect(list.items.some((q) => q.id === question.id), "new question not in tab=new list");

  const detail = await ok("GET", `/questions/${question.id}`);
  expect(detail.question.title === title, "detail title mismatch");

  const noAuth = await req("POST", "/questions", { body: { title: "x" } });
  expect(noAuth.status === 401, `POST /questions without token -> ${noAuth.status}, expected 401`);
});
