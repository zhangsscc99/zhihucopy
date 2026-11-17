// Z1020 — 自己的回答/评论有编辑与删除入口（浏览器级验收）。
//
// 场景：账号 C 自己提问 + 自己回答 + 自己评论该回答 → 打开问题页：
//   1) 回答卡内点「⋯」（.answer__more-btn）→ 菜单出现「编辑」「删除」两项；
//   2) 点「编辑」→ 内联编辑出现 → 改正文保存 → 新正文 1.5s 内出现在卡片上；
//   3) 刷新后仍是新正文（PATCH 已落库，不是本地假象）；
//   4) 展开评论区 → 自己的评论行内存在「删除」按钮；
//   5) 再点「⋯」→「删除」→ 确认条 →「确认删除」→ 该回答卡消失且刷新不复活；
//   6) window.__errs 为空、无横向溢出（1280/390 各量一次）。
//
// 账号口径：C 必须是「真实形态」账号（真人* 昵称 + real-*@zhihucopy.dev 邮箱）。
//   GET /comments 用 testCommentSql 过滤 —— is_test/测试昵称/测试邮箱账号的
//   评论连本人也看不到，走 register()（@test.dev）会让「自己的评论有删除入口」
//   恒不可验。真人* + real-*@zhihucopy.dev 命中 probeUserMatchSql（可删口径），
//   lib 退出自清理按会话正常回收（作者/属主一致）。
// 内容标记一律纯数字（避开 content-filter 的标题/正文规则）。
//
// 自清理：register/apiOk 创建的对象全部进 lib 的 owned 跟踪；回答经 UI 软删后
//   由清理硬删，问题/评论/账号由 --only-owned 口径删除（API 模式，同 vote-comment.mjs）。
//
// Env: API_BASE 或 E2E_BASE。退出码即结论（逐项 PASS/FAIL 明细行）。

const API_ENV = (process.env.API_BASE || "").replace(/\/+$/, "");
const BASE = (
  process.env.E2E_BASE ||
  API_ENV.replace(/\/api$/, "") ||
  "http://127.0.0.1:3030/zhihucopy"
).replace(/\/+$/, "");
process.env.E2E_BASE ||= BASE;

const { launch, authedPage, api, apiOk, uniq } = await import("../e2e/lib.mjs");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} edit-delete ${name}${detail ? ` — ${detail}` : ""}`);
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

const digits = () => String(Math.floor(100000 + Math.random() * 900000));
const mark = digits();

// 真实形态账号（probe 口径）：公共过滤不吞，退出自清理可删。
async function registerReal() {
  const nickname = `真人${uniq("n").replace(/-/g, "")}`.slice(0, 24);
  const email = `${uniq("real")}@zhihucopy.dev`;
  const password = "assert-pass-123";
  const r = await api("POST", "/auth/register", {
    body: { email, password, nickname },
  });
  if (r.status !== 201) {
    throw new Error(`register -> ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  }
  return { token: r.data.token, user: r.data.user, email, password };
}

