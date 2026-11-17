// probe-round15.mjs — 第十五轮巡检固化探针：主链路 + Z1041 内嵌搜索框验收。
//
// 覆盖（真实浏览器，桌面 1366×900 + 移动 390×844）：
//   首页 → 问题详情 → 赞同/取消 → 评论展开/发布/删除 → 收藏 → 写回答 →
//   通知(B 评论 A 的回答→锚点落点) → 搜索 Z1041 五项 → 话题页 → 个人主页 →
//   等你来答 → 提问（话题菜单遮挡为已知缺陷，记 WARN，Escape 绕过）→
//   移动端搜索出入口（放大镜→弹层→内嵌框→取消回弹层）。
//
// 判定：硬断言失败 -> exit 1（页面回归/死路/白屏/__errs 非空）；
//       WARN 项（已知缺陷/可访问性缺口）只打印不影响退出码。
//
// Env: E2E_BASE（默认 http://127.0.0.1:3030/zhihucopy），E2E_API 可覆盖 API；
//      CHROME 覆盖浏览器路径；E2E_NO_CLEANUP=1 保留现场。
// 截图：失败现场 + 关键证据 -> /root/logs/e2e-probe15-*.png（E2E_SHOT_DIR 可覆盖）。

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import {
  BASE, API, SHOT_DIR, register, launch, apiOk, api, uniq, trackSessionUsers,
  expect,
} from "./lib.mjs";

const TOKEN_KEY = "zhihu_token";
const warnings = [];
const steps = [];
const ok = (name, extra = "") => { steps.push(`PASS ${name}${extra ? ` — ${extra}` : ""}`); console.log(`  [ok] ${name}${extra ? ` — ${extra}` : ""}`); };
const warn = (name, detail) => { warnings.push(`${name}: ${detail}`); console.log(`  [warn] ${name}: ${detail}`); };

