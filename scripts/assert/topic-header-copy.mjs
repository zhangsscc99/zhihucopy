// Z1142 — 浏览器级断言：话题页头部统计口径与关注按钮可辨识、有间距。
//
// 断言（/topic/2 与 /topic/5，各跑 1440×900 与 390×844）：
//  1) 头部（.topic-head）innerText 不出现「关注 关注」相邻形态
//     （正则 /关注\s*关注/ 0 命中）；
//  2) 统计文本含「人关注」且含「个讨论」；
//  3) 统计容器（.topic__stats）与关注按钮（.topic-head__follow）是不同节点，
//     二者 getBoundingClientRect 水平或垂直间距 >= 12px；
//  4) 1440 下统计与按钮同一行（top 差 <= 8px）；390 下无横向溢出
//     （documentElement.scrollWidth - clientWidth === 0），按钮单行不折行；
//  5) window.__errs 为空。
//
// Env: E2E_BASE || API_BASE(-/api) || http://127.0.0.1:3030/zhihucopy
// 退出码即结论：0 PASS / 1 FAIL。

const apiBaseEnv = (process.env.API_BASE || "").replace(/\/+$/, "");
const derivedBase = apiBaseEnv.replace(/\/api$/, "");
process.env.E2E_BASE =
  process.env.E2E_BASE || derivedBase || "http://127.0.0.1:3030/zhihucopy";
process.env.E2E_API =
  process.env.E2E_API || apiBaseEnv || `${process.env.E2E_BASE}/api`;

const { run, expect, BASE } = await import("../e2e/lib.mjs");

const TOPICS = ["/topic/2", "/topic/5"];
const VIEWPORTS = [
  { tag: "1440", width: 1440, height: 900 },
  { tag: "390", width: 390, height: 844 },
];

async function injectErrs(page) {
  await page.addInitScript(() => {
    const w = window;
    w.__errs = [];
    w.addEventListener("error", (e) => w.__errs.push(`error:${e.message}`));
    w.addEventListener("unhandledrejection", (e) =>
      w.__errs.push(
        `unhandledrejection:${e.reason && e.reason.message ? e.reason.message : e.reason}`
      )
    );
    const ce = console.error.bind(console);
    console.error = (...a) => {
      w.__errs.push(`console.error:${a.map(String).join(" ")}`);
      ce(...a);
    };
  });
}

run("topic-header-copy", async ({ browser }) => {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      locale: "zh-CN",
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    await injectErrs(page);

    for (const path of TOPICS) {
      await page.goto(`${BASE}${path}`);
      await page.locator(".topic-head__name").waitFor();
      await page.locator(".topic__stats").waitFor();
      const btn = page.locator(".topic-head__follow");
      await btn.waitFor();

      const headText = (await page.locator(".topic-head").innerText()) || "";
      expect(
        !/关注\s*关注/.test(headText),
        `[${vp.tag} ${path}] 头部出现「关注 关注」相邻：${JSON.stringify(headText.slice(0, 80))}`
      );

      const statsText = (await page.locator(".topic__stats").innerText()) || "";
      expect(
        statsText.includes("人关注"),
        `[${vp.tag} ${path}] 统计缺「人关注」：${JSON.stringify(statsText)}`
      );
      expect(
        statsText.includes("个讨论"),
        `[${vp.tag} ${path}] 统计缺「个讨论」：${JSON.stringify(statsText)}`
      );

      const gap = await page.evaluate(() => {
        const s = document.querySelector(".topic__stats");
        const b = document.querySelector(".topic-head__follow");
        if (!s || !b || s === b) return null;
        const sr = s.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        const hGap = Math.max(br.left - sr.right, sr.left - br.right, 0);
        const vGap = Math.max(br.top - sr.bottom, sr.top - br.bottom, 0);
        return {
          hGap,
          vGap,
          topDiff: Math.abs(sr.top - br.top),
          btnHeight: br.height,
          sameNode: s === b,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      expect(gap !== null, `[${vp.tag} ${path}] 统计容器或关注按钮缺失/同一节点`);
      expect(
        gap.hGap >= 12 || gap.vGap >= 12,
        `[${vp.tag} ${path}] 统计与按钮间距不足 12px（h=${gap.hGap.toFixed(1)} v=${gap.vGap.toFixed(1)}）`
      );

      if (vp.tag === "1440") {
        expect(
          gap.topDiff <= 8,
          `[${vp.tag} ${path}] 1440 下统计与按钮未同行（top 差 ${gap.topDiff.toFixed(1)}px）`
        );
      }

      expect(
        gap.overflow === 0,
        `[${vp.tag} ${path}] 横向溢出 ${gap.overflow}px`
      );
      expect(
        gap.btnHeight <= 40,
        `[${vp.tag} ${path}] 关注按钮被挤成两行（height=${gap.btnHeight.toFixed(1)}）`
      );

      const errs = await page.evaluate(() => window.__errs || []);
      expect(
        errs.length === 0,
        `[${vp.tag} ${path}] __errs: ${errs.slice(0, 3).join(" | ")}`
      );
    }
    await ctx.close();
  }
});
