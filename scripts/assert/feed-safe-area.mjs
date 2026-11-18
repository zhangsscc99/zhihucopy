// Z1198 — 390 宽下固定底栏不得压住信息流末卡，元信息数值与作者名拉开层级。
//
// 断言（BASE 首页推荐流，390×844）：
//   1. 点「加载更多」直到「已经到底了」（cap 40 页防死循环），滚到文档底部时
//      最后一张 .feed__item 的 getBoundingClientRect().bottom
//      <= .bottomnav 的 top + 1（底部安全区）。
//   2. 第一张卡 .feed__meta 内必须有 .meta__num；其 computed color 与
//      .feed__author-name 不同，且对卡片有效背景色按 WCAG 相对亮度公式
//      算出的对比度 >= 4.5:1（脚本内计算，非目测）。
//   3. document.body.scrollWidth === 390（无横向溢出）；window.__errs 为空。
//
// Env: E2E_BASE || http://127.0.0.1:3030/zhihucopy ；CHROME 可覆盖浏览器路径；
//      失败截图到 /root/logs。退出码 0 PASS / 1 FAIL。

import { run, expect, launch, BASE } from "../e2e/lib.mjs";

function injectErrs(page) {
  return page.addInitScript(() => {
    const w = window;
    w.__errs = [];
    w.addEventListener("error", (e) => w.__errs.push(`error:${e.message}`));
    w.addEventListener("unhandledrejection", (e) =>
      w.__errs.push(
        `rejection:${e.reason && e.reason.message ? e.reason.message : e.reason}`
      )
    );
  });
}

run("feed-safe-area", async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "zh-CN",
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  await injectErrs(page);
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.locator(".feed__item").first().waitFor({ state: "visible" });

  // 滚到列表末尾：逐页点「加载更多」直到出现「已经到底了」或按钮消失。
  for (let i = 0; i < 40; i++) {
    if (await page.locator(".feed-end").count()) break;
    const btn = page.locator(".feed-foot button");
    if (!(await btn.count())) break;
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await page.waitForTimeout(600);
  }
  expect(
    (await page.locator(".feed-end").count()) > 0,
    "点满 40 页仍未出现「已经到底了」，无法界定列表末尾"
  );

  // 滚到文档绝对底部（两次：第一次可能触发懒加载再撑高）。
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);

  const info = await page.evaluate(() => {
    const nav = document.querySelector(".bottomnav");
    const items = [...document.querySelectorAll(".feed__item")];
    const last = items[items.length - 1];
    const num = document.querySelector(".feed__meta .meta__num");
    const author = document.querySelector(".feed__meta .feed__author-name");

    // 元素有效背景色：沿祖先链取第一个非透明 background-color。
    const effBg = (el) => {
      for (let n = el; n; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor;
        const m = c.match(/rgba?\(([^)]+)\)/);
        if (m) {
          const [r, g, b, a = "1"] = m[1].split(",").map((s) => s.trim());
          if (parseFloat(a) > 0.99) return [+r, +g, +b];
        }
      }
      return [255, 255, 255];
    };
    const rgb = (el) => {
      const m = getComputedStyle(el).color.match(/rgba?\(([^)]+)\)/);
      return m ? m[1].split(",").slice(0, 3).map((s) => +s.trim()) : null;
    };
    // WCAG 相对亮度 + 对比度。
    const lum = ([r, g, b]) =>
      [r, g, b]
        .map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        })
        .reduce((acc, v, i) => acc + v * [0.2126, 0.7152, 0.0722][i], 0);
    const contrast = (c1, c2) => {
      const [l1, l2] = [lum(c1), lum(c2)].sort((a, b) => b - a);
      return (l1 + 0.05) / (l2 + 0.05);
    };

    return {
      navTop: nav ? nav.getBoundingClientRect().top : null,
      lastBottom: last ? last.getBoundingClientRect().bottom : null,
      itemCount: items.length,
      numColor: num ? rgb(num) : null,
      numBg: num ? effBg(num) : null,
      authorColor: author ? rgb(author) : null,
      numRatio: num ? contrast(rgb(num), effBg(num)) : null,
      bodySW: document.body.scrollWidth,
      winW: window.innerWidth,
    };
  });

  expect(info.itemCount > 0, "首页没有 .feed__item");
  expect(info.navTop !== null, ".bottomnav 不存在（移动端应渲染固定底栏）");
  expect(
    info.lastBottom <= info.navTop + 1,
    `末卡被底栏压住：lastCard.bottom=${info.lastBottom?.toFixed(
      1
    )} > bottomnav.top=${info.navTop?.toFixed(1)} + 1`
  );

  expect(info.numColor, ".feed__meta 内没有 .meta__num（数字未包 <b>）");
  expect(
    JSON.stringify(info.numColor) !== JSON.stringify(info.authorColor),
    `数字与作者名同色 ${JSON.stringify(info.numColor)}，层级未拉开`
  );
  expect(
    info.numRatio >= 4.5,
    `.meta__num 对比度 ${info.numRatio?.toFixed(2)}:1 < 4.5:1（color=${JSON.stringify(
      info.numColor
    )} bg=${JSON.stringify(info.numBg)}）`
  );

  expect(
    info.bodySW === info.winW,
    `body 横向溢出 scrollWidth=${info.bodySW} innerWidth=${info.winW}`
  );
  const errs = await page.evaluate(() => window.__errs || []);
  expect(errs.length === 0, `页面错误：${errs.join(" | ")}`);

  await ctx.close();
});
