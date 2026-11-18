// Z1184 — 「N 条评论已删除」合并行可见性收敛（浏览器级断言）。
//
// 契约：合并行仅在「当前登录用户 === 该回答作者」且 N<=3 时渲染；匿名访客、
// 非作者的登录用户、或 N>3 时一律不渲染 —— 大额 N 会暴露站点级批量清理
// 痕迹，损害可信度。评论计数口径（「N 条评论」按钮文案）不受影响。
//
// 自检有效性（防「元素不存在就永远绿」的空断言）：
//   ① 前置断言首条回答评论按钮文案含条数（页面/评论确已加载）；
//   ② 若 `.answer__comment-merged` 存在（例如以回答作者身份复跑），其文本
//      必须匹配 /^(\d+) 条评论已删除$/ 且数字 <= 3 —— 不满足即 FAIL。
//
// 通用守卫：body.innerText>200；window.__errs 为空；1440×900 与 390×844
// 两视口都查，390 视口另查无横向溢出。
//
// 一律用种子号 user4@zhihucopy.dev（非 /question/6 首答作者）登录验证
// 「登录但非作者」分支；不注册新号、不写生产数据。
const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
if (!process.env.E2E_API) process.env.E2E_API = API_BASE;
if (!process.env.E2E_BASE) process.env.E2E_BASE = API_BASE.replace(/\/api$/, "");

const { run, expect, BASE, authedPage, api } = await import("../e2e/lib.mjs");

const QUESTION_URL = `${BASE}/question/6`;
const MERGED_RE = /(\d+)\s*条评论已删除/;
const MERGED_STRICT_RE = /^(\d+) 条评论已删除$/;

async function injectErrs(page) {
  await page.addInitScript(() => {
    const w = window;
    w.__errs = [];
    w.addEventListener("error", (e) => w.__errs.push(`error:${e.message}`));
    w.addEventListener("unhandledrejection", (e) =>
      w.__errs.push(`rejection:${e.reason && e.reason.message ? e.reason.message : e.reason}`)
    );
    const origError = console.error;
    console.error = (...args) => {
      w.__errs.push(`console:${args.map(String).join(" ")}`);
      return origError.apply(console, args);
    };
  });
}

const pageErrs = (page) => page.evaluate(() => window.__errs || []);

// 打开 /question/6 首条回答的评论列表，返回该回答 li 的 locator。
async function expandFirstAnswerComments(page, tag) {
  await page.goto(QUESTION_URL);
  await page.locator(".question__title").first().waitFor();

  const ans = page.locator("ul.answerlist > li.answer").first();
  await ans.waitFor();
  const toggle = ans.getByRole("button", { name: /条评论|收起评论/ }).first();
  const toggleText = await toggle.innerText();
  // 前置断言：按钮文案必须含条数（「N 条评论」），否则页面未加载就判绿。
  expect(/\d+\s*条评论/.test(toggleText), `${tag}：首答评论按钮未含条数：「${toggleText}」`);
  await toggle.click();
  // 等评论列表出现：≥5 个任意 answer__comment-* 节点，或出现可见评论行。
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        'ul.answerlist > li.answer:first-child [class*="answer__comment"]'
      ).length >= 5
  );
  return ans;
}

async function assertNoMergedBadge(page, tag) {
  // 通用守卫：页面非白屏。
  const bodyLen = await page.evaluate(() => document.body.innerText.length);
  expect(bodyLen > 200, `${tag}：页面内容过少：innerText=${bodyLen}`);

  // 主断言：body 文本不出现「N 条评论已删除」。
  const bodyText = await page.evaluate(() => document.body.innerText);
  expect(!MERGED_RE.test(bodyText), `${tag}：页面仍暴露「N 条评论已删除」`);

  // 自检有效性：元素若存在，文本必须恰为「N 条评论已删除」且 N<=3。
  const merged = page.locator(".answer__comment-merged");
  const count = await merged.count();
  if (count > 0) {
    const texts = await merged.allInnerTexts();
    for (const t of texts) {
      const m = t.trim().match(MERGED_STRICT_RE);
      expect(m, `${tag}：.answer__comment-merged 文案异常：「${t}」`);
      expect(Number(m[1]) <= 3, `${tag}：合并行 N=${m[1]} > 3 仍被渲染`);
    }
  }
  // 本任务语境（匿名/非作者）下元素应为 0 个。
  expect(count === 0, `${tag}：.answer__comment-merged 存在 ${count} 个，期望 0`);

  const errs = await pageErrs(page);
  expect(errs.length === 0, `${tag}：页面错误：${errs.join(" | ")}`);
}

run("deleted-comments-badge", async ({ browser }) => {
  // ---- 匿名 1440×900 ----
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    await injectErrs(page);
    await expandFirstAnswerComments(page, "匿名1440");
    await assertNoMergedBadge(page, "匿名1440");
    await ctx.close();
  }

  // ---- 匿名 390×844 ----
  {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "zh-CN",
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    await injectErrs(page);
    await expandFirstAnswerComments(page, "匿名390");
    await assertNoMergedBadge(page, "匿名390");
    const noOverflow = await page.evaluate(
      () => document.body.scrollWidth === document.documentElement.clientWidth
    );
    expect(noOverflow, "匿名390：存在横向溢出");
    await ctx.close();
  }

  // ---- 登录但非该回答作者（user4 种子号）----
  {
    const login = await api("POST", "/auth/login", {
      body: { email: "user4@zhihucopy.dev", password: "zhihu123456" },
    });
    expect(login.status === 200, `seed login -> ${login.status}`);
    const page = await authedPage(browser, login.data.token);
    await injectErrs(page);
    await expandFirstAnswerComments(page, "登录非作者");
    await assertNoMergedBadge(page, "登录非作者");
  }
});
