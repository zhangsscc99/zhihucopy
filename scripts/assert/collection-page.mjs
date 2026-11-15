// Z1021 — 收藏夹页面 API 契约：列表/详情/条目可读，取消收藏后 has_item 与 item_count 回写。
import { ok, req, register, expect, main, uniq } from "./lib.mjs";

main("collection-page", async () => {
  const { token } = await register();

  const { question } = await ok("POST", "/questions", {
    token,
    body: { title: `[assert] ${uniq("q")}?`, detail_md: "" },
  });
  const { answer } = await ok("POST", `/questions/${question.id}/answers`, {
    token,
    body: { content_md: "[assert] 收藏页断言回答" },
  });

  // 未登录：GET /collections 401（页面据此渲染登录引导）。
  const anon = await req("GET", "/collections");
  expect(anon.status === 401, `anonymous GET /collections -> ${anon.status}, want 401`);

  // 建收藏夹 -> 收藏该回答。
  const { collection } = await ok("POST", "/collections", {
    token,
    body: { name: `[assert] ${uniq("收藏夹")}` },
  });
  const add = await ok("POST", `/collections/${collection.id}/items`, {
    token,
    body: { answer_id: answer.id },
  });
  expect(add.collected === true, "POST items should return collected:true");

  // 总览列表：收藏夹在列、item_count=1、带 has_item 标记、带 last_collected_at（页面「更新于」）。
  const list = await ok("GET", "/collections", { token });
  const mine = (list.collections || []).find((c) => c.id === collection.id);
  expect(mine, "new collection missing from GET /collections");
  expect(mine.item_count === 1, `item_count should be 1, got ${mine.item_count}`);
  const flagged = await ok("GET", `/collections?answer_id=${answer.id}`, { token });
  expect(
    flagged.collections.find((c) => c.id === collection.id)?.has_item === 1,
    "has_item should be 1 after collect"
  );

  // 详情 + 条目：渲染所需的字段都在（问题标题/作者/摘要来源 content_md/收藏时间）。
  const detail = await ok("GET", `/collections/${collection.id}`, { token });
  expect(detail.collection.item_count === 1, "GET /collections/:id item_count should be 1");
  const items = await ok("GET", `/collections/${collection.id}/items`, { token });
  const hit = (items.items || []).find((i) => i.answer_id === answer.id);
  expect(hit, "answer missing from collection items");
  expect(hit.question_title === question.title, "item should carry question_title");
  expect(hit.author && hit.author.nickname, "item should carry author");
  expect(typeof hit.collected_at === "string" && hit.collected_at, "item should carry collected_at");

  // 私有收藏夹：他人读详情/条目都拿不到（403 不可见，页面显示「该收藏夹不可见」）。
  const { collection: priv } = await ok("POST", "/collections", {
    token,
    body: { name: `[assert] ${uniq("私密")}`, is_public: false },
  });
  const { token: stranger } = await register();
  const pv = await req("GET", `/collections/${priv.id}`, { token: stranger });
  expect(pv.status === 403, `private collection for stranger -> ${pv.status}, want 403`);
  const pvi = await req("GET", `/collections/${priv.id}/items`, { token: stranger });
  expect(pvi.status === 403, `private items for stranger -> ${pvi.status}, want 403`);
  // 本人仍可读。
  const own = await ok("GET", `/collections/${priv.id}`, { token });
  expect(own.collection.id === priv.id, "owner should read own private collection");

  // 取消收藏：条目即时消失、item_count/has_item 回写为 0。
  const rm = await ok("DELETE", `/collections/${collection.id}/items/${answer.id}`, { token });
  expect(rm.collected === false, "DELETE items should return collected:false");
  const items2 = await ok("GET", `/collections/${collection.id}/items`, { token });
  expect(
    !(items2.items || []).some((i) => i.answer_id === answer.id),
    "item should disappear after uncollect"
  );
  const detail2 = await ok("GET", `/collections/${collection.id}`, { token });
  expect(detail2.collection.item_count === 0, "item_count should write back to 0");
  const flagged2 = await ok("GET", `/collections?answer_id=${answer.id}`, { token });
  expect(
    flagged2.collections.find((c) => c.id === collection.id)?.has_item === 0,
    "has_item should be 0 after uncollect"
  );
});
