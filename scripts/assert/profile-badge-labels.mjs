// profile-badge-labels.mjs — Z1123 个人主页徽章语义不明（浏览器级断言）。
//
// 契约：
//   1. /u/:id 头部徽章 .profile__badges [class*=badge] 每个节点：
//      - title 非空且 length >= 6（完整中文说明，不是缩写）；
//      - 可见文本 ∈ 徽章全称白名单（收获 10 赞 / 首个粉丝 / 首个回答 /
//        首个提问 / 发布 5 个回答），不许出现缩写；
//   2. main 文本不再出现「首答」「首问」「十赞」「被看见」四个缩写词；
//   3. 徽章容器与统计容器是不同的 DOM 节点，且徽章底边到统计顶边间距 >= 12px；
//   4. window.__errs 为空、无横向溢出，1440 与 390 各验一次。
//
// 种子形态：经 API 造一个拿满 5 枚徽章的页主——
//   自己发 1 题（first_question）、答 5 题（first_answer + answer_5）、
//   10 个号给其中一答点赞（upvote_10）、1 个号关注（first_follower）。
// 所有产物走 owned 自清理。
//
// 反向自检：打未修的线上代码 FAIL——服务端不返回 label/title，
// 前端回落到缩写 name（首答/首问/十赞/被看见），白名单断言全灭。
//
// Env: API_BASE（默认 http://127.0.0.1:3030/zhihucopy/api）
//      E2E_BASE 覆盖页面地址（默认 API_BASE 去掉 /api）
//      CHROME 可覆盖浏览器路径；截图失败现场到 /root/logs。

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { API, expect, main, ok, register, uniq } from "./lib.mjs";

const BASE = (process.env.E2E_BASE || API.replace(/\/api$/, "")).replace(/\/+$/, "");
const SHOT_DIR = process.env.E2E_SHOT_DIR || "/root/logs";
const TOKEN_KEY = "zhihu_token";

// 徽章全称白名单：与 server/badges.js 的 label 一一对应，写死防回归。
const LABEL_WHITELIST = ["收获 10 赞", "首个粉丝", "首个回答", "首个提问", "发布 5 个回答"];
// 四个被点名淘汰的缩写词。
const BANNED_WORDS = ["首答", "首问", "十赞", "被看见"];

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

async function checkBadges(page, label) {
  // 容器锁死新类名 .profile__badges；线上基线没有该类（仅 .medals），
  // 此时退化取 .medals 让后续「缩写词/白名单」断言给出真正的 FAIL 原因，
  // 而不是一句 locator timeout。
  const containerSel = (await page.locator("main .profile__badges").count())
    ? ".profile__badges"
    : ".medals";
  await page.locator(`main ${containerSel}`).waitFor({ timeout: 20000 });

  const pills = page.locator(`main ${containerSel} [class*=badge], main ${containerSel} .medals__pill`);
  const n = await pills.count();
  expect(n >= 1, `${label}: 徽章行没有徽章节点`);
  for (let i = 0; i < n; i++) {
    const el = pills.nth(i);
    const title = (await el.getAttribute("title")) || "";
    expect(title.length >= 6, `${label}: 徽章 #${i} title 过短/缺失 "${title}"`);
    const text = (await el.innerText()).trim();
    expect(
      LABEL_WHITELIST.includes(text),
      `${label}: 徽章 #${i} 文案 "${text}" 不在全称白名单 ${LABEL_WHITELIST.join("/")}`
    );
  }

  const headText = await page.locator("main").innerText();
  for (const w of BANNED_WORDS) {
    expect(!headText.includes(w), `${label}: main 文本仍含缩写「${w}」`);
  }

  // 徽章容器与统计容器是不同节点，且纵向间距 >= 12px（徽章 ≠ 统计）。
  const { distinct, gap } = await page.evaluate((sel) => {
    const b = document.querySelector(`main ${sel}`);
    const s = document.querySelector("main .profile__stats");
    if (!b || !s) return { distinct: false, gap: -1 };
    const rb = b.getBoundingClientRect();
    const rs = s.getBoundingClientRect();
    return {
      distinct:
        b !== s &&
        !(b.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_CONTAINED_BY) &&
        !(b.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_CONTAINS),
      gap: rs.top - rb.bottom,
    };
  }, containerSel);
  expect(distinct, `${label}: 徽章容器与统计容器不是独立 DOM 节点`);
  expect(gap >= 12, `${label}: 徽章底边到统计顶边间距 ${gap.toFixed(1)}px < 12px`);

  const errs = await page.evaluate(() => window.__errs || []);
  expect(
    errs.length === 0,
    `${label}: __errs 非空 ${errs.slice(0, 3).join(" | ")}`
  );
  const over = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  );
  expect(over === 0, `${label}: 横向溢出 scrollWidth-clientWidth=${over}`);
}

main("profile-badge-labels", async () => {
  // ---------- 种子：拿满 5 枚徽章的页主 ----------
  const target = await register(uniq("pbl-target"));
  // 提问限速 3 题/5min/人：5 道问题摊给两个 helper 发。
  const helpers = [await register(uniq("pbl-helper")), await register(uniq("pbl-helper"))];
  const uid = target.user.id;

  // first_question
  await ok("POST", "/questions", {
    token: target.token,
    body: { title: `[assert] ${uniq("q")} 怎么做?`, detail_md: "" },
  });
  // first_answer + answer_5：helper 们发 5 题，target 各答 1 个
  const answerIds = [];
  for (let i = 0; i < 5; i++) {
    const { question } = await ok("POST", "/questions", {
      token: helpers[i % helpers.length].token,
      body: { title: `[assert] ${uniq("hq")}?`, detail_md: "" },
    });
    const { answer } = await ok("POST", `/questions/${question.id}/answers`, {
      token: target.token,
      body: { content_md: `徽章断言用回答 ${i + 1}，内容足够长。` },
    });
    answerIds.push(answer.id);
  }
  // upvote_10：10 个号给第一答点赞
  for (let i = 0; i < 10; i++) {
    const voter = await register(uniq("pbl-voter"));
    await ok("POST", "/votes", {
      token: voter.token,
      body: { target_type: "answer", target_id: answerIds[0], value: 1 },
    });
  }
  // first_follower
  await ok("POST", `/users/${uid}/follow`, { token: helpers[0].token });

  const profile = await ok("GET", `/users/${uid}`);
  const codes = (profile.badges || []).map((b) => b.code).sort();
  for (const c of ["first_question", "first_answer", "answer_5", "upvote_10", "first_follower"]) {
    expect(codes.includes(c), `种子失败：页主缺徽章 ${c}（现有 ${codes.join(",")}）`);
  }

  // ---------- 浏览器级：1440 / 390 ----------
  const browser = await chromium.launch({
    executablePath: chromePath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  let shotPage = null;
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
    });
    await ctx.addInitScript(ERR_HOOK);
    const page = await ctx.newPage();
    shotPage = page;
    page.setDefaultTimeout(15000);
    await page.goto(`${BASE}/u/${uid}`, { waitUntil: "domcontentloaded" });
    await checkBadges(page, "1440");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await page.reload({ waitUntil: "domcontentloaded" });
    await checkBadges(page, "390");
    await ctx.close();
  } catch (e) {
    if (shotPage) {
      try {
        fs.mkdirSync(SHOT_DIR, { recursive: true });
        await shotPage.screenshot({
          path: path.join(SHOT_DIR, `assert-profile-badge-labels-${Date.now()}.png`),
          fullPage: true,
        });
      } catch {}
    }
    throw e;
  } finally {
    await browser.close();
  }
});
