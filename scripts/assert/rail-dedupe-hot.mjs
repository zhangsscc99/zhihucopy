// rail-dedupe-hot.mjs — Z1105 热榜 tab 下右栏不再重复同一份热榜。
//
//   浏览器级（import { run } from ../e2e/lib.mjs）：
//     桌面 1440×900 `/?tab=hot`：
//       a) 右栏不含热榜区块（无标题为「热榜」的 .rail-block、无 .hotlist__rank 排名色块）；
//       b) 右栏至少有 1 个非热榜模块（「等你来答」或「你可能感兴趣的话题」）；
//       c) 主列表首卡标题与右栏任一链接标题不重复（防再次复用同一份热榜）；
//       d) 热榜 tab 仍 aria-selected（顶部 tab aria-current 不回归）。
//     桌面 1440×900 默认首页 `/`：右栏仍渲染热榜块（不得误删）。
//     移动 390×844 `/?tab=hot`：右栏各模块不可见、无横向溢出。
//     所有页面：body 文本 > 200、window.__errs 为空。
//
// Env: API_BASE（缺省 3030）、E2E_BASE（缺省 API_BASE 去掉 /api）。
// 反向自检：未修基线 ?tab=hot 右栏第一块即「热榜」，断言 a 必 FAIL。

import { expect } from "./lib.mjs";

const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
const BASE = (process.env.E2E_BASE || API_BASE.replace(/\/api$/, "")).replace(/\/+$/, "");
process.env.E2E_BASE ||= BASE;
const { run } = await import("../e2e/lib.mjs");

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

async function checkCommon(page, tag) {
  const bodyLen = await page.evaluate(() => (document.body.innerText || "").length);
  expect(bodyLen > 200, `${tag} body 文本仅 ${bodyLen} 字符（疑似白屏）`);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow <= 1, `${tag} 横向溢出 ${overflow}px`);
  const errs = await page.evaluate(() => window.__errs || []);
  expect(errs.length === 0, `${tag} window.__errs ${errs.length} 条: ${errs.slice(0, 3).join(" | ")}`);
}

// 等右栏异步模块落地：等你来答 / 话题块任一出现或 5s 超时。
async function waitRailSettled(page) {
  await page
    .locator(".rail-block--unanswered, .rail-block--topics")
    .first()
    .waitFor({ state: "attached", timeout: 5000 })
    .catch(() => {});
}

async function checkHotTab(page) {
  await page.goto(`${BASE}/?tab=hot`, { waitUntil: "networkidle" });
  await page.waitForSelector(".feed__item, .rail-block");
  await waitRailSettled(page);

  // a) 右栏不含热榜区块
  const railInfo = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll(".rail .rail-block")];
    return blocks.map((el) => ({
      title: (el.querySelector(".rail-block__title") || {}).innerText || "",
      hasRank: !!el.querySelector(".hotlist__rank"),
      hasHotlist: !!el.querySelector(".hotlist"),
      cls: el.className,
    }));
  });
  const hotBlocks = railInfo.filter(
    (b) => b.title.trim() === "热榜" || b.hasRank || b.hasHotlist
  );
  expect(
    hotBlocks.length === 0,
    `?tab=hot 右栏仍含热榜区块：${JSON.stringify(railInfo.map((b) => b.title))}`
  );

  // b) 右栏至少有 1 个非热榜模块
  const nonHot = railInfo.filter((b) => !(b.title.trim() === "热榜" || b.hasRank || b.hasHotlist));
  expect(nonHot.length >= 1, "?tab=hot 右栏没有任何非热榜模块（等你来答/话题块）");

  // c) 主列表首卡标题与右栏任一链接标题不重复
  const firstTitle = (
    await page.locator(".feed__item .feed__title, .feed__title").first().innerText()
  ).trim();
  const railLinkTexts = await page
    .locator(".rail .rail-block a")
    .allInnerTexts()
    .then((ts) => ts.map((t) => t.trim()).filter(Boolean));
  expect(
    !railLinkTexts.includes(firstTitle),
    `主列表首卡「${firstTitle}」与右栏链接重复（疑似复用同一份热榜）`
  );

  // d) 热榜 tab aria-selected 不回归
  const aria = await page
    .locator('.tabs__tab[aria-selected="true"]')
    .innerText()
    .catch(() => "");
  expect(aria.trim() === "热榜", `?tab=hot 下 aria-selected tab 为 ${JSON.stringify(aria)}（需「热榜」）`);

  await checkCommon(page, "hot1440");
  console.log(
    `  hot1440: 右栏 ${railInfo.length} 块 [${railInfo.map((b) => b.title.trim()).join("/")}]，首卡不重复，aria-selected=热榜`
  );
}

async function checkDefaultHome(page) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".rail-block");
  await waitRailSettled(page);
  const hasHot = await page.evaluate(() => {
    return [...document.querySelectorAll(".rail .rail-block")].some(
      (el) =>
        (el.querySelector(".rail-block__title") || {}).innerText?.trim() === "热榜" ||
        !!el.querySelector(".hotlist")
    );
  });
  expect(hasHot, "默认首页右栏热榜块被误删");
  const blocks = await page.locator(".rail .rail-block").count();
  expect(blocks >= 2, `默认首页右栏仅 ${blocks} 块（热榜 + 非热榜模块，需 >= 2）`);
  await checkCommon(page, "home1440");
  console.log(`  home1440: 右栏 ${blocks} 块，热榜块仍在`);
}

async function checkMobile(page) {
  await page.goto(`${BASE}/?tab=hot`, { waitUntil: "networkidle" });
  await page.waitForSelector(".feed__item, .tabs");
  await waitRailSettled(page);
  const visible = await page.evaluate(() => {
    return [...document.querySelectorAll(".rail .rail-block")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== "none";
    }).length;
  });
  expect(visible === 0, `mobile390 下右栏仍有 ${visible} 个可见模块`);
  await checkCommon(page, "hot390");
  console.log("  hot390: 右栏模块均不可见、无横向溢出");
}

run("rail-dedupe-hot", async ({ browser }) => {
  const hot = await newCleanPage(browser, 1440, 900);
  try {
    await checkHotTab(hot);
  } finally {
    await hot.context().close();
  }
  const home = await newCleanPage(browser, 1440, 900);
  try {
    await checkDefaultHome(home);
  } finally {
    await home.context().close();
  }
  const mobile = await newCleanPage(browser, 390, 844);
  try {
    await checkMobile(mobile);
  } finally {
    await mobile.context().close();
  }
});
