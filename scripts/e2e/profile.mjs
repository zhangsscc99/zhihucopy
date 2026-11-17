// profile.mjs — 个人主页：资料 + 统计 + 回答列表 + 关注/粉丝数。
import { run, expect, BASE, register, authedPage, apiOk, uniq } from "./lib.mjs";

run("profile", async ({ browser }) => {
  const { token, user } = await register(uniq("prof"));
  // 让用户有一条回答，主页列表才有内容可验
  const q = await apiOk("POST", "/questions", { token, body: { title: `[e2e] ${uniq("q")} — profile 探针问题？`, detail_md: "probe" } });
  await apiOk("POST", `/questions/${q.question.id}/answers`, { token, body: { content_md: `[e2e] ${uniq("a")} — 我的主页回答内容。` } });

  const page = await authedPage(browser, token);
  await page.goto(`${BASE}/u/${user.id}`);
  await page.locator(".profile__name, h1").first().waitFor();

  expect((await page.locator("body").textContent()).includes(user.nickname), "nickname not on profile page");
  for (const label of ["回答", "关注", "粉丝"]) {
    await page.locator("dl, .profile__stats, main").getByText(label, { exact: false }).first().waitFor();
  }
  // 回答列表：出现指向刚回答问题的链接或「TA 的回答/回答列表」区块。
  // 注意用字符串（子串匹配）而非 RegExp —— 标题以 [e2e] 开头，直接 new RegExp
  // 会把方括号解释成字符类，永远匹配不到（Z1085 返修）。
  const list = page.getByRole("link", { name: q.question.title.slice(0, 15) }).or(page.getByText(/TA 的回答|的回答|回答列表/)).first();
  await list.waitFor({ timeout: 8000 });
});
