// ask-editor.mjs — 提问页：Markdown 编辑器（工具栏/预览）+ 话题选择。
// 契约（Z014）：/ask 页在标题/正文之外提供
//   - 编辑器工具栏：按钮名含 加粗/标题/列表/代码/引用/链接/图片 中至少 3 个，或 .md-toolbar/[data-testid="md-toolbar"]
//   - 实时预览：输入 markdown 后出现渲染结果（.md-preview/[data-testid="md-preview"] 或「预览」区域）
//   - 话题选择：placeholder/label 含「话题」的输入控件，可选 1–5 个
import { run, expect, BASE, register, authedPage } from "./lib.mjs";

run("ask-editor", async ({ browser }) => {
  const { token } = await register();
  const page = await authedPage(browser, token);
  await page.goto(`${BASE}/ask`);
  await page.getByRole("button", { name: "发布问题" }).waitFor();

  // 工具栏
  const toolbar = page.locator(".md-toolbar, [data-testid='md-toolbar'], [class*='toolbar']").first();
  const hasToolbar = (await toolbar.count()) > 0;
  const toolBtns = await page
    .getByRole("button", { name: /加粗|标题|列表|代码|引用|链接|图片/ })
    .count();
  expect(hasToolbar || toolBtns >= 3, "no markdown toolbar on /ask");

  // 预览：输入 markdown 后出现渲染区
  await page.locator(".ask textarea, textarea").first().fill("**粗体测试** `code`");
  const preview = page.locator(".md-preview, [data-testid='md-preview'], [class*='preview']").first();
  const previewVisible = (await preview.count()) > 0 && (await preview.isVisible());
  const previewText = previewVisible ? await preview.textContent() : "";
  const liveRendered = previewVisible && /粗体测试/.test(previewText);
  const previewTab = await page.getByRole("button", { name: /预览/ }).count();
  expect(liveRendered || previewTab > 0, "no markdown preview (live pane or 预览 toggle)");

  // 话题选择控件
  const topicCtl = page
    .getByLabel(/话题/)
    .or(page.getByPlaceholder(/话题/))
    .or(page.locator("[data-testid='topic-select'], .topic-select"))
    .first();
  expect((await topicCtl.count()) > 0, "no topic selector on /ask");
});
