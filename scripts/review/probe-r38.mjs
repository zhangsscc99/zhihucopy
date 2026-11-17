// 第三十八轮真实用户走查探针（只读，不改产品代码）——对线上 https://openfolio.uk/zhihucopy
import { BASE, launch, run, uniq } from "../e2e/lib.mjs";

const NICK = "走查员" + String(Date.now()).slice(-4);
const OUT = (o) => console.log(JSON.stringify(o));

run("probe-r38", async ({ browser }) => {
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

  // 未登录首屏先看一遍（真实访客第一眼）
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".feed__item", { timeout: 25000 });
  await page.waitForTimeout(600);
  OUT({ anon_home: await page.evaluate(() => ({
    cards: document.querySelectorAll(".feed__item").length,
    textLen: document.body.innerText.length,
    rail: [...document.querySelectorAll(".rail-block")].map((b) => b.innerText.replace(/\s+/g, " ").slice(0, 36)),
    zeros: [...document.querySelectorAll(".feed__item")].filter((i) => /0 个回答/.test(i.innerText)).length,
  })), ovf: await ovf() });

  // ---- 注册新号（干净上下文） ----
  await page.goto(BASE + "/register", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#reg-email", { timeout: 15000 });
  const email = `walk38_${Date.now()}@example.com`;
  await page.fill("#reg-email", email);
  await page.fill("#reg-nickname", NICK);
  await page.fill("#reg-password", "Walk38pass!");
  await page.click(".authform button[type=submit]");
  await page.waitForTimeout(2500);
  OUT({ step: "register", url: page.url(), nick: NICK });

  // ---- 1 首页信息流 ----
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".feed__item", { timeout: 20000 });
  await page.waitForTimeout(700);
  OUT({ step: "home", ...(await page.evaluate(() => {
    const items = [...document.querySelectorAll(".feed__item")];
    return {
      cards: items.length,
      pills: document.querySelectorAll(".feed__item .tag, .feed__item .feed__topic").length,
      first: items.slice(0, 4).map((i) => (i.innerText || "").replace(/\s+/g, " ").slice(0, 80)),
      textLen: document.body.innerText.length,
    };
  })), ovf: await ovf() });

  // ---- 2 打开一个问题 ----
  await M("open_question", async () => {
    await page.locator(".feed__item h2, .feed__item .feed__title").first().click();
    await page.waitForSelector(".answer, .question__title", { timeout: 15000 });
    await page.waitForFunction(() => document.body.innerText.length > 400, null, { timeout: 15000 });
  });
  OUT({ step: "question", ...(await page.evaluate(() => ({
    url: location.pathname,
    title: (document.querySelector("h1")?.innerText || "").slice(0, 80),
    answers: document.querySelectorAll(".answer").length,
    related: /相关问题/.test(document.body.innerText),
    ovf: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))) });

  // ---- 3 读一条回答 ----
  OUT({ step: "read_answer", ...(await page.evaluate(() => {
    const a = document.querySelector(".answer");
    return {
      len: a.innerText.length,
      first220: a.innerText.replace(/\s+/g, " ").slice(0, 220),
      hasPre: !!a.querySelector("pre"),
      actions: [...a.querySelectorAll("button")].slice(0, 9).map((b) => b.innerText.trim()).filter(Boolean),
    };
  })) });

  // ---- 4 点赞 ----
  await M("like", async () => {
    const btn = page.locator(".answer").first().locator("button", { hasText: /赞同/ }).first();
    await btn.click();
    await page.waitForFunction(() => /已赞同|取消赞同/.test(document.querySelector(".answer").innerText), null, { timeout: 6000 });
  });
  OUT({ step: "like", head: (await page.locator(".answer").first().innerText()).replace(/\s+/g, " ").slice(0, 130) });

  // ---- 5 写一条评论 + 抽样既有评论语料 ----
  await M("comment", async () => {
    const t = page.locator(".answer").first().locator("text=/\\d+ 条评论/").first();
    if (await t.count()) await t.click();
    await page.waitForTimeout(500);
    const box = page.locator(".answer").first().locator("textarea, input[type=text]").first();
    await box.fill("把依赖数组当成合同来读，这个比喻我记住了，回头照着重构一版。");
    const send = page.locator(".answer").first().locator("button", { hasText: /发布|发送/ }).first();
    await send.click();
    await page.waitForFunction(() => /当作合同|合同来读/.test(document.body.innerText), null, { timeout: 6000 });
  });
  OUT({ step: "comment", ...(await page.evaluate(() => {
    const a = document.querySelector(".answer");
    const cs = [...a.querySelectorAll(".comment__body, .comment__item .comment__text, .comment")].map((c) => c.innerText.replace(/\s+/g, " ").slice(0, 60)).slice(0, 10);
    return { mine: /合同来读/.test(a.innerText), total: document.body.innerText.match(/(\d+) 条评论/)?.[1], samples: cs };
  })) });

  // ---- 6 返回 ----
  await M("back", async () => {
    await page.goBack();
    await page.waitForSelector(".feed__item", { timeout: 10000 });
  });
  OUT({ step: "back", url: page.url(), cards: await page.locator(".feed__item").count(), scrollY: await page.evaluate(() => window.scrollY) });

  // ---- 7 搜索 ----
  await M("search", async () => {
    await page.goto(BASE + "/search?q=" + encodeURIComponent("代码质量"), { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => /相关结果|条/.test(document.body.innerText), null, { timeout: 12000 });
  });
  OUT({ step: "search", ...(await page.evaluate(() => ({
    head: (document.body.innerText.match(/相关结果[^\n]*/) || [""])[0],
    items: document.querySelectorAll(".feed__item, .search__item").length,
    topics: [...document.querySelectorAll('a[href*="/topic/"]')].length,
    hasFallback: /相关话题|换个说法|相关用户/.test(document.body.innerText),
  }))) });
  // 搜索低命中/边界
  for (const q of ["？", "冷启动留存", "react"]) {
    await page.goto(BASE + "/search?q=" + encodeURIComponent(q), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1100);
    OUT({ step: "search_probe", q, text: (await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 180))) });
  }

  // ---- 8 通知 ----
  await M("notifications", async () => {
    await page.goto(BASE + "/notifications", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1400);
  });
  OUT({ step: "notifications", ...(await page.evaluate(() => ({
    tabs: [...document.querySelectorAll(".notify__tab, .notify__tabs button")].map((b) => b.innerText.trim()),
    body: document.body.innerText.replace(/\s+/g, " ").slice(0, 260),
  }))) });

  // ---- 9 关注作者 ----
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".feed__item", { timeout: 15000 });
  await M("follow_author", async () => {
    await page.locator(".feed__item h2, .feed__item .feed__title").first().click();
    await page.waitForSelector(".answer", { timeout: 15000 });
    const ab = page.locator(".answer").first().locator("button", { hasText: "关注" }).first();
    await ab.click();
    await page.waitForFunction(() => /已关注/.test(document.body.innerText), null, { timeout: 6000 });
  });
  OUT({ step: "follow", ...(await page.evaluate(() => ({ has: /已关注/.test(document.body.innerText) }))) });

  // ---- 10 主页 ----
  await M("profile", async () => {
    const a = page.locator('.answer a[href^="/u/"]').first();
    if (await a.count()) await a.click(); else await page.goto(BASE + "/u/27");
    await page.waitForSelector(".medals, h1", { timeout: 15000 });
    await page.waitForTimeout(600);
  });
  OUT({ step: "profile", ...(await page.evaluate(() => ({
    url: location.pathname,
    head: document.body.innerText.replace(/\s+/g, " ").slice(0, 260),
    tabs: [...document.querySelectorAll(".profile__tab, .tabs button")].map((b) => b.innerText.trim()),
    followed: /已关注/.test(document.body.innerText),
  }))), ovf: await ovf() });

  OUT({ total_errs: await page.evaluate(() => window.__errs.length), errs: errs.slice(0, 8) });

  // ---- 额外探针 ----
  // 相关问题质量
  await page.goto(BASE + "/question/6", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  OUT({ step: "related", ...(await page.evaluate(() => ({
    found: /相关问题/.test(document.body.innerText),
    links: [...document.querySelectorAll('a[href*="/question/"]')].map((a) => a.innerText.replace(/\s+/g, " ").slice(0, 44)).filter(Boolean).slice(-8),
  }))) });

  // 热榜 / 发现 / 等你来答 可点性
  for (const p of ["/?tab=hot", "/topics", "/unanswered", "/feed", "/settings", "/404-nonexistent"]) {
    await page.goto(BASE + p, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    OUT({ step: "page", p, ...(await page.evaluate(() => ({
      h1: (document.querySelector("h1")?.innerText || "").slice(0, 50),
      links: document.querySelectorAll("main a, #root a").length,
      text: document.body.innerText.replace(/\s+/g, " ").slice(0, 120),
    }))) });
  }

  // 未登录动作回跳（新上下文）
  const actx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ap = await actx.newPage();
  await ap.goto(BASE + "/question/6", { waitUntil: "domcontentloaded" });
  await ap.waitForSelector(".answer", { timeout: 15000 });
  for (const label of ["反对", "收藏", "关注问题", "写回答"]) {
    const b = ap.locator("button", { hasText: label }).first();
    if (!(await b.count())) { OUT({ anon_act: label, missing: true }); continue; }
    const before = ap.url();
    await b.click();
    await ap.waitForTimeout(900);
    OUT({ anon_act: label, url: ap.url(), changed: ap.url() !== before, toast: (await ap.evaluate(() => (document.querySelector(".toast, .snack, [role=status]")?.innerText || "").replace(/\s+/g, " ").slice(0, 60))) });
    if (ap.url() !== before) await ap.goto(BASE + "/question/6", { waitUntil: "domcontentloaded" });
  }
  await actx.close();

  // ---- 移动端 390×844 ----
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mp = await mctx.newPage();
  const merrs = [];
  mp.on("pageerror", (e) => merrs.push(String(e.message)));
  await mp.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await mp.waitForSelector(".feed__item", { timeout: 20000 });
  await mp.waitForTimeout(600);
  OUT({ step: "mobile_home", cards: await mp.locator(".feed__item").count(),
        ovf: await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
        errs: merrs.length,
        nav: await mp.evaluate(() => [...document.querySelectorAll("nav a, .tabbar a")].map((a) => a.innerText.trim())) });
  await mp.goto(BASE + "/question/6", { waitUntil: "domcontentloaded" });
  await mp.waitForSelector(".answer", { timeout: 15000 });
  await mp.waitForTimeout(600);
  OUT({ step: "mobile_question", ovf: await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
        actions: await mp.evaluate(() => [...document.querySelectorAll(".answer button")].slice(0, 8).map((b) => b.innerText.trim())) });
  await mctx.close();

  await ctx.close();
});
