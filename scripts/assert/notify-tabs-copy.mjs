// Z1149 — /notifications 分类 tab 文案（浏览器级）。
//
// 契约：
//   1) 种子号 user2@zhihucopy.dev 进 /notifications：4 个 tab 的 innerText
//      不得命中 /[\u4e00-\u9fa5]\d/（即「全部0」式粘连禁止）；有计数的 tab
//      必须是「全部 3」式（汉字与数字之间有空白）；
//   2) 有通知时 tab 数字与当前列表条数一致（沿用 counts）；
//   3) 每个 tab 带 aria-label：有数为「评论，5 条」式，无数为「评论，暂无」；
//   4) register() 新注册号：4 个 tab 文本不含任何数字（0 不显示）；
//   5) 1440×900 与 390×844 无横向溢出、window.__errs 为空；
//   6) 反向自检：改动前「全部0」命中第 1 步 FAIL。
const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
if (!process.env.E2E_API) process.env.E2E_API = API_BASE;
if (!process.env.E2E_BASE) process.env.E2E_BASE = API_BASE.replace(/\/api$/, "");

const { run, expect, BASE, register, authedPage, api, uniq } = await import("../e2e/lib.mjs");

const SEED_EMAIL = "user2@zhihucopy.dev";
const SEED_PASSWORD = "zhihu123456";
const TAB_LABELS = ["全部", "评论", "赞同", "关注"];

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

const tabs = (page) => page.locator(".notify__tabs .notify__tab");
const rows = (page) => page.locator("main .ntf__item");

async function checkViewports(page, tag) {
  for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow === 0, `${tag}-overflow-${vp.width}: 横向溢出 ${overflow}px`);
  }
}

// tab innerText 的结构检查：无汉字+数字粘连；有数字时必须「汉字 数字」式。
function checkTabText(i, text, tag) {
  expect(
    !/[\u4e00-\u9fa5]\d/.test(text),
    `${tag}-tab-${i}-glued: 汉字与数字粘连（「${text}」）`
  );
  expect(
    text.startsWith(TAB_LABELS[i]),
    `${tag}-tab-${i}-label: 期望以「${TAB_LABELS[i]}」开头，实际「${text}」`
  );
  const m = text.match(/\d+/);
  if (m) {
    expect(
      new RegExp(`^${TAB_LABELS[i]}\\s+${m[0]}$`).test(text),
      `${tag}-tab-${i}-format: 数字前无空白分隔（「${text}」）`
    );
    expect(
      parseInt(m[0], 10) > 0,
      `${tag}-tab-${i}-zero: 计数为 0 不应显示（「${text}」）`
    );
  }
  return m ? parseInt(m[0], 10) : null;
}

run("notify-tabs-copy", async ({ browser }) => {
  // ---- 种子号：文案 + 数字一致 + aria-label --------------------------------
  const login = await api("POST", "/auth/login", {
    body: { email: SEED_EMAIL, password: SEED_PASSWORD },
  });
  expect(login.status === 200 && login.data.token, `seed-login: ${login.status}`);

  const page = await authedPage(browser, login.data.token);
  await injectErrs(page);
  await page.goto(`${BASE}/notifications`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".notify__tabs .notify__tab", { timeout: 15000 });
  await rows(page).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);

  const tabTexts = await tabs(page).allInnerTexts();
  expect(tabTexts.length === 4, `tabs-count: 仅 ${tabTexts.length} 个 tab（${tabTexts.join("|")}）`);
  const nums = tabTexts.map((t, i) => checkTabText(i, t.trim(), "seed"));

  // 「全部」tab 数字 === 首屏条数
  const allRows = await rows(page).count();
  expect(nums[0] !== null, "seed-all-count: 「全部」tab 应有计数");
  expect(nums[0] === allRows, `seed-all-eq: tab 数字 ${nums[0]} !== 列表 ${allRows} 行`);

  // aria-label：有数「N 条」、无数「暂无」
  for (let i = 0; i < 4; i++) {
    const label = await tabs(page).nth(i).getAttribute("aria-label");
    const want = nums[i] !== null ? `${TAB_LABELS[i]}，${nums[i]} 条` : `${TAB_LABELS[i]}，暂无`;
    expect(label === want, `seed-aria-${i}: 期望「${want}」，实际「${label}」`);
  }

  // 切「评论」→ 数字与列表条数一致
  await tabs(page).nth(1).click();
  await page.waitForURL(/type=comment/, { timeout: 15000 });
  await page.waitForTimeout(600);
  const cRows = await rows(page).count();
  const cText = (await tabs(page).nth(1).innerText()).trim();
  const cNum = checkTabText(1, cText, "seed-comment");
  if (cRows > 0) {
    expect(cNum === cRows, `comment-eq: tab 数字 ${cNum} !== 列表 ${cRows} 行`);
  } else {
    expect(cNum === null, `comment-zero-shown: 空分类仍显示数字（「${cText}」）`);
  }

  await checkViewports(page, "seed");
  const errs = await pageErrs(page);
  expect(errs.length === 0, `seed-errs: ${errs.join(" | ")}`);
  await page.close();

  // ---- 新注册号：4 个 tab 均为纯文案 ---------------------------------------
  const fresh = await register(uniq("tabscopy"));
  const fpage = await authedPage(browser, fresh.token);
  await injectErrs(fpage);
  await fpage.goto(`${BASE}/notifications`, { waitUntil: "domcontentloaded" });
  await fpage.waitForSelector(".notify__tabs .notify__tab", { timeout: 15000 });
  await fpage.waitForTimeout(500);

  const fTexts = await tabs(fpage).allInnerTexts();
  expect(fTexts.length === 4, `fresh-tabs-count: ${fTexts.length} 个 tab`);
  for (let i = 0; i < 4; i++) {
    const t = fTexts[i].trim();
    expect(!/\d/.test(t), `fresh-tab-${i}-digit: 新号 tab 不应含数字（「${t}」）`);
    expect(t === TAB_LABELS[i], `fresh-tab-${i}-pure: 期望纯文案「${TAB_LABELS[i]}」，实际「${t}」`);
    const label = await tabs(fpage).nth(i).getAttribute("aria-label");
    expect(
      label === `${TAB_LABELS[i]}，暂无`,
      `fresh-aria-${i}: 期望「${TAB_LABELS[i]}，暂无」，实际「${label}」`
    );
  }

  await checkViewports(fpage, "fresh");
  const ferrs = await pageErrs(fpage);
  expect(ferrs.length === 0, `fresh-errs: ${ferrs.join(" | ")}`);
  await fpage.close();
});
