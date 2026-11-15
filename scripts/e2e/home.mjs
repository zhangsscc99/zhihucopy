// home.mjs — 首页加载 → 三个 tab 存在 → ≥1 条问题卡片渲染且作者昵称可见。
import { run, expect, BASE } from "./lib.mjs";

run("home", async ({ page }) => {
  await page.goto(`${BASE}/`);
  await page.waitForLoadState("networkidle");

  for (const label of ["关注", "推荐", "热榜"]) {
    const tab = page.getByRole("tab", { name: label });
    await tab.waitFor();
    expect(await tab.count() === 1, `tab「${label}」missing`);
  }

  // default tab = 推荐 (seeded data guarantees cards)
  const card = page.locator(".feed__item").first();
  await card.waitFor();
  expect((await page.locator(".feed__item").count()) >= 1, "no question cards rendered");

  const author = card.locator(".feed__author");
  expect((await author.textContent())?.trim().length > 0, "author nickname not visible");

  const title = (await card.locator(".feed__title").textContent())?.trim();
  expect(!!title, "question card has no title");
  console.log(`  first card: 「${title}」 by ${await author.textContent()}`);
});
