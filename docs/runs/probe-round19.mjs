// probe-round19.mjs — 第十九轮巡检：主链路复验 + 本轮 4 组改动反向验证。
//   Z1061/62 顶栏 a11y（role=search 命名、用户菜单名去重）
//   Z1063/65 结果页空态「换个关键词」原地聚焦 + 移动 msearchbar focus-visible
//   Z1067/68/69 回复表单收尾：Esc、aria-expanded、失败留草稿、info toast、删除竞态
// 用法: E2E_BASE=https://openfolio.uk/zhihucopy node docs/runs/probe-round19.mjs
// 截图 /root/logs/e2e-review19-*.png；只记录事实，不因单步失败中断。
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const lib = await import("../../scripts/e2e/lib.mjs");
const { BASE, API, SHOT_DIR, register, launch, apiOk, api, uniq, trackSessionUsers } = lib;

const TOKEN_KEY = "zhihu_token";
const results = []; // {name, status: PASS|FAIL|WARN, detail, shot}
const ok = (n, d = "") => { results.push({ name: n, status: "PASS", detail: d }); console.log(`  [ok] ${n} ${d}`); };
const fail = (n, d = "", shot = "") => { results.push({ name: n, status: "FAIL", detail: d, shot }); console.log(`  [FAIL] ${n} ${d}`); };
const warn = (n, d = "") => { results.push({ name: n, status: "WARN", detail: d }); console.log(`  [warn] ${n} ${d}`); };
async function step(n, fn) {
  try { const d = await fn(); ok(n, d || ""); }
  catch (e) { fail(n, String(e.message || e).slice(0, 300)); }
}
let shotSeq = 0;
async function shot(page, tag) {
  const p = path.join(SHOT_DIR, `e2e-review19-${String(++shotSeq).padStart(2, "0")}-${tag}.png`);
  try { await page.screenshot({ path: p, fullPage: true }); return p; } catch { return null; }
}
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
const errs = async (page) => page.evaluate(() => window.__errs || ["<missing>"]).catch(() => ["<eval-fail>"]);
const bodyLen = async (page) => page.evaluate(() => document.body.innerText.length);
async function pageHealth(page, tag) {
  const [n, e] = [await bodyLen(page), await errs(page)];
  if (n < 200) { const s = await shot(page, `white-${tag}`); fail(`${tag}.body`, `innerText=${n}<200`, s || ""); }
  if (e.length) fail(`${tag}.errs`, JSON.stringify(e.slice(0, 5)));
  return { len: n, errs: e };
}
async function newCtxPage(browser, { width, height, token } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: "zh-CN" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(25000);
  if (token) await page.addInitScript(([k, t]) => localStorage.setItem(k, t), [TOKEN_KEY, token]);
  await injectErrs(page);
  return page;
}
// a11y: 读所有 role=search 元素的计算可访问名（用 aria-label / 标签推导近似）
const searchNames = (page) => page.evaluate(() =>
  [...document.querySelectorAll('[role="search"]')].map((el) => ({
    ariaLabel: el.getAttribute("aria-label"),
    cls: el.className,
  })));

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  console.log(`BASE=${BASE}`);
  const { token, user } = await register("巡检19");
  const { token: tokenB, user: userB } = await register("巡检19B");
  console.log(`users: A=${user.id} B=${userB.id}`);
  const browser = await launch();

  // ---------- 数据准备：A 的回答 + B 的评论（给通知用）；A 的两条评论（给竞态用） ----------
  const qd = await apiOk("GET", "/questions?tab=hot&limit=50");
  const qWith = qd.items.find((it) => it.answer_count > 0);
  const qdet = await apiOk("GET", `/questions/${qWith.id}`);
  const ans = qdet.answers[0];
  // 通知夹具：A 写一条回答，B 评论它（自建评论被 testCommentSql 隐藏，不能用作回复表单夹具）
  const myAns = (await apiOk("POST", `/questions/${qWith.id}/answers`, { token, body: { content_md: `巡检19占位回答 ${uniq()}，用于通知链路。` } })).answer;
  await apiOk("POST", "/comments", { token: tokenB, body: { target_type: "answer", target_id: myAns.id, body: `巡检19B 的通知评论 ${uniq()}` } });
  console.log(`fixture: q=${qWith.id} ans=${ans.id} myAns=${myAns.id}`);

  // ================= 桌面 1440×900 =================
  const page = await newCtxPage(browser, { width: 1440, height: 900, token });
  let forceFailComments = false;
  page.on("response", (r) => {
    if (r.status() >= 500 && !(forceFailComments && r.url().endsWith("/api/comments")))
      fail(`http.${r.url().split("/").pop()}`, `${r.status()} ${r.url()}`);
  });

  // ---- 1. 首页三 tab ----
  await step("desktop.home", async () => {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const cards = await page.locator(".feed__item").count();
    if (!cards) throw new Error("feed 0 卡片");
    return `cards=${cards} bodyLen=${await bodyLen(page)}`;
  });
  await pageHealth(page, "home");
  for (const t of ["推荐", "热榜"]) {
    await step(`desktop.home.tab.${t}`, async () => {
      await page.getByRole("tab", { name: t }).click().catch(async () => {
        await page.locator(`.feed-tabs button:has-text("${t}"), button:has-text("${t}")`).first().click();
      });
      await page.waitForTimeout(800);
      const cards = await page.locator(".feed__item").count();
      return `cards=${cards}`;
    });
  }
  await pageHealth(page, "home.tabs");

  // ---- 顶栏 a11y 反向验证 ----
  await step("desktop.a11y.searchlandmark", async () => {
    const names = await searchNames(page);
    const topnav = names.filter((n) => String(n.cls).includes("topnav__search"));
    if (!topnav.length) throw new Error(`无 topnav role=search: ${JSON.stringify(names)}`);
    if (!topnav[0].ariaLabel || !topnav[0].ariaLabel.includes("全站")) throw new Error(`顶栏 search 名=${topnav[0].ariaLabel}`);
    return JSON.stringify(topnav);
  });
  await step("desktop.a11y.usermenu", async () => {
    const r = await page.evaluate(() => {
      const btn = document.querySelector(".usermenu__trigger");
      if (!btn) return null;
      const avatar = btn.querySelector(".avatar");
      return {
        ariaLabel: btn.getAttribute("aria-label"),
        avatarHidden: avatar ? avatar.getAttribute("aria-hidden") : null,
        innerTexts: [...btn.querySelectorAll("*")].map((el) => ({ tag: el.tagName, hid: el.getAttribute("aria-hidden"), txt: (el.textContent || "").trim().slice(0, 20) })).slice(0, 8),
      };
    });
    if (!r) throw new Error("无 .usermenu__trigger");
    if (r.avatarHidden !== "true") throw new Error(`avatar aria-hidden=${r.avatarHidden}（昵称会被读两遍）`);
    return `name="${r.ariaLabel}" avatar aria-hidden=true`;
  });

  // ---- 2. 问题详情链路 ----
  await step("desktop.question.open", async () => {
    await page.goto(`${BASE}/question/${qWith.id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const t = await page.locator("h1").first().innerText();
    return `title="${t.trim().slice(0, 40)}" answers=${await page.locator(".answer").count()}`;
  });
  await pageHealth(page, "question");

  // 赞同/反对（用 A 自己的回答避免污染他人计数？—— 用夹具 ans，点完取消）
  await step("desktop.vote", async () => {
    const card = page.locator(".answer").first();
    const up = card.getByRole("button", { name: /赞同/ }).first();
    const before = (await up.innerText()).trim();
    await up.click(); await page.waitForTimeout(600);
    const mid = (await up.innerText()).trim();
    await up.click(); await page.waitForTimeout(600); // 取消还原
    const after = (await up.innerText()).trim();
    if (mid === before) throw new Error(`点赞同无变化 ${before}`);
    return `${before} -> ${mid} -> ${after}`;
  });
  await step("desktop.vote.down", async () => {
    const card = page.locator(".answer").first();
    const down = card.getByRole("button", { name: /反对/ }).first();
    await down.click(); await page.waitForTimeout(500);
    const cls = await down.getAttribute("class");
    await down.click(); await page.waitForTimeout(500);
    return `反对切换 class=${cls}`;
  });

  // ---- 评论：展开 → 回复 Esc/aria-expanded → 失败留草稿 → info toast ----
  let ansCard, c1, c2;
  await step("desktop.comments.expand", async () => {
    ansCard = page.locator(`.answer:has(#answer-${ans.id}), #answer-${ans.id}`).first();
    if (!(await ansCard.count())) ansCard = page.locator(".answer").first();
    await ansCard.scrollIntoViewIfNeeded();
    const btn = ansCard.getByRole("button", { name: /条评论|评论/ }).first();
    const label = (await btn.innerText()).trim();
    await btn.click(); await page.waitForTimeout(800);
    const list = await ansCard.locator(".answer__comment-list li").count();
    const m2 = label.match(/(\d+)/);
    if (m2 && Number(m2[1]) !== list) {
      fail("desktop.comments.count-vs-rows", `按钮="${label}" 但渲染 ${list} 行（comment_count 未过滤测试评论，列表过滤了）`);
    }
    // 取前两个带回复按钮的一级评论做夹具（自有测试评论被隐藏，用不了）
    const rbs = ansCard.locator('button[aria-controls^="reply-slot-"]');
    const n = await rbs.count();
    if (n < 2) throw new Error(`可回复评论不足 2 条: ${n}`);
    c1 = Number((await rbs.nth(0).getAttribute("aria-controls")).replace("reply-slot-", ""));
    c2 = Number((await rbs.nth(1).getAttribute("aria-controls")).replace("reply-slot-", ""));
    return `"${label}" -> ${list} 行, 夹具 c1=${c1} c2=${c2}`;
  });
  await step("desktop.reply.esc+aria", async () => {
    const replyBtn = ansCard.locator(`button[aria-controls="reply-slot-${c1}"]`);
    if (!(await replyBtn.count())) throw new Error(`找不到 c1=${c1} 的回复按钮`);
    const expBefore = await replyBtn.getAttribute("aria-expanded");
    await replyBtn.click(); await page.waitForTimeout(400);
    const form = ansCard.locator(`#reply-form-${c1}`);
    if (!(await form.count())) throw new Error("表单未打开");
    const expOpen = await replyBtn.getAttribute("aria-expanded");
    // 控件槽常驻：收起按钮 aria-controls 指向的元素即使空也在 DOM
    const slotOk = await ansCard.locator(`#reply-slot-${c1}`).count();
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    const closed = (await ansCard.locator(`#reply-form-${c1}`).count()) === 0;
    const expClosed = await replyBtn.getAttribute("aria-expanded");
    if (!closed) throw new Error("Esc 未关闭表单");
    if (expOpen !== "true" || expClosed !== "false") throw new Error(`aria-expanded ${expBefore}/${expOpen}/${expClosed}`);
    return `expanded ${expBefore}->${expOpen}->${expClosed}, slot常驻=${slotOk}, Esc 关闭 OK`;
  });
  await step("desktop.reply.fail-keeps-draft", async () => {
    // 拦截评论提交为 500，验证表单不关 + 草稿留 + role=alert
    await page.route("**/api/comments", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "e2e-forced" }) }));
    forceFailComments = true;
    try {
      const replyBtn = ansCard.locator(`button[aria-controls="reply-slot-${c1}"]`);
      await replyBtn.click(); await page.waitForTimeout(300);
      const ta = ansCard.locator(`#reply-form-${c1} textarea`);
      await ta.fill("这条回复注定失败");
      await ansCard.locator(`#reply-form-${c1} button:has-text("回复")`).first().click();
      await page.waitForTimeout(900);
      const alertTxt = (await ansCard.locator(`#reply-form-${c1} [role=alert]`).innerText().catch(() => "")).trim();
      const val = await ta.inputValue();
      const formOpen = (await ansCard.locator(`#reply-form-${c1}`).count()) === 1;
      if (!formOpen || val !== "这条回复注定失败") throw new Error(`表单open=${formOpen} draft="${val}"`);
      if (!alertTxt) throw new Error("失败后无 role=alert 错误提示");
      return `alert="${alertTxt}" 草稿保留`;
    } finally { await page.unroute("**/api/comments"); forceFailComments = false; }
  });
  await step("desktop.reply.switch-info-toast", async () => {
    // c1 表单里有草稿（上一步失败留下的）→ 切 c2 → 应出非红色 info toast
    const b2 = ansCard.locator(`button[aria-controls="reply-slot-${c2}"]`);
    if (!(await b2.count())) throw new Error("c2 回复按钮缺失");
    await b2.click(); await page.waitForTimeout(500);
    const toast = page.locator(".toast").last();
    const cls = (await toast.getAttribute("class").catch(() => "")) || "";
    const txt = (await toast.innerText().catch(() => "")).trim();
    const bg = await toast.evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => "");
    const color = await toast.evaluate((el) => getComputedStyle(el).color).catch(() => "");
    const onC2 = (await ansCard.locator(`#reply-form-${c2}`).count()) === 1;
    if (!onC2) throw new Error("表单未切到 c2");
    if (cls.includes("error")) throw new Error(`放弃草稿用了 error toast: ${cls}`);
    const s = await shot(page, "info-toast");
    return `toast="${txt}" class="${cls}" bg=${bg} color=${color} shot=${s}`;
  });
  await step("desktop.reply.collapse-discard", async () => {
    // resetReplyState 路径：c2 表单开着且有草稿 → 收起评论区 → 表单关 + info toast
    const ta = ansCard.locator(`#reply-form-${c2} textarea`);
    await ta.fill("收起时要被放弃的草稿");
    const toggle = ansCard.getByRole("button", { name: /收起评论|条评论/ }).first();
    await toggle.click(); await page.waitForTimeout(500);
    const formGone = (await ansCard.locator(`#reply-form-${c2}`).count()) === 0;
    const toast = page.locator(".toast").last();
    const cls = (await toast.getAttribute("class").catch(() => "")) || "";
    const txt = (await toast.innerText().catch(() => "")).trim();
    if (!formGone) throw new Error("收起评论后表单仍开着");
    if (!txt.includes("放弃")) warn("desktop.reply.collapse-discard.toast", `无放弃提示 toast="${txt}" class=${cls}`);
    return `表单关闭=${formGone} toast="${txt}" class="${cls}"`;
  });
  warn("desktop.reply.delete-race", "未验证：线上无法造出「可见且可删」的自有评论（测试账号评论被 testCommentSql 隐藏）；仅代码层确认 replyForRef 比对存在");
  // 重新展开评论区供后续/截图
  await ansCard.getByRole("button", { name: /条评论/ }).first().click().catch(() => {});
  await page.waitForTimeout(400);
  // 清理：关掉残留表单
  await page.keyboard.press("Escape");

  // 收藏 + 分享
  await step("desktop.collect+share", async () => {
    const card = page.locator(".answer").first();
    const fav = card.getByRole("button", { name: /收藏/ }).first();
    await fav.click(); await page.waitForTimeout(600);
    const favTxt = (await fav.innerText()).trim();
    const share = card.getByRole("button", { name: /分享/ }).first();
    await share.click(); await page.waitForTimeout(500);
    const toast = (await page.locator(".toast").last().innerText().catch(() => "")).trim();
    return `收藏="${favTxt}" 分享toast="${toast}"`;
  });

  // ---- 3. 搜索 ----
  await step("desktop.search.flow", async () => {
    const input = page.locator(".topnav__search input");
    await input.fill("职场");
    await input.press("Enter");
    await page.waitForURL(/[?&]q=/, { timeout: 10000 });
    await page.waitForTimeout(900);
    const names = await searchNames(page);
    const tabs = await page.locator('[role="tablist"] [role="tab"]').allTextContents();
    const items = await page.locator(".feed__item").count();
    return `tabs=${JSON.stringify(tabs.map((t) => t.trim()))} items=${items} searchNames=${JSON.stringify(names.map((n) => n.ariaLabel))}`;
  });
  for (const t of ["回答", "用户"]) {
    await step(`desktop.search.tab.${t}`, async () => {
      await page.locator('[role="tablist"]').getByRole("tab", { name: new RegExp(`^${t}`) }).click();
      await page.waitForTimeout(800);
      return `url=${new URL(page.url()).search} items=${await page.locator(".feed__item").count()}`;
    });
  }
  await step("desktop.search.tab.全部", async () => {
    const n = await page.locator('[role="tablist"]').getByRole("tab", { name: /^全部/ }).count();
    if (!n) return "不存在「全部」tab（仅 问题/回答/用户），「问题」tab 即全部口径";
    await page.locator('[role="tablist"]').getByRole("tab", { name: /^全部/ }).click();
    await page.waitForTimeout(800);
    return `items=${await page.locator(".feed__item").count()}`;
  });
  // 零结果 → 换个关键词
  await step("desktop.search.zero-refocus", async () => {
    const inline = page.locator(".msearchbar__input");
    await inline.fill("zz123456");
    await inline.press("Enter");
    await page.waitForTimeout(900);
    const empty = await page.locator(".empty").count();
    const btn = page.getByRole("button", { name: "换个关键词" }).first();
    if (!(await btn.count())) throw new Error("无「换个关键词」按钮");
    const s1 = await shot(page, "search-empty");
    await btn.click();
    await page.waitForTimeout(400);
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.className);
    const val = await inline.inputValue();
    const selAll = await inline.evaluate((el) => el.selectionStart === 0 && el.selectionEnd === el.value.length);
    const url = page.url();
    if (!String(focused).includes("msearchbar__input")) throw new Error(`焦点未回输入框 active=${focused}`);
    if (val !== "zz123456") throw new Error(`关键词未保留 val="${val}"`);
    if (!/q=zz123456/.test(url)) throw new Error(`URL 关键词丢失 ${url}`);
    return `焦点回框+全选=${selAll} val 保留 URL 保留 shot=${s1}`;
  });
  // answer/user tab 的「换个关键词」同样验证
  for (const [tab, scope] of [["回答", "answer"], ["用户", "user"]]) {
    await step(`desktop.search.zero-refocus.${scope}`, async () => {
      await page.locator('[role="tablist"]').getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
      await page.waitForTimeout(800);
      const btn = page.getByRole("button", { name: "换个关键词" }).first();
      if (!(await btn.count())) throw new Error("该 tab 无「换个关键词」");
      await btn.click(); await page.waitForTimeout(300);
      const focused = await page.evaluate(() => (document.activeElement || {}).className || "");
      const url = page.url();
      if (!String(focused).includes("msearchbar__input")) throw new Error(`active=${focused}`);
      if (!url.includes(`type=${scope}`)) throw new Error(`切焦点丢了 scope: ${url}`);
      return `focus OK, url=${new URL(url).search}`;
    });
  }
  await pageHealth(page, "search");

  // ---- 4. 通知 ----
  await step("desktop.notifications", async () => {
    const badge = await page.locator(".topnav__bell .badge").innerText().catch(() => null);
    await page.goto(`${BASE}/notifications`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const items = await page.locator(".ntf__item").count();
    const link = page.locator(".ntf__item .ntf__title").first();
    let anchor = "";
    if (await link.count()) {
      const href = await link.getAttribute("href");
      await link.click(); await page.waitForTimeout(1000);
      anchor = `href=${href} -> ${page.url().replace(BASE, "")} hash=${await page.evaluate(() => location.hash)}`;
    }
    const badgeAfter = await page.locator(".topnav__bell .badge").count();
    return `badge=${badge} items=${items} 点击跳转 ${anchor} badgeAfter=${badgeAfter}`;
  });
  await pageHealth(page, "notifications");

  // ---- 5. 个人页 ----
  await step("desktop.profile", async () => {
    await page.goto(`${BASE}/u/${user.id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    const tabs = await page.locator(".profile-tabs button, [role=tab]").allTextContents().catch(() => []);
    const items = await page.locator(".plist__item").count();
    return `tabs=${JSON.stringify(tabs.map((t) => t.trim()).slice(0, 6))} items=${items} len=${await bodyLen(page)}`;
  });
  await pageHealth(page, "profile");

  // ---- 6. 提问页 ----
  await step("desktop.ask", async () => {
    await page.goto(`${BASE}/ask`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const tin = page.locator(".topic-select__input");
    if (await tin.count()) { await tin.click(); await page.waitForTimeout(500); }
    const menu = await page.locator(".topic-select__menu").count();
    const opts = await page.locator(".topic-select__option").count();
    const s = await shot(page, "ask-topics");
    await page.keyboard.press("Escape");
    return `topic菜单=${menu} 选项=${opts} shot=${s}`;
  });
  await pageHealth(page, "ask");

  // ---- 7. 404 ----
  for (const p of ["/question/999999", "/u/999999", "/nonexistent"]) {
    await step(`desktop.404${p}`, async () => {
      await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(700);
      const len = await bodyLen(page);
      const e = await errs(page);
      const s = len < 200 ? await shot(page, `dead${p.replace(/\//g, "_")}`) : null;
      if (len < 200) throw new Error(`bodyLen=${len} shot=${s}`);
      return `len=${len} errs=${JSON.stringify(e.slice(0, 3))} text="${(await page.locator("main, body").first().innerText()).replace(/\s+/g, " ").slice(0, 80)}"`;
    });
  }

  await shot(page, "desktop-final");
  const deskErrs = await errs(page);
  if (deskErrs.length) fail("desktop.__errs.total", JSON.stringify(deskErrs.slice(0, 8)));

  // ================= 移动 390×844 =================
  const m = await newCtxPage(browser, { width: 390, height: 844, token });
  await step("mobile.home", async () => {
    await m.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await m.waitForTimeout(600);
    const sw = await m.evaluate(() => document.documentElement.scrollWidth);
    if (sw > 390) fail("mobile.hscroll", `scrollWidth=${sw}`);
    return `cards=${await m.locator(".feed__item").count()} scrollWidth=${sw}`;
  });
  await step("mobile.search.open+focusring", async () => {
    const btn = m.locator(".topnav__search-btn");
    if (!(await btn.count())) throw new Error("移动端无放大镜按钮");
    // 键盘 Tab 到按钮再 Enter，保证 :focus-visible 语义成立
    await btn.focus(); await m.keyboard.press("Enter");
    await m.waitForTimeout(500);
    const dialog = await m.locator('.msearch[role="dialog"]').count();
    const input = m.locator(".msearch__input");
    if (!(await input.count())) throw new Error("弹层输入框缺失");
    const unfocused = { border: "rgb(0,0,0)/transparent", bg: "var(--paper)", note: "弹层 autoFocus，无未聚焦基线" };
    const vis1 = await input.evaluate((el) => el.matches(":focus-visible"));
    const focused = await input.evaluate((el) => { const cs = getComputedStyle(el); return { border: cs.borderColor, bg: cs.backgroundColor, ow: cs.outlineWidth, os: cs.outlineStyle }; });
    if (vis1 && focused.os === "none") fail("mobile.msearch.focusring", `focus-visible 成立但 outline=none（unfocused=${JSON.stringify(unfocused)} focused=${JSON.stringify(focused)}）—— 焦点仅 1px 边色变化`);
    const names = await m.evaluate(() =>
      [...document.querySelectorAll('[role="search"]')].map((el) => ({ label: el.getAttribute("aria-label"), cls: el.className })));
    const s = await shot(m, "msearch-focus");
    return `dialog=${dialog} focus-visible=${vis1} focused=${JSON.stringify(focused)} names=${JSON.stringify(names)} shot=${s}`;
  });
  await step("mobile.search.submit+cancel", async () => {
    const input = m.locator(".msearch__input");
    await input.fill("职场");
    await input.press("Enter");
    await m.waitForURL(/[?&]q=/, { timeout: 10000 });
    await m.waitForTimeout(700);
    const sw = await m.evaluate(() => document.documentElement.scrollWidth);
    const barVisible = await m.locator(".msearchbar").count();
    if (sw > 390) fail("mobile.search.hscroll", `scrollWidth=${sw}`);
    return `msearchbar=${barVisible} sw=${sw}`;
  });
  await step("mobile.question+comments", async () => {
    await m.goto(`${BASE}/question/${qWith.id}`, { waitUntil: "networkidle" });
    await m.waitForTimeout(800);
    const sw = await m.evaluate(() => document.documentElement.scrollWidth);
    if (sw > 390) fail("mobile.question.hscroll", `scrollWidth=${sw}`);
    const card = m.locator(".answer").first();
    await card.scrollIntoViewIfNeeded();
    const cbtn = card.getByRole("button", { name: /条评论|评论/ }).first();
    await cbtn.click(); await m.waitForTimeout(700);
    return `sw=${sw} comments=${await card.locator(".answer__comment-list li").count()}`;
  });
  await pageHealth(m, "mobile");
  const mobErrs = await errs(m);
  if (mobErrs.length) fail("mobile.__errs.total", JSON.stringify(mobErrs.slice(0, 8)));
  await shot(m, "mobile-final");

  // ---- 汇总 ----
  await trackSessionUsers(browser);
  await browser.close();
  const fails = results.filter((r) => r.status === "FAIL");
  console.log("\n===== SUMMARY =====");
  for (const r of results) console.log(`${r.status.padEnd(4)} ${r.name} ${r.detail}`);
  console.log(`\n${results.length} steps, ${fails.length} FAIL, ${results.filter((r) => r.status === "WARN").length} WARN`);
  fs.writeFileSync(path.join(SHOT_DIR, "e2e-review19-results.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2));
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => { console.error(`FATAL ${e.stack || e}`); process.exit(1); });
