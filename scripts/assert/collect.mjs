// Z1003 — 收藏闭环：GET /collections 列表 + is_collected 回读 + 幂等收/退。
import { ok, req, register, expect, main, uniq } from "./lib.mjs";

main("collect", async () => {
  const { token } = await register();
  const { token: otherToken } = await register();

  const { question } = await ok("POST", "/questions", {
    token,
    body: { title: `[assert] ${uniq("q")}?`, detail_md: "" },
  });
  const { answer } = await ok("POST", `/questions/${question.id}/answers`, {
    token,
    body: { content_md: "x" },
  });

  // 未收藏时：本人 / 他人 / 匿名读 GET /answers/:id 都应 is_collected === false。
  const before = await ok("GET", `/answers/${answer.id}`, { token });
  expect(before.answer.is_collected === false, "is_collected should be false before collect");

  // 建一个收藏夹 -> GET /collections 200 且包含它（/mine 同口径）。
  const { collection } = await ok("POST", "/collections", {
    token,
    body: { name: uniq("收藏夹") },
  });
  const list = await ok("GET", "/collections", { token });
  expect(Array.isArray(list.collections), "GET /collections should return {collections}");
  expect(
    list.collections.some((c) => c.id === collection.id),
    "new collection missing from GET /collections"
  );
  // ?answer_id= 标记：此刻还没有收藏夹装着它。
  const flagged0 = await ok("GET", `/collections?answer_id=${answer.id}`, { token });
  expect(
    flagged0.collections.find((c) => c.id === collection.id)?.has_item === 0,
    "has_item should be 0 before collect"
  );

  // 收藏 -> 响应 collected:true；重复收藏幂等（200 + collected:true）。
  const add = await ok("POST", `/collections/${collection.id}/items`, {
    token,
    body: { answer_id: answer.id },
  });
  expect(add.collected === true, "POST items should return collected:true");
  const again = await req("POST", `/collections/${collection.id}/items`, {
    token,
    body: { answer_id: answer.id },
  });
  expect(again.status === 200, `repeat collect should be 200, got ${again.status}`);
  expect(again.data.collected === true, "repeat collect should keep collected:true");

  // 回读：/answers/:id 与 /questions/:id 回答列表口径一致，都是 true。
  const after = await ok("GET", `/answers/${answer.id}`, { token });
  expect(after.answer.is_collected === true, "is_collected should be true after collect");
  const detail = await ok("GET", `/questions/${question.id}`, { token });
  const inList = detail.answers.find((a) => a.id === answer.id);
  expect(inList && inList.is_collected === true, "question detail answers missing is_collected:true");
  // 他人视角不受影响。
  const foreign = await ok("GET", `/answers/${answer.id}`, { token: otherToken });
  expect(foreign.answer.is_collected === false, "other user should see is_collected:false");

  // 取消 -> collected:false，回读 false。
  const rm = await ok("DELETE", `/collections/${collection.id}/items/${answer.id}`, { token });
  expect(rm.collected === false, "DELETE items should return collected:false");
  const gone = await ok("GET", `/answers/${answer.id}`, { token });
  expect(gone.answer.is_collected === false, "is_collected should be false after uncollect");
});
