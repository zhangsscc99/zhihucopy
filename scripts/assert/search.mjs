// Z030 — FTS5 搜索接口：命中 + 高亮片段 + 类型筛选。
import { ok, expect, main, uniq } from "./lib.mjs";

main("search", async () => {
  const list = await ok("GET", "/questions?tab=hot&limit=5");
  const title = list.items[0].title;
  const kw = title.replace(/[？?。！!，,\s]/g, " ").split(" ").find((w) => w.length >= 4) || title.slice(0, 6);

  const res = await ok("GET", `/search?q=${encodeURIComponent(kw)}`);
  const items = res.items || [];
  expect(items.length > 0, `search「${kw}」returned no hits`);
  const text = JSON.stringify(items[0]);
  expect(/mark|em|highlight|snippet/i.test(text), "no highlight/snippet field in result");

  const typed = await ok("GET", `/search?q=${encodeURIComponent(kw)}&type=question`);
  expect(Array.isArray(typed.items), "type=question did not return items array");

  const none = await ok("GET", `/search?q=${encodeURIComponent(uniq("nohit"))}`);
  expect((none.items || []).length === 0, "gibberish query returned hits");
});
