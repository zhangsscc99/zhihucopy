// auth-rail-mobile.mjs — Z1166 手机端 auth 页（/login、/register）隐藏右栏 +
// 「请先登录」toast 中性化。
//
//   浏览器级（import { run } from ../e2e/lib.mjs）：
//     移动 390/414/360 ×844，遍历 /login 与 /register：
//       a) .rail 计算样式 display === "none"（直接隐藏，非 order 挤尾）；
//       b) document.body.scrollHeight < 900（表单一屏内，无整页滚动）；
//       c) 表单首个 input 可见且 getBoundingClientRect().top ∈ [0,400]；
//       d) 提交按钮为唯一实心主按钮，背景 #0066FF；
//       e) 无横向溢出（scrollWidth <= innerWidth+1）、window.__errs 为空。
//     桌面 1440×900 /login：
//       f) .rail display !== "none" 且宽 ∈ [300,400]，window.__errs 为空。
//     移动 390 /question/6 未登录点「赞同」→ 回跳 /login：
//       g) toast 文本含「请先登录」且计算 background-color 非红色系
//          （红色定义：r >= g+60 且 r >= b+60），副行含「登录后即可继续刚才的操作」。
//
// Env: API_BASE（缺省 3030）、E2E_BASE（缺省 API_BASE 去掉 /api）。
//      可用 `--baseline <url>` 或 E2E_BASE 指向未修基线做反向自检：
//        node scripts/assert/auth-rail-mobile.mjs --baseline https://openfolio.uk/zhihucopy
//      未修基线 390 下 .rail 可见（display!==none、scrollHeight≈1262），断言 a/b 必 FAIL。

import { expect } from "./lib.mjs";

const argv = process.argv.slice(2);
const bi = argv.indexOf("--baseline");
if (bi !== -1 && argv[bi + 1]) process.env.E2E_BASE = argv[bi + 1];

const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
const BASE = (process.env.E2E_BASE || API_BASE.replace(/\/api$/, "")).replace(/\/+$/, "");
process.env.E2E_BASE ||= BASE;
const { run } = await import("../e2e/lib.mjs");

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

async function newCleanPage(browser, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: "zh-CN" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  await page.addInitScript(ERR_HOOK);
  return page;
}

async function checkErrs(page, tag) {
  const errs = await page.evaluate(() => window.__errs || []);
  expect(errs.length === 0, `${tag} window.__errs ${errs.length} 条: ${errs.slice(0, 3).join(" | ")}`);
}

async function checkAuthMobile(browser, width, path) {
  const page = await newCleanPage(browser, width, 844);
  try {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await page.waitForSelector(".authcard input");
    const m = await page.evaluate(() => {
      const rail = document.querySelector(".rail");
      const input = document.querySelector(".authcard input");
      const submit = document.querySelector('.authform button[type="submit"], .authform .btn--primary');
      const solids = [...document.querySelectorAll(".authpage button, .authpage a")].filter((el) => {
        const bg = getComputedStyle(el).backgroundColor;
        return bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
      });
      return {
        railDisplay: rail ? getComputedStyle(rail).display : "(absent)",
        scrollHeight: document.body.scrollHeight,
        docScrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
        inputTop: input ? input.getBoundingClientRect().top : null,
        inputVisible: input ? input.offsetParent !== null : false,
        submitBg: submit ? getComputedStyle(submit).backgroundColor : null,
        solidCount: solids.length,
      };
    });
    const tag = `${width} ${path}`;
    expect(
      m.railDisplay === "none",
      `${tag} .rail display=${m.railDisplay}（需 none；未修基线为 flex 可见）`
    );
    expect(
      m.scrollHeight < 900,
      `${tag} body.scrollHeight=${m.scrollHeight}（需 <900；未修基线 ~1262）`
    );
    expect(m.inputTop !== null && m.inputVisible, `${tag} 表单首个输入框不可见`);
    expect(
      m.inputTop >= 0 && m.inputTop <= 400,
      `${tag} 首个输入框 top=${Math.round(m.inputTop)}（需 ∈ [0,400]）`
    );
    expect(
      m.submitBg === "rgb(0, 102, 255)",
      `${tag} 提交按钮背景=${m.submitBg}（需 rgb(0,102,255)）`
    );
    expect(
      m.solidCount === 1,
      `${tag} auth 页实心按钮/链接 ${m.solidCount} 个（需唯一主按钮）`
    );
    expect(
      m.docScrollW <= m.innerW + 1,
      `${tag} 横向溢出 scrollWidth=${m.docScrollW} innerWidth=${m.innerW}`
    );
    await checkErrs(page, tag);
    console.log(
      `  ${tag}: rail=${m.railDisplay} scrollH=${m.scrollHeight} inputTop=${Math.round(
        m.inputTop
      )} submitBg=${m.submitBg} 实心按钮=${m.solidCount}`
    );
  } finally {
    await page.context().close();
  }
}

