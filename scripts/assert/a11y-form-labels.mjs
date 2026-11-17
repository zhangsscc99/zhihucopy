// Z1104 — 登录/注册表单 label 与 input 关联（WCAG 1.3.1 / 4.1.2）：浏览器级断言。
//
// 断言：
//  1) /register：getByLabel("昵称"/"邮箱"/"密码") 各唯一定位一个 input；
//     点击 <label> 文本后 document.activeElement 是对应 input；
//     input 有稳定 id（reg-*）且 label[for] 指向它。
//  2) /login：getByLabel("邮箱"/"密码") 同上（login-* id）。
//  3) 键盘 Tab 聚焦输入框时 :focus-visible 轮廓可见（outline != none，>=2px）。
//  4) 1440×900 与 390×844 各跑一遍；window.__errs 为空；无横向溢出。
//
// Env: E2E_BASE || API_BASE(-/api) || http://127.0.0.1:3030/zhihucopy
//      CHROME 可覆盖浏览器路径；截图失败现场到 /root/logs。
// 退出码即结论：0 PASS / 1 FAIL（打印具体失败点）。

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const BASE = (
  process.env.E2E_BASE ||
  process.env.API_BASE?.replace(/\/api$/, "") ||
  "http://127.0.0.1:3030/zhihucopy"
).replace(/\/+$/, "");

const SHOT_DIR = process.env.E2E_SHOT_DIR || "/root/logs";

let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  const req = createRequire(new URL("../e2e/lib.mjs", import.meta.url));
  ({ chromium } = req("playwright-core"));
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

function expect(cond, msg) {
  if (!cond) throw new Error(`assert: ${msg}`);
}

function injectErrs(page) {
  return page.addInitScript(() => {
    const w = window;
    w.__errs = [];
    w.addEventListener("error", (e) => w.__errs.push(`error:${e.message}`));
    w.addEventListener("unhandledrejection", (e) =>
      w.__errs.push(`rejection:${e.reason && e.reason.message ? e.reason.message : e.reason}`)
    );
    const origError = console.error;
    console.error = (...args) => {
      w.__errs.push(`console:${args.map(String).join(" ")}`);
      return origError.apply(console, args);
    };
  });
}

const pageErrs = (page) => page.evaluate(() => window.__errs || []);

async function scrollWidth(page) {
  return page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
  );
}

// 每个字段：getByLabel 唯一定位 → id/for 配对 → 点 label 聚焦 → Tab 焦点环。
async function checkForm(page, url, fields, vw) {
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
  await page.locator(".authform").waitFor({ state: "visible", timeout: 10000 });

  for (const { name, id } of fields) {
    const input = page.getByLabel(name, { exact: true });
    const count = await input.count();
    expect(count === 1, `${url} ${vw}：getByLabel("${name}") 命中 ${count} 个，期望 1`);
    const tag = await input.evaluate((el) => el.tagName);
    expect(tag === "INPUT", `${url}：getByLabel("${name}") 定位到 ${tag}，期望 INPUT`);

    const dom = await input.evaluate((el) => ({
      id: el.id,
      forAttr: el.labels && el.labels[0] ? el.labels[0].htmlFor : null,
      labelCount: el.labels ? el.labels.length : 0,
    }));
    expect(dom.id === id, `${url}："${name}" input id=${dom.id}，期望 ${id}`);
    expect(dom.forAttr === id, `${url}："${name}" label[for]=${dom.forAttr}，期望 ${id}`);

    // 点击 label 文本 → activeElement 必须是该 input
    await page.locator(`label[for="${id}"]`).click();
    await page.waitForTimeout(120);
    const active = await page.evaluate(() => document.activeElement && document.activeElement.id);
    expect(active === id, `${url}：点击 "${name}" label 后 activeElement=${active}，期望 ${id}`);
  }

  // 键盘 Tab 进表单第一个输入框：:focus-visible 轮廓必须可见
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.locator("h1.page-title").click({ position: { x: 4, y: 4 } }).catch(() => {});
  await page.keyboard.press("Tab");
  const focus = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    return {
      id: el.id,
      tag: el.tagName,
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      focusVisible: el.matches(":focus-visible"),
    };
  });
  expect(focus, `${url} ${vw}：Tab 后无可聚焦元素`);
  if (focus.tag === "INPUT") {
    const w = parseFloat(focus.outlineWidth) || 0;
    expect(
      focus.outlineStyle !== "none" && w >= 2,
      `${url} ${vw}：输入框焦点环不可见 outline=${focus.outlineStyle}/${focus.outlineWidth}`
    );
  }

  const sw = await scrollWidth(page);
  expect(sw <= vw, `${url} ${vw}：横向溢出 scrollWidth=${sw}`);
  const errs = await pageErrs(page);
  expect(errs.length === 0, `${url} ${vw}：页面错误：${errs.join(" | ")}`);
}

async function main() {
  const browser = await chromium.launch({
    executablePath: chromePath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  let shotPage = null;
  try {
    for (const vp of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const ctx = await browser.newContext({ viewport: vp, locale: "zh-CN" });
      const page = await ctx.newPage();
      shotPage = page;
      page.setDefaultTimeout(15000);
      await injectErrs(page);

      await checkForm(
        page,
        "/register",
        [
          { name: "昵称", id: "reg-nickname" },
          { name: "邮箱", id: "reg-email" },
          { name: "密码", id: "reg-password" },
        ],
        vp.width
      );
      await checkForm(
        page,
        "/login",
        [
          { name: "邮箱", id: "login-email" },
          { name: "密码", id: "login-password" },
        ],
        vp.width
      );
      await ctx.close();
    }

    await browser.close();
    console.log(`[ASSERT] a11y-form-labels PASS — ${BASE}`);
    process.exit(0);
  } catch (e) {
    try {
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      if (shotPage) {
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const p = path.join(SHOT_DIR, `assert-a11y-form-labels-${ts}.png`);
        await shotPage.screenshot({ path: p, fullPage: true });
        console.error(`[ASSERT] screenshot: ${p}`);
      }
    } catch {}
    try {
      await browser.close();
    } catch {}
    console.error(`[ASSERT] a11y-form-labels FAIL — ${BASE}`);
    console.error(`  ${e.message || e}`);
    process.exit(1);
  }
}

main();
