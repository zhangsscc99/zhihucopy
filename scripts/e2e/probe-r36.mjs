// 第三十六轮真实用户走查探针（只读，不改产品代码）
import { BASE, API, launch, run, uniq } from "./lib.mjs";

const NICK = "沈舟拾" + String(Date.now()).slice(-4);
const OUT = (o) => console.log(JSON.stringify(o));

run("probe-r36", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.addInitScript(() => {
    window.__errs = [];
    const ce = console.error.bind(console);
    console.error = (...a) => { window.__errs.push(String(a[0])); ce(...a); };
    window.addEventListener("error", (e) => window.__errs.push("error:" + e.message));
    window.addEventListener("unhandledrejection", (e) => window.__errs.push("rej:" + String(e.reason)));
  });

  const M = async (label, fn) => {
    const t = Date.now();
    try { await fn(); } catch (e) { OUT({ label, err: String(e).slice(0, 200) }); }
    OUT({ label, ms: Date.now() - t });
  };
  const ovf = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  // 1 首页
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".feed__item", { timeout: 20000 });
  await page.waitForTimeout(800);
  OUT({ step: "home", cards: await page.locator(".feed__item").count(),
        innerText: (await page.evaluate(() => document.body.innerText.length)),
        pills: await page.locator(".feed__item .tag").count(),
        hot: await page.locator(".rail .hot__item, .rail li").count(),
        ovf: await ovf(), errs: await page.evaluate(() => window.__errs.length) });
  const firstTitle = (await page.locator(".feed__item h2, .feed__item .feed__title").first().innerText()).slice(0, 60);
  OUT({ firstTitle });

  // 2 打开问题
  await M("open_question", async () => {
    await page.locator(".feed__item h2, .feed__item .feed__title").first().click();
    await page.waitForSelector(".answer, .question__title", { timeout: 15000 });
    await page.waitForFunction(() => document.body.innerText.length > 400, null, { timeout: 15000 });
  });
  OUT({ url: page.url(), questionTitle: (await page.locator("h1").first().innerText()).slice(0, 60),
        answers: await page.locator(".answer").count(), ovf: await ovf() });

  // 3 读一条回答
  const codeInfo = await page.evaluate(() => {
    const a = document.querySelector(".answer");
    const pre = a && a.querySelector("pre");
    return { hasPre: !!pre, preW: pre ? pre.scrollWidth - pre.clientWidth : null,
             textLen: a ? a.innerText.length : 0 };
  });
  OUT({ step: "read_answer", ...codeInfo });

  // 4 未登录点赞
  const likeBefore = await page.locator(".answer").first().innerText();
  await M("like_unauth", async () => {
    await page.locator(".answer .answer__vote--up").first().click();
    await page.waitForURL(/\/login/, { timeout: 8000 });
    await page.waitForFunction(() => document.body.innerText.length > 100, null, { timeout: 8000 });
  });
  OUT({ afterLikeUrl: page.url(), loginText: (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").slice(0, 260) });

  // 4b 现场注册
  await M("register", async () => {
    const link = page.locator("a:has-text('注册')").first();
    if (await link.count()) { await link.click(); await page.waitForTimeout(600); }
    await page.locator("#reg-nickname").fill(NICK);
    await page.locator("#reg-email").fill("review" + String(Date.now()).slice(-6) + "@zhihucopy.dev");
    await page.locator("#reg-password").fill("zhihu123456");
    await page.locator(".authform button[type=submit]").first().click();
    await page.waitForFunction(() => !!localStorage.getItem("zhihu_token"), null, { timeout: 15000 });
  });
  OUT({ afterRegisterUrl: page.url(), nick: NICK });

  // 回问题页点赞
  await page.goto(BASE + "/question/6", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".answer", { timeout: 15000 });
  await page.waitForTimeout(500);
  const voteNum = async () => (await page.locator(".answer .answer__vote--up").first().innerText()).replace(/\s+/g, "");
  const v0 = await voteNum();
  await M("like_auth", async () => {
    await page.locator(".answer .answer__vote--up").first().click();
    await page.waitForFunction((b) => {
      const el = document.querySelector(".answer .answer__vote--up");
      return el && el.innerText.replace(/\s+/g, "") !== b;
    }, v0, { timeout: 5000 });
  });
  OUT({ vote: [v0, await voteNum()] });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".answer", { timeout: 15000 });
  OUT({ voteAfterReload: await voteNum() });

  // 5 写评论
  const cbtn = page.locator(".answer button:has-text('条评论')").first();
  const cbtnText = await cbtn.count() ? await cbtn.innerText() : "none";
  await M("open_comments", async () => {
    await page.locator(".answer button:has-text('评论')").first().click();
    await page.waitForSelector(".answer textarea, .answer input[type=text]", { timeout: 6000 });
  });
  const body = "第" + String(Date.now()).slice(-4) + "条走查感想：这段关于依赖数组的解释我终于看懂了。";
  await M("post_comment", async () => {
    const ta = page.locator(".answer textarea").first();
    await ta.fill(body);
    await page.locator(".answer button:has-text('发布')").first().click();
    await page.waitForFunction((b) => document.querySelector(".answer")?.innerText.includes(b), body, { timeout: 8000 });
  });
  OUT({ commentBtn: cbtnText.replace(/\s+/g, " "), posted: (await page.locator(".answer").first().innerText()).includes(body) });

  // 6 返回
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".feed__item", { timeout: 15000 });
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(400);
  const card = page.locator(".feed__item h2, .feed__item .feed__title").nth(11);
  await M("open_from_scrolled", async () => { await card.click(); await page.waitForSelector(".answer, .question__title", { timeout: 15000 }); });
  await M("back", async () => { await page.goBack(); await page.waitForSelector(".feed__item", { timeout: 15000 }); });
  OUT({ scrollAfterBack: await page.evaluate(() => window.scrollY) });

  // 7 搜索
  await M("search", async () => {
    const q = page.locator("header input[type=search], header input[type=text]").first();
    await q.fill("React");
    await q.press("Enter");
    await page.waitForURL(/search/, { timeout: 10000 });
    await page.waitForFunction(() => document.body.innerText.length > 300, null, { timeout: 15000 });
  });
  OUT({ searchUrl: page.url(), searchHead: (await page.evaluate(() => document.querySelector("main").innerText)).replace(/\s+/g, " ").slice(0, 200), ovf: await ovf() });

  // 8 通知
  await M("notifications", async () => {
    await page.goto(BASE + "/notifications", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.innerText.length > 150, null, { timeout: 15000 });
  });
  OUT({ notifyText: (await page.evaluate(() => document.querySelector("main").innerText)).replace(/\s+/g, " ").slice(0, 300) });

  // 9 关注作者（回问题页）
  await page.goto(BASE + "/question/6", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".answer", { timeout: 15000 });
  const fbtn = page.locator(".answer button:has-text('关注')").first();
  const f0 = await fbtn.count() ? await fbtn.innerText() : "none";
  await M("follow", async () => {
    await fbtn.click();
    await page.waitForFunction(() => document.querySelector(".answer button")?.innerText !== "", null, { timeout: 1000 }).catch(() => {});
    await page.waitForTimeout(1200);
  });
  OUT({ followBefore: f0, followAfter: await page.locator(".answer button:has-text('关注')").first().innerText().catch(() => "n/a") });

  // 10 作者主页
  await M("author_profile", async () => {
    await page.locator(".answer a[href*='/u/']").first().click();
    await page.waitForFunction(() => document.body.innerText.length > 300, null, { timeout: 15000 });
  });
  OUT({ profileUrl: page.url(), profileHead: (await page.evaluate(() => document.querySelector("main").innerText)).replace(/\s+/g, " ").slice(0, 240) });

  // 全站 errs（桌面）
  OUT({ errsDesktop: await page.evaluate(() => window.__errs.length), errList: (await page.evaluate(() => window.__errs)).slice(0, 5) });

  // ---- 移动端 390 ----
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await m.newPage();
  const merrs = [];
  mp.on("pageerror", (e) => merrs.push(e.message));
  await mp.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await mp.waitForSelector(".feed__item", { timeout: 20000 });
  await mp.waitForTimeout(600);
  const movf = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  OUT({ mobile: { cards: await mp.locator(".feed__item").count(), ovf: movf, bottomnav: await mp.locator(".bottomnav a").count(), merrs } });
  await mp.goto(BASE + "/question/6", { waitUntil: "domcontentloaded" });
  await mp.waitForSelector(".answer", { timeout: 15000 });
  OUT({ mobileQ: { ovf: await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
                   actions: (await mp.evaluate(() => document.querySelector(".answer")?.innerText)).replace(/\s+/g, " ").slice(-160) } });

  // 收尾：删掉走查账号
  try {
    const lr = await page.evaluate(() => localStorage.getItem("zhihu_token"));
    const adm = await fetch(API + "/auth/login", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "admin@zhihucopy.dev", password: "zhihu123456" }) }).then((r) => r.json());
    const r = await fetch(API + "/test-support/purge-residue", { method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + adm.token },
      body: JSON.stringify({ only_nicknames: [NICK] }) }).then((r) => r.json());
    OUT({ purge: JSON.stringify(r).slice(0, 160), hadToken: !!lr });
  } catch (e) { OUT({ purgeErr: String(e).slice(0, 120) }); }
});
