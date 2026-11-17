// Z1082 — 首屏假内容与自动化残留。
//
//   浏览器级（桌面 1440×900 + 移动 390×844，import { run } from ../e2e/lib.mjs）：
//     a) 首页 .feed__item 就绪后：.feed__excerpt--empty 数量 === 0，且前 10 张
//        卡片 innerText 不含「暂无补充说明」；
//     b) body 文本 > 200、无横向溢出、注入的 window.__errs（error /
//        unhandledrejection / console.error）为空；
//     c) /question/339 评论区展开后不含「走查评论…/走查<数字>」形态；
//     d) /notifications（种子账号 林间有风 登录）不含「巡检探针」形态。
//   API 级：/questions?limit=30、/feed/recommended、/feed/hot、/search?q=巡检
//     响应全文不含「走查<数字>」「巡检探针」形态。
//   规则自校：新形态（走查9434/巡检探针banv/走查评论D：…）必须命中
//     content-filter，反例（代码走查/走查一下这段 diff/走查会议记录/
//     巡检报告怎么写/走查员3lq4）不得命中 —— 断言非恒真。
//
// Env: API_BASE（HTTP 断言，缺省 3030）、E2E_BASE（缺省 API_BASE 去掉 /api）。
// 反向自检：对未修基线实例跑必须 FAIL（旧代码首页渲染 暂无补充说明）。
import { createRequire } from "node:module";
import { ok, req, expect } from "./lib.mjs";

const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
const BASE = (process.env.E2E_BASE || API_BASE.replace(/\/api$/, "")).replace(/\/+$/, "");
process.env.E2E_BASE ||= BASE;
// e2e/lib.mjs 顶层按 env 求值 BASE，须在赋值后动态引入。
const { run, TOKEN_KEY } = await import("../e2e/lib.mjs");

const requireHere = createRequire(import.meta.url);
const { isTestTitle, isTestNickname, isTestBody } = requireHere(
  "../../server/content-filter.js"
);

// 本轮残留形态（页面文本扫描用，与规则同口径的大小写敏感）。
const RESIDUE_RE = /走查[0-9]+|走查评论[A-Za-z0-9]{0,4}[：:]|巡检探针[A-Za-z0-9]*/;

// 注入 window.__errs 收集 error / unhandledrejection / console.error。
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
  const ctx = await browser.newContext({ viewport: { width, height }, locale: "zh-CN" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  await page.addInitScript(ERR_HOOK);
  return page;
}

async function checkHome(page, tag) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".feed__item, .empty, .errorbox");
  const emptyCount = await page.locator(".feed__excerpt--empty").count();
  expect(
    emptyCount === 0,
    `${tag} 首页渲染了 ${emptyCount} 个 .feed__excerpt--empty 占位（暂无补充说明）`
  );
  const cards = await page.$$eval(".feed__item", (els) =>
    els.slice(0, 10).map((e) => e.innerText || "")
  );
  expect(cards.length > 0, `${tag} 首页无 .feed__item 卡片`);
  for (const t of cards) {
    expect(
      !/暂无补充说明/.test(t),
      `${tag} 首屏前 10 张卡片含「暂无补充说明」: ${JSON.stringify(t.slice(0, 80))}`
    );
  }
  const bodyLen = await page.evaluate(() => (document.body.innerText || "").length);
  expect(bodyLen > 200, `${tag} body 文本仅 ${bodyLen} 字符（疑似白屏）`);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow <= 1, `${tag} 横向溢出 ${overflow}px`);
  const errs = await page.evaluate(() => window.__errs || []);
  expect(
    errs.length === 0,
    `${tag} window.__errs ${errs.length} 条: ${errs.slice(0, 3).join(" | ")}`
  );
  console.log(`  ${tag}: 首页 ${cards.length} 卡，占位 0，溢出 ${overflow}px，__errs 0`);
}

