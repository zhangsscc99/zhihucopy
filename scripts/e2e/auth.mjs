// auth.mjs — UI 注册（随机邮箱）→ 自动登录 → 顶栏显示昵称 → 退出登录。
import { run, expect, BASE, uniq } from "./lib.mjs";

run("auth", async ({ page }) => {
  const nickname = uniq("e2e").slice(0, 20);
  const email = `${uniq("e2e")}@test.dev`;
  const password = "e2e-pass-123456";

  await page.goto(`${BASE}/register`);
  await page.getByLabel("昵称").fill(nickname);
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "注册" }).click();

  await page.waitForURL(/\/zhihucopy\/?$/, { timeout: 15000 });
  const nameEl = page.locator(".usermenu__name");
  await nameEl.waitFor();
  expect((await nameEl.textContent())?.trim() === nickname, `top nav shows "${await nameEl.textContent()}", expected "${nickname}"`);

  await page.locator(".usermenu__trigger").click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await page.getByRole("link", { name: "登录" }).waitFor();
  expect(await page.locator(".usermenu__name").count() === 0, "nickname still visible after logout");
});
