// 第三十七轮补充探针 C：顶栏搜索输入 / 移动端入口 / 点赞可访问性
import { BASE, run } from "../e2e/lib.mjs";
const OUT = (o) => console.log(JSON.stringify(o));

run("probe-r37c", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".feed__item", { timeout: 15000 });
  OUT({ desktopInputs: await page.evaluate(() => [...document.querySelectorAll("input")].map((i) => {
    const r = i.getBoundingClientRect();
    return { type: i.type, q: i.name || i.id || i.placeholder, w: Math.round(r.width), h: Math.round(r.height), vis: getComputedStyle(i).visibility, disp: getComputedStyle(i).display, op: getComputedStyle(i).opacity };
  })) });
  OUT({ desktopHeaderText: (await page.evaluate(() => (document.querySelector("header, .topnav")?.innerText || "").replace(/\s+/g, " ").slice(0, 200))) });

  // 顶栏搜索可用性：直接按 placeholder 找
  const box = page.getByPlaceholder(/搜索/).first();
  OUT({ placeholderCount: await page.getByPlaceholder(/搜索/).count() });
  if (await box.count()) {
    const t = Date.now();
    await box.click();
    await box.fill("代码质量");
    await page.keyboard.press("Enter");
    try { await page.waitForSelector(".feed__item", { timeout: 10000 }); } catch {}
    OUT({ navSearch: { ms: Date.now() - t, url: page.url().replace(BASE, ""), items: await page.locator(".feed__item").count(),
      head: (await page.evaluate(() => (document.body.innerText.match(/相关结果[^\n]*/) || [""])[0])),
      qValue: await page.evaluate(() => [...document.querySelectorAll("input")].map((i) => i.value).filter(Boolean)) } });
  }

  // 点赞按钮可访问性（aria-pressed）
  await page.goto(BASE + "/question/6", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".answer", { timeout: 15000 });
  OUT({ voteA11y: await page.evaluate(() => [...document.querySelectorAll(".answer")][0] && [...document.querySelectorAll(".answer__vote")].slice(0, 2).map((b) => ({
    t: b.innerText.trim().replace(/\s+/g, " "), aria: b.getAttribute("aria-pressed"), title: b.getAttribute("title"), ariaLabel: b.getAttribute("aria-label"),
  }))) });

  // 移动端
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mp = await mctx.newPage();
  await mp.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await mp.waitForSelector(".feed__item", { timeout: 15000 });
  OUT({ mobile: await mp.evaluate(() => ({
    btns: [...document.querySelectorAll("header button, .topnav button")].map((b) => ({ t: b.innerText.trim().replace(/\s+/g, " "), a: b.getAttribute("aria-label"), w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) })),
    inputs: [...document.querySelectorAll("input")].map((i) => { const r = i.getBoundingClientRect(); return { q: i.name || i.id || i.placeholder, w: Math.round(r.width), h: Math.round(r.height) }; }),
    bottom: [...document.querySelectorAll(".bottomnav a")].map((a) => ({ t: a.innerText.trim().replace(/\s+/g, " "), h: a.getAttribute("href") })),
  })) });
  const mag = mp.locator('header button[aria-label*="搜索"], .topnav button[aria-label*="搜索"], button.searchbtn').first();
  const magCount = await mag.count();
  OUT({ magCount });
  if (magCount) {
    await mag.click();
    await mp.waitForTimeout(600);
    OUT({ afterMag: await mp.evaluate(() => ({
      bigInputs: [...document.querySelectorAll("input")].filter((i) => i.getBoundingClientRect().width > 80).length,
      focused: document.activeElement?.tagName + ":" + (document.activeElement?.getAttribute("placeholder") || ""),
      overlayText: (document.querySelector(".searchlayer, .search-overlay, .search-layer, [role=dialog]")?.innerText || "").replace(/\s+/g, " ").slice(0, 80),
      ovf: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    })) });
  }
  await mctx.close();
  await ctx.close();
});
