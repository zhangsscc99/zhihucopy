// probe-extra.mjs — 补测：分页到底、卡片去重、移动端布局、公网站点对照。
import fs from "node:fs";
import path from "node:path";
import { BASE, SHOT_DIR, launch, newPage, apiOk } from "./lib.mjs";

const out = {};
const txt = async (l) => ((await l.first().textContent()) || "").replace(/\s+/g, " ").trim();
const PUBLIC = "https://openfolio.uk/zhihucopy";

const main = async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await launch();
  const page = await newPage(browser);
  page.on("pageerror", (e) => (out.pageerror = String(e.message).slice(0, 200)));

  // A. 分页到底
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const total = (await apiOk("GET", "/questions?tab=new&page=1&limit=50")).total;
  out.totalQuestions = total;
  let clicks = 0;
  while (clicks < 12 && (await page.getByRole("button", { name: "加载更多" }).count())) {
    await page.getByRole("button", { name: "加载更多" }).click();
    await page.waitForTimeout(1200);
    clicks++;
  }
  const titles = await page.locator(".feed__title").allTextContents();
  out.pagination = {
    clicks, rendered: titles.length, unique: new Set(titles).size,
    endCopy: await txt(page.locator(".feed-end")).catch(() => null),
    moreBtnStill: await page.getByRole("button", { name: "加载更多" }).count(),
  };

  // B. 首页卡片数据健康度
  const feed = await apiOk("GET", "/questions?tab=new&page=1&limit=100");
  out.feed = {
    total: feed.total,
    e2eTitles: feed.items.filter((q) => /\[e2e\]|巡检|probe/i.test(q.title)).length,
    zeroAnswer: feed.items.filter((q) => q.answer_count === 0).length,
    zeroView: feed.items.filter((q) => q.view_count === 0).length,
    first5: feed.items.slice(0, 5).map((q) => `${q.title} | ${q.answer_count}答 ${q.view_count}看`),
  };
  const hot = await apiOk("GET", "/questions?tab=hot&page=1&limit=10");
  out.hot = hot.items.slice(0, 3).map((q) => `${q.title.slice(0, 24)} | ${q.answer_count}答 ${q.view_count}看`);

  // C. 移动端视口
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-CN", isMobile: true, hasTouch: true });
  const mp = await m.newPage();
  await mp.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await mp.waitForTimeout(800);
  out.mobile = {
    bottomNavVisible: await mp.locator("nav[aria-label=底部导航]").isVisible(),
    topnavVisible: await mp.locator("header.topnav").isVisible(),
    searchVisible: await mp.getByLabel("搜索").isVisible(),
    cards: await mp.locator(".feed__item").count(),
    horizontalOverflow: await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
    railVisible: await mp.locator("aside.rail").isVisible().catch(() => false),
  };
  await mp.screenshot({ path: path.join(SHOT_DIR, "mobile-home.png"), fullPage: false });
  await mp.locator(".feed__title").first().click();
  await mp.waitForTimeout(1200);
  out.mobileDetail = { url: mp.url().replace(BASE, ""), textTail: (await mp.locator("main").innerText()).replace(/\s+/g, " ").slice(-80) };
  await mp.screenshot({ path: path.join(SHOT_DIR, "mobile-detail.png"), fullPage: false });

  // D. 公网抽查
  const pub = await browser.newPage();
  const pubConsole = [];
  pub.on("console", (c) => c.type() === "error" && pubConsole.push(c.text().slice(0, 120)));
  pub.on("pageerror", (e) => pubConsole.push("PAGEERROR " + String(e.message).slice(0, 120)));
  try {
    await pub.goto(PUBLIC + "/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await pub.waitForTimeout(3000);
    out.public = {
      cards: await pub.locator(".feed__item").count(),
      firstTitle: await txt(pub.locator(".feed__title")).catch(() => null),
      header: (await pub.locator("header").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 80),
      console: pubConsole.slice(0, 5),
    };
    await pub.screenshot({ path: path.join(SHOT_DIR, "public-home.png"), fullPage: false });
    // 公网搜索
    const sb = pub.getByLabel("搜索");
    await sb.fill("编程");
    await sb.press("Enter");
    await pub.waitForTimeout(2500);
    out.public.search = { url: pub.url().replace(PUBLIC, ""), cards: await pub.locator(".feed__item").count(), mentionsSearch: /没有找到|无结果|搜索结果/.test(await pub.locator("main").innerText()) };
    await pub.goto(PUBLIC + "/question/127", { waitUntil: "domcontentloaded" });
    await pub.waitForTimeout(2500);
    out.public.detail = {
      title: await txt(pub.locator("h1")).catch(() => null),
      answers: await pub.locator(".answer").count(),
      hasTextarea: await pub.locator("textarea").count(),
      tail: (await pub.locator("main").innerText()).replace(/\s+/g, " ").slice(-100),
    };
    await pub.screenshot({ path: path.join(SHOT_DIR, "public-detail.png"), fullPage: false });
  } catch (e) {
    out.public = { error: String(e.message).slice(0, 200) };
  }

  fs.writeFileSync(path.join(SHOT_DIR, "extra.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
};
main().catch((e) => { console.error("FATAL", e.stack || e); process.exit(1); });
