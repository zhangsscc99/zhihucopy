// answer-editor.mjs — 回答编辑器：实时预览 + 草稿本地保存。
// 契约（Z015）：问题详情页的回答编辑器
//   - 输入 markdown 后出现预览（.md-preview / [data-testid] / 「预览」切换），或输入即渲染
//   - 草稿写入 localStorage（键名含 draft 或 answer），刷新后内容仍在
import { run, expect, BASE, register, authedPage, questionWithAnswers, uniq } from "./lib.mjs";

run("answer-editor", async ({ browser }) => {
  const { token } = await register();
  const detail = await questionWithAnswers();
  const page = await authedPage(browser, token);
  await page.goto(`${BASE}/question/${detail.question.id}`);
  await page.locator(".question__title, h1").first().waitFor();

  const draft = `**草稿内容** ${uniq("d")}`;
  const area = page.locator(".answer-editor textarea, .answer-editor .field--area").first();
  await area.fill(draft);

  // 实时预览
  const preview = page.locator(".answer-editor .md-preview, [data-testid='answer-preview'], [class*='preview']").first();
  const previewVisible = (await preview.count()) > 0 && (await preview.isVisible());
  const rendered = previewVisible && (await preview.textContent()).includes("草稿内容");
  const previewToggle = await page
    .locator(".answer-editor")
    .getByRole("button", { name: /预览/ })
    .count();
  expect(rendered || previewToggle > 0, "answer editor has no live preview");

  // 草稿本地保存：localStorage 或刷新后回填
  await page.waitForTimeout(1200); // debounce save
  const saved = await page.evaluate(() =>
    Object.keys(localStorage).some((k) => /draft|answer/i.test(k) && (localStorage.getItem(k) || "").length > 0)
  );
  await page.reload();
  await page.locator(".question__title, h1").first().waitFor();
  const refilled = (await area.inputValue()).includes("草稿内容");
  expect(saved || refilled, "draft not persisted (localStorage key or refill after reload)");
});
