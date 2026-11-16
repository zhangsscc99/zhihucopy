// search.mjs — 顶栏搜索关键词 → 结果页有命中 → 空结果页显示空态引导。
// 契约（Z953）：搜索提交后进入 /?q= 首页搜索态；结果项含关键词（或高亮 <mark>）；
// 无结果时显示空态文案（含「没有/暂无/找到/试试」之一）。
import { run, expect, BASE, apiOk, uniq } from "./lib.mjs";

run("search", async ({ page }) => {
  // 取一个真实存在的关键词（某个种子里问题的标题片段）
  const list = await apiOk("GET", "/questions?tab=hot&limit=10");
  const title = list.items[0].title;
  const keyword = title.replace(/[？?。！!，,\s]/g, " ").split(" ").filter((w) => w.length >= 4)[0] || title.slice(0, 6);

  await page.goto(`${BASE}/`);
  const box = page.getByRole("searchbox").or(page.locator(".topnav__search input, header input[aria-label='搜索']")).first();
  await box.fill(keyword);
  await box.press("Enter");
  await page.waitForLoadState("networkidle");

  expect(/[?&]q=/.test(page.url()), `search did not navigate to /?q= (url=${page.url()})`);
  const hit = page.locator("main, .main-col, body").getByText(keyword, { exact: false }).first();
  await hit.waitFor({ timeout: 8000 });

  // Z1044 分类 tab：切「回答」后 URL 带 type=answer 且该 tab aria-selected="true"。
  const ansTab = page.getByRole("tab", { name: /^回答/ }).first();
  await ansTab.waitFor({ timeout: 8000 });
  await ansTab.click();
  await page.waitForLoadState("networkidle");
  expect(/[?&]type=answer/.test(page.url()), `切「回答」tab 后 URL 无 type=answer（url=${page.url()}）`);
  expect(
    (await ansTab.getAttribute("aria-selected")) === "true",
    "「回答」tab 未置 aria-selected=\"true\""
  );

  // 顶栏再提交回到默认「问题」tab（URL 不带 type）。
  await box.fill(keyword);
  await box.press("Enter");
  await page.waitForLoadState("networkidle");
  expect(!/[?&]type=/.test(page.url()), `再提交后 URL 不应带 type（url=${page.url()}）`);

  // 空结果
  const none = uniq("nohit");
  await box.fill(none);
  await box.press("Enter");
  await page.waitForLoadState("networkidle");
  await page.getByText(/没有找到|无结果|暂无|空空如也|换个关键词|试试/).first().waitFor({ timeout: 8000 });
});
