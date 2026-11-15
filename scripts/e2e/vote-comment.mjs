// vote-comment.mjs — 问题详情页：对回答点赞 → 计数 +1 → 发评论 → 评论渲染。
// 契约（Z013/Z066）：实现方需保证以下可定位性之一：
//   赞同按钮：role=button 且名字含「赞同/赞成/▲」，或 [data-testid="vote-up"] / .vote__up
//   计数：     赞同按钮文本内含数字，或 .answer__votes / [data-testid="vote-count"]
//   评论输入： placeholder/name 含「评论」的输入框，或 .comment-form textarea
//   评论提交： 按钮名含「发布/评论/发送」
//   回答排序： 回答区存在名字含「默认/最新/排序」的控件
import { run, expect, BASE, register, authedPage, apiOk, questionWithAnswers, uniq } from "./lib.mjs";

const num = (s) => {
  const m = String(s || "").match(/\d+/);
  return m ? Number(m[0]) : null;
};

run("vote-comment", async ({ browser }) => {
  const { token } = await register();
  const detail = await questionWithAnswers();
  const q = detail.question;
  const firstAnswer = detail.answers[0];

  const page = await authedPage(browser, token);
  await page.goto(`${BASE}/question/${q.id}`);
  await page.locator(".question__title, h1").first().waitFor();

  // 回答排序控件（Z013 契约的一部分）
  const sortCtl = page.getByRole("button", { name: /默认|最新|最热|排序/ }).or(page.locator(".answers__sort, [data-testid='answer-sort']"));
  expect((await sortCtl.count()) > 0, "answer sort control not found");

  const scope = (await page.locator(`[data-answer-id="${firstAnswer.id}"]`).count()) > 0
    ? page.locator(`[data-answer-id="${firstAnswer.id}"]`)
    : page.locator(".answer").first();

  const upBtn = scope
    .getByRole("button", { name: /赞同|赞成|▲|👍/ })
    .or(scope.locator("[data-testid='vote-up'], .vote__up, .vote-btn--up"))
    .first();
  await upBtn.waitFor({ timeout: 8000 });

  const before = num(await upBtn.textContent()) ?? num(await scope.locator(".answer__votes, [data-testid='vote-count']").first().textContent());
  expect(before !== null, "cannot read current vote count");
  await upBtn.click();
  // wait for count +1
  const readCount = async () =>
    num(await upBtn.textContent()) ?? num(await scope.locator(".answer__votes, [data-testid='vote-count']").first().textContent());
  let after = before;
  for (let i = 0; i < 20; i++) {
    after = await readCount();
    if (after === before + 1) break;
    await page.waitForTimeout(250);
  }
  expect(after === before + 1, `vote count ${before} -> ${after}, expected +1`);

  // 评论
  const commentText = `[e2e] ${uniq("c")} — 赞同楼上，补充一点细节。`;
  const box = scope
    .getByPlaceholder(/评论/)
    .or(scope.locator(".comment-form textarea, [data-testid='comment-input'], textarea"))
    .first();
  await box.fill(commentText);
  const submit = scope
    .getByRole("button", { name: /发布|评论|发送|提交/ })
    .or(scope.locator("[data-testid='comment-submit'], .comment-form button[type='submit']"))
    .first();
  await submit.click();
  await page.getByText(commentText.slice(0, 30)).waitFor();
});
