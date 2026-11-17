#!/usr/bin/env node
// Z1154 — 「查看全部 N 个回答」展开后可逆：已展开态底部出现「收起回答」，
// 点击截回首屏条数、滚动回回答区顶部、焦点交给区标题；投票/收藏/评论态
// 不重置；再点「查看全部」可重新展开。1440/390 无横向溢出、__errs 为空。
// 夹具：热榜找 answer_count >= 6 的题，找不到则 API 造题 + 7 条回答（owned 自动清理）。
import {
  run, expect, BASE, apiOk, register, authedPage, uniq,
} from "../e2e/lib.mjs";

async function pickQuestion() {
  const list = await apiOk("GET", "/questions?tab=hot&limit=50");
  const q = (list.items || []).find((it) => it.answer_count >= 6);
  if (q) return { qid: q.id, owned: false };
  const { token } = await register();
  const { question } = await apiOk("POST", "/questions", {
    token,
    body: { title: `[assert] ${uniq("q")} — 收起回答验收？`, detail_md: "" },
  });
  for (let i = 0; i < 7; i++) {
    await apiOk("POST", `/questions/${question.id}/answers`, {
      token,
      body: { content_md: `[assert] ${uniq("a")} — 收起回答夹具 ${i + 1}` },
    });
  }
  return { qid: question.id, owned: true };
}

const countAnswers = (page) => page.locator("li.answer").count();
const expandBtn = (page) =>
  page.getByRole("button", { name: /查看全部 \d+ 个回答|加载更多回答/ });
const collapseBtn = (page) => page.getByRole("button", { name: "收起回答" });

async function watchErrs(page) {
  await page.addInitScript(() => {
    window.__errs = [];
    window.addEventListener("error", (e) => window.__errs.push(String(e.message || e)));
    window.addEventListener("unhandledrejection", (e) => window.__errs.push(String(e.reason)));
    const ce = console.error.bind(console);
    console.error = (...a) => {
      window.__errs.push(a.map(String).join(" "));
      ce(...a);
    };
  });
}

async function expandAll(page, limit = 10) {
  for (let i = 0; i < limit; i++) {
    const btn = expandBtn(page);
    if (!(await btn.count())) break;
    const before = await countAnswers(page);
    await btn.first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll("li.answer").length > n,
      before
    );
  }
}

async function noXOverflow(page, tag) {
  const diff = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(diff <= 0, `${tag} 存在横向溢出 scrollWidth-clientWidth=${diff}`);
}

run("answers-collapse", async ({ browser }) => {
  const { token } = await register(); // 投票用账号
  const { qid } = await pickQuestion();

  const page = await authedPage(browser, token);
  await page.setViewportSize({ width: 1440, height: 900 });
  await watchErrs(page);
  await page.goto(`${BASE}/question/${qid}`);
  await page.locator("li.answer").first().waitFor();

  const n0 = await countAnswers(page);
  expect(n0 >= 1, `首屏应渲染回答，n0=${n0}`);

  // 展开态先点赞第一条，验证收起后投票态不丢
  await expandAll(page);
  const n1 = await countAnswers(page);
  expect(n1 > n0, `展开后应有更多回答：${n0} -> ${n1}`);
  const collapse = collapseBtn(page);
  expect(await collapse.count() >= 1, "展开态未渲染「收起回答」按钮");
  expect(
    (await collapse.first().getAttribute("aria-expanded")) === "true",
    "收起回答按钮 aria-expanded 应为 true"
  );

  const upBtn = page.locator("li.answer").first().locator(".answer__vote--up");
  if ((await upBtn.getAttribute("aria-pressed")) !== "true") await upBtn.click();
  await page.waitForFunction(
    () => document.querySelector("li.answer .answer__vote--up")?.getAttribute("aria-pressed") === "true"
  );

  // 收起
  const secTop = await page.locator("section.answers").evaluate(
    (el) => el.getBoundingClientRect().top + window.scrollY
  );
  await collapse.first().click();
  await page.waitForFunction(
    (n) => document.querySelectorAll("li.answer").length === n,
    n0
  );
  expect(await countAnswers(page) === n0, "收起后回答数未回到首屏条数");
  const scrollY = await page.evaluate(() => window.scrollY);
  expect(
    Math.abs(scrollY - (secTop - 12)) <= 200,
    `收起后 scrollY=${scrollY}，应落在回答区顶部 ${secTop - 12} ±200`
  );
  const moreBtn = expandBtn(page);
  expect(await moreBtn.count() >= 1, "收起后应恢复「查看全部」入口");
  expect(
    (await moreBtn.first().getAttribute("aria-expanded")) === "false",
    "收起后「查看全部」aria-expanded 应为 false"
  );
  expect(
    (await page.locator("li.answer").first().locator(".answer__vote--up")
      .getAttribute("aria-pressed")) === "true",
    "收起后点赞态被重置（aria-pressed 应为 true）"
  );

  // 可逆：再次展开
  await expandAll(page);
  expect(await countAnswers(page) === n1, "再次展开未恢复全部回答");

  await noXOverflow(page, "1440");
  const errs1440 = await page.evaluate(() => window.__errs || []);
  expect(errs1440.length === 0, `__errs 非空（1440）：${errs1440.join(" | ")}`);

  // 390 视口重跑一遍收起链路
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/question/${qid}`);
  await page.locator("li.answer").first().waitFor();
  await expandAll(page);
  const c = collapseBtn(page);
  expect(await c.count() >= 1, "390 展开态未渲染「收起回答」");
  await c.first().click();
  await page.waitForFunction(
    (n) => document.querySelectorAll("li.answer").length === n,
    n0
  );
  await noXOverflow(page, "390");
  const errs390 = await page.evaluate(() => window.__errs || []);
  expect(errs390.length === 0, `__errs 非空（390）：${errs390.join(" | ")}`);
});
