// Z978 — 未登录文案去空格：「登录后即可回答」「登录后参与评论」，
// 不得出现「登录 后」（登录与后之间不允许有空白字符）。
//
// 断言（浏览器级，未登录态，1440×900 与 390×844 各跑一遍）：
//   打开一个 answer_count>0 的问题页：
//     a) main 文本含「登录后」；
//     b) main 文本不匹配 /登录\s+后/ —— 有任何空白分隔形态即 FAIL；
//     c) main 文本含「登录后即可回答」；
//     d) 展开首个回答的评论区后存在「登录后参与评论」；
//     e) 无横向溢出，window.__errs 为空。
//
// Env: API_BASE 或 E2E_BASE。退出码即结论（逐项 PASS/FAIL 明细行）。

const API_ENV = (process.env.API_BASE || "").replace(/\/+$/, "");
const BASE = (
  process.env.E2E_BASE ||
  API_ENV.replace(/\/api$/, "") ||
  "http://127.0.0.1:3030/zhihucopy"
).replace(/\/+$/, "");
process.env.E2E_BASE ||= BASE;

const { launch, questionWithAnswers } = await import("../e2e/lib.mjs");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} login-copy ${name}${detail ? ` — ${detail}` : ""}`);
};

const injectErrs = (page) =>
  page.addInitScript(() => {
    const w = window;
    w.__errs = [];
    w.addEventListener("error", (e) => w.__errs.push(`error:${e.message}`));
    w.addEventListener("unhandledrejection", (e) =>
      w.__errs.push(
        `rejection:${e.reason && e.reason.message ? e.reason.message : e.reason}`
      )
    );
    const origError = console.error;
    console.error = (...args) => {
      w.__errs.push(`console:${args.map(String).join(" ")}`);
      return origError.apply(console, args);
    };
  });
const pageErrs = (page) => page.evaluate(() => window.__errs || []);

const scrollWidth = (page) =>
  page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
  );

const isVis = (loc) => loc.isVisible().catch(() => false);

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
];

async function main() {
  // 取一个已有回答的问题（API 侧，与视口无关）。
  const detail = await questionWithAnswers();
  const qid = detail.question.id;
  const aid = detail.answers[0].id;

  const browser = await launch();
  let shotPage = null;
  try {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        locale: "zh-CN",
      });
      const page = await ctx.newPage();
      shotPage = page;
      page.setDefaultTimeout(15000);
      await injectErrs(page);
      // 未登录（无 token）打开问题页。
      await page.goto(`${BASE}/question/${qid}`, { waitUntil: "domcontentloaded" });
      await page.locator(`#answer-${aid}`).waitFor({ state: "visible", timeout: 15000 });

      const text = (await page.locator("main").textContent()) || "";
      check(`${vp.name}-has-登录后`, text.includes("登录后"), "main 含「登录后」引导");
      const spaced = text.match(/登录\s+后/);
      check(
        `${vp.name}-no-登录␣后`,
        !spaced,
        spaced ? `命中片段「${spaced[0]}」` : "main 无空白分隔形态"
      );
      check(
        `${vp.name}-登录后即可回答`,
        text.includes("登录后即可回答"),
        "main 含「登录后即可回答」"
      );

      // 展开首个回答评论区 → 「登录后参与评论」提示。
      const card = page.locator(`#answer-${aid}`);
      const toggle = card.getByRole("button", { name: /条评论|收起评论/ }).first();
      await toggle.click();
      await page
        .locator(".answer__comment-hint")
        .first()
        .waitFor({ state: "visible", timeout: 8000 })
        .catch(() => {});
      const hint = page.locator(".answer__comment-hint").first();
      const hintText = (await hint.textContent().catch(() => "")) || "";
      check(
        `${vp.name}-登录后参与评论`,
        (await isVis(hint)) && hintText.includes("登录后参与评论"),
        `hint=「${hintText.trim().slice(0, 30)}」`
      );

      const sw = await scrollWidth(page);
      check(`${vp.name}-no-hscroll`, sw <= vp.width, `scrollWidth=${sw} > ${vp.width}`);

      const errs = await pageErrs(page);
      check(`${vp.name}-errs-empty`, errs.length === 0, errs.slice(0, 3).join(" | "));
      await ctx.close();
    }
    await browser.close();
  } catch (e) {
    check("unexpected-error", false, String(e && e.message ? e.message : e).slice(0, 200));
    try {
      if (shotPage) {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const dir = process.env.E2E_SHOT_DIR || "/root/logs";
        fs.mkdirSync(dir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        await shotPage.screenshot({ path: path.join(dir, `assert-login-copy-${ts}.png`), fullPage: true });
      }
    } catch {}
    await browser.close().catch(() => {});
  }
  const fails = results.filter((r) => !r.ok).length;
  console.log(`[ASSERT] login-copy ${fails ? "FAIL" : "PASS"} — ${results.length - fails}/${results.length} checks — ${BASE}`);
  process.exit(fails ? 1 : 0);
}

main();
