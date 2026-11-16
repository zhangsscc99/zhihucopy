// Z1060 — /ask 话题下拉遮挡「发布问题」（P1）：浏览器级断言。
//
// 断言（桌面 1366×900 与移动 390×844 各跑一遍）：
//  1) 登录后打开 /ask，聚焦话题输入框 → .topic-select__menu 可见、可见选项 ≥1；
//  2) 点第一个选项 → 菜单收起（可见 .topic-select__option 数为 0）、话题 chip 出现在已选区、
//     输入框仍聚焦（document.activeElement 为 .topic-select__input）；
//  3) blur 后重新 focus 输入框 → 菜单重新打开，再选第 2 个话题成功（多选未退化）；
//  4) 菜单展开态下 document.elementFromPoint(发布按钮中心) 命中元素在按钮内（button.contains(hit)），
//     且菜单与按钮的 getBoundingClientRect 不相交（重叠面积 0）；
//  5) 用例 B：选中话题后 input 仍聚焦，此时单击输入框 → 菜单重新出现（focus 事件
//     在已聚焦元素上不会再触发，必须靠 onClick 重开）；
//  6) 用例 A：菜单展开态下单次点击「发布问题」即跳转 /question/<id>（不许先 Escape、
//     不许点两次）、页面含该标题、body.innerText.length > 200、__errs 为空
//     （问题经 trackOwned 退出自动清理）；
//  7) 390×844：同流程走通且 document.documentElement.scrollWidth <= 390。
//
// 旧实现的死路：addTopic 选中后保持菜单展开，absolute 240px 菜单正好盖住 .form-actions，
// hit-test 命中 .topic-select__option，真实点击会误加话题。本断言第 2/4 步专杀该回归。
//
// Env: E2E_BASE || API_BASE(-/api) || http://127.0.0.1:3030/zhihucopy
//      CHROME 可覆盖浏览器路径；截图失败现场到 /root/logs。
// 退出码即结论：0 PASS / 1 FAIL（打印具体失败点）。

import fs from "node:fs";
import path from "node:path";

// e2e/lib.mjs 内部锚定 playwright-core（scripts/e2e/node_modules），直接 import；
// register()/trackOwned() 创建的账号与问题随进程退出由 lib 自动清理。
const {
  BASE,
  register,
  expect,
  launch,
  trackOwned,
  trackSessionUsers,
  TOKEN_KEY,
  uniq,
} = await import("../e2e/lib.mjs");

const SHOT_DIR = process.env.E2E_SHOT_DIR || "/root/logs";

function injectErrs(page) {
  return page.addInitScript(() => {
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
const visibleOptions = (page) => page.locator(".topic-select__option:visible").count();

async function publishBtn(page) {
  const btn = page.getByRole("button", { name: "发布问题" });
  await btn.waitFor({ state: "visible", timeout: 10000 });
  return btn;
}

// 菜单展开态下的几何断言：elementFromPoint(按钮中心) 命中按钮内部 + 矩形不相交。
async function expectNoOverlay(page, tag) {
  const r = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "发布问题"
    );
    const menu = document.querySelector(".topic-select__menu");
    if (!btn) return { err: "no publish button" };
    if (!menu) return { err: "menu not open" };
    // 390 高度下提交钮常在首屏外：先滚进视口再做 hit-test（真实用户也要滚到才点）。
    btn.scrollIntoView({ block: "center" });
    const br = btn.getBoundingClientRect();
    const mr = menu.getBoundingClientRect();
    const hit = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
    const ox = Math.max(0, Math.min(br.right, mr.right) - Math.max(br.left, mr.left));
    const oy = Math.max(0, Math.min(br.bottom, mr.bottom) - Math.max(br.top, mr.top));
    return {
      hitInside: btn.contains(hit),
      hitCls: hit ? hit.className || hit.tagName : "null",
      overlap: ox * oy,
      br: { t: br.top, b: br.bottom },
      mr: { t: mr.top, b: mr.bottom },
    };
  });
  expect(!r.err, `${tag}: ${r.err}`);
  expect(
    r.hitInside,
    `${tag}: 菜单展开时 elementFromPoint(发布按钮中心) 命中 ${r.hitCls}，不在按钮内（遮挡回归）`
  );
  expect(
    r.overlap === 0,
    `${tag}: 菜单与发布按钮矩形相交 ${r.overlap}px² menu=${JSON.stringify(r.mr)} btn=${JSON.stringify(r.br)}`
  );
}

