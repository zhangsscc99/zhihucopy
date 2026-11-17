// Z1145 — /notifications 分类 tab（全部 / 评论 / 赞同 / 关注）（浏览器级）。
//
// 契约：
//   1) 种子号 user2@zhihucopy.dev 进 /notifications：4 个 tab 存在，
//      默认「全部」选中（aria-selected=true / is-active），
//      「全部」tab 数字 === 首屏列表条数；
//   2) 点「评论」→ 列表每行文案含「评论」（comment/reply 同组），
//      行数 ≤ 全部行数且与「评论」tab 数字一致；
//   3) 空类型 tab：种子号无空类型时用新注册号，点任一非全部 tab →
//      「暂无该类型通知」空态 +「看全部通知」出口，点后选中态回全部；
//   4) 1440×900 与 390×844：documentElement 无横向溢出、__errs 为空、
//      切 tab 后 document.body.innerText.length > 200；
//   5) 反向自检：线上（无 tab）在第 1 步 FAIL。
//
// 环境：verify.sh 透传 API_BASE；e2e/lib.mjs 的 BASE/API 在模块加载时定型，
// 故先按 API_BASE 反推 E2E_BASE/E2E_API 再动态 import。
const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
if (!process.env.E2E_API) process.env.E2E_API = API_BASE;
if (!process.env.E2E_BASE) process.env.E2E_BASE = API_BASE.replace(/\/api$/, "");

const { run, expect, BASE, register, authedPage, api, apiOk, uniq } = await import("../e2e/lib.mjs");

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

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];

const tabs = (page) => page.locator(".notify__tabs .notify__tab");
const rows = (page) => page.locator("main .ntf__item");

async function selectedTab(page) {
  const n = await tabs(page).count();
  for (let i = 0; i < n; i++) {
    const el = tabs(page).nth(i);
    const sel = await el.getAttribute("aria-selected");
    const cls = (await el.getAttribute("class")) || "";
    if (sel === "true" || /\bis-active\b/.test(cls)) return i;
  }
  return -1;
}

// tab 按钮内数字（无数字返回 null）。
async function tabCount(page, i) {
  const text = await tabs(page).nth(i).innerText();
  const m = text.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

async function checkViewports(page, tag) {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow === 0, `${tag}-overflow-${vp.width}: 横向溢出 ${overflow}px`);
  }
}

run("notify-tabs", async ({ browser }) => {
  // ---- 种子号登录 ---------------------------------------------------------
  const login = await api("POST", "/auth/login", {
    body: { email: SEED_EMAIL, password: SEED_PASSWORD },
  });
  expect(login.status === 200 && login.data.token, `seed-login: ${login.status}`);
  const token = login.data.token;

  const page = await authedPage(browser, token);
  await injectErrs(page);
  await page.goto(`${BASE}/notifications`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".notify__tabs .notify__tab", { timeout: 15000 });
  await rows(page).first().waitFor({ timeout: 15000 });

  // ---- 4 个 tab + 默认「全部」选中 + 条数一致 -----------------------------
  const tabTexts = await tabs(page).allInnerTexts();
  expect(tabTexts.length === 4, `tabs-count: 仅 ${tabTexts.length} 个 tab（${tabTexts.join("|")}）`);
  for (let i = 0; i < 4; i++) {
    expect(
      tabTexts[i].includes(TAB_LABELS[i]),
      `tab-label-${i}: 期望含「${TAB_LABELS[i]}」，实际「${tabTexts[i]}」`
    );
  }
  expect((await selectedTab(page)) === 0, "tabs-default: 默认选中非「全部」");

  const allRows = await rows(page).count();
  const allCount = await tabCount(page, 0);
  expect(allCount !== null, "all-tab-count: 「全部」tab 无数字");
  expect(allCount === allRows, `all-tab-count-eq: tab 数字 ${allCount} !== 首屏条数 ${allRows}`);

  // ---- 点「评论」→ 每行评论类 + 行数一致 -----------------------------------
  await tabs(page).nth(1).click();
  await page.waitForURL(/type=comment/, { timeout: 15000 });
  await page.waitForSelector(".notify__tab.is-active", { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.waitForSelector("main .ntf__item", { timeout: 15000 });
  expect((await selectedTab(page)) === 1, "comment-tab-active: 「评论」未选中");

  const commentRows = rows(page);
  const commentRowCount = await commentRows.count();
  const commentTabN = await tabCount(page, 1);
  expect(commentTabN !== null, "comment-tab-count: 「评论」tab 无数字");
  expect(
    commentRowCount === commentTabN,
    `comment-count-eq: 列表 ${commentRowCount} 行 !== tab 数字 ${commentTabN}`
  );
  expect(commentRowCount <= allRows, `comment-le-all: ${commentRowCount} > ${allRows}`);
  for (let i = 0; i < commentRowCount; i++) {
    const t = await commentRows.nth(i).innerText();
    expect(/评论/.test(t), `comment-row-${i}: 非评论类通知（${t.slice(0, 60)}）`);
  }
  const bodyLen = await page.evaluate(() => document.body.innerText.length);
  expect(bodyLen > 200, `comment-body-len: ${bodyLen}`);

  // ---- 空类型 tab ---------------------------------------------------------
  // 记录种子号数量为 0 的 tab；都没有则用新注册号（其非全部 tab 必为空）。
  let emptyPage = page;
  let emptyIdx = -1;
  for (let i = 1; i < 4; i++) {
    if ((await tabCount(page, i)) === 0) {
      emptyIdx = i;
      break;
    }
  }
  if (emptyIdx === -1) {
    const fresh = await register(uniq("tabs"));
    emptyPage = await authedPage(browser, fresh.token);
    await injectErrs(emptyPage);
    await emptyPage.goto(`${BASE}/notifications`, { waitUntil: "domcontentloaded" });
    await emptyPage.waitForSelector(".notify__tabs .notify__tab", { timeout: 15000 });
    emptyIdx = 1; // 评论 tab：新账号必为 0
  }
  await tabs(emptyPage).nth(emptyIdx).click();
  await emptyPage.waitForSelector("main .empty", { timeout: 15000 });
  const emptyText = await emptyPage.locator("main").innerText();
  expect(/暂无该类型通知/.test(emptyText), `empty-tab-copy: 缺「暂无该类型通知」（${emptyText.slice(0, 80)}）`);
  const back = emptyPage.getByRole("button", { name: "看全部通知" });
  await back.click();
  await emptyPage.waitForTimeout(300);
  expect(
    (await selectedTab(emptyPage)) === 0,
    "empty-tab-back: 「看全部通知」未切回全部"
  );
  const bodyLen2 = await emptyPage.evaluate(() => document.body.innerText.length);
  expect(bodyLen2 > 200, `empty-body-len: ${bodyLen2}`);

  // ---- 双视口溢出 + __errs -------------------------------------------------
  await checkViewports(page, "tabs");
  const errs = await pageErrs(page);
  expect(errs.length === 0, `tabs-page-errs: ${errs.join(" | ")}`);
  if (emptyPage !== page) {
    const errs2 = await pageErrs(emptyPage);
    expect(errs2.length === 0, `empty-page-errs: ${errs2.join(" | ")}`);
    await emptyPage.close();
  }
  await page.close();
});
