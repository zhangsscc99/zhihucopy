// profile-badge-hierarchy.mjs — Z1132 个人主页徽章与统计视觉分层（浏览器级断言）。
//
// 契约（双端 1440×900 与 390×844）：
//   ① 徽章容器 .profile__badges 与统计容器 .profile__stats 均存在，
//      且互不为祖先/后代；
//   ② 测真实可见文字节点：徽章文字 .profile__badge .medals__name
//      fontSize ≤ 12px 且比统计数值 .profile__stats dd 小 ≥2px，
//      文字颜色为灰色 rgb(133,144,166)；
//   ③ 新增小标题「成就」.profile__section-title：存在、fontSize ≤ 12px、
//      颜色灰、位于首枚徽章胶囊之前（compareDocumentPosition）；
//   ④ 徽章底→统计顶垂直间距 ≥16px（getBoundingClientRect）；
//   ⑤ 1440 下徽章行单行不折行；390 下允许折行但无横向溢出（容器级+页面级）；
//   ⑥ 每枚徽章 title 非空且 ≠ 可见文本（Z1123 不回退）；
//   ⑦ window.__errs 为空、document.body.innerText.length > 200。
//
// 页主选取：先 GET /users/27，若无徽章则用 assert lib 造一个带徽章的号
//   （自发 1 题 → first_question，另答 1 题被赞 1 次），owned 自清理；
//   两步都拿不到 → expect 给出「assert: 找不到带徽章的用户」，不吃 locator 超时。
//
// 反向自检：打未修的线上代码 FAIL——徽章文字颜色 #444 非灰（颜色断言先炸），
//   且无 .profile__section-title。容器退化取 .medals 让失败落在样式断言上。
//
// 跑法: API_BASE=http://127.0.0.1:3142/zhihucopy/api \
//       E2E_BASE=http://127.0.0.1:3142/zhihucopy \
//       node scripts/assert/profile-badge-hierarchy.mjs

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { API, expect, main, ok, register, req, uniq } from "./lib.mjs";

const BASE = (process.env.E2E_BASE || API.replace(/\/api$/, "")).replace(/\/+$/, "");
const SHOT_DIR = process.env.E2E_SHOT_DIR || "/root/logs";

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

// 找一个带徽章的页主：优先既有 uid 27；没有就自己造（产物走 owned 自清理）。
async function resolveBadgeUser() {
  const r = await req("GET", "/users/27");
  if (r.status === 200 && (r.data.badges || []).length >= 1) return 27;

  const target = await register(uniq("pbh-target"));
  const helper = await register(uniq("pbh-helper"));
  // first_question：自发 1 题
  await ok("POST", "/questions", {
    token: target.token,
    body: { title: `[assert] ${uniq("q")} 怎么做?`, detail_md: "" },
  });
  // 被赞 1 次：helper 发题，target 答，helper 点赞
  const { question: hq } = await ok("POST", "/questions", {
    token: helper.token,
    body: { title: `[assert] ${uniq("hq")}?`, detail_md: "" },
  });
  const { answer } = await ok("POST", `/questions/${hq.id}/answers`, {
    token: target.token,
    body: { content_md: "徽章层级断言用回答，内容足够长。" },
  });
  await ok("POST", "/votes", {
    token: helper.token,
    body: { target_type: "answer", target_id: answer.id, value: 1 },
  });

  const prof = await ok("GET", `/users/${target.user.id}`);
  expect(
    (prof.badges || []).length >= 1,
    "assert: 找不到带徽章的用户"
  );
  return target.user.id;
}

