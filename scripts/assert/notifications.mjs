// Z040 — 通知接口：他人回答 → 产生通知 + 未读数 + 全部已读。
import { ok, req, register, expect, main, uniq } from "./lib.mjs";

main("notifications", async () => {
  const a = await register();
  const b = await register();
  const { question } = await ok("POST", "/questions", { token: a.token, body: { title: `[assert] ${uniq("q")} — 通知验收？`, detail_md: "" } });
  await ok("POST", `/questions/${question.id}/answers`, { token: b.token, body: { content_md: "触发通知的回答" } });

  const unread = await ok("GET", "/notifications/unread-count", { token: a.token });
  expect((unread.count ?? unread.unread ?? 0) >= 1, "unread count did not increase");

  const list = await ok("GET", "/notifications", { token: a.token });
  const items = list.items || [];
  expect(
    items.some((n) => /answer/.test(n.type || "") || (n.actor && n.actor.id === b.user.id)),
    "no answer-notification from B in A's list"
  );

  const r = await req("POST", "/notifications/read", { token: a.token, body: { all: true } });
  expect(r.status < 300, `mark-all-read -> ${r.status}`);
  const after = await ok("GET", "/notifications/unread-count", { token: a.token });
  expect((after.count ?? after.unread ?? 0) === 0, "unread count not zero after read-all");
});
