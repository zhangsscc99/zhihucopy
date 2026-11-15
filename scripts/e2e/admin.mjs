// admin.mjs — 管理员后台：admin 登录 → /admin 举报队列可见。
// 契约（Z042/Z044）：/admin 路由（或顶栏管理入口）渲染举报列表/处理控件/禁言入口。
import { run, expect, BASE, uiLogin } from "./lib.mjs";

run("admin", async ({ page }) => {
  await uiLogin(page, "admin@zhihucopy.dev", "zhihu123456");
  // 入口：直接进 /admin，或顶栏/菜单里的「管理」入口
  await page.goto(`${BASE}/admin`);
  await page.waitForLoadState("networkidle");
  await page.getByText(/举报|管理|队列|后台/).first().waitFor({ timeout: 8000 });
  // 列表/处理控件至少有一个可操作元素
  await page
    .getByRole("button", { name: /处理|驳回|删除|折叠|禁言|通过/ })
    .or(page.locator("table tr, .report-item, [data-testid='report-item']").first())
    .first()
    .waitFor({ timeout: 8000 });
});
