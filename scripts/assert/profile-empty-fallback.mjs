// profile-empty-fallback.mjs — Z1111 作者主页空落点补厚度（浏览器级断言）。
//
// 契约：
//   A) 「回答数 = 0 且有关注/赞同行为」的用户 /u/:id：
//      1. main a[href*="/question/"] ≥ 3（空态下方渲染可点的轨迹内容）；
//      2. 「还没有回答」不得与列表并存：若该文案出现，同页问题链接数必须为 0；
//      3. window.__errs 为空、body.innerText.length > 300；
//      4. 无横向溢出（documentElement.scrollWidth - clientWidth === 0），
//         桌面 1440 与移动 390 各验一次；
//      5. 未登录与登录访问同一页表现一致（公开数据）：两边问题链接数相同。
//   B) 有回答的用户主页不变：回答列表 .plist__item ≥ 1，且无 .phl 补块。
//
// 目标用户选择：按 CANDIDATES（prod 库快照里「0 回答但有关注/赞同」的种子
// 用户，首选 214 = 走查原始落点）扫 /users/:id —— stats.answers===0 再打
// /users/:id/highlights 验证有轨迹。接口 404（基线无此接口）仍当选：让页面
// 断言产出 FAIL 证据。全部不命中时回落 fixture：注册测试号，自己关注 2 个
// 问题 + 赞同 2 条回答，测后由 finally 清掉自己的 follow/vote 记录（注册号
// 走 owned 自清理）。
//
// 反向自检：同脚本打基线（无 /highlights 接口、无补块渲染的实例）必须 FAIL
// —— CANDIDATES 首个 0 回答用户当选后 anon 段 qLinks=0 < 3 即 FAIL。
//
// Env: API_BASE（默认 http://127.0.0.1:3030/zhihucopy/api）
//      E2E_BASE 覆盖页面地址（默认 API_BASE 去掉 /api）
//      CHROME 可覆盖浏览器路径；截图失败现场到 /root/logs。

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { API, expect, main, req, ok, register, uniq } from "./lib.mjs";

const BASE = (process.env.E2E_BASE || API.replace(/\/api$/, "")).replace(/\/+$/, "");
const SHOT_DIR = process.env.E2E_SHOT_DIR || "/root/logs";
const TOKEN_KEY = "zhihu_token";

let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  const req2 = createRequire(new URL("../e2e/lib.mjs", import.meta.url));
  ({ chromium } = req2("playwright-core"));
}

function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = "/root/.cache/ms-playwright";
  for (const d of fs
    .readdirSync(root)
    .filter((d) => d.startsWith("chromium-"))
    .sort()
    .reverse()) {
    const p = path.join(root, d, "chrome-linux", "chrome");
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`no chromium under ${root}`);
}

const ERR_HOOK = `(() => {
  window.__errs = [];
  window.addEventListener("error", (e) => window.__errs.push("error: " + e.message));
  window.addEventListener("unhandledrejection", (e) => window.__errs.push("rejection: " + e.reason));
  const orig = console.error;
  console.error = function (...args) {
    window.__errs.push("console.error: " + args.join(" "));
    return orig.apply(console, args);
  };
})()`;

// prod 库快照（Z1111 走查时取）：回答数 0 但有关注问题/赞同回答轨迹的用户。
const CANDIDATES = [
  214, 52, 61, 62, 75, 94, 110, 116, 117, 118, 119, 121, 122, 125, 127, 128,
  130, 131, 132, 133, 134,
];

function hlCount(hl) {
  return (hl.followed_questions || []).length + (hl.upvoted_answers || []).length;
}

// 字段契约校验（仅接口存在时）：问题条目与列表条目兼容、snippet ≤ 60。
function checkHlShape(id, hl) {
  for (const q of hl.followed_questions || []) {
    expect(
      Number.isInteger(q.id) && typeof q.title === "string" &&
        Number.isInteger(q.answer_count) && Array.isArray(q.topics),
      `/users/${id}/highlights 关注问题字段不符：${JSON.stringify(q).slice(0, 160)}`
    );
  }
  for (const a of hl.upvoted_answers || []) {
    expect(
      Number.isInteger(a.answer_id) && Number.isInteger(a.question_id) &&
        typeof a.question_title === "string" &&
        typeof a.snippet === "string" && a.snippet.length <= 60 &&
        a.author && typeof a.author.nickname === "string",
      `/users/${id}/highlights 赞同条目字段不符：${JSON.stringify(a).slice(0, 160)}`
    );
  }
}

