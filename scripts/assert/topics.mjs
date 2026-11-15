// Z031 — 话题页接口：简介 + 关注 + 内容流。
import { ok, req, register, expect, main } from "./lib.mjs";

main("topics", async () => {
  const { token } = await register();
  // 找一个挂了话题的问题
  const list = await ok("GET", "/questions?tab=hot&limit=20");
  let topic = null;
  for (const it of list.items) {
    const d = await ok("GET", `/questions/${it.id}`);
    if (d.question.topics?.length) { topic = d.question.topics[0]; break; }
  }
  expect(topic, "no seeded question carries a topic");

  const key = topic.slug || topic.id;
  const page = await ok("GET", `/topics/${key}`);
  expect(page.topic && page.topic.name === topic.name, "topic payload missing/mismatched");
  expect(Array.isArray(page.items) && page.items.length > 0, "topic content stream empty");

  const f = await req("POST", `/topics/${key}/follow`, { token });
  expect(f.status < 300, `follow topic -> ${f.status}`);
});
