#!/usr/bin/env node
// Z1150 — 赞同/反对按钮必须带状态文案：已投时「已赞同 N」/「已反对」，
// 未投时「赞同 N」/「反对」；不能只靠颜色区分。
// 断言（/question/6，登录态 1440）：
//   1) 点「赞同」→ innerText 含「已赞同」、aria-pressed=true、计数 +1；
//   2) 再点 → 文本回到 ^赞同（不含「已」）、计数 -1；
//   3) 点赞后刷新页面，按钮仍含「已赞同」（服务端态回放）；
//   4) 未登录新 context 下按钮文本不含「已赞同」；
//   5) 390 视口下无横向溢出（scrollWidth-clientWidth=0）、window.__errs 为空。
// finally 里把该账号对本回答的票收回（POST /votes value=0）。
import { run, expect, BASE, api, register, authedPage, TOKEN_KEY } from "../e2e/lib.mjs";

const QID = 6;
const num = (s) => {
  const m = String(s || "").match(/\d+/);
  return m ? Number(m[0]) : null;
};

async function watchErrs(page) {
  await page.addInitScript(() => {
    window.__errs = [];
    window.addEventListener("error", (e) => window.__errs.push(String(e.message || e)));
    window.addEventListener("unhandledrejection", (e) => window.__errs.push(String(e.reason)));
    const ce = console.error.bind(console);
    console.error = (...a) => {
      window.__errs.push(a.map(String).join(" "));
      ce(...a);
    };
  });
}

const upBtn = (page) =>
  page.locator(".answer").first().locator(".answer__vote--up");

async function waitText(page, re, timeout = 8000) {
  // playwright expect 不在依赖里，用手动轮询
  const t0 = Date.now();
  for (;;) {
    const t = await upBtn(page).innerText();
    if (re.test(t)) return t;
    if (Date.now() - t0 > timeout) throw new Error(`waitText ${re} timeout, last="${t}"`);
    await page.waitForTimeout(200);
  }
}

run("vote-label-state", async ({ browser }) => {
  const { token } = await register();
  let answerId = null;
  try {
    // ---- 1440 登录态 ----
    const page = await authedPage(browser, token);
    await page.setViewportSize({ width: 1440, height: 900 });
    await watchErrs(page);
    await page.goto(`${BASE}/question/${QID}`);
    await page.locator(".answer .answer__vote--up").first().waitFor();

    const first = page.locator(".answer").first();
    answerId = Number((await first.getAttribute("id") || "").replace(/\D+/g, ""));
    expect(answerId > 0, "cannot resolve answer id from li#answer-N");

    const t0 = await upBtn(page).innerText();
    expect(/^赞同/.test(t0) && !t0.includes("已赞同"), `初始文本应为「赞同 N」，实际 "${t0}"`);
    const c0 = num(t0);

    // 1) 点赞 → 已赞同 + 计数 +1 + aria-pressed
    await upBtn(page).click();
    const t1 = await waitText(page, /已赞同/);
    expect(await upBtn(page).getAttribute("aria-pressed") === "true", "点赞后 aria-pressed 应为 true");
    const c1 = num(t1);
    expect(c0 === null || c1 === c0 + 1, `计数应 +1：${c0} -> ${c1}`);

    // 2) 再点 → 回到「赞同 N」、计数 -1
    await upBtn(page).click();
    const t2 = await waitText(page, /^赞同/);
    expect(!t2.includes("已赞同"), `取消后不应含「已赞同」："${t2}"`);
    const c2 = num(t2);
    expect(c0 === null || c2 === c0, `计数应回落：${c0} -> ${c2}`);

    // 3) 再点赞 → 刷新 → 仍是「已赞同」
    await upBtn(page).click();
    await waitText(page, /已赞同/);
    await page.reload();
    await page.locator(".answer .answer__vote--up").first().waitFor();
    // /votes/mine 异步回填，等「已赞同」出现再断言
    const t3 = await waitText(page, /已赞同/);
    expect(t3.includes("已赞同"), `刷新后应仍是「已赞同」，实际 "${t3}"`);
    expect(await upBtn(page).getAttribute("aria-pressed") === "true", "刷新后 aria-pressed 应为 true");

    const errs = await page.evaluate(() => window.__errs || []);
    expect(errs.length === 0, `window.__errs 非空: ${errs.join(" | ")}`);
    await page.close();

    // ---- 未登录态 ----
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
    const anon = await ctx2.newPage();
    await watchErrs(anon);
    await anon.goto(`${BASE}/question/${QID}`);
    await anon.locator(".answer .answer__vote--up").first().waitFor();
    const ta = await anon.locator(".answer").first().locator(".answer__vote--up").innerText();
    expect(!ta.includes("已赞同"), `未登录不应出现「已赞同」："${ta}"`);
    await ctx2.close();

    // ---- 390 视口 ----
    const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-CN" });
    const mp = await ctx3.newPage();
    await mp.addInitScript(([k, t]) => localStorage.setItem(k, t), [TOKEN_KEY, token]);
    await watchErrs(mp);
    await mp.goto(`${BASE}/question/${QID}`);
    await mp.locator(".answer .answer__vote--up").first().waitFor();
    await mp.waitForTimeout(400);
    const ovf = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(ovf === 0, `390 横向溢出 scrollWidth-clientWidth=${ovf}`);
    const rowFit = await mp.evaluate(() => {
      const row = document.querySelector(".answer .answer__actions");
      return row ? row.scrollWidth - row.clientWidth : 0;
    });
    expect(rowFit <= 0, `.answer__actions 行内溢出 ${rowFit}px`);
    const box = await mp.locator(".answer").first().locator(".answer__vote--up").boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390, `赞同按钮越界: ${JSON.stringify(box)}`);
    const merrs = await mp.evaluate(() => window.__errs || []);
    expect(merrs.length === 0, `390 window.__errs 非空: ${merrs.join(" | ")}`);
    await ctx3.close();
  } finally {
    if (answerId) {
      await api("POST", "/votes", {
        token,
        body: { target_type: "answer", target_id: answerId, value: 0 },
      }).catch(() => {});
      // 兜底：若上面未清掉（如答案 id 解析错），按服务端态再清一次
      const mine = await api("GET", `/votes/mine?target_type=answer&target_id=${answerId}`, { token }).catch(() => null);
      if (mine && mine.data && mine.data.vote) {
        await api("POST", "/votes", {
          token,
          body: { target_type: "answer", target_id: answerId, value: 0 },
        }).catch(() => {});
      }
    }
  }
});
