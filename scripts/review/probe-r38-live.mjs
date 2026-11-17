// 部署后线上复核（只读）
import { run, expect } from "../e2e/lib.mjs";
const BASE = "https://openfolio.uk/zhihucopy";
const OUT = (o) => console.log(JSON.stringify(o));

run("probe-r38-live", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e.message)));
  await page.goto(BASE + "/question/3", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".answer", { timeout: 25000 });
  await page.waitForTimeout(800);
  const first = await page.evaluate(() => ({
    n: document.querySelectorAll(".answerlist > li").length,
    times: [...document.querySelectorAll(".answer__date")].map((e) => e.innerText.trim()),
    foot: (document.querySelector(".feed-foot")?.innerText || "").replace(/\s+/g, " "),
    ovf: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  OUT({ step: "q3", ...first, errs: errs.length });
  const more = page.locator(".feed-foot button").first();
  if (await more.count()) {
    const t = Date.now();
    await more.click();
    await page.waitForFunction((n) => document.querySelectorAll(".answerlist > li").length > n, first.n, { timeout: 15000 });
    OUT({ step: "expand", ms: Date.now() - t, n: await page.locator(".answerlist > li").count(),
          collapse: await page.locator("button", { hasText: "收起回答" }).count() });
    const cb = page.locator("button", { hasText: "收起回答" }).first();
    if (await cb.count()) {
      await cb.click();
      await page.waitForTimeout(500);
      OUT({ step: "collapse", n: await page.locator(".answerlist > li").count(), scrollY: await page.evaluate(() => Math.round(window.scrollY)) });
    }
  }
  // 评论时间散布
  const c = await page.locator(".answer").first().locator("text=/\\d+ 条评论/").first();
  if (await c.count()) await c.click();
  await page.waitForTimeout(900);
  OUT({ step: "comments", times: await page.evaluate(() => [...document.querySelectorAll(".answer__comment-time")].slice(0, 12).map((e) => e.innerText.trim())) });
  await ctx.close();
  expect(errs.length === 0, "pageerror " + errs[0]);
});
