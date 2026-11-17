#!/usr/bin/env node
// answer-pagination.mjs — 问题详情页回答分页验收。
//
// Z961（静态 + API，历史口径保留）：
//   静态：Question.tsx 调用 /questions/:id/answers? 分页接口、存在 answer_count
//   比较逻辑与「查看全部/加载更多」入口，不再是单一 LIMIT 5 渲染路径。
//   动态：分页接口条数 == answer_count 且不少于 detail 首屏；新发布的回答
//   在 sort=newest 第一页可见（刷新后不丢）。
//
// Z1153（浏览器级，热榜真实数据覆盖盲区）：
//   线上热榜首题回答数须 ≥6——点一次「查看全部 N 个回答/加载更多回答」后
//   .answer 数增加且 ≥6、id 集合无重复；分页请求期间按钮有加载态
//   （「加载中…」或 aria-busy）；落地后「加载更多回答」或「已经到底了」
//   状态合理；同题渲染出的回答作者互不相同；window.__errs 为空；
//   1440 与 390 视口均无横向溢出。
//
// Env: API_BASE / E2E_BASE / E2E_API / CHROME / DB_PATH。
// 反向自检：未修基线（热榜首题 answer_count<=5、分页按钮不渲染）跑本断言
// 必须在浏览器段 FAIL。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ok, register, expect, uniq } from "./lib.mjs";

const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
const BASE = (process.env.E2E_BASE || API_BASE.replace(/\/api$/, "")).replace(/\/+$/, "");
process.env.E2E_BASE ||= BASE;
process.env.E2E_API ||= API_BASE;
// e2e/lib.mjs 顶层按 env 求值 BASE/API，须在赋值后动态引入。
const { run } = await import("../e2e/lib.mjs");

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tsx = readFileSync(join(root, "client/src/pages/Question.tsx"), "utf8");

// ---------- 静态断言（Z961） ----------
expect(/\/answers\?/.test(tsx), "Question.tsx 未调用 /questions/:id/answers? 分页接口");
expect(/answer_count\s*>/.test(tsx), "Question.tsx 缺少 answer_count 与已渲染条数的比较");
expect(/查看全部|加载更多/.test(tsx), "Question.tsx 缺少「查看全部/加载更多回答」入口");
expect(/sort=/.test(tsx) && /newest/.test(tsx), "Question.tsx 缺少回答排序切换（sort/newest）");

// ---------- 动态断言（Z961：自造问题，验接口与刷新可见性） ----------
async function checkApiPagination() {
  const { token } = await register();

  // 造一个 answer_count >= 2 的问题（[assert] 前缀不进公共列表/热榜）
  const { question } = await ok("POST", "/questions", {
    token,
    body: { title: `[assert] ${uniq("q")} — 回答分页验收？`, detail_md: "" },
  });
  for (let i = 0; i < 2; i++) {
    await ok("POST", `/questions/${question.id}/answers`, {
      token,
      body: { content_md: `[assert] ${uniq("a")} — 分页前置回答 ${i + 1}` },
    });
  }

  const detail = await ok("GET", `/questions/${question.id}`);
  const shown = detail.answers.length;
  const count = detail.question.answer_count;
  expect(count >= 2, `answer_count=${count}，预期 >= 2`);
  expect(shown >= 1 && shown <= 5, `detail 首屏返回 ${shown} 条，超出 1–5 预期`);

  const page = await ok("GET", `/questions/${question.id}/answers?page=1&limit=50`);
  expect(
    page.items.length === count,
    `分页接口返回 ${page.items.length} 条 != answer_count=${count}`
  );
  expect(page.items.length >= shown, `分页 ${page.items.length} 条 < detail 首屏 ${shown} 条`);

  // created_at 秒级精度：隔开 1.2s 保证新回答时间戳严格更大，newest 首位确定
  await new Promise((r) => setTimeout(r, 1200));
  const marker = uniq("mine");
  const { answer } = await ok("POST", `/questions/${question.id}/answers`, {
    token,
    body: { content_md: `[assert] ${marker} — 发布后刷新不能丢的新回答` },
  });
  const newest = await ok(
    "GET",
    `/questions/${question.id}/answers?sort=newest&page=1&limit=10`
  );
  expect(
    newest.items.some((a) => a.id === answer.id),
    `新回答 #${answer.id} 未出现在 sort=newest 第一页`
  );
  expect(
    newest.items[0]?.id === answer.id,
    `sort=newest 首条是 #${newest.items[0]?.id}，不是刚发布的 #${answer.id}`
  );
  console.log(`  API: 自造问题 q#${question.id} 分页口径与 newest 首位均正确`);
}

// ---------- 浏览器级断言（Z1153：热榜首题的真实分页路径） ----------
const ERR_HOOK = () => {
  window.__errs = [];
  const push = (m) => {
    try {
      window.__errs.push(String(m && m.message ? m.message : m));
    } catch {}
  };
  window.addEventListener("error", (e) => push(e.message || e.error));
  window.addEventListener("unhandledrejection", (e) => push(e.reason));
  const orig = console.error.bind(console);
  console.error = (...a) => {
    push(a.map((x) => String(x)).join(" "));
    orig(...a);
  };
};

