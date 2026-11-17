// 第三十七轮补充探针：点赞态 / 搜索首屏 / 移动端搜索入口
import { BASE, API, launch, run, uniq } from "../e2e/lib.mjs";

const OUT = (o) => console.log(JSON.stringify(o));

run("probe-r37b", async ({ browser }) => {
  // --- 用 API 建号并拿 token ---
  const email = `walk37b_${Date.now()}@example.com`;
  const nick = "沈砚卿" + String(Date.now()).slice(-4);
  let reg;
  try {
    const r = await fetch(API + "/auth/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "Walk37pass!", nickname: nick }),
    });
    reg = await r.json();
  } catch (e) {
    OUT({ apiUrl: API, fetchErr: String(e), cause: String(e.cause || "") });
    throw e;
  }
  OUT({ reg: { id: reg.user?.id, nick } });
  const token = reg.token;

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => { localStorage.setItem("zhihu_token", t); }, token);
  const page = await ctx.newPage();
  const netlog = [];
  page.on("response", (r) => { if (/\/api\/(votes|follows|comments)/.test(r.url())) netlog.push({ u: r.url().replace(BASE, ""), s: r.status() }); });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));

  await page.goto(BASE + "/question/6", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".answer", { timeout: 15000 });
  await page.waitForTimeout(600);

  const before = await page.evaluate(() => {
    const a = document.querySelector(".answer");
    const btns = [...a.querySelectorAll("button")].filter((b) => /赞同|反对/.test(b.innerText));
    return { labels: btns.map((b) => b.innerText.trim().replace(/\s+/g, " ")), full: a.innerText.replace(/\s+/g, " ").slice(0, 60) };
  });
  OUT({ before });

  const t0 = Date.now();
  await page.locator(".answer").first().locator("button", { hasText: "赞同" }).first().click();
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => {
    const a = document.querySelector(".answer");
    const btns = [...a.querySelectorAll("button")].filter((b) => /赞同|反对/.test(b.innerText));
    return { labels: btns.map((b) => b.innerText.trim().replace(/\s+/g, " ")), cls: btns.map((b) => b.className), toast: (document.querySelector(".notify-stack, .toast-stack")?.innerText || "").replace(/\s+/g, " ") };
  });
  OUT({ likeClick: { ms: Date.now() - t0, after, net: netlog.slice(-3) } });

  // 再点一次（取消）看是否有两态
  await page.locator(".answer").first().locator("button", { hasText: "赞同" }).first().click();
  await page.waitForTimeout(1200);
  OUT({ unlike: await page.evaluate(() => [...document.querySelectorAll(".answer")][0].innerText.replace(/\s+/g, " ").slice(0, 40)) });

  // --- 搜索：直接导航 + 等待结果 ---
  const t1 = Date.now();
  await page.goto(BASE + "/search?q=" + encodeURIComponent("代码质量"), { waitUntil: "domcontentloaded" });
  let searchState = null;
  try {
    await page.waitForSelector(".feed__item", { timeout: 10000 });
    searchState = { ok: true, ms: Date.now() - t1 };
  } catch {
    searchState = { ok: false, ms: Date.now() - t1 };
  }
  OUT({ search: { ...searchState, ...(await page.evaluate(() => ({
    head: (document.body.innerText.match(/相关结果[^\n]*/) || [""])[0],
    items: document.querySelectorAll(".feed__item").length,
    tabs: [...document.querySelectorAll(".search__tabs button, .tabs button")].map((b) => b.innerText.trim()),
    hasTopic: /相关话题/.test(document.body.innerText),
  }))) } });

  // --- 搜索：从顶栏输入提交 ---
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".feed__item", { timeout: 15000 });
  const t2 = Date.now();
  await page.fill('input[type=search], input[name=q]', "代码质量");
  await page.keyboard.press("Enter");
  try { await page.waitForSelector(".feed__item", { timeout: 10000 }); } catch {}
  OUT({ searchFromNav: { ms: Date.now() - t2, url: page.url().replace(BASE, ""),
    items: await page.locator(".feed__item").count(),
    head: (await page.evaluate(() => (document.body.innerText.match(/相关结果[^\n]*/) || [""])[0])) } });

  // --- 移动端顶栏入口清点 ---
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mp = await mctx.newPage();
  await mp.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await mp.waitForSelector(".feed__item", { timeout: 15000 });
  OUT({ mobileNav: await mp.evaluate(() => ({
    topBtns: [...document.querySelectorAll("header button, .topnav button")].map((b) => ({ t: b.innerText.trim().replace(/\s+/g, " "), a: b.getAttribute("aria-label"), w: Math.round(b.getBoundingClientRect().width) })),
    inputs: [...document.querySelectorAll("input")].map((i) => ({ type: i.type, q: i.name || i.id, w: Math.round(i.getBoundingClientRect().width) })),
    bottom: [...document.querySelectorAll(".bottomnav a, nav a")].map((a) => a.innerText.trim().replace(/\s+/g, " ")),
    links: [...document.querySelectorAll("header a, .topnav a")].map((a) => a.innerText.trim().replace(/\s+/g, " ")).filter(Boolean),
  })) });
  // 点放大镜（若有）
  const mag = mp.locator('header button[aria-label*="搜索"], .topnav button[aria-label*="搜索"]').first();
  if (await mag.count()) {
    await mag.click();
    await mp.waitForTimeout(500);
    OUT({ mobileSearchOpen: await mp.evaluate(() => ({
      visibleInput: [...document.querySelectorAll("input")].filter((i) => i.getBoundingClientRect().width > 100).length,
      overlay: !!document.querySelector(".searchlayer, .search-overlay, [role=dialog]"),
      focused: document.activeElement?.tagName + "/" + (document.activeElement?.getAttribute("type") || ""),
    })) });
  } else OUT({ mobileSearchOpen: "no magnifier button" });
  await mctx.close();
  OUT({ errs });
  await ctx.close();
});