async function check(page, label, { singleLine }) {
  // 容器锁死新类名 .profile__badges；线上基线没有该类（仅 .medals），
  // 退化取 .medals 让后续字号/颜色/标题断言给出真正的 FAIL 原因。
  const containerSel = (await page.locator("main .profile__badges").count())
    ? ".profile__badges"
    : ".medals";
  await page.locator(`main ${containerSel}`).waitFor({ timeout: 20000 });
  await page.locator("main .profile__stats").waitFor({ timeout: 20000 });
  await page
    .waitForFunction(() => document.body.innerText.length > 200, null, {
      timeout: 10000,
    })
    .catch(() => {});

  const m = await page.evaluate((sel) => {
    const b = document.querySelector(`main ${sel}`);
    const s = document.querySelector("main .profile__stats");
    if (!b || !s) return { missing: true };
    const pills = [...b.querySelectorAll(".profile__badge, .medals__pill")];
    const pill = pills[0];
    // 真实可见文字节点：徽章名称 .medals__name（退化取 pill 自身）
    const nameEl = pill
      ? pill.querySelector(".medals__name") || pill
      : null;
    const ns = nameEl ? getComputedStyle(nameEl) : null;
    const dd = s.querySelector("dd");
    const ddFont = dd ? parseFloat(getComputedStyle(dd).fontSize) : -1;
    const titleEl = document.querySelector("main .profile__section-title");
    const list = b.querySelector(".medals") || b;
    const rb = b.getBoundingClientRect();
    const rs = s.getBoundingClientRect();
    return {
      missing: false,
      distinct: b !== s && !b.contains(s) && !s.contains(b),
      gap: rs.top - rb.bottom,
      nameFont: ns ? parseFloat(ns.fontSize) : -1,
      ddFont,
      nameColor: ns ? ns.color : "",
      titleExists: !!titleEl,
      titleFont: titleEl
        ? parseFloat(getComputedStyle(titleEl).fontSize)
        : -1,
      titleColor: titleEl ? getComputedStyle(titleEl).color : "",
      titleBeforePill:
        titleEl && pill
          ? !!(
              titleEl.compareDocumentPosition(pill) &
              Node.DOCUMENT_POSITION_FOLLOWING
            )
          : false,
      titleText: titleEl ? (titleEl.innerText || "").trim() : "",
      pillCount: pills.length,
      pillH: pill ? pill.offsetHeight : 0,
      pillTitles: pills.map((p) => ({
        title: p.getAttribute("title") || "",
        text: (p.innerText || "").trim(),
      })),
      listScrollH: list.scrollHeight,
      listOver: list.scrollWidth - list.clientWidth,
      pageOver:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      bodyLen: document.body.innerText.length,
      errs: window.__errs || [],
    };
  }, containerSel);

  expect(!m.missing, `${label}: 徽章容器或 .profile__stats 缺失`);

  // ① 容器互相独立
  expect(m.distinct, `${label}: 徽章容器与统计容器互为祖先/后代`);

  // ② 真实文字节点：徽章名字 ≤12px 且比统计数值 dd 小 ≥2px，颜色灰
  expect(
    m.nameFont > 0 && m.nameFont <= 12,
    `${label}: 徽章文字字号 ${m.nameFont}px > 12px`
  );
  expect(
    m.nameFont <= m.ddFont - 2,
    `${label}: 徽章文字 ${m.nameFont}px 未比统计数值 ${m.ddFont}px 小 ≥2px`
  );
  expect(
    m.nameColor === "rgb(133, 144, 166)",
    `${label}: 徽章文字颜色 ${m.nameColor} ≠ rgb(133, 144, 166)（#8590A6）`
  );

  // ③ 「成就」小标题：存在、≤12px、灰、在首枚徽章之前
  expect(m.titleExists, `${label}: 缺少 .profile__section-title「成就」标题`);
  expect(
    m.titleText === "成就",
    `${label}: .profile__section-title 文案 "${m.titleText}" ≠ 成就`
  );
  expect(
    m.titleFont > 0 && m.titleFont <= 12,
    `${label}: 「成就」标题字号 ${m.titleFont}px > 12px`
  );
  expect(
    m.titleColor === "rgb(133, 144, 166)",
    `${label}: 「成就」标题颜色 ${m.titleColor} ≠ rgb(133, 144, 166)`
  );
  expect(
    m.titleBeforePill,
    `${label}: 「成就」标题未出现在首枚徽章胶囊之前`
  );

  // ④ 垂直间距
  expect(m.gap >= 16, `${label}: 徽章底→统计顶间距 ${m.gap.toFixed(1)}px < 16px`);

  // ⑤ 折行与横向溢出
  if (singleLine) {
    expect(
      m.listScrollH <= m.pillH + 2,
      `${label}: 1440 徽章行折行 scrollHeight=${m.listScrollH} > 单行高 ${m.pillH}+2`
    );
  }
  expect(
    m.listOver === 0,
    `${label}: 徽章行横向溢出 scrollWidth-clientWidth=${m.listOver}`
  );
  expect(
    m.pageOver === 0,
    `${label}: 页面横向溢出 scrollWidth-clientWidth=${m.pageOver}`
  );

  // ⑥ title 全称保留（Z1123 不回退）
  expect(m.pillCount >= 1, `${label}: 徽章容器内无徽章`);
  for (const [i, p] of m.pillTitles.entries()) {
    expect(
      p.title.length > 0 && p.title !== p.text,
      `${label}: 徽章 #${i} title 缺失或等于缩写文本 "${p.text}"（title="${p.title}"）`
    );
  }

  // ⑦ 页面健康
  expect(
    m.errs.length === 0,
    `${label}: __errs 非空 ${m.errs.slice(0, 3).join(" | ")}`
  );
  expect(m.bodyLen > 200, `${label}: body 文本长度 ${m.bodyLen} ≤ 200`);
}

main("profile-badge-hierarchy", async () => {
  const uid = await resolveBadgeUser();

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
    await check(page, "1440", { singleLine: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await page.reload({ waitUntil: "domcontentloaded" });
    await check(page, "390", { singleLine: false });

    await ctx.close();
  } catch (e) {
    if (shotPage) {
      try {
        fs.mkdirSync(SHOT_DIR, { recursive: true });
        await shotPage.screenshot({
          path: path.join(
            SHOT_DIR,
            `assert-profile-badge-hierarchy-${Date.now()}.png`
          ),
          fullPage: true,
        });
      } catch {}
    }
    throw e;
  } finally {
    await browser.close();
  }
});
