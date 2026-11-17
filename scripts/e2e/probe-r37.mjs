// 第三十七轮真实用户走查探针（只读，不改产品代码）
import { BASE, launch, run, uniq } from "./lib.mjs";

const NICK = "顾屿舟" + String(Date.now()).slice(-4);
const OUT = (o) => console.log(JSON.stringify(o));

run("probe-r37", async ({ browser }) => {
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
  const ovf = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const M = async (label, fn) => {
    const t = Date.now();
    try { await fn(); } catch (e) { OUT({ label, err: String(e).slice(0, 200) }); }
    OUT({ [label + "_ms"]: Date.now() - t });
  };

  // ---- 注册一个新号（干净上下文） ----
  await page.goto(BASE + "/register", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#reg-email", { timeout: 15000 });
  const email = `walk37_${Date.now()}@example.com`;
  await page.fill("#reg-email", email);
  await page.fill("#reg-nickname", NICK);
  await page.fill("#reg-password", "Walk37pass!");
  await page.click(".authform button[type=submit]");
  await page.waitForTimeout(2500);
  OUT({ step: "register", url: page.url(), nick: NICK });

  // ---- 1 首页信息流 ----
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".feed__item", { timeout: 20000 });
  await page.waitForTimeout(700);
  const home = await page.evaluate(() => {
    const items = [...document.querySelectorAll(".feed__item")];
    return {
      cards: items.length,
      pills: document.querySelectorAll(".feed__item .tag, .feed__item .feed__topic").length,
      first: items.slice(0, 6).map((i) => (i.innerText || "").replace(/\s+/g, " ").slice(0, 90)),
      zeros: items.filter((i) => /0 个回答/.test(i.innerText)).length,
      rail: [...document.querySelectorAll(".rail .rail-block")].map((b) => (b.innerText || "").replace(/\s+/g, " ").slice(0, 40)),
      textLen: document.body.innerText.length,
    };
  });
  OUT({ step: "home", ...home, ovf: await ovf(), errs: await page.evaluate(() => window.__errs.length) });

  // ---- 2 打开一个问题 ----
  await M("open_question", async () => {
    await page.locator(".feed__item h2, .feed__item .feed__title").first().click();
    await page.waitForSelector(".answer, .question__title", { timeout: 15000 });
    await page.waitForFunction(() => document.body.innerText.length > 400, null, { timeout: 15000 });
  });
  const q = await page.evaluate(() => ({
    url: location.pathname + location.search,
    title: (document.querySelector("h1")?.innerText || "").slice(0, 70),
    answers: document.querySelectorAll(".answer").length,
    hasRelated: !!document.querySelector(".question__related, .related"),
    relatedText: (document.querySelector(".question__related, .related")?.innerText || "").replace(/\s+/g, " ").slice(0, 120),
  }));
  OUT({ step: "question", ...q, ovf: await ovf() });

  // ---- 3 读一条回答 ----
  const ans = await page.evaluate(() => {
    const a = document.querySelector(".answer");
    if (!a) return null;
    return {
      len: a.innerText.length,
      first200: a.innerText.replace(/\s+/g, " ").slice(0, 220),
      hasPre: !!a.querySelector("pre"),
      actions: [...a.querySelectorAll(".answer__action, button")].slice(0, 8).map((b) => b.innerText.trim()).filter(Boolean),
    };
  });
  OUT({ step: "read_answer", ...ans });

  // ---- 4 点赞 ----
  await M("like", async () => {
    const btn = page.locator(".answer").first().locator("button", { hasText: "赞同" }).first();
    await btn.click();
    await page.waitForFunction(() => {
      const b = document.querySelector(".answer");
      return b && /已赞同|取消赞同/.test(b.innerText);
    }, null, { timeout: 6000 });
  });
  OUT({ step: "like", answerHead: (await page.locator(".answer").first().innerText()).replace(/\s+/g, " ").slice(0, 120) });

  // ---- 5 写一条评论 ----
  await M("comment", async () => {
    const t = page.locator(".answer").first().locator("text=/\\d+ 条评论/").first();
    if (await t.count()) await t.click();
    await page.waitForTimeout(400);
    const box = page.locator(".answer").first().locator("textarea, input[type=text]").first();
    await box.fill("这段讲得清楚，尤其是把依赖数组的代价说透了。");
    const send = page.locator(".answer").first().locator("button", { hasText: /发布|发送/ }).first();
    await send.click();
    await page.waitForFunction(() => /依赖数组的代价/.test(document.body.innerText), null, { timeout: 6000 });
  });
  const cmt = await page.evaluate(() => {
    const a = document.querySelector(".answer");
    return { hasComment: /依赖数组的代价/.test(a.innerText), text: a.innerText.replace(/\s+/g, " ").slice(0, 160) };
  });
  OUT({ step: "comment", ...cmt });

  // ---- 6 返回 ----
  await M("back", async () => {
    await page.goBack();
    await page.waitForSelector(".feed__item", { timeout: 10000 });
  });
  OUT({ step: "back", url: page.url(), cards: await page.locator(".feed__item").count(),
        scrollY: await page.evaluate(() => window.scrollY) });

  // ---- 7 搜索关键词 ----
  await M("search", async () => {
    await page.goto(BASE + "/search?q=" + encodeURIComponent("代码质量"), { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => /相关结果|条/.test(document.body.innerText), null, { timeout: 12000 });
  });
  const se = await page.evaluate(() => {
    const m = document.body.innerText.match(/相关结果[^\n]*/);
    return {
      head: m ? m[0] : "",
      items: document.querySelectorAll(".feed__item, .search__item, li").length,
      hasTopicBlock: /相关话题/.test(document.body.innerText),
      topicLinks: [...document.querySelectorAll('a[href*="/topic/"]')].length,
      text: document.body.innerText.replace(/\s+/g, " ").slice(0, 400),
    };
  });
  OUT({ step: "search", ...se, ovf: await ovf() });

  // ---- 8 通知 ----
  await M("notifications", async () => {
    await page.goto(BASE + "/notifications", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
  });
  const nt = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll(".notify__tabs button, .notify__tab")].map((b) => b.innerText.trim()),
    body: document.body.innerText.replace(/\s+/g, " ").slice(0, 300),
  }));
  OUT({ step: "notifications", ...nt });

  // ---- 9 关注作者 ----
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".feed__item", { timeout: 15000 });
  let followRes = null;
  const followBtn = page.locator(".feed__item button", { hasText: "关注" }).first();
  if (await followBtn.count()) {
    await M("follow_author", async () => {
      await followBtn.click();
      await page.waitForFunction(() => /已关注/.test(document.body.innerText), null, { timeout: 6000 });
    });
    followRes = "ok";
  } else {
    // 进问题页点作者行关注
    await page.locator(".feed__item h2, .feed__item .feed__title").first().click();
    await page.waitForSelector(".answer", { timeout: 15000 });
    const ab = page.locator(".answer").first().locator("button", { hasText: "关注" }).first();
    await M("follow_author_ans", async () => { await ab.click(); await page.waitForFunction(() => /已关注/.test(document.body.innerText), null, { timeout: 6000 }); });
    followRes = "from_answer";
  }
  OUT({ step: "follow", mode: followRes });

  // ---- 10 看他的主页 ----
  const authorLink = page.locator('.feed__item a[href^="/u/"], .answer a[href^="/u/"]').first();
  await M("profile", async () => {
    if (await authorLink.count()) { await authorLink.click(); } else { await page.goto(BASE + "/u/27"); }
    await page.waitForSelector(".profile, .medals, h1", { timeout: 12000 });
    await page.waitForTimeout(500);
  });
  const pr = await page.evaluate(() => ({
    url: location.pathname,
    head: (document.querySelector(".profile")?.innerText || document.body.innerText).replace(/\s+/g, " ").slice(0, 220),
    badges: document.querySelectorAll(".profile__badge, .medals__item").length,
    followable: /已关注/.test(document.body.innerText),
  }));
  OUT({ step: "profile", ...pr, ovf: await ovf() });

  OUT({ total_errs: await page.evaluate(() => window.__errs.length), errs: errs.slice(0, 8) });

  // ---- 额外探针：相关问题质量 / 空态 / 举报 ----
  await page.goto(BASE + "/question/6", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const rel = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll("section, div")].filter((d) => /相关问题/.test(d.innerText) && d.querySelectorAll("a[href*='/question/']").length > 0);
    const b = blocks[blocks.length - 1];
    if (!b) return { found: false };
    const links = [...b.querySelectorAll("a[href*='/question/']")].map((a) => ({ t: a.innerText.replace(/\s+/g, " ").slice(0, 40), h: a.getAttribute("href") }));
    return { found: true, count: links.length, links: links.slice(0, 8), atBottom: b.getBoundingClientRect().top };
  });
  OUT({ step: "related", ...rel });

  // 搜索兜底：低命中
  await page.goto(BASE + "/search?q=" + encodeURIComponent("冷启动留存"), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  OUT({ step: "search_lowhit", text: (await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 300))) });

  // ---- 移动端 ----
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mp = await mctx.newPage();
  await mp.addInitScript(() => {
    window.__errs = [];
    window.addEventListener("error", (e) => window.__errs.push("error:" + e.message));
  });
  await mp.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await mp.waitForSelector(".feed__item", { timeout: 20000 });
  await mp.waitForTimeout(600);
  OUT({ step: "mobile_home", cards: await mp.locator(".feed__item").count(),
        ovf: await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
        errs: await mp.evaluate(() => window.__errs.length),
        meta: await mp.evaluate(() => (document.querySelector(".feed__item .feed__meta")?.innerText || "").replace(/\s+/g, " ")),
        topSearch: await mp.evaluate(() => {
          const f = document.querySelector("form");
          const i = document.querySelector("input[type=search], input[name=q]");
          return { formW: f ? f.getBoundingClientRect().width : null, inputW: i ? i.getBoundingClientRect().width : null };
        }) });
  await mp.goto(BASE + "/question/6", { waitUntil: "domcontentloaded" });
  await mp.waitForSelector(".answer", { timeout: 15000 });
  await mp.evaluate(() => window.scrollTo(0, document.body.scrollHeight - 900));
  await mp.waitForTimeout(800);
  OUT({ step: "mobile_question", ovf: await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
        related: await mp.evaluate(() => /相关问题/.test(document.body.innerText)) });
  await mp.goto(BASE + "/notifications", { waitUntil: "domcontentloaded" });
  await mp.waitForTimeout(1000);
  OUT({ step: "mobile_notify", ovf: await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
        tabs: await mp.evaluate(() => [...document.querySelectorAll(".notify__tab, .notify__tabs button")].map((b) => b.innerText.trim())) });
  await mctx.close();
  await ctx.close();
});
