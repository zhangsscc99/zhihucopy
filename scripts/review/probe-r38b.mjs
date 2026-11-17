// 第三十八轮补充探针：评论语料/相关问题相关性/移动端导航
import { BASE, run } from "../e2e/lib.mjs";
const OUT = (o) => console.log(JSON.stringify(o));

run("probe-r38b", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  for (const qid of [6, 1, 2]) {
    await page.goto(`${BASE}/question/${qid}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".answer", { timeout: 20000 });
    await page.waitForTimeout(800);
    // 展开所有评论
    const toggles = await page.locator("text=/\\d+ 条评论/").all();
    for (const t of toggles.slice(0, 3)) { try { await t.click({ timeout: 2500 }); } catch {} }
    await page.waitForTimeout(1200);
    const data = await page.evaluate(() => {
      const cls = new Set();
      document.querySelectorAll("[class*=comment]").forEach((e) => cls.add(e.className));
      const texts = [...document.querySelectorAll("[class*=comment]")].map((e) => e.innerText.replace(/\s+/g, " ").trim()).filter((t) => t.length > 4 && t.length < 200);
      return { classes: [...cls].slice(0, 12), texts: [...new Set(texts)].slice(0, 14) };
    });
    OUT({ qid, classes: data.classes, commentTexts: data.texts });
  }

  // 相关问题相关性：抓相关问题区块
  await page.goto(`${BASE}/question/6`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".answer", { timeout: 20000 });
  await page.waitForTimeout(1200);
  OUT({ related: await page.evaluate(() => {
    const heads = [...document.querySelectorAll("h2,h3,.section__title,div")].filter((n) => (n.innerText || "").trim().startsWith("相关问题"));
    if (!heads.length) return { found: false };
    const sec = heads[heads.length - 1].closest("section,div");
    return { found: true, items: [...sec.querySelectorAll("a[href*='/question/']")].map((a) => a.innerText.replace(/\s+/g, " ").slice(0, 60)) };
  }) });

  // 移动端导航重复项 / aria-current
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mp = await mctx.newPage();
  await mp.goto(BASE + "/?tab=hot", { waitUntil: "domcontentloaded" });
  await mp.waitForTimeout(1500);
  OUT({ mobile: await mp.evaluate(() => {
    const navs = [...document.querySelectorAll("nav")];
    return navs.map((n) => ({
      cls: n.className,
      display: getComputedStyle(n).display,
      box: [Math.round(n.getBoundingClientRect().width), Math.round(n.getBoundingClientRect().height)],
      items: [...n.querySelectorAll("a,button")].map((a) => ({
        t: a.innerText.trim(),
        cur: a.getAttribute("aria-current"),
        href: a.getAttribute("href"),
      })),
    }));
  }) });
  await mctx.close();
  await ctx.close();
});
