// ask-answer.mjs — 登录后提问 → 详情页出现标题 → 提交回答 → 回答出现在列表。
import { run, expect, BASE, register, authedPage, uniq } from "./lib.mjs";

run("ask-answer", async ({ browser }) => {
  const { token } = await register();
  const page = await authedPage(browser, token);

  const title = `[e2e] ${uniq("q")} — 为什么自动化验收比人工验收可靠？`;
  const detail = "这是一个 E2E 自动化脚本创建的问题，用于验证提问链路。";
  const answerText = `[e2e] ${uniq("a")} — 机器判定可重复、可回放、不疲劳。`;

  await page.goto(`${BASE}/ask`);
  await page.getByLabel("标题").fill(title);
  await page.getByLabel(/补充说明/).fill(detail);
  await page.getByRole("button", { name: "发布问题" }).click();

  await page.waitForURL(/\/question\/\d+/, { timeout: 15000 });
  const h1 = page.locator(".question__title, h1");
  await h1.waitFor();
  expect((await h1.textContent())?.includes(title), `detail page title mismatch: "${await h1.textContent()}"`);

  await page.locator(".answer-editor textarea, .answer-editor .field--area").fill(answerText);
  await page.getByRole("button", { name: "发布回答" }).click();

  const item = page.locator(".answerlist .answer", { hasText: answerText.slice(0, 40) });
  await item.waitFor();
  expect(await item.count() === 1, "submitted answer not found in answer list");
});
