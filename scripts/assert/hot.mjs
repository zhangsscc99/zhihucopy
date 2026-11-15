// Z023 — 热榜 /feed/hot：Top20，按互动加权排序。
import { ok, expect, main } from "./lib.mjs";

main("hot", async () => {
  const feed = await ok("GET", "/feed/hot");
  const items = feed.items || feed;
  expect(Array.isArray(items), "hot feed is not an array");
  expect(items.length > 0 && items.length <= 20, `hot list size ${items.length} out of (0,20]`);
  // 排序存在性：相邻项的互动分应非递增（若返回了 score/hot_score 字段）
  const scores = items.map((i) => i.hot_score ?? i.score).filter((s) => typeof s === "number");
  if (scores.length >= 2) {
    for (let i = 1; i < scores.length; i++) expect(scores[i] <= scores[i - 1], "hot feed not sorted by score");
  }
});