async function findTarget() {
  for (const id of CANDIDATES) {
    const u = await req("GET", `/users/${id}`);
    if (u.status !== 200 || (u.data?.stats?.answers ?? -1) !== 0) continue;
    const h = await req("GET", `/users/${id}/highlights?limit=5`);
    if (h.status === 200) {
      checkHlShape(id, h.data);
      if (hlCount(h.data) > 0) return { id, hl: h.data, fixture: null };
      continue; // 接口在但该用户轨迹被滤空，换下一个
    }
    if (h.status === 404) {
      // 接口缺失（基线）：仍当选，页面断言给出 FAIL 证据。
      return { id, hl: null, fixture: null };
    }
  }
  return null;
}

// 无候选时造 fixture：新注册测试号（0 回答）自己关注 2 个问题 + 赞同 2 条
// 回答。返回清理句柄，finally 里把自己的 follow/vote 记录撤回。
async function makeFixture() {
  const me = await register(uniq("assert"));
  const list = await ok("GET", "/questions?limit=30");
  const items = (list.items || []).filter((q) => Number.isInteger(q.id));
  expect(items.length >= 2, "题库问题不足，无法造 fixture");

  const followed = [];
  for (const q of items.slice(0, 2)) {
    const r = await req("POST", `/questions/${q.id}/follow`, { token: me.token });
    expect(r.status < 300, `fixture follow q${q.id} -> ${r.status}`);
    followed.push(q.id);
  }

  const voted = [];
  for (const q of items) {
    if (voted.length >= 2) break;
    if (!(q.answer_count > 0)) continue;
    const d = await ok("GET", `/questions/${q.id}`);
    for (const a of (d.answers || []).slice(0, 2 - voted.length)) {
      const r = await req("POST", "/votes", {
        token: me.token,
        body: { target_type: "answer", target_id: a.id, value: 1 },
      });
      expect(r.status < 300, `fixture vote a${a.id} -> ${r.status}`);
      voted.push(a.id);
    }
  }
  expect(
    followed.length + voted.length >= 3,
    `fixture 轨迹不足 3 条（follow=${followed.length} vote=${voted.length}）`
  );

  const cleanup = async () => {
    for (const qid of followed)
      await req("DELETE", `/questions/${qid}/follow`, { token: me.token });
    for (const aid of voted)
      await req("POST", "/votes", {
        token: me.token,
        body: { target_type: "answer", target_id: aid, value: 0 },
      });
  };
  return { id: me.user.id, token: me.token, cleanup };
}

// 等内容区落定：回答列表 / 空态 / 补块 三选一出现。
async function waitProfileSettled(page, uid) {
  await page.goto(`${BASE}/u/${uid}`, { waitUntil: "domcontentloaded" });
  await page.locator("main .profile__stats").waitFor({ timeout: 20000 });
  await page.waitForSelector(
    "main .profile__content .plist__item, main .profile__content .empty, main .profile__content .phl__sec",
    { timeout: 20000 }
  );
}

async function checkEmptyProfile(page, uid, label, hl) {
  await waitProfileSettled(page, uid);
  const qLinks = await page.locator('main a[href*="/question/"]').count();
  const bodyText = await page.evaluate(() => document.body.innerText);
  const hasEmptyCopy = bodyText.includes("还没有回答");
  expect(
    !(hasEmptyCopy && qLinks > 0),
    `${label}: 「还没有回答」与 ${qLinks} 条问题链接并存`
  );
  expect(
    qLinks >= 3,
    `${label}: main a[href*="/question/"] = ${qLinks}，要求 ≥3（无补内容块）`
  );
  if (hl) {
    if ((hl.followed_questions || []).length > 0)
      await page.locator(".phl__sec", { hasText: "TA 最近关注的问题" }).waitFor();
    if ((hl.upvoted_answers || []).length > 0)
      await page.locator(".phl__sec", { hasText: "TA 最近赞同的回答" }).waitFor();
  }
  expect(
    bodyText.length > 300,
    `${label}: body.innerText=${bodyText.length} ≤ 300`
  );
  const errs = await page.evaluate(() => window.__errs || []);
  expect(
    errs.length === 0,
    `${label}: __errs 非空 ${errs.slice(0, 3).join(" | ")}`
  );
  const gap = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  );
  expect(gap === 0, `${label}: 横向溢出 scrollWidth-clientWidth=${gap}`);
  return qLinks;
}