async function checkAuthDesktop(browser) {
  const page = await newCleanPage(browser, 1440, 900);
  try {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.waitForSelector(".authcard input");
    const m = await page.evaluate(() => {
      const rail = document.querySelector(".rail");
      if (!rail) return null;
      return {
        display: getComputedStyle(rail).display,
        width: rail.getBoundingClientRect().width,
      };
    });
    expect(m, "desktop1440 /login 找不到 .rail");
    expect(
      m.display !== "none",
      `desktop1440 /login .rail display=${m.display}（桌面端不得隐藏）`
    );
    expect(
      m.width >= 300 && m.width <= 400,
      `desktop1440 /login .rail 宽 ${Math.round(m.width)}px（需 ∈ [300,400]）`
    );
    await checkErrs(page, "desktop1440 /login");
    console.log(
      `  desktop1440 /login: rail display=${m.display} width=${Math.round(m.width)}px`
    );
  } finally {
    await page.context().close();
  }
}

async function checkToast(browser) {
  const page = await newCleanPage(browser, 390, 844);
  try {
    await page.goto(`${BASE}/question/6`, { waitUntil: "networkidle" });
    const vote = page.locator(".answer__vote--up").first();
    await vote.waitFor({ state: "visible" });
    await vote.click();
    await page.waitForURL(/\/login\?next=/, { timeout: 10000 });
    const toast = page.locator(".toast", { hasText: "请先登录" }).first();
    await toast.waitFor({ state: "visible", timeout: 8000 });
    const m = await toast.evaluate((el) => {
      const bg = getComputedStyle(el).backgroundColor;
      const nums = bg.match(/\d+/g).map(Number);
      const sub = el.querySelector(".toast__sub");
      const subLink = sub && sub.querySelector("a");
      return {
        text: el.innerText,
        bg,
        rgb: nums,
        subText: sub ? sub.innerText : "",
        subHref: subLink ? subLink.getAttribute("href") : null,
      };
    });
    expect(m.text.includes("请先登录"), `toast 文本缺「请先登录」: ${m.text}`);
    expect(
      m.subText.includes("登录后即可继续刚才的操作"),
      `toast 副行缺失/不含「登录后即可继续刚才的操作」: ${m.subText || "(无)"}`
    );
    expect(
      m.subHref && m.subHref.includes("next="),
      `toast 副行「登录」链接未透传 next: ${m.subHref || "(无)"}`
    );
    const [r, g, b] = m.rgb;
    expect(
      !(r >= g + 60 && r >= b + 60),
      `toast 背景 ${m.bg} 仍是红色系（需中性深色 var(--ink)，错误色 --seal 禁用于守卫提示）`
    );
    console.log(
      `  mobile390 未登录点赞回跳: toast「${m.text.split("\n")[0]}」 bg=${m.bg} 副行链接 ${m.subHref}`
    );
  } finally {
    await page.context().close();
  }
}

run("auth-rail-mobile", async ({ browser }) => {
  for (const w of [390, 414, 360]) {
    for (const p of ["/login?next=%2Fquestion%2F6", "/register"]) {
      await checkAuthMobile(browser, w, p);
    }
  }
  await checkAuthDesktop(browser);
  await checkToast(browser);
});
