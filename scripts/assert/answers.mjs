// Z005 — 回答接口：POST /questions/:id/answers + 列表 + 详情。
import { ok, req, register, expect, main, uniq } from "./lib.mjs";

main("answers", async () => {
  const { token } = await register();
  const { question } = await ok("POST", "/questions", { token, body: { title: `[assert] ${uniq("q")} — 回答接口验收？`, detail_md: "" } });

  const content = `[assert] ${uniq("a")} — 回答正文。`;
  const { answer } = await ok("POST", `/questions/${question.id}/answers`, { token, body: { content_md: content } });
  expect(answer.id > 0, "no answer id");

  const list = await ok("GET", `/questions/${question.id}/answers`);
  expect(list.items.some((a) => a.id === answer.id), "answer not in list");

  const one = await ok("GET", `/answers/${answer.id}`);
  expect(one.answer.content_md === content, "answer detail content mismatch");

  const detail = await ok("GET", `/questions/${question.id}`);
  expect(detail.question.answer_count === 1, `answer_count=${detail.question.answer_count}, expected 1`);

  const noAuth = await req("POST", `/questions/${question.id}/answers`, { body: { content_md: "x" } });
  expect(noAuth.status === 401, `POST answer without token -> ${noAuth.status}, expected 401`);
});