main("profile-empty-fallback", async () => {
  let target = await findTarget();
  let fixture = null;
  if (!target) {
    fixture = await makeFixture();
    const h = await ok("GET", `/users/${fixture.id}/highlights?limit=5`);
    checkHlShape(fixture.id, h);
    expect(hlCount(h) >= 3, `fixture 用户 ${fixture.id} highlights 不足 3 条`);
    target = { id: fixture.id, hl: h, fixture };
  }
  const uid = target.id;

  const browser = await chromium.launch({
    executablePath: chromePath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  let shotPage = null;
  try {
    // ---------- A1) 未登录，桌面 1440 ----------
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
    });
    await ctx.addInitScript(ERR_HOOK);
    const page = await ctx.newPage();
    shotPage = page;
    page.setDefaultTimeout(15000);
    const anonLinks = await checkEmptyProfile(page, uid, "anon1440", target.hl);

    // ---------- A4) 同页切 390 复验 ----------
    await page.setViewportSize({ width: 390, height: 844 });
    const mLinks = await checkEmptyProfile(page, uid, "anon390", target.hl);
    expect(mLinks >= 3, `anon390: 问题链接 ${mLinks} < 3`);

    // ---------- A5) 登录访问表现一致 ----------
    const viewer = await register(uniq("assert"));
    const ctx2 = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
    });
    await ctx2.addInitScript(ERR_HOOK);
    await ctx2.addInitScript(
      ([k, t]) => localStorage.setItem(k, t),
      [TOKEN_KEY, fixture ? fixture.token : viewer.token]
    );
    const apage = await ctx2.newPage();
    shotPage = apage;
    apage.setDefaultTimeout(15000);
    const authLinks = await checkEmptyProfile(
      apage,
      uid,
      "authed1440",
      target.hl
    );
    expect(
      authLinks === anonLinks,
      `登录(${authLinks}) 与未登录(${anonLinks}) 问题链接数不一致`
    );
    await ctx2.close();

    // ---------- B) 有回答用户主页不变 ----------
    let richId = null;
    for (const id of [3, 1, 2, 4, 5]) {
      const u = await req("GET", `/users/${id}`);
      if (u.status === 200 && (u.data?.stats?.answers ?? 0) >= 1) {
        richId = id;
        break;
      }
    }
    expect(richId !== null, "找不到有回答的用户做回归点");
    await waitProfileSettled(page, richId);
    const items = await page
      .locator("main .profile__content .plist__item")
      .count();
    expect(items >= 1, `用户 ${richId} 回答列表条目 ${items} < 1`);
    const phl = await page.locator("main .phl__sec").count();
    expect(phl === 0, `有回答主页多出 highlights 块（${phl} 节）`);
    const errsB = await page.evaluate(() => window.__errs || []);
    expect(errsB.length === 0, `rich: __errs 非空 ${errsB.slice(0, 3).join(" | ")}`);

    await ctx.close();
  } catch (e) {
    if (shotPage) {
      try {
        fs.mkdirSync(SHOT_DIR, { recursive: true });
        const p = path.join(
          SHOT_DIR,
          `profile-empty-fallback-${Date.now()}.png`
        );
        await shotPage.screenshot({ path: p, fullPage: true });
        console.error(`[profile-empty-fallback] screenshot: ${p}`);
      } catch {}
    }
    throw e;
  } finally {
    await browser.close();
    if (fixture) await fixture.cleanup();
  }
});
