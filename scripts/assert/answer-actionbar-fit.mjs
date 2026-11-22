// Z1269 — 390 宽下回答操作栏五项全部完整可见，不再依赖横向滚动。
//
// 断言（BASE/question/6 与 /question/54，各取前 3 个 .answer__actions）：
//  1) 390×844：
//     - 操作栏每个直接子项 scrollWidth <= clientWidth + 1（文字不被裁切）；
//     - 栏内每个可点元素（button/a）getBoundingClientRect() 宽高均 >= 44
//       （触控命中区域；桌面端不要求）；
//     - 操作栏 getBoundingClientRect().right <= innerWidth + 0.5；
//     - document.documentElement.scrollWidth === 390（无横向溢出）；
//     - window.__errs 为空。
//  2) 1440×900 回归：同两项断言不溢出，且操作栏不换行
//     （所有直接子项 top 差值 <= 2px）。
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

async function checkBar(bar, tag, singleRow, minHit) {
  const info = await bar.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      right: r.right,
      winW: window.innerWidth,
      docSW: document.documentElement.scrollWidth,
      kids: [...el.children].map((k) => ({
        cls: k.className,
        sw: k.scrollWidth,
        cw: k.clientWidth,
        cy: (() => {
          const kr = k.getBoundingClientRect();
          return kr.top + kr.height / 2;
        })(),
      })),
      clickables: [...el.querySelectorAll("button, a")].map((it) => {
        const ir = it.getBoundingClientRect();
        return {
          text: (it.innerText || "").trim(),
          w: ir.width,
          h: ir.height,
        };
      }),
    };
  });

  for (const k of info.kids) {
    expect(
      k.sw <= k.cw + 1,
      `${tag}：子项 .${k.cls} 文字裁切 scrollWidth=${k.sw} clientWidth=${k.cw}`
    );
  }
  expect(info.clickables.length > 0, `${tag}：操作栏内没有可点元素`);
  if (minHit) {
    for (const c of info.clickables) {
      expect(
        c.w >= minHit && c.h >= minHit,
        `${tag}：可点元素「${c.text}」命中区域 ${c.w.toFixed(1)}×${c.h.toFixed(1)} < ${minHit}×${minHit}`
      );
    }
  }
  expect(
    info.right <= info.winW + 0.5,
    `${tag}：操作栏右缘越界 right=${info.right.toFixed(1)} innerWidth=${info.winW}`
  );
  expect(
    info.docSW === info.winW,
    `${tag}：页面横向溢出 documentElement.scrollWidth=${info.docSW} innerWidth=${info.winW}`
  );
  if (singleRow) {
    const cys = info.kids.map((k) => k.cy);
    const span = Math.max(...cys) - Math.min(...cys);
    expect(span <= 2, `${tag}：桌面操作栏换行（子项纵向中心差 ${span.toFixed(1)}px）`);
  }
}

async function checkPage(page, path, tag, singleRow, minHit) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  const bars = page.locator(".answer__actions");
  await bars.first().waitFor({ state: "visible" });
  await page.waitForTimeout(300);
  const n = Math.min(await bars.count(), 3);
  expect(n > 0, `${tag} ${path}：没有找到 .answer__actions`);
  for (let i = 0; i < n; i++) {
    await checkBar(bars.nth(i), `${tag} ${path} 第${i + 1}栏`, singleRow, minHit);
  }
  const errs = await page.evaluate(() => window.__errs || []);
  expect(errs.length === 0, `${tag} ${path}：页面错误：${errs.join(" | ")}`);
}

run("answer-actionbar-fit", async ({ browser }) => {
  {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "zh-CN",
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    await injectErrs(page);
    for (const p of ["/question/6", "/question/54"]) {
      await checkPage(page, p, "390px", false, 44);
    }
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    await injectErrs(page);
    for (const p of ["/question/6", "/question/54"]) {
      await checkPage(page, p, "1440px", true, 0);
    }
    await ctx.close();
  }
});
