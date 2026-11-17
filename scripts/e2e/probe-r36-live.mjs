// 部署后线上复核（Z1144/Z1145/Z1146）
import { BASE, API, launch, run } from "./lib.mjs";

run("probe-r36-live", async ({ browser }) => {
  const OUT = (o) => console.log(JSON.stringify(o));
  const r = await fetch(API + "/auth/login", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "user2@zhihucopy.dev", password: "zhihu123456" }) }).then((x) => x.json());
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => localStorage.setItem("zhihu_token", t), r.token);
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__errs = [];
    const ce = console.error.bind(console);
    console.error = (...a) => { window.__errs.push(String(a[0])); ce(...a); };
  });
  const ovf = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  // Z1144 搜索
  await page.goto(BASE + "/search?q=" + encodeURIComponent("代码质量"), { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".feed__item", { timeout: 20000 });
  await page.waitForTimeout(1500);
  OUT({ search: { items: await page.locator(".feed__item").count(), head: (await page.evaluate(() => document.querySelector("main").innerText)).replace(/\s+/g, " ").slice(0, 90),
                  rel: await page.locator(".search-rel__item").count(), relHref: await page.locator(".search-rel__link").first().getAttribute("href").catch(() => null),
                  lowhit: await page.locator(".search-lowhit").count(), ovf: await ovf(), errs: await page.evaluate(() => window.__errs.length) } });

  // Z1145 通知 tab
  await page.goto(BASE + "/notifications", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".notify__tabs .notify__tab", { timeout: 20000 });
  await page.waitForTimeout(1000);
  const tabs = await page.locator(".notify__tab").allInnerTexts();
  await page.locator(".notify__tab", { hasText: "评论" }).first().click();
  await page.waitForTimeout(1500);
  const items = await page.locator(".ntf-item, .notif__item, main li").count();
  OUT({ notif: { tabs, active: await page.locator(".notify__tab[aria-selected=true]").innerText(), url: page.url(), items,
                 errs: await page.evaluate(() => window.__errs.length), ovf: await ovf() } });

  // Z1146 相关问题
  await page.goto(BASE + "/question/6", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".related", { timeout: 20000 });
  await page.waitForTimeout(800);
  const relBox = await page.locator(".related").boundingBox();
  OUT({ related: { items: await page.locator(".related__item").count(),
                   hrefs: await page.locator(".related__link").evaluateAll((els) => els.map((e) => e.getAttribute("href"))),
                   box: relBox && { x: Math.round(relBox.x), right: Math.round(relBox.x + relBox.width) }, viewport: 1440,
                   errs: await page.evaluate(() => window.__errs.length), ovf: await ovf() } });

  // 390 复核三项
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await m.addInitScript((t) => localStorage.setItem("zhihu_token", t), r.token);
  const mp = await m.newPage();
  await mp.addInitScript(() => { window.__errs = []; window.addEventListener("unhandledrejection", (e) => window.__errs.push("rej")); });
  const mo = () => mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await mp.goto(BASE + "/search?q=" + encodeURIComponent("代码质量"), { waitUntil: "domcontentloaded" });
  await mp.waitForTimeout(2500);
  const s = { searchOvf: await mo(), rel: await mp.locator(".search-rel__item").count() };
  await mp.goto(BASE + "/notifications", { waitUntil: "domcontentloaded" });
  await mp.waitForTimeout(2000);
  s.notifOvf = await mo(); s.tabs = await mp.locator(".notify__tab").count();
  await mp.goto(BASE + "/question/6", { waitUntil: "domcontentloaded" });
  await mp.waitForTimeout(2000);
  s.relatedOvf = await mo(); s.related = await mp.locator(".related__item").count();
  OUT({ mobile: s });
});
