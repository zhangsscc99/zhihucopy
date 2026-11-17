// 第三十七轮补充探针 D：移动端放大镜为何点不动 / 点赞 aria-pressed
import { BASE, run } from "./lib.mjs";
const OUT = (o) => console.log(JSON.stringify(o));

run("probe-r37d", async ({ browser }) => {
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mp = await mctx.newPage();
  await mp.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await mp.waitForSelector(".feed__item", { timeout: 15000 });
  const info = await mp.evaluate(() => {
    const b = document.querySelector('button[aria-label="打开搜索"], button[aria-label*="搜索"]');
    if (!b) return { found: false };
    const r = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    return {
      found: true, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      pe: cs.pointerEvents, vis: cs.visibility, op: cs.opacity, disp: cs.display,
      disabled: b.disabled, cls: b.className, html: b.outerHTML.slice(0, 200),
      topEl: top ? { tag: top.tagName, cls: top.className, txt: (top.innerText || "").slice(0, 30) } : null,
      expanded: b.getAttribute("aria-expanded"),
    };
  });
  OUT({ mag: info });
  // 强制 JS 点击看是否打开
  const opened = await mp.evaluate(() => {
    const b = document.querySelector('button[aria-label="打开搜索"], button[aria-label*="搜索"]');
    b.click();
    return true;
  });
  await mp.waitForTimeout(700);
  OUT({ afterJsClick: await mp.evaluate(() => ({
    bigInputs: [...document.querySelectorAll("input")].filter((i) => i.getBoundingClientRect().width > 80).map((i) => ({ q: i.placeholder, w: Math.round(i.getBoundingClientRect().width) })),
    focused: document.activeElement?.tagName + ":" + (document.activeElement?.getAttribute("placeholder") || ""),
    overlay: (document.querySelector(".searchlayer, .search-overlay, .search-layer, .searchmodal, [role=dialog]")?.innerText || "").replace(/\s+/g, " ").slice(0, 100),
    ovf: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    bodyLen: document.body.innerText.length,
  })) });
  // 截图留证
  await mctx.close();

  // 点赞 aria-pressed
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const reg = await (await fetch(BASE.replace("/zhihucopy", "") + "/zhihucopy/api/auth/register", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `walk37d_${Date.now()}@example.com`, password: "Walk37pass!", nickname: "陆知微" + String(Date.now()).slice(-4) }),
  })).json();
  await ctx.addInitScript((t) => localStorage.setItem("zhihu_token", t), reg.token);
  const p = await ctx.newPage();
  await p.goto(BASE + "/question/6", { waitUntil: "domcontentloaded" });
  await p.waitForSelector(".answer", { timeout: 15000 });
  const b1 = await p.evaluate(() => { const b = document.querySelector(".answer__vote--up"); return { aria: b.getAttribute("aria-pressed"), cls: b.className, t: b.innerText.trim() }; });
  await p.locator(".answer__vote--up").first().click();
  await p.waitForTimeout(1200);
  const b2 = await p.evaluate(() => { const b = document.querySelector(".answer__vote--up"); const cs = getComputedStyle(b); return { aria: b.getAttribute("aria-pressed"), cls: b.className, t: b.innerText.trim(), color: cs.color, bg: cs.backgroundColor }; });
  OUT({ vote: { before: b1, after: b2 } });
  await p.locator(".answer__vote--up").first().click(); // 取消，别留副作用
  await ctx.close();
});
