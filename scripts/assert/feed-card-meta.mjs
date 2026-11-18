#!/usr/bin/env node
// feed-card-meta.mjs — Z1163 信息流卡元信息行补「N 人关注」（浏览器级）。
//
// 契约：
//   1) 1440×900 首页 ≥18 张 .feed__item 的 .feed__meta 文案含「人关注」，
//      且数字与 GET /questions 同题 follower_count 一致（抽样 5 张双口径）；
//   2) 卡片仍是纯信息：每张 .feed__item 内新增 button 数为 0（不加交互）；
//   3) 热榜 tab（?tab=hot）保留排名块与「热度」，且同样有「人关注」；
//   4) 390×844：.feed__follows 计算 display 为 none、.feed__follows-short 可见，
//      元信息行仍单行（各项 y 相同），无横向溢出；
//   5) window.__errs 为空；
//   6) 反向自检：未修基线（无「人关注」文案）必须 FAIL —— 在第 1 条折。
//
// Env: E2E_BASE / E2E_API / API_BASE / CHROME。
const apiBaseEnv = (process.env.API_BASE || "").replace(/\/+$/, "");
const derivedBase = apiBaseEnv.replace(/\/api$/, "");
process.env.E2E_BASE =
  process.env.E2E_BASE || derivedBase || "http://127.0.0.1:3030/zhihucopy";
process.env.E2E_API =
  process.env.E2E_API || apiBaseEnv || `${process.env.E2E_BASE}/api`;

const { run, expect, BASE, apiOk } = await import("../e2e/lib.mjs");

const ERR_HOOK = () => {
  window.__errs = [];
  const push = (m) => {
    try {
      window.__errs.push(String(m && m.message ? m.message : m));
    } catch {}
  };
  window.addEventListener("error", (e) => push(e.message || e.error));
  window.addEventListener("unhandledrejection", (e) => push(e.reason));
  const orig = console.error.bind(console);
  console.error = (...a) => {
    push(a.map((x) => String(x)).join(" "));
    orig(...a);
  };
};

const num = (s) => {
  const m = String(s || "").match(/(\d+)\s*人关注/);
  return m ? Number(m[1]) : null;
};

run("feed-card-meta", async ({ browser }) => {
  // ---- 1/2/4: 桌面信息流 ----
  const desk = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
  });
  const page = await desk.newPage();
  page.setDefaultTimeout(15000);
  await page.addInitScript(ERR_HOOK);
  try {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.waitForSelector(".feed__item", { timeout: 15000 });

    const cards = await page.$$eval(".feed__item", (els) =>
      els.map((el) => ({
        id: el.querySelector('a[href*="/question/"]')?.getAttribute("href") || "",
        meta: el.querySelector(".feed__meta")?.innerText || "",
        buttons: el.querySelectorAll("button").length,
      }))
    );
    expect(cards.length >= 20, `首页卡片数 ${cards.length} < 20`);
    const withFollows = cards.filter((c) => /人关注/.test(c.meta));
    expect(
      withFollows.length >= 18,
      `含「人关注」的卡片 ${withFollows.length}/20 < 18 —— 元信息行未生效`
    );
    const withButtons = cards.filter((c) => c.buttons > 0);
    expect(
      withButtons.length === 0,
      `卡片内出现 button（应保持纯信息行）：${withButtons.length} 张`
    );

    // 双口径抽样 5 张：接口 follower_count 与页面数字一致
    const api = await apiOk("GET", "/questions?limit=50");
    const byId = new Map((api.items || []).map((q) => [String(q.id), q]));
    let checked = 0;
    for (const c of withFollows.slice(0, 5)) {
      const id = String(c.id).match(/question\/(\d+)/)?.[1];
      const q = id ? byId.get(id) : null;
      if (!q || typeof q.follower_count !== "number") continue;
      const shown = num(c.meta);
      expect(
        shown === q.follower_count,
        `q${id} 页面「${shown} 人关注」与接口 follower_count=${q.follower_count} 不一致`
      );
      checked++;
    }
    expect(checked >= 3, `双口径抽样只比对到 ${checked} 张（<3）`);

    // ---- 3: 热榜 tab ----
    await page.goto(`${BASE}/?tab=hot`, { waitUntil: "networkidle" });
    await page.waitForSelector(".feed__item", { timeout: 15000 });
    const hot = await page.evaluate(() => {
      const items = [...document.querySelectorAll(".feed__item")];
      return {
        n: items.length,
        withRank: items.filter((el) => el.querySelector('[class*="rank"]')).length,
        withHeat: items.filter((el) => /热度/.test(el.innerText)).length,
        withFollows: items.filter((el) => /人关注/.test(el.querySelector(".feed__meta")?.innerText || "")).length,
      };
    });
    expect(hot.n > 0, "热榜列表为空");
    expect(hot.withRank >= hot.n - 1, `热榜排名块缺失：${hot.withRank}/${hot.n}`);
    expect(hot.withHeat >= hot.n - 1, `热榜「热度」缺失：${hot.withHeat}/${hot.n}`);
    expect(hot.withFollows >= hot.n - 2, `热榜卡片缺「人关注」：${hot.withFollows}/${hot.n}`);

    const errs = await page.evaluate(() => window.__errs || []);
    expect(errs.length === 0, `桌面 __errs 非空: ${errs.join(" | ")}`);
  } finally {
    await desk.close();
  }

  // ---- 4: 390×844 紧凑文案 ----
  const mob = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "zh-CN",
    isMobile: true,
    hasTouch: true,
  });
  const mp = await mob.newPage();
  mp.setDefaultTimeout(15000);
  await mp.addInitScript(ERR_HOOK);
  try {
    await mp.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await mp.waitForSelector(".feed__item", { timeout: 15000 });
    const info = await mp.evaluate(() => {
      const card = document.querySelector(".feed__item");
      const long = card.querySelector(".feed__follows");
      const short = card.querySelector(".feed__follows-short");
      const meta = card.querySelector(".feed__meta");
      const ys = [...meta.children]
        .filter((el) => el.getBoundingClientRect().height > 0)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return Math.round(r.y + r.height / 2);
        });
      return {
        longShown: long ? getComputedStyle(long).display !== "none" : true,
        shortShown: short ? getComputedStyle(short).display !== "none" : false,
        shortText: short ? short.innerText.trim() : "",
        ys,
        metaH: Math.round(meta.getBoundingClientRect().height),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    expect(!info.longShown, "390：长文案「N 人关注」应隐藏");
    expect(info.shortShown, "390：紧凑文案「N 关注」应可见");
    expect(/^\d+\s*关注$/.test(info.shortText), `390：紧凑文案形态异常「${info.shortText}」`);
    expect(
      Math.max(...info.ys) - Math.min(...info.ys) <= 4 && info.metaH <= 30,
      `390：元信息行换行了（centers=${info.ys.join(",")} 高=${info.metaH}）`
    );
    expect(info.overflow === 0, `390：横向溢出 ${info.overflow}px`);
    const merrs = await mp.evaluate(() => window.__errs || []);
    expect(merrs.length === 0, `390 __errs 非空: ${merrs.join(" | ")}`);
  } finally {
    await mob.close();
  }
});
