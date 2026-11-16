// search.mjs — 顶栏搜索关键词 → 结果页有命中 → 空结果页显示空态引导。
// 契约（Z953）：搜索提交后进入 /?q= 首页搜索态；结果项含关键词（或高亮 <mark>）；
// 无结果时显示空态文案（含「没有/暂无/找到/试试」之一）。
//
// Z1044b 回归：切分类 tab（回答→用户→问题→回答）不得白屏——旧代码 scope 先变、
// items 仍是旧 scope 对象，新行组件拿错 shape 渲染（u.nickname.slice → TypeError）
// 且无 ErrorBoundary，整个 SPA 卸载。每次点击后断言：页面非白屏、main 有内容、
// window.__errs 为空、tab aria-selected 正确、列表项类型与 scope 匹配。
import { run, expect, BASE, apiOk, uniq } from "./lib.mjs";

run("search", async ({ page }) => {
  // 页面级错误收集器：error / unhandledrejection / console.error 全记进 window.__errs。
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
  const pageErrs = () => page.evaluate(() => window.__errs || []);

  // 关键词：优先取三 scope 都有命中的词（切 tab 需要真实数据断言卡型），
  // 否则退化为热榜标题片段（0 命中的 scope 改按空态断言）。
  let keyword = "代码";
  let counts = { question: 0, answer: 0, user: 0 };
  for (const cand of ["代码", "什么", "工作", "怎么"]) {
    const res = await apiOk("GET", `/search?q=${encodeURIComponent(cand)}`);
    if (res.counts?.question > 0 && res.counts?.answer > 0 && res.counts?.user > 0) {
      keyword = cand;
      counts = res.counts;
      break;
    }
    keyword = cand;
    counts = res.counts || counts;
  }
  if (!(counts.question > 0 && counts.answer > 0 && counts.user > 0)) {
    const list = await apiOk("GET", "/questions?tab=hot&limit=10");
    const title = list.items[0].title;
    keyword =
      title.replace(/[？?。！!，,\s]/g, " ").split(" ").filter((w) => w.length >= 4)[0] ||
      title.slice(0, 6);
    const res = await apiOk("GET", `/search?q=${encodeURIComponent(keyword)}`);
    counts = res.counts || counts;
  }

  await page.goto(`${BASE}/`);
  const box = page
    .getByRole("searchbox")
    .or(page.locator(".topnav__search input, header input[aria-label='搜索']"))
    .first();
  await box.fill(keyword);
  await box.press("Enter");
  await page.waitForLoadState("networkidle");

  expect(/[?&]q=/.test(page.url()), `search did not navigate to /?q= (url=${page.url()})`);
  const hit = page
    .locator("main, .main-col, body")
    .getByText(keyword, { exact: false })
    .first();
  await hit.waitFor({ timeout: 8000 });

  // ---- Z1044b 白屏回归：从 ?type=answer 直达出发，真实 click 逐个切 tab ----
  await page.goto(`${BASE}/search?q=${encodeURIComponent(keyword)}&type=answer`);
  const ansTab = page.getByRole("tab", { name: /^回答/ }).first();
  await ansTab.waitFor({ timeout: 8000 });
  await page.waitForSelector("ul.feed li.feed__item", { timeout: 10000 });

  async function expectHealthy(t, kindRe, readySel, scopeCount, itemSel, forbidSel) {
    // readySel 只能在本 scope 的新数据里出现（用户行 li.urow / 回答卡 #answer- 锚点），
    // 不会命中旧 scope 的残留 DOM——防止断言竞态读到切换前的一帧。
    await page.waitForSelector(readySel, { timeout: 10000 });
    const bodyLen = await page.evaluate(() => document.body.innerText.length);
    expect(bodyLen > 200, `切「${t}」后页面白屏（body.innerText=${bodyLen}）`);
    const mainLen = await page.evaluate(
      () => (document.querySelector("main")?.innerText || "").length
    );
    expect(mainLen > 0, `切「${t}」后 main 为空`);
    const errs = await pageErrs();
    expect(errs.length === 0, `切「${t}」后页面报错：${errs.join(" | ").slice(0, 300)}`);
    const tab = page.getByRole("tab", { name: kindRe }).first();
    expect(
      (await tab.getAttribute("aria-selected")) === "true",
      `「${t}」tab 未置 aria-selected="true"`
    );
    expect(
      (await tab.getAttribute("class"))?.includes("--active"),
      `「${t}」tab 缺少 --active 类`
    );
    const n = await page.locator(`ul.feed ${itemSel}`).count();
    if (scopeCount > 0) {
      expect(n > 0, `「${t}」tab 下 ${itemSel} 为 0（counts 应为 ${scopeCount}）`);
    }
    const bad = await page.locator(`ul.feed ${forbidSel}`).count();
    expect(bad === 0, `「${t}」tab 残留异型卡 ${forbidSel} ×${bad}（错 shape 渲染）`);
    return n;
  }

  // 就绪选择器：命中数 >0 时用 scope 专属元素，0 命中时等空态/错误卡。
  const readyUser =
    counts.user > 0 ? "ul.feed li.urow" : ".empty, .errorbox, .crashbox";
  const readyQuestion =
    counts.question > 0
      ? "ul.feed a.feed__title:not([href*='#answer-'])"
      : ".empty, .errorbox, .crashbox";
  const readyAnswer =
    counts.answer > 0
      ? "ul.feed a.feed__title[href*='#answer-']"
      : ".empty, .errorbox, .crashbox";

  // 回答 → 用户 → 问题 → 回答：逐次点击 + 全部健康断言。
  await page.getByRole("tab", { name: /^用户/ }).first().click();
  await expectHealthy("用户", /^用户/, readyUser, counts.user, "li.urow", ".feed__title");
  expect(
    /[?&]type=user/.test(page.url()),
    `切「用户」tab 后 URL 无 type=user（url=${page.url()}）`
  );

  await page.getByRole("tab", { name: /^问题/ }).first().click();
  await expectHealthy("问题", /^问题/, readyQuestion, counts.question, "li.feed__item", "li.urow");

  await page.getByRole("tab", { name: /^回答/ }).first().click();
  await expectHealthy("回答", /^回答/, readyAnswer, counts.answer, "li.feed__item", "li.urow");
  expect(
    /[?&]type=answer/.test(page.url()),
    `切「回答」tab 后 URL 无 type=answer（url=${page.url()}）`
  );
  if (counts.answer > 0) {
    const nAns = await page.locator("ul.feed .feed__title").count();
    expect(nAns > 0, "「回答」tab 下无 .feed__title 回答卡");
  }

  // 顶栏再提交回到默认「问题」tab（URL 不带 type）。
  await box.fill(keyword);
  await box.press("Enter");
  await page.waitForLoadState("networkidle");
  expect(!/[?&]type=/.test(page.url()), `再提交后 URL 不应带 type（url=${page.url()}）`);

  // 空结果
  const none = uniq("nohit");
  await box.fill(none);
  await box.press("Enter");
  await page.waitForLoadState("networkidle");
  await page
    .getByText(/没有找到|无结果|暂无|空空如也|换个关键词|试试/)
    .first()
    .waitFor({ timeout: 8000 });

  const errs = await pageErrs();
  expect(errs.length === 0, `用例结束时仍有页面错误：${errs.join(" | ").slice(0, 300)}`);
});