function injectErrs(page) {
  return page.addInitScript(() => {
    const w = window;
    w.__errs = [];
    w.addEventListener("error", (e) => w.__errs.push(`error:${e.message}`));
    w.addEventListener("unhandledrejection", (e) =>
      w.__errs.push(`rejection:${e.reason && e.reason.message ? e.reason.message : e.reason}`));
    const orig = console.error;
    console.error = (...a) => { w.__errs.push(`console:${a.map(String).join(" ")}`); return orig.apply(console, a); };
  });
}
const errs = (p) => p.evaluate(() => window.__errs || []);
const bodyLen = (p) => p.evaluate(() => document.body.innerText.length);
const scrollW = (p) => p.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
const noErrs = async (p, tag) => {
  const e = await errs(p);
  expect(e.length === 0, `${tag}: __errs 非空 ${e.join(" | ")}`);
};
let shotSeq = 0;
async function shot(page, name) {
  const p = path.join(SHOT_DIR, `e2e-probe15-${String(++shotSeq).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: p, fullPage: true }).catch(() => null);
  return p;
}
async function authedPage(browser, token, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: "zh-CN" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  await injectErrs(page);
  await page.addInitScript(([k, t]) => localStorage.setItem(k, t), [TOKEN_KEY, token]);
  return page;
}
const upCount = async (loc) => {
  const t = (await loc.innerText()).trim();
  const m = t.match(/(\d+)/);
  return m ? Number(m[1]) : 0;
};

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const tag = Date.now().toString(36).slice(-4);
  // Z1088：通知过滤按残留昵称形态拦截，「巡检探针*」正是残留形态 —— 探针
  // 账号改用非残留昵称（仍是 @test.dev 测试号，自清理口径不变），否则 B 的
  // 评论通知会被当作残留挡掉、notification 步骤恒 FAIL。
  const A = await register(`r15探针${tag}`);
  const B = await register(`r15探针B${tag}`);
  console.log(`[probe15] ${BASE}  A=u${A.user.id}  B=u${B.user.id}`);
  const browser = await launch();
  let shotPage = null;
  try {
    const page = await authedPage(browser, A.token, 1366, 900);
    shotPage = page;
    const QID = 6;

    // ---- 1. 首页 ----
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    expect((await page.locator(".feed__item").count()) >= 10, `首页卡片过少: ${await page.locator(".feed__item").count()}`);
    expect((await bodyLen(page)) > 1500, `首页 bodyLen 过小`);
    await noErrs(page, "home");
    ok("home", `cards=${await page.locator(".feed__item").count()}`);

    // ---- 2. 问题详情 ----
    const qBefore = await apiOk("GET", `/questions/${QID}`);
    await page.goto(`${BASE}/question/${QID}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    expect((await page.locator(".answerlist > li").count()) > 0, "详情页无回答列表");
    expect((await bodyLen(page)) > 1200, "详情页 bodyLen 过小");
    await noErrs(page, "question");
    ok("question", `answers=${await page.locator(".answerlist > li").count()}`);

    // ---- 3. 赞同/取消（±1 且刷新保持） ----
    const up0 = await upCount(page.locator(".answerlist > li").first().locator(".answer__vote--up"));
    await page.locator(".answerlist > li").first().locator(".answer__vote--up").click();
    await page.waitForTimeout(900);
    const up1 = await upCount(page.locator(".answerlist > li").first().locator(".answer__vote--up"));
    expect(up1 === up0 + 1, `赞同未 +1: ${up0}->${up1}`);
    await page.locator(".answerlist > li").first().locator(".answer__vote--up").click();
    await page.waitForTimeout(900);
    const up2 = await upCount(page.locator(".answerlist > li").first().locator(".answer__vote--up"));
    expect(up2 === up0, `取消赞同未还原: ${up0}->${up2}`);
    await noErrs(page, "vote");
    ok("vote", `${up0}->${up1}->${up2}`);

    // ---- 4. 评论：展开/发布/删除，计数回写 ----
    const ans1 = page.locator(".answerlist > li").first();
    const cBtn = () => ans1.locator(".answer__action", { hasText: "评论" }).first();
    await cBtn().click();
    await page.waitForTimeout(800);
    const cNum = async () => Number(((await cBtn().innerText()).match(/\d+/) || [0])[0]);
    const declared = await cNum();
    const rows0 = await ans1.locator(".answer__comment").count();
    const placeholders0 = await ans1.locator(".answer__comment", { hasText: "该评论已删除" }).count();
    expect(rows0 - placeholders0 === declared, `评论计数与可见行数不一致: 声明${declared} 可见${rows0 - placeholders0}（渲染${rows0}，占位${placeholders0}）`);
    await ans1.locator(".answer__comment-form textarea").fill(`巡检探针评论 ${uniq("c")}，稍后自删。`);
    await ans1.locator(".answer__comment-actions button").click();
    await page.waitForTimeout(1400);
    const rows1 = await ans1.locator(".answer__comment").count();
    expect(rows1 === rows0 + 1, `发布评论未回写: ${rows0}->${rows1}`);
    const declared1 = await cNum();
    expect(declared1 === declared + 1, `发布后按钮计数未 +1: 声明${declared}->${declared1}`);
    const mine = page.locator(".answer__comment", { hasText: "巡检探针评论" }).first();
    await mine.locator("button", { hasText: "删除" }).click();
    await page.waitForTimeout(500);
    const confirmBtn = mine.locator("button", { hasText: "确认" }).first();
    if (await confirmBtn.count()) await confirmBtn.click();
    await page.waitForTimeout(1200);
    const rows2 = await ans1.locator(".answer__comment").count();
    expect(rows2 === rows0, `删除评论未回写: ${rows1}->${rows2}（期望回 ${rows0}）`);
    await noErrs(page, "comment");
    ok("comment", `rows ${rows0}->${rows1}->${rows2}`);

    // ---- 5. 收藏：建夹→已收藏→刷新保持→取消 ----
    const ans2 = page.locator(".answerlist > li").nth(1);
    const favBtn = () => ans2.locator(".answer__fav > button").first();
    await favBtn().click();
    await page.waitForTimeout(800);
    const favMenu = ans2.locator(".answer__fav-menu");
    expect(await favMenu.isVisible(), "收藏面板未弹出");
    await favMenu.locator(".answer__fav-input").fill(`巡检夹${tag}`);
    await favMenu.locator(".answer__fav-create").click();
    await page.waitForTimeout(1100);
    expect(/已收藏/.test(await favBtn().innerText()), "收藏后按钮未变「已收藏」");
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    expect(/已收藏/.test(await page.locator(".answerlist > li").nth(1).locator(".answer__fav > button").first().innerText()), "刷新后收藏态丢失");
    await page.locator(".answerlist > li").nth(1).locator(".answer__fav > button").first().click();
    await page.waitForTimeout(900);
    expect(/收藏/.test(await page.locator(".answerlist > li").nth(1).locator(".answer__fav > button").first().innerText()) && !/已收藏/.test(await page.locator(".answerlist > li").nth(1).locator(".answer__fav > button").first().innerText()), "取消收藏未还原");
    await noErrs(page, "collect");
    ok("collect", "建夹→已收藏→刷新保持→取消");

    // ---- 6. 写回答 ----
    const acBefore = (await apiOk("GET", `/questions/${QID}`)).question.answer_count;
    await page.locator(".answer-editor textarea").fill(`巡检探针回答 ${uniq("a")}：分三步看——界定边界、建立反馈、小步迭代。（自动清理）`);
    await page.getByRole("button", { name: "发布回答" }).click();
    await page.waitForTimeout(1800);
    const acAfter = (await apiOk("GET", `/questions/${QID}`)).question.answer_count;
    expect(acAfter === acBefore + 1, `回答数未 +1: ${acBefore}->${acAfter}`);
    const qDetail = await apiOk("GET", `/questions/${QID}`);
    const myAns = qDetail.answers.find((a) => a.author?.id === A.user.id);
    expect(!!myAns, "新回答未在详情返回");
    await noErrs(page, "answer");
    ok("answer", `answer_count ${acBefore}->${acAfter}, my=a${myAns.id}`);

    // ---- 7. 通知：B 评论 A 的回答 → 铃铛角标 → 行 → 锚点落点 ----
    const cr = await api("POST", "/comments", { token: B.token, body: { target_type: "answer", target_id: myAns.id, body: `巡检探针通知验证 ${uniq("n")}` } });
    expect(cr.status === 201, `B 评论失败: ${cr.status}`);
    await page.goto(`${BASE}/notifications`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    const nrow = page.locator(".ntf__item", { hasText: B.user.nickname }).first();
    expect(await nrow.count(), "通知列表无 B 的评论通知");
    await nrow.locator("a.ntf__title").click();
    await page.waitForTimeout(1400);
    const landHash = await page.evaluate(() => location.hash);
    expect(/^#answer-\d+$/.test(landHash), `落点无 #answer- 锚: ${landHash}`);
    const inView = await page.evaluate((id) => { const el = document.getElementById(id); if (!el) return false; const r = el.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; }, landHash.slice(1));
    expect(inView, `锚点元素不在视口: ${landHash}`);
    await noErrs(page, "notification");
    ok("notification", `land=${page.url().replace(BASE, "")}`);

    // ---- 8. 搜索 Z1041 五项 ----
    const KW1 = "代码", KW2 = "职场", ZERO = `zzq${tag}`;
    // 8.1 内嵌框可见+预填+改词同步
    await page.goto(`${BASE}/search?q=${encodeURIComponent(KW1)}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".msearchbar input", { timeout: 8000 });
    const input = page.locator('.msearchbar input[type="search"]').first();
    expect(await input.inputValue() === KW1, "内嵌框未预填 q");
    await input.fill(KW2);
    await input.press("Enter");
    await page.waitForFunction((w) => new URL(location.href).searchParams.get("q") === w, KW2, { timeout: 8000 });
    await page.waitForTimeout(900);
    expect(/职场/.test(await page.locator(".search-head__title").innerText()), "结果标题未跟新词");
    expect((await bodyLen(page)) > 400, "改词后页面过空");
    await noErrs(page, "search-change");
    ok("search.inline", "可见+预填+改词同步");
    // 8.2 type=answer 换词保留 tab
    await page.goto(`${BASE}/search?q=${encodeURIComponent(KW1)}&type=answer`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".msearchbar input", { timeout: 8000 });
    await page.locator('.msearchbar input[type="search"]').fill(KW2);
    await page.locator('.msearchbar input[type="search"]').press("Enter");
    await page.waitForFunction(() => new URL(location.href).searchParams.get("type") === "answer" && new URL(location.href).searchParams.get("q") === "职场", null, { timeout: 8000 });
    expect((await page.locator('.stabs [role="tab"]:has-text("回答")').getAttribute("aria-selected")) === "true", "换词后「回答」tab 失选");
    ok("search.scope-keep", "type=answer 保留");
    // 8.3 换个关键词：URL 不变 + 聚焦 + 全选
    await page.goto(`${BASE}/search?q=${encodeURIComponent(ZERO)}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('button:has-text("换个关键词")', { timeout: 9000 });
    const urlBefore = page.url();
    await page.locator('button:has-text("换个关键词")').first().click();
    await page.waitForTimeout(400);
    const ref = await page.evaluate(() => {
      const el = document.querySelector('.msearchbar input[type="search"]');
      return { url: location.href, focused: document.activeElement === el, sel0: el?.selectionStart, sel1: el?.selectionEnd, len: el?.value?.length };
    });
    expect(ref.url === urlBefore, `换个关键词改了 URL: ${ref.url}`);
    expect(ref.focused && ref.sel0 === 0 && ref.sel1 === ref.len && ref.len > 0, `未聚焦+全选: ${JSON.stringify(ref)}`);
    ok("search.refocus", "URL 不变+焦点+全选");
    // 8.4 取消搜索：首页+顶栏焦点
    await page.locator('.search-head__exit').first().click();
    await page.waitForFunction(() => !location.pathname.endsWith("/search"), null, { timeout: 8000 });
    await page.waitForTimeout(400);
    const land = await page.evaluate(() => { const ae = document.activeElement; return { url: location.href, isTopnav: !!(ae && ae.matches('.topnav__search input')) }; });
    expect(!land.url.includes("q="), `取消后 URL 带 q: ${land.url}`);
    expect(land.isTopnav, "落地焦点不在顶栏搜索框");
    expect((await bodyLen(page)) > 1500, "取消回首页内容过少");
    ok("search.exit", "回首页+顶栏焦点");
    // 8.5 键盘可达：Tab 到「换个关键词」→ Enter → 输入框聚焦全选
    await page.goto(`${BASE}/search?q=${encodeURIComponent(ZERO)}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('button:has-text("换个关键词")', { timeout: 9000 });
    let khit = false;
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      const t = await page.evaluate(() => document.activeElement?.textContent || "");
      if (/换个关键词/.test(t)) { khit = true; break; }
    }
    expect(khit, "Tab 无法到达「换个关键词」");
    const focusOutline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineWidth);
    expect(focusOutline !== "0px", "焦点 outline 为 0（无可见焦点提示）");
    await shot(page, "kbd-focus-evidence");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    const kfocus = await page.evaluate(() => document.activeElement === document.querySelector('.msearchbar input[type="search"]'));
    expect(kfocus, "键盘 Enter 换个关键词后焦点未进内嵌框");
    ok("search.keyboard", "Tab+Enter 可达，焦点可见");
    // 8.6 role=search 并存检查（WARN）
    const landmarks = await page.evaluate(() =>
      [...document.querySelectorAll('[role="search"]')].filter((f) => f.offsetWidth || f.offsetHeight)
        .map((f) => ({ cls: f.className, label: f.getAttribute("aria-label") })));
    const unnamed = landmarks.filter((l) => !l.label);
    if (landmarks.length > 1 && unnamed.length) {
      warn("a11y.search-landmark", `页面 ${landmarks.length} 个可见 search 界标，${unnamed.length} 个无 aria-label（${unnamed.map((u) => u.cls).join(",")}）`);
    }
    // 8.7 回退/前进 输入框重同步
    await page.goto(`${BASE}/search?q=${encodeURIComponent(KW1)}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".msearchbar input", { timeout: 8000 });
    await page.locator('.msearchbar input[type="search"]').fill(KW2);
    await page.locator('.msearchbar input[type="search"]').press("Enter");
    await page.waitForTimeout(1100);
    await page.goBack(); await page.waitForTimeout(1100);
    expect((await page.locator('.msearchbar input[type="search"]').inputValue()) === KW1, "后退后内嵌框未回到旧词");
    await page.goForward(); await page.waitForTimeout(1100);
    expect((await page.locator('.msearchbar input[type="search"]').inputValue()) === KW2, "前进后内嵌框未回到新词");
    await noErrs(page, "search-nav");
    ok("search.nav", "回退/前进输入框随 URL 重同步");

    // ---- 9. 话题页 ----
    await page.goto(`${BASE}/topics`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const tlink = page.locator("a[href*='/topic/']").first();
    expect(await tlink.count(), "话题页无话题链接");
    await tlink.click();
    await page.waitForTimeout(1200);
    expect((await page.locator(".feed__item").count()) > 0, "话题详情无问题列表");
    expect((await bodyLen(page)) > 800, "话题详情 bodyLen 过小");
    await noErrs(page, "topic");
    ok("topics", `items=${await page.locator(".feed__item").count()}`);

    // ---- 10. 个人主页（自己/他人） ----
    await page.goto(`${BASE}/u/${A.user.id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    expect((await bodyLen(page)) > 300, "自己主页 bodyLen 过小");
    await page.goto(`${BASE}/u/2`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    expect((await page.locator(".plist__item").count()) > 0, "他人主页无内容列表");
    await noErrs(page, "profile");
    ok("profiles", "自己+他人均可达");

    // ---- 11. 等你来答（空态 CTA 或列表非空） ----
    await page.goto(`${BASE}/unanswered`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const unaItems = await page.locator(".feed__item").count();
    if (unaItems === 0) {
      expect(await page.locator('a[href="/ask"], a:has-text("去提问")').count() > 0, "等你来答空态且无出口");
      ok("unanswered", "空态+去提问 CTA");
    } else ok("unanswered", `items=${unaItems}`);

    // ---- 12. 提问（已知遮挡 WARN + Escape 绕过） ----
    await page.goto(`${BASE}/ask`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    await page.locator(".ask input").first().fill(`巡检探针问题 ${tag}：巡检提问链路验证？`);
    await page.locator(".ask textarea").first().fill("巡检探针提问内容，自动清理。");
    const tIn = page.locator(".topic-select__input");
    await tIn.fill("编程");
    await page.waitForTimeout(800);
    await tIn.press("Enter");
    await page.waitForTimeout(500);
    const overlay = await page.evaluate(() => {
      const menu = document.querySelector(".topic-select__menu");
      const btn = [...document.querySelectorAll(".form-actions button")].find((b) => /发布问题/.test(b.textContent));
      if (!menu || !btn) return { covered: false };
      const r = btn.getBoundingClientRect();
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { covered: !!(at && at.closest(".topic-select__menu")), opts: menu.querySelectorAll(".topic-select__option").length };
    });
    if (overlay.covered) {
      warn("ask.topic-overlay", `选完话题后菜单不收（${overlay.opts} 项），hit-test 盖住「发布问题」`);
      await shot(page, "ask-overlay");
      await tIn.press("Escape");
      await page.waitForTimeout(300);
    }
    await page.getByRole("button", { name: /发布问题/ }).click();
    await page.waitForTimeout(2000);
    expect(/\/question\/\d+/.test(page.url()), `提问未落地详情页: ${page.url()}`);
    await noErrs(page, "ask");
    ok("ask", `land=${page.url().replace(BASE, "")}`);

    // ---- 13. 移动端搜索出入口 ----
    const mp = await authedPage(browser, A.token, 390, 844);
    shotPage = mp;
    await mp.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await mp.waitForTimeout(600);
    expect((await scrollW(mp)) <= 390, `首页横向溢出 sw=${await scrollW(mp)}`);
    await mp.locator(".topnav__search-btn").click();
    await mp.waitForTimeout(600);
    expect(await mp.locator(".msearch").isVisible(), "放大镜未开搜索弹层");
    await mp.locator(".msearch__input").fill("代码");
    await mp.locator(".msearch__input").press("Enter");
    await mp.waitForTimeout(1300);
    expect(await mp.locator(".msearchbar").isVisible(), "移动结果页无 .msearchbar");
    expect((await mp.locator('.msearchbar input[type="search"]').inputValue()) === "代码", "移动内嵌框未预填");
    expect((await scrollW(mp)) <= 390, `结果页横向溢出 sw=${await scrollW(mp)}`);
    // 移动端取消搜索 → 弹层+输入框焦点
    await mp.locator('.search-head__exit').first().click();
    await mp.waitForTimeout(900);
    const mexit = await mp.evaluate(() => { const ae = document.activeElement; return { url: location.href, dlg: !!document.querySelector(".msearch"), inDlg: !!(ae && ae.closest(".msearch")) }; });
    expect(!mexit.url.includes("q="), `移动取消后 URL 带 q`);
    expect(mexit.dlg && mexit.inDlg, `移动取消后未回到搜索弹层输入框: ${JSON.stringify(mexit)}`);
    await noErrs(mp, "mobile");
    ok("mobile.search", "放大镜→弹层→内嵌框→取消回弹层");

    await trackSessionUsers(browser);
    await browser.close();
    console.log(`\n[PROBE15] PASS ${steps.length} 步, ${warnings.length} 条 WARN — ${BASE}`);
    for (const w of warnings) console.log(`  WARN ${w}`);
    process.exit(0);
  } catch (e) {
    try {
      if (shotPage) console.error(`[PROBE15] screenshot: ${await shot(shotPage, "fail")}`);
    } catch {}
    try { await trackSessionUsers(browser); await browser.close(); } catch {}
    console.error(`[PROBE15] FAIL — ${e.message || e}`);
    process.exit(1);
  }
}
main().catch((e) => { console.error("[PROBE15] FATAL", e); process.exit(1); });
