// profile-badge-hierarchy.mjs — Z1132 个人主页徽章与统计视觉分层（浏览器级断言）。
//
// 契约（页面 /u/27，双端 1440×900 与 390×844）：
//   ① 徽章容器 .profile__badges 与统计容器 .profile__stats 均存在，
//      且互不为祖先/后代；
//   ② 徽章胶囊 fontSize 比统计行小 ≥2px；徽章颜色为灰色 rgb(133,144,166)；
//   ③ 两容器垂直间距 ≥16px（getBoundingClientRect）；
//   ④ 1440 下徽章行单行不折行（scrollHeight <= 单行高 + 2）；
//      390 下允许折行但 scrollWidth - clientWidth === 0（容器级 + 页面级）；
//   ⑤ 每枚徽章 title 非空且 ≠ 可见文本（Z1123 不回退）；
//   ⑥ window.__errs 为空、document.body.innerText.length > 200。
//
// 反向自检：打未修的线上代码 FAIL——徽章与统计同色（#444），
// 且徽章容器类名缺失/结构不满足分层契约。
//
// 跑法: API_BASE=http://127.0.0.1:3142/zhihucopy/api \
//       E2E_BASE=http://127.0.0.1:3142/zhihucopy \
//       node scripts/assert/profile-badge-hierarchy.mjs
const API_ENV = (process.env.API_BASE || "").replace(/\/+$/, "");
const BASE = (
  process.env.E2E_BASE ||
  API_ENV.replace(/\/api$/, "") ||
  "http://127.0.0.1:3030/zhihucopy"
).replace(/\/+$/, "");
process.env.E2E_BASE ||= BASE;

const { run, expect } = await import("../e2e/lib.mjs");

const UID = process.env.PROFILE_UID || 27;

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

async function check(page, label, { singleLine }) {
  await page.locator("main .profile__badges").waitFor({ timeout: 20000 });
  await page.locator("main .profile__stats").waitFor({ timeout: 20000 });
  await page
    .waitForFunction(() => document.body.innerText.length > 200, null, {
      timeout: 10000,
    })
    .catch(() => {});

  const m = await page.evaluate(() => {
    const b = document.querySelector("main .profile__badges");
    const s = document.querySelector("main .profile__stats");
    if (!b || !s) return { missing: true };
    const pills = [...b.querySelectorAll(".profile__badge, .medals__pill")];
    const pill = pills[0];
    const cs = pill ? getComputedStyle(pill) : null;
    const ss = getComputedStyle(s);
    const list = b.querySelector(".medals") || b;
    const rb = b.getBoundingClientRect();
    const rs = s.getBoundingClientRect();
    return {
      missing: false,
      distinct: b !== s && !b.contains(s) && !s.contains(b),
      gap: rs.top - rb.bottom,
      pillFont: cs ? parseFloat(cs.fontSize) : -1,
      statsFont: parseFloat(ss.fontSize),
      pillColor: cs ? cs.color : "",
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
  });

  expect(!m.missing, `${label}: .profile__badges 或 .profile__stats 缺失`);

  // ① 容器互相独立
  expect(m.distinct, `${label}: 徽章容器与统计容器互为祖先/后代`);

  // ② 视觉降级：字号小 ≥2px，颜色灰
  expect(
    m.pillFont > 0 && m.pillFont <= m.statsFont - 2,
    `${label}: 徽章字号 ${m.pillFont}px 未比统计行 ${m.statsFont}px 小 ≥2px`
  );
  expect(
    m.pillColor === "rgb(133, 144, 166)",
    `${label}: 徽章颜色 ${m.pillColor} ≠ rgb(133, 144, 166)（#8590A6）`
  );

  // ③ 垂直间距
  expect(m.gap >= 16, `${label}: 徽章底→统计顶间距 ${m.gap.toFixed(1)}px < 16px`);

  // ④ 折行与横向溢出
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

  // ⑤ title 全称保留
  expect(m.pillCount >= 1, `${label}: 徽章容器内无徽章`);
  for (const [i, p] of m.pillTitles.entries()) {
    expect(
      p.title.length > 0 && p.title !== p.text,
      `${label}: 徽章 #${i} title 缺失或等于缩写文本 "${p.text}"（title="${p.title}"）`
    );
  }

  // ⑥ 页面健康
  expect(
    m.errs.length === 0,
    `${label}: __errs 非空 ${m.errs.slice(0, 3).join(" | ")}`
  );
  expect(m.bodyLen > 200, `${label}: body 文本长度 ${m.bodyLen} ≤ 200`);
}

run("profile-badge-hierarchy", async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
  });
  await ctx.addInitScript(ERR_HOOK);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);

  await page.goto(`${BASE}/u/${UID}`, { waitUntil: "domcontentloaded" });
  await check(page, "1440", { singleLine: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: "domcontentloaded" });
  await check(page, "390", { singleLine: false });

  await ctx.close();
});
