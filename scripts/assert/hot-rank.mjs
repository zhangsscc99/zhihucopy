// Z1022 — 热榜区分度：GET /questions?tab=hot&limit=10
//   1) 每条必须带数值型 hot_score（确定性分数，非空、有限）；
//   2) 条目按 hot_score 降序（分数即顺序，与 ORDER BY 同表达式）；
//   3) 不含测试产物（标题/作者昵称，口径同 server/content-filter.js：
//      覆盖 ^\[e2e\]、巡检、验证+随机串 等全部形态）。
import { createRequire } from "node:module";
import { ok, expect, main } from "./lib.mjs";

const { isTestTitle, isTestNickname } = createRequire(import.meta.url)(
  "../../server/content-filter.js"
);

main("hot-rank", async () => {
  const res = await ok("GET", "/questions?tab=hot&limit=10");
  const items = res.items || [];
  expect(Array.isArray(items), "items is not an array");
  expect(items.length > 0, "hot list empty (seeded data should produce items)");
  for (const it of items) {
    expect(
      typeof it.hot_score === "number" && Number.isFinite(it.hot_score),
      `q${it.id} missing numeric hot_score: ${JSON.stringify(it.hot_score)}`
    );
    expect(
      !isTestTitle(it.title || ""),
      `hot list leaked test title: ${it.title}`
    );
    const nick = (it.author && it.author.nickname) || "";
    expect(
      !isTestNickname(nick),
      `hot list leaked test author nickname: ${nick}`
    );
  }
  for (let i = 1; i < items.length; i++) {
    expect(
      items[i].hot_score <= items[i - 1].hot_score,
      `hot_score not descending at index ${i}: ` +
        `${items[i - 1].hot_score} -> ${items[i].hot_score}`
    );
  }
});
