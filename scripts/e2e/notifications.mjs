// notifications.mjs — 他人回答我的问题 → 通知页出现该条并显示未读红点。
// 契约（Z040/Z043）：/notifications 路由渲染分组列表，条目含触发者昵称或「回答了你的问题」，
// 未读条目有视觉标记（.unread / 红点 badge / 「未读」字样），顶栏或列表显示未读数。
import { run, expect, BASE, register, authedPage, apiOk, uniq } from "./lib.mjs";

run("notifications", async ({ browser }) => {
  const asker = await register(uniq("asker"));
  const answerer = await register(uniq("answerer"));

  const title = `[e2e] ${uniq("q")} — 通知链路验证问题？`;
  const q = await apiOk("POST", "/questions", { token: asker.token, body: { title, detail_md: "e2e notification probe" } });
  await apiOk("POST", `/questions/${q.question.id}/answers`, { token: answerer.token, body: { content_md: "e2e 回答，用于触发通知。" } });

  const page = await authedPage(browser, asker.token);
  await page.goto(`${BASE}/notifications`);
  await page.waitForLoadState("networkidle");

  // 顶栏未读红点/未读数
  const badge = page.locator(".topnav .badge, .topnav__badge, [data-testid='unread-badge'], .unread-dot");
  const badgeVisible = (await badge.count()) > 0 && (await badge.first().isVisible());
  const bodyText = await page.locator("body").textContent();
  expect(
    badgeVisible || /未读/.test(bodyText),
    "no unread indicator (badge/dot/未读) visible"
  );

  // 通知条目：提到回答者昵称，或文案含「回答了你的问题」
  const item = page.getByText(new RegExp(`${answerer.user.nickname}|回答了你的问题|回答了你的提问`)).first();
  await item.waitFor({ timeout: 8000 });
});
