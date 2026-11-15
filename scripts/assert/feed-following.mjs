// Z021 — 关注流 /feed/following：A 关注 B 后，B 的回答/提问出现在 A 的流中。
import { ok, register, expect, main, uniq } from "./lib.mjs";

main("feed-following", async () => {
  const a = await register();
  const b = await register();
  await ok("POST", `/users/${b.user.id}/follow`, { token: a.token });

  const { question } = await ok("POST", "/questions", { token: b.token, body: { title: `[assert] ${uniq("q")} — B 的提问？`, detail_md: "" } });
  await ok("POST", `/questions/${question.id}/answers`, { token: b.token, body: { content_md: "B 的回答" } });

  const feed = await ok("GET", "/feed/following?page=1", { token: a.token });
  const items = feed.items || [];
  expect(
    items.some((it) => it.id === question.id || it.question_id === question.id || (it.question && it.question.id === question.id)),
    "B's question/answer not in A's following feed"
  );
});