// 一遍完整流程；返回发布的问题 id（供清理跟踪）。
async function askFlow(page, tag) {
  const input = page.locator(".topic-select__input");
  await input.waitFor({ state: "visible", timeout: 10000 });

  // (1) 聚焦 → 菜单开、选项 ≥1
  await input.focus();
  await page.locator(".topic-select__menu").waitFor({ state: "visible", timeout: 8000 });
  expect((await visibleOptions(page)) >= 1, `${tag}: 聚焦后无可见话题候选`);

  // (1b) 展开态即不得遮挡提交钮
  await expectNoOverlay(page, `${tag}/菜单展开`);

  // (2) 点第一个选项 → 菜单收起、chip 出现、输入框仍聚焦
  const firstName = (await page.locator(".topic-select__option").first().innerText())
    .split("\n")[0]
    .trim();
  await page.locator(".topic-select__option").first().click();
  await page.waitForTimeout(200);
  expect(
    (await visibleOptions(page)) === 0,
    `${tag}: 选中话题后菜单未收起（仍有 ${await visibleOptions(page)} 个可见选项）`
  );
  expect(
    (await page.locator(".topic-select__chip").count()) === 1,
    `${tag}: 选中后已选区无 chip`
  );
  const chipText = await page.locator(".topic-select__chip").first().innerText();
  expect(chipText.includes(firstName), `${tag}: chip「${chipText}」不含所选话题「${firstName}」`);
  const stillFocused = await page.evaluate(() =>
    document.activeElement?.classList.contains("topic-select__input")
  );
  expect(stillFocused, `${tag}: 选中后输入框未保持聚焦`);

  // (2b) 用例 B：input 仍聚焦时单击输入框 → 菜单重新出现。
  // 已聚焦元素再 focus() 不触发 focus 事件，这里专杀「只有 onFocus 没有 onClick」的回归。
  await input.click();
  await page.locator(".topic-select__menu").waitFor({ state: "visible", timeout: 8000 });
  expect(
    (await visibleOptions(page)) >= 1,
    `${tag}: 聚焦态单击输入框未重开菜单（可见选项=${await visibleOptions(page)}）`
  );

  // (3) 重新聚焦 → 菜单重开，选第 2 个话题（多选未退化）
  await input.evaluate((el) => el.blur());
  await page.waitForTimeout(150);
  await input.focus();
  await page.locator(".topic-select__menu").waitFor({ state: "visible", timeout: 8000 });
  expect((await visibleOptions(page)) >= 1, `${tag}: 重新聚焦后菜单未重开/无候选`);
  await page.locator(".topic-select__option").first().click();
  await page.waitForTimeout(200);
  expect(
    (await page.locator(".topic-select__chip").count()) === 2,
    `${tag}: 第 2 个话题未选中（chip 数=${await page.locator(".topic-select__chip").count()}）`
  );

  // (4) 键盘路径回归：重开菜单后 Enter 选第 3 个、Escape 收起、Backspace 删尾
  await input.evaluate((el) => el.blur());
  await page.waitForTimeout(150);
  await input.focus();
  await page.locator(".topic-select__menu").waitFor({ state: "visible", timeout: 8000 });
  await input.press("Enter");
  await page.waitForTimeout(200);
  expect(
    (await page.locator(".topic-select__chip").count()) === 3,
    `${tag}: Enter 未选中第 3 个话题`
  );
  await input.evaluate((el) => el.blur());
  await page.waitForTimeout(150);
  await input.focus();
  await page.locator(".topic-select__menu").waitFor({ state: "visible", timeout: 8000 });
  await input.press("Escape");
  await page.waitForTimeout(200);
  expect((await visibleOptions(page)) === 0, `${tag}: Escape 未收起菜单`);
  await input.press("Backspace");
  await page.waitForTimeout(200);
  expect(
    (await page.locator(".topic-select__chip").count()) === 2,
    `${tag}: Backspace 未删除最后一个已选话题`
  );

  // (5) 填标题/正文 → 用例 A：菜单展开态下单次点击「发布问题」即发布。
  // 曾有的回退：mousedown 先触发 input blur → 菜单卸载 → 按钮上移 → mouseup 落空，
  // 第一次点击静默失效。这里保证点击瞬间菜单处于展开态且只点一次。
  const title = `E2E巡检 ${uniq("q")}：话题下拉遮挡回归验证`;
  await page.getByLabel("标题").fill(title);
  await page.locator(".ask textarea, textarea").first().fill(
    "这是一条自动化巡检问题：验证 /ask 话题下拉菜单在选中和展开时都不会遮挡「发布问题」按钮。\n\n- 选中即收起\n- 聚焦重开续选\n- 提交钮 hit-test 命中自身"
  );
  await input.click();
  await page.locator(".topic-select__menu").waitFor({ state: "visible", timeout: 8000 });
  expect(
    (await visibleOptions(page)) >= 1,
    `${tag}: 发布前菜单未处于展开态，用例 A 前提不成立`
  );
  const btn = await publishBtn(page);
  await btn.click();
  await page.waitForURL(/\/question\/\d+$/, { timeout: 15000 });
  const qid = Number(page.url().match(/\/question\/(\d+)/)?.[1]);
  expect(Number.isInteger(qid) && qid > 0, `${tag}: 发布后未跳转 /question/<id>，url=${page.url()}`);
  await page.locator("h1.question__title").waitFor({ state: "visible", timeout: 10000 });
  const bodyText = await page.evaluate(() => document.body.innerText);
  expect(bodyText.includes(title), `${tag}: 详情页不含标题「${title}」`);
  expect(bodyText.length > 200, `${tag}: 详情页内容过少 innerText=${bodyText.length}`);
  const errs = await pageErrs(page);
  expect(errs.length === 0, `${tag}: 页面出现错误：${errs.join(" | ")}`);
  return qid;
}

