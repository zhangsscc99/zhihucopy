// 第三十六轮补充探针：搜索/通知/主页/发现/等你来答/话题
import { BASE, launch, run, api, uniq } from "./lib.mjs";

run("probe-r36b", async ({ browser }) => {
  const OUT = (o) => console.log(JSON.stringify(o));
  // 用种子号登录（真实内容可见）
  const sess = await api("POST", "/auth/login", { body: { email: "user2@zhihucopy.dev", password: "zhihu123456" } });
  const token = sess.token;
  OUT({ login: !!token, nick: sess.user && sess.user.nickname });

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => localStorage.setItem("zhihu_token", t), token);
  const page = await ctx.newPage();
  const perr = [];
  page.on("pageerror", (e) => perr.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") perr.push("console:" + m.text()); });
  await page.addInitScript(() => {
    window.__errs = [];
    const ce = console.error.bind(console);
    console.error = (...a) => { window.__errs.push(String(a[0])); ce(...a); };
  });
  const ovf = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const mainText = () => page.evaluate(() => (document.querySelector("main")?.innerText || "").replace(/\s+/g, " "));

  // 搜索：点输入框输关键词回车
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".feed__item", { timeout: 20000 });
  const t0 = Date.now();
  await page.locator('header input[aria-label="搜索"]').fill("React");
  await page.locator('header input[aria-label="搜索"]').press("Enter");
  await page.waitForURL(/search/, { timeout: 10000 });
  await page.waitForSelector(".searchres, .result, main h1, .search__head", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  OUT({ search: { ms: Date.now() - t0, url: page.url(), ovf: await ovf(), errs: await page.evaluate(() => window.__errs.length),
                  head: (await mainText()).slice(0, 180), items: await page.locator(".feed__item, .search__item, li").count() } });

  // 搜索 tab 切换（用户）
  const tabs = await page.locator("main [role=tab], main .tabs button, main button:has-text('用户')").allInnerTexts().catch(() => []);
  OUT({ searchTabs: tabs.slice(0, 8) });
  const uTab = page.locator("main button:has-text('用户')").first();
  if (await uTab.count()) {
    await uTab.click();
    await page.waitForTimeout(1200);
    OUT({ userTab: { url: page.url(), body: (await page.evaluate(() => document.body.innerText.length)), errs: await page.evaluate(() => window.__errs.length) } });
  }

  // 通知页：等真实内容
  await page.goto(BASE + "/notifications", { waitUntil: "domcontentloaded" });
  const nt = Date.now();
  const got = await page.waitForSelector(".notif__item, .notification, .empty, .emptybox, [class*=notif], main p", { timeout: 20000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(800);
  OUT({ notifications: { ms: Date.now() - nt, got, text: (await mainText()).slice(0, 400), ovf: await ovf(), errs: await page.evaluate(() => window.__errs.length) } });

  // 个人主页
  await page.goto(BASE + "/u/27", { waitUntil: "domcontentloaded" });
  const pt = Date.now();
  await page.waitForSelector(".profile, .profile__head, main h1", { timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => (document.querySelector("main")?.innerText || "").length > 200, null, { timeout: 15000 }).catch(() => {});
  OUT({ profile: { ms: Date.now() - pt, text: (await mainText()).slice(0, 300), ovf: await ovf(), errs: await page.evaluate(() => window.__errs.length) } });

  // 发现页 / 等你来答
  for (const p of ["/discover", "/unanswered", "/topic/2", "/topics"]) {
    await page.goto(BASE + p, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);
    OUT({ page: p, text: (await mainText()).slice(0, 220), ovf: await ovf(), errs: await page.evaluate(() => window.__errs.length),
          cards: await page.locator(".feed__item").count() });
  }

  // 话题页关注按钮是否可用
  await page.goto(BASE + "/topic/2", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const fbtn = page.locator("main button:has-text('关注')").first();
  const before = await fbtn.innerText().catch(() => "none");
  await fbtn.click().catch(() => {});
  await page.waitForTimeout(1000);
  OUT({ topicFollow: { before, after: await fbtn.innerText().catch(() => "none") } });

  // 390：问题页五个动作、通知页
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await m.addInitScript((t) => localStorage.setItem("zhihu_token", t), token);
  const mp = await m.newPage();
  await mp.goto(BASE + "/notifications", { waitUntil: "domcontentloaded" });
  await mp.waitForTimeout(2000);
  OUT({ mobileNotif: { text: (await mp.evaluate(() => (document.querySelector("main")?.innerText || "").replace(/\s+/g, " "))).slice(0, 260),
                       ovf: await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) } });

  OUT({ perrs: perr.slice(0, 5) });
});
