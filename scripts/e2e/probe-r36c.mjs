// 第三十六轮补充探针 2：登录态下的通知/关注/主页/热榜/关注流
import { BASE, API, launch, run } from "./lib.mjs";

run("probe-r36c", async ({ browser }) => {
  const OUT = (o) => console.log(JSON.stringify(o));
  const r = await fetch(API + "/auth/login", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "user2@zhihucopy.dev", password: "zhihu123456" }) }).then((x) => x.json());
  const token = r.token;
  OUT({ login: !!token, nick: r.user?.nickname });

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => localStorage.setItem("zhihu_token", t), token);
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__errs = [];
    const ce = console.error.bind(console);
    console.error = (...a) => { window.__errs.push(String(a[0])); ce(...a); };
  });
  const ovf = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const mainText = () => page.evaluate(() => (document.querySelector("main")?.innerText || "").replace(/\s+/g, " "));

  // 通知（登录态）
  await page.goto(BASE + "/notifications", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (document.querySelector("main")?.innerText || "").length > 120, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  OUT({ notif: { text: (await mainText()).slice(0, 420), items: await page.locator("main li, main .notif__item").count(),
                 badge: await page.locator(".topnav__badge, [class*=badge]").first().innerText().catch(() => "none"), errs: await page.evaluate(() => window.__errs.length) } });

  // 热榜 tab
  await page.goto(BASE + "/?tab=hot", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".feed__item", { timeout: 20000 });
  await page.waitForTimeout(800);
  OUT({ hot: { cards: await page.locator(".feed__item").count(), text: (await mainText()).slice(0, 200), errs: await page.evaluate(() => window.__errs.length) } });

  // 关注流 tab
  await page.goto(BASE + "/?tab=following", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  OUT({ following: { cards: await page.locator(".feed__item").count(), text: (await mainText()).slice(0, 260) } });

  // 关注一个作者 + 作者主页（登录态，跟随真实按钮）
  await page.goto(BASE + "/question/6", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".answer", { timeout: 15000 });
  const fbtn = page.locator(".answer__follow").first();
  const fb = await fbtn.count() ? await fbtn.innerText() : "none";
  const t0 = Date.now();
  if (await fbtn.count()) await fbtn.click();
  await page.waitForTimeout(1200);
  OUT({ follow: { before: fb.replace(/\s+/g, ""), after: (await fbtn.innerText().catch(() => "none")).replace(/\s+/g, ""), ms: Date.now() - t0 } });

  const at = Date.now();
  await page.locator(".answer a[href*='/u/']").first().click();
  await page.waitForFunction(() => (document.querySelector("main")?.innerText || "").length > 220, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);
  OUT({ profile: { ms: Date.now() - at, url: page.url(), text: (await mainText()).slice(0, 260), ovf: await ovf(), errs: await page.evaluate(() => window.__errs.length) } });

  // 主页 tab：提问
  const askTab = page.locator("main button:has-text('提问'), main [role=tab]:has-text('提问')").first();
  if (await askTab.count()) {
    await askTab.click();
    await page.waitForTimeout(1500);
    OUT({ profileAsk: { text: (await mainText()).slice(0, 200), cards: await page.locator("main li").count() } });
  }

  // 首页搜索后再回首页：搜索框是否还留着关键词
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".feed__item", { timeout: 20000 });
  await page.locator('header input[aria-label="搜索"]').fill("代码质量");
  await page.locator('header input[aria-label="搜索"]').press("Enter");
  await page.waitForURL(/search/, { timeout: 10000 });
  await page.waitForTimeout(1800);
  OUT({ search2: { text: (await mainText()).slice(0, 160), items: await page.locator(".feed__item").count() } });
  const cancel = page.locator("main a:has-text('取消搜索'), main button:has-text('取消搜索')").first();
  if (await cancel.count()) { await cancel.click(); await page.waitForTimeout(1200); }
  OUT({ afterCancelSearch: { url: page.url(), searchBox: await page.locator('header input[aria-label="搜索"]').inputValue().catch(() => "n/a") } });

  OUT({ errs: await page.evaluate(() => window.__errs.length) });
});