async function newCleanPage(browser, width, height) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    locale: "zh-CN",
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  await page.addInitScript(ERR_HOOK);
  return page;
}

const answerCount = (page) => page.locator(".answerlist .answer").count();
const answerIds = (page) =>
  page.locator(".answerlist .answer").evaluateAll((els) =>
    els.map((e) => e.id)
  );

async function checkQuestionPage(browser, qid, tag) {
  const page = await newCleanPage(
    browser,
    tag === "mobile390" ? 390 : 1440,
    tag === "mobile390" ? 844 : 900
  );
  try {
    await page.goto(`${BASE}/question/${qid}`, { waitUntil: "networkidle" });
    await page.waitForSelector(".answerlist .answer");

    const n0 = await answerCount(page);
    expect(n0 >= 1 && n0 <= 5, `${tag} 首屏 .answer=${n0}（detail 首屏口径 1–5）`);

    // 「查看全部 N 个回答 / 加载更多回答」按钮必须存在（answer_count > 首屏）。
    const moreBtn = page.locator(".feed-foot button", {
      hasText: /查看全部|加载更多回答/,
    });
    expect(
      (await moreBtn.count()) === 1,
      `${tag} 未找到「查看全部 N 个回答/加载更多回答」按钮（首屏 ${n0} 条，疑似未修基线）`
    );
    const btnText = (await moreBtn.first().innerText()).trim();

    // 拦截分页接口观察加载态：响应挂起期间按钮须呈「加载中…」或 aria-busy。
    const ANSWERS_API = /\/api\/questions\/\d+\/answers/;
    const hold = async (route) => {
      await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    };
    await page.route(ANSWERS_API, hold);
    const ids0 = await answerIds(page);
    await moreBtn.first().click();
    const sawLoading = await page
      .waitForFunction(
        () => {
          const btns = [...document.querySelectorAll(".feed-foot button")];
          return btns.some(
            (b) => /加载中/.test(b.textContent) || b.getAttribute("aria-busy") === "true"
          );
        },
        undefined,
        { timeout: 5000 }
      )
      .then(() => true)
      .catch(() => false);
    expect(sawLoading, `${tag} 分页请求期间按钮无加载态（「加载中」/aria-busy 均未见）`);

    await page.waitForFunction(
      (n) => document.querySelectorAll(".answerlist .answer").length > n,
      n0,
      { timeout: 10000 }
    );
    await page.unroute(ANSWERS_API, hold);

    const n1 = await answerCount(page);
    expect(n1 > n0, `${tag} 点击后 .answer ${n0} -> ${n1}，未增加`);
    expect(n1 >= 6, `${tag} 展开后 .answer=${n1} < 6（热榜首题须达到分页规模）`);

    const ids1 = await answerIds(page);
    const idSet = new Set(ids1);
    expect(idSet.size === ids1.length, `${tag} 分页后回答 id 有重复`);
    expect(ids0.every((x) => idSet.has(x)), `${tag} 首屏回答在展开后丢失`);

    // 落地状态合理：还有下一页则按钮仍在（「加载更多回答」），否则「已经到底了」。
    const stillMore = await page
      .locator(".feed-foot button", { hasText: /加载更多回答/ })
      .count();
    const atEnd = await page
      .locator(".feed-end", { hasText: /已经到底了/ })
      .count();
    expect(
      stillMore + atEnd >= 1,
      `${tag} 分页落地后既无「加载更多回答」也无「已经到底了」`
    );

    // 同题渲染出的回答作者互不相同。
    const names = await page
      .locator(".answerlist .answer .answer__name")
      .allInnerTexts();
    const uniqNames = new Set(names.map((s) => s.trim()));
    expect(
      uniqNames.size === names.length,
      `${tag} 同题作者重复：${names.length} 条回答只有 ${uniqNames.size} 个昵称`
    );

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow <= 1, `${tag} 横向溢出 ${overflow}px`);
    const errs = await page.evaluate(() => window.__errs || []);
    expect(
      errs.length === 0,
      `${tag} window.__errs ${errs.length} 条: ${errs.slice(0, 3).join(" | ")}`
    );
    console.log(
      `  ${tag}: q#${qid} 首屏 ${n0} -> 展开 ${n1} 条` +
        `（按钮「${btnText}」，落地 ${stillMore ? "加载更多回答" : "已经到底了"}，作者 ${uniqNames.size} 人，溢出 ${overflow}px，__errs 0）`
    );
  } finally {
    await page.context().close();
  }
}

run("answer-pagination", async ({ browser }) => {
  await checkApiPagination();
  const hot = await ok("GET", "/questions?tab=hot&limit=1");
  const top = hot.items && hot.items[0];
  expect(top && Number.isInteger(top.id), "热榜为空，无法取首题");
  const detail = await ok("GET", `/questions/${top.id}`);
  expect(
    detail.question.answer_count >= 6,
    `热榜首题 q#${top.id} answer_count=${detail.question.answer_count} < 6（疑似未修基线）`
  );
  for (const tag of ["desktop1440", "mobile390"]) {
    await checkQuestionPage(browser, top.id, tag);
  }
});
