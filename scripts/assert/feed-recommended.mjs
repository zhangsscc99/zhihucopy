// Z022 — 推荐流 /feed/recommended：返回分页 items。
import { ok, register, expect, main } from "./lib.mjs";

main("feed-recommended", async () => {
  const { token } = await register();
  const feed = await ok("GET", "/feed/recommended?page=1", { token });
  expect(Array.isArray(feed.items), "items is not an array");
  expect(feed.items.length > 0, "recommended feed empty (seeded data should produce items)");
  expect("has_more" in feed || "page" in feed || "next" in feed, "no pagination field in response");
});