async function main() {
  const browser = await launch();
  let shotPage = null;
  try {
    const c = await registerReal();

    const { question } = await apiOk("POST", "/questions", {
      token: c.token,
      body: { title: `走查问题${mark}？`, detail_md: "" },
    });
    const { answer } = await apiOk("POST", `/questions/${question.id}/answers`, {
      token: c.token,
      body: { content_md: `回答正文 ${mark}` },
    });
    await apiOk("POST", "/comments", {
      token: c.token,
      body: { target_type: "answer", target_id: answer.id, body: `评论 ${mark}` },
    });

    const page = await authedPage(browser, c.token);
    shotPage = page;
    page.setDefaultTimeout(15000);
    await injectErrs(page);
    await page.goto(`${BASE}/question/${question.id}`, { waitUntil: "domcontentloaded" });

    const card = page.locator(`#answer-${answer.id}`);
    await card.waitFor({ state: "visible", timeout: 15000 });

    // (1) 「⋯」菜单 → 编辑 + 删除 两项
    // ⋯ 按钮要等 /users/me 回来（user 落定且即作者）才渲染，须先等出现再判。
    const moreBtn = card.locator(".answer__more-btn");
    await moreBtn.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    check("more-btn-visible", await isVis(moreBtn), ".answer__more-btn（⋯）");
    await moreBtn.click();
    const menu = card.locator(".answer__more-menu");
    await menu.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    const menuText = (await menu.textContent().catch(() => "")) || "";
    check(
      "menu-has-edit-delete",
      (await isVis(menu)) && menuText.includes("编辑") && menuText.includes("删除"),
      `menu=「${menuText.trim()}」`
    );

    // (2) 编辑 → 内联编辑 → 保存 → 1.5s 内新正文上卡
    const edited = `回答正文 ${mark} 修订${digits()}`;
    await menu.getByRole("menuitem", { name: "编辑" }).click();
    const editArea = card.locator(".answer__edit textarea").first();
    await editArea.waitFor({ state: "visible", timeout: 5000 });
    await editArea.fill(edited);
    const tSave = Date.now();
    await card.getByRole("button", { name: "保存" }).click();
    let savedFast = false;
    try {
      await page.waitForFunction(
        ({ aid, frag }) => {
          const el = document.getElementById(`answer-${aid}`);
          return el && (el.textContent || "").includes(frag);
        },
        { aid: answer.id, frag: "修订" },
        { timeout: 1500 }
      );
      savedFast = true;
    } catch {}
    check(
      "edit-saves-in-1500ms",
      savedFast,
      `elapsed=${Date.now() - tSave}ms 新正文=「…修订${edited.slice(-6)}」`
    );

    // (3) 刷新后仍是新正文（落库验证）
    await page.reload({ waitUntil: "domcontentloaded" });
    const card2 = page.locator(`#answer-${answer.id}`);
    await card2.waitFor({ state: "visible", timeout: 15000 });
    const bodyText = (await card2.locator(".answer__body").textContent().catch(() => "")) || "";
    check("edit-persists-reload", bodyText.includes("修订"), `body=「${bodyText.trim().slice(0, 40)}」`);

    // (4) 展开评论区 → 自己的评论行内「删除」入口
    const toggle = card2.getByRole("button", { name: /条评论|收起评论/ }).first();
    await toggle.click();
    await card2
      .locator(".answer__comment")
      .first()
      .waitFor({ state: "visible", timeout: 8000 })
      .catch(() => {});
    const myRow = card2.locator(".answer__comment", { hasText: mark }).first();
    const myRowText = (await myRow.textContent().catch(() => "")) || "";
    const delBtn = myRow.getByRole("button", { name: "删除" }).first();
    check(
      "own-comment-delete-entry",
      (await isVis(myRow)) && (await isVis(delBtn)),
      `row=「${myRowText.trim().slice(0, 40)}」`
    );

    // (5) 「⋯」→ 删除 → 确认 → 卡消失 → 刷新不复活
    const moreBtn2 = card2.locator(".answer__more-btn");
    await moreBtn2.click();
    const menu2 = card2.locator(".answer__more-menu");
    await menu2.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    await menu2.getByRole("menuitem", { name: "删除" }).click();
    const confirm = card2.locator(".answer__del-confirm");
    await confirm.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    check("delete-confirm-bar", await isVis(confirm), ".answer__del-confirm");
    await confirm.getByRole("button", { name: /确认删除/ }).click();
    await page
      .waitForSelector(`#answer-${answer.id}`, { state: "detached", timeout: 8000 })
      .catch(() => {});
    const gone = (await page.locator(`#answer-${answer.id}`).count()) === 0;
    check("answer-card-gone", gone, "确认后回答卡消失");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".question__title, h1", { state: "visible", timeout: 15000 }).catch(() => {});
    const stillGone = (await page.locator(`#answer-${answer.id}`).count()) === 0;
    check("answer-stays-gone", stillGone, "刷新后回答不复活");

    // (6) 无横向溢出（1280/390 各一次）+ __errs 为空
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
        await shotPage.screenshot({ path: path.join(dir, `assert-edit-delete-${ts}.png`), fullPage: true });
      }
    } catch {}
    await browser.close().catch(() => {});
  }
  const fails = results.filter((r) => !r.ok).length;
  console.log(`[ASSERT] edit-delete ${fails ? "FAIL" : "PASS"} — ${results.length - fails}/${results.length} checks — ${BASE}`);
  process.exit(fails ? 1 : 0);
}

main();
