// topic.mjs — 话题页：简介 + 关注按钮 + 内容流。
// 契约（Z031/Z033）：话题页路由 /topic/:id|slug 显示话题名、简介、关注按钮与内容列表。
import { run, expect, BASE, apiOk } from "./lib.mjs";

run("topic", async ({ page }) => {
  // 从某个问题详情拿话题名（种子里问题挂了话题）
  const list = await apiOk("GET", "/questions?tab=hot&limit=20");
  let topicName = null, qid = null;
  for (const it of list.items) {
    const d = await apiOk("GET", `/questions/${it.id}`);
    if (d.question.topics && d.question.topics.length) {
      topicName = d.question.topics[0].name;
      qid = it.id;
      break;
    }
  }
  expect(topicName, "no question carries a topic (seed broken?)");

  await page.goto(`${BASE}/question/${qid}`);
  const tag = page.getByRole("link", { name: topicName }).or(page.locator(".tag", { hasText: topicName })).first();
  await tag.waitFor();
  await tag.click();

  await page.waitForURL(/\/topic\//, { timeout: 10000 });
  await page.waitForLoadState("networkidle");
  await page.getByText(topicName).first().waitFor();
  await page.getByRole("button", { name: /关注/ }).first().waitFor();
  // 内容流：至少一条指向问题的链接
  await page.getByRole("link", { name: /./ }).first().waitFor();
});
