// Z1019 — 通知覆盖赞同/评论/关注/回答四类事件（纯 API 造事件 + 一次 UI 校验）。
//
// 场景：A 注册并提问（且自问自答一条供投票/评论做目标）；B 注册后依次：
//   · 回答 A 的问题      → A 收 type=answer（「回答了你的问题」）
//   · 赞同 A 的回答      → A 收 type=agree（「赞同了你的回答」，POST /votes）
//   · 评论 A 的回答      → A 收 type=comment（「评论了你的回答」，POST /comments）
//   · 关注 A             → A 收 type=follow（「关注了你」，POST /users/:id/follow）
// API 侧断言 A 的 /notifications 覆盖四类；UI 侧 A 登录进 /notifications：
//   .ntf__item 行 ≥3 且 main 文本命中 赞同/评论/关注/回答 关键词 ≥3 类；
//   无横向溢出（1280/390 各量一次）；window.__errs 为空。
//
// 账号口径：接收者 A 用 `走查<6 位纯数字>`（任务约定标记，残留过滤按 actor 判定，
//   对接收者无影响）；actor B 不能用残留形态昵称（residueActorSql 命中即被
//   /notifications 过滤），故 B 用 register() 默认 e2e- 形态（is_test 标记可清）。
// 内容标记一律纯数字（命中不了 content-filter 的正文/标题规则）。
//
// Env: API_BASE 或 E2E_BASE。退出码即结论（逐项 PASS/FAIL 明细行）。

const API_ENV = (process.env.API_BASE || "").replace(/\/+$/, "");
const BASE = (
  process.env.E2E_BASE ||
  API_ENV.replace(/\/api$/, "") ||
  "http://127.0.0.1:3030/zhihucopy"
).replace(/\/+$/, "");
process.env.E2E_BASE ||= BASE;

const { launch, authedPage, register, apiOk } = await import("../e2e/lib.mjs");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} notify-events ${name}${detail ? ` — ${detail}` : ""}`);
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

const digits = () => String(Math.floor(100000 + Math.random() * 900000));
const mark = digits();

async function main() {
  const browser = await launch();
  let shotPage = null;
  try {
    // ---- API 侧：造四类通知事件 ---------------------------------------------
    const a = await register(`走查${mark}`); // 接收者（残留形态对接收方无影响）
    const b = await register(); // actor：不得用残留昵称（会被通知接口过滤）

    const { question } = await apiOk("POST", "/questions", {
      token: a.token,
      body: { title: `走查提问${mark}？`, detail_md: "" },
    });
    const { answer: myAnswer } = await apiOk("POST", `/questions/${question.id}/answers`, {
      token: a.token,
      body: { content_md: `回答正文 ${mark}` },
    });
    await apiOk("POST", `/questions/${question.id}/answers`, {
      token: b.token,
      body: { content_md: `回答内容 ${mark}` },
    });
    await apiOk("POST", "/votes", {
      token: b.token,
      body: { target_type: "answer", target_id: myAnswer.id, value: 1 },
    });
    await apiOk("POST", "/comments", {
      token: b.token,
      body: { target_type: "answer", target_id: myAnswer.id, body: `评论 ${mark}` },
    });
    await apiOk("POST", `/users/${a.user.id}/follow`, { token: b.token });

    // API 断言：A 的通知覆盖四类（按 actor=B 过滤出本 run 的 4 条）。
    const list = await apiOk("GET", "/notifications", { token: a.token });
    const mine = (list.items || []).filter((n) => n.actor && n.actor.id === b.user.id);
    const types = new Set(mine.map((n) => n.type));
    check(
      "api-notify-4-events",
      mine.length >= 4 && ["answer", "agree", "comment", "follow"].every((t) => types.has(t)),
      `items=${mine.length} types=${[...types].join(",")}`
    );

    // ---- UI 侧：A 进 /notifications ------------------------------------------
    const page = await authedPage(browser, a.token);
    shotPage = page;
    page.setDefaultTimeout(15000);
    await injectErrs(page);
    await page.goto(`${BASE}/notifications`, { waitUntil: "domcontentloaded" });
    await page.locator(".ntf__item").first().waitFor({ state: "visible", timeout: 15000 });

    const rows = await page.locator(".ntf__item").count();
    check("ui-rows>=3", rows >= 3, `.ntf__item=${rows}`);

    const mainText = (await page.locator("main").textContent()) || "";
    const hit = ["赞同", "评论", "关注", "回答"].filter((k) => mainText.includes(k));
    check("ui-keywords>=3", hit.length >= 3, `命中=${hit.join(",")}（/4 类）`);

    // 无横向溢出：1280 与 390 各量一次（同页改视口即可）。
    const sw1280 = await scrollWidth(page);
    check("no-hscroll-1280", sw1280 <= 1280, `scrollWidth=${sw1280}`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const sw390 = await scrollWidth(page);
    check("no-hscroll-390", sw390 <= 390, `scrollWidth=${sw390}`);

    const errs = await pageErrs(page);
    check("errs-empty", errs.length === 0, errs.slice(0, 3).join(" | "));

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
        await shotPage.screenshot({ path: path.join(dir, `assert-notify-events-${ts}.png`), fullPage: true });
      }
    } catch {}
    await browser.close().catch(() => {});
  }
  const fails = results.filter((r) => !r.ok).length;
  console.log(`[ASSERT] notify-events ${fails ? "FAIL" : "PASS"} — ${results.length - fails}/${results.length} checks — ${BASE}`);
  process.exit(fails ? 1 : 0);
}

main();
