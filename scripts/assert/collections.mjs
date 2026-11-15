// Z012 — 收藏夹 CRUD + 收藏/取消。
import { ok, req, register, expect, main, uniq } from "./lib.mjs";

main("collections", async () => {
  const { token } = await register();
  const { question } = await ok("POST", "/questions", { token, body: { title: `[assert] ${uniq("q")}?`, detail_md: "" } });
  const { answer } = await ok("POST", `/questions/${question.id}/answers`, { token, body: { content_md: "x" } });

  const { collection } = await ok("POST", "/collections", { token, body: { name: uniq("收藏夹"), is_public: false } });
  await ok("POST", `/collections/${collection.id}/items`, { token, body: { answer_id: answer.id } });
  const mine = await ok("GET", "/collections/mine", { token });
  expect((mine.collections || mine.items || []).some((c) => c.id === collection.id), "collection not in /collections/mine");

  const items = await ok("GET", `/collections/${collection.id}/items`, { token });
  expect((items.items || []).some((i) => i.answer_id === answer.id || i.id === answer.id), "answer not in collection items");

  const r = await req("DELETE", `/collections/${collection.id}/items/${answer.id}`, { token });
  expect(r.status < 300, `remove collection item -> ${r.status}`);
});
