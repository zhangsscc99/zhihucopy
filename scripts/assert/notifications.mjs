// Z040 — 通知接口：他人回答 → 产生通知 + 未读数 + 全部已读。
// 注意：测试账号/测试内容产生的通知不进列表（content-filter），
// 因此本用例注册「真实形态」账号并发布非测试标题的问题。
import { ok, req, expect, main, uniq } from "./lib.mjs";

async function realRegister() {
  const nickname = `用户${uniq("n").replace(/-/g, "")}`.slice(0, 24);
  const email = `${uniq("real")}@zhihucopy.dev`;
  const r = await req("POST", "/auth/register", {
    body: { email, password: "assert-pass-123", nickname },
  });
  expect(r.status === 201, `register -> ${r.status}`);
  return { token: r.data.token, user: r.data.user, email };
}

main("notifications", async () => {
  const a = await realRegister();
  const b = await realRegister();
  const { question } = await ok("POST", "/questions", { token: a.token, body: { title: `通知链路验证${uniq("q").replace(/-/g, "")}？`, detail_md: "" } });
  const first = await ok("POST", `/questions/${question.id}/answers`, { token: b.token, body: { content_md: "触发通知的回答" } });

  const unread = await ok("GET", "/notifications/unread-count", { token: a.token });
  expect((unread.count ?? unread.unread ?? 0) >= 1, "unread count did not increase");

  const list = await ok("GET", "/notifications", { token: a.token });
  const items = list.items || [];
  expect(
    items.some((n) => /answer/.test(n.type || "") || (n.actor && n.actor.id === b.user.id)),
    "no answer-notification from B in A's list"
  );

  // 通知项必须能定位到触发它的具体回答（不是「该用户最新一条回答」）。
  const forFirst = items.find((n) => n.payload && n.payload.answer_id === first.answer.id);
  expect(
    forFirst,
    `notification payload does not point at created answer ${first.answer.id} (payloads: ${JSON.stringify(items.map((n) => n.payload))})`
  );
  expect(
    Number(forFirst.payload.question_id) === Number(question.id),
    "notification payload question_id mismatch"
  );

  // 同一人再次回答同一问题：两条通知必须各自指向各自的回答（防旧通知被新回答覆盖）。
  const second = await ok("POST", `/questions/${question.id}/answers`, { token: b.token, body: { content_md: "第二条回答，用于验证通知不会指向新回答" } });
  const list2 = await ok("GET", "/notifications", { token: a.token });
  const ids2 = (list2.items || [])
    .filter((n) => n.actor && n.actor.id === b.user.id && n.payload)
    .map((n) => Number(n.payload.answer_id));
  expect(ids2.includes(Number(first.answer.id)), "old notification lost its answer_id after a second answer");
  expect(ids2.includes(Number(second.answer.id)), "new notification missing its answer_id");

  const r = await req("POST", "/notifications/read", { token: a.token, body: { all: true } });
  expect(r.status < 300, `mark-all-read -> ${r.status}`);
  const after = await ok("GET", "/notifications/unread-count", { token: a.token });
  expect((after.count ?? after.unread ?? 0) === 0, "unread count not zero after read-all");

  // unread=1 必须真的过滤（全部已读后应为空）。
  const unreadList = await ok("GET", "/notifications?unread=1", { token: a.token });
  expect(
    (unreadList.items || []).length === 0,
    `unread=1 returned ${(unreadList.items || []).length} item(s) after read-all (filter not applied)`
  );
  expect(Number(unreadList.total ?? 0) === 0, "unread=1 total not zero after read-all");

  // unread=0 → 只看已读。
  const readList = await ok("GET", "/notifications?unread=0", { token: a.token });
  const readItems = readList.items || [];
  expect(readItems.length >= 2, "unread=0 did not return the read notifications");
  expect(readItems.every((n) => n.is_read === true), "unread=0 returned an unread notification");
});