async function checkQuestion339(page) {
  await page.goto(`${BASE}/question/339`, { waitUntil: "networkidle" });
  await page.waitForSelector(".answer, .empty, .errorbox");
  const toggle = page.getByRole("button", { name: /条评论/ }).first();
  if (await toggle.count()) {
    await toggle.click();
    await page.waitForSelector(".answer__comment-list, .answer__comment-empty");
  }
  const text = await page.evaluate(() => document.body.innerText || "");
  expect(
    !RESIDUE_RE.test(text),
    `/question/339 展开评论后仍含残留形态: ${JSON.stringify((text.match(RESIDUE_RE) || [])[0])}`
  );
  console.log(`  /question/339: 评论区展开无残留`);
}

async function checkNotifications(page, apiBase) {
  const login = await req("POST", "/auth/login", {
    body: { email: "user2@zhihucopy.dev", password: "zhihu123456" },
  });
  expect(login.status === 200, `种子账号登录失败 -> ${login.status}（无通知残留可核）`);
  await page.addInitScript(
    ([k, t]) => localStorage.setItem(k, t),
    [TOKEN_KEY, login.data.token]
  );
  await page.goto(`${BASE}/notifications`, { waitUntil: "networkidle" });
  await page.waitForSelector(".ntf__item, .empty, .errorbox, .ntf-head__title");
  const text = await page.evaluate(() => document.body.innerText || "");
  expect(
    !/巡检探针[A-Za-z0-9]*/.test(text),
    `/notifications 含「巡检探针」形态残留`
  );
  console.log(`  /notifications: 无「巡检探针」形态`);
}

async function checkApis() {
  for (const p of [
    "/questions?limit=30",
    "/feed/recommended?page=1&limit=30",
    "/feed/hot",
    "/search?q=" + encodeURIComponent("巡检"),
  ]) {
    const data = await ok("GET", p);
    const m = JSON.stringify(data).match(RESIDUE_RE);
    expect(!m, `${p} 含残留形态 ${JSON.stringify(m && m[0])}`);
    console.log(`  API ${p}: 无残留形态`);
  }
}

function checkFilterRules() {
  // 正例：新形态必须命中（否则断言形同虚设）。
  for (const n of ["走查9434", "走查20285", "巡检探针banv", "巡检探针Bbanv", "巡检探针"]) {
    expect(isTestNickname(n), `isTestNickname 漏判 ${JSON.stringify(n)}`);
  }
  expect(isTestBody("走查评论D：测试提交路径"), "isTestBody 漏判 走查评论D：…");
  expect(isTestTitle("走查评论A：链路验证"), "isTestTitle 漏判 走查评论A：…");
  // 反例：真实内容不得命中。
  for (const s of ["代码走查", "走查一下这段 diff", "走查会议记录", "巡检报告怎么写"]) {
    expect(!isTestBody(s), `isTestBody 误杀 ${JSON.stringify(s)}`);
  }
  for (const s of ["代码走查", "走查一下这段 diff", "走查会议记录"]) {
    expect(!isTestNickname(s), `isTestNickname 误杀 ${JSON.stringify(s)}`);
    expect(!isTestTitle(s), `isTestTitle 误杀 ${JSON.stringify(s)}`);
  }
  // 「巡检报告怎么写」在昵称/标题侧命中的是既有 巡检 前缀（非本轮新规则），
  // 此处仅验证新昵称正则不误伤更宽形态：
  expect(!isTestNickname("走查员3lq4"), "isTestNickname 误杀 走查员3lq4");
  expect(!isTestNickname("质检小七"), "isTestNickname 误杀 质检小七");
  console.log("  规则自校：正例命中、反例未命中");
}

run("feed-clean-first-screen", async ({ browser }) => {
  checkFilterRules();
  await checkApis();
  for (const [w, h, tag] of [
    [1440, 900, "desktop1440"],
    [390, 844, "mobile390"],
  ]) {
    const page = await newCleanPage(browser, w, h);
    try {
      await checkHome(page, tag);
      if (w === 1440) {
        await checkQuestion339(page);
        await checkNotifications(page, API_BASE);
      }
    } finally {
      await page.context().close();
    }
  }
});