async function main() {
  const { token } = await register();
  const browser = await launch();
  let shotPage = null;
  try {
    // ---------- 桌面 1366×900 ----------
    const dctx = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      locale: "zh-CN",
    });
    const page = await dctx.newPage();
    shotPage = page;
    page.setDefaultTimeout(15000);
    await injectErrs(page);
    await page.addInitScript(([k, t]) => localStorage.setItem(k, t), [TOKEN_KEY, token]);
    await page.goto(`${BASE}/ask`, { waitUntil: "domcontentloaded" });
    const qid = await askFlow(page, "1366×900");
    trackOwned("q", qid, token);

    // ---------- 移动 390×844 ----------
    const mctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "zh-CN",
    });
    const mpage = await mctx.newPage();
    shotPage = mpage;
    mpage.setDefaultTimeout(15000);
    await injectErrs(mpage);
    await mpage.addInitScript(([k, t]) => localStorage.setItem(k, t), [TOKEN_KEY, token]);
    await mpage.goto(`${BASE}/ask`, { waitUntil: "domcontentloaded" });
    const mqid = await askFlow(mpage, "390×844");
    trackOwned("q", mqid, token);
    const sw = await mpage.evaluate(() => document.documentElement.scrollWidth);
    expect(sw <= 390, `390×844 横向溢出：scrollWidth=${sw}`);

    await trackSessionUsers(browser);
    await browser.close();
    console.log(`[ASSERT] ask-topic-overlay PASS — ${BASE}`);
    process.exit(0);
  } catch (e) {
    try {
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      if (shotPage) {
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const p = path.join(SHOT_DIR, `assert-ask-topic-overlay-${ts}.png`);
        await shotPage.screenshot({ path: p, fullPage: true });
        console.error(`[ASSERT] screenshot: ${p}`);
      }
    } catch {}
    await trackSessionUsers(browser).catch(() => {});
    await browser.close().catch(() => {});
    console.error(`[ASSERT] ask-topic-overlay FAIL — ${BASE}`);
    console.error(`  ${e.message || e}`);
    process.exit(1);
  }
}

main();
