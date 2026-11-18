// Z1183 — 个人主页「回答 0」tab 结构错位返修验收：
//   找一个 answers===0 的真实用户（遍历 GET /api/users?limit=50 候选，
//   逐个 GET /api/users/:id 看 stats.answers，不硬编码 id；列表接口本身排除 is_test）。
//   打开 /u/<id>（默认即「回答」tab）：
//     a) tabpanel 内含「TA 还没有写过回答」或「还没有回答」，且不含「TA 最近关注的问题」；
//     b) 「TA 最近关注的问题 / TA 最近赞同的回答」两个 h2（若出现）不在任何 [role=tabpanel] 内；
//     c) 存在可点「邀请 TA 回答」入口（a[href]，href 非空）；
//     d) 数据条 dt 文本集合含「关注者」，且无独立 dt「关注」（「粉丝」保持原样）；
//     e) 点击「提问」tab 后 tabpanel 不含「TA 最近关注的问题」；
//     f) 390×844 与 1440×900 均无横向溢出（scrollWidth === clientWidth）、window.__errs 为空。
//
// Env: API_BASE 或 E2E_BASE。退出码即结论（逐项 PASS/FAIL 明细行）。

const API_ENV = (process.env.API_BASE || "").replace(/\/+$/, "");
const BASE = (
  process.env.E2E_BASE ||
  API_ENV.replace(/\/api$/, "") ||
  "http://127.0.0.1:3030/zhihucopy"
).replace(/\/+$/, "");
const API = API_ENV || `${BASE}/api`;
process.env.E2E_BASE ||= BASE;

const { launch } = await import("../e2e/lib.mjs");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} profile-tabs ${name}${detail ? ` — ${detail}` : ""}`);
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

const HL_RE = /TA 最近(关注的问题|赞同的回答)/;
const EMPTY_RE = /(TA 还没有写过回答|还没有回答)/;
const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
];

// 不硬编码 id：遍历用户列表，逐个取 stats，挑第一个 answers===0 的。
async function pickZeroAnswerUser() {
  let candidates = 0;
  for (let offset = 0; offset < 500; offset += 50) {
    const r = await fetch(`${API}/users?limit=50&offset=${offset}`);
    if (!r.ok) break;
    const { items = [] } = await r.json();
    if (items.length === 0) break;
    for (const u of items) {
      candidates += 1;
      const d = await fetch(`${API}/users/${u.id}`);
      if (!d.ok) continue;
      const body = await d.json();
      if (body.stats && body.stats.answers === 0) {
        return { id: u.id, nickname: u.nickname, candidates };
      }
    }
  }
  return { id: null, candidates };
}

async function main() {
  const pick = await pickZeroAnswerUser();
  check(
    "pick-user",
    pick.id !== null,
    pick.id
      ? `id=${pick.id} «${pick.nickname}»（候选 ${pick.candidates}）`
      : `无 answers===0 用户（候选 ${pick.candidates}）`
  );
  if (pick.id === null) {
    console.log(`[ASSERT] profile-tabs FAIL — 0/1 checks — ${BASE}`);
    process.exit(1);
  }

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
      const tag = vp.name;

      await page.goto(`${BASE}/u/${pick.id}`, { waitUntil: "domcontentloaded" });
      // 等回答面板落定（空态标题或列表项出现）。
      await page
        .waitForFunction(
          (re) => {
            const p = document.querySelector("[role=tabpanel]");
            return (
              p && (new RegExp(re).test(p.textContent || "") || p.querySelector(".plist__item"))
            );
          },
          EMPTY_RE.source,
          { timeout: 10000 }
        )
        .catch(() => {});
      // 轨迹卡是二次请求，等它要么出现要么确认不出现（给 3s 窗口）。
      await page
        .waitForSelector(".phl", { timeout: 3000 })
        .catch(() => {});

      const panelText = (await page.locator("[role=tabpanel]").first().textContent()) || "";
      check(`${tag}-panel-empty-copy`, EMPTY_RE.test(panelText), panelText.trim().slice(0, 40));
      check(`${tag}-panel-no-highlights`, !HL_RE.test(panelText), "panel 内不得含轨迹块");

      // b) 轨迹 h2 若存在，必须都在 tabpanel 之外。
      const hlInside = await page.evaluate(() => {
        const re = /TA 最近(关注的问题|赞同的回答)/;
        const h2s = [...document.querySelectorAll("h2")].filter((h) => re.test(h.textContent || ""));
        return {
          total: h2s.length,
          inside: h2s.filter((h) => h.closest("[role=tabpanel]")).length,
        };
      });
      check(
        `${tag}-highlights-outside-panel`,
        hlInside.inside === 0,
        `h2=${hlInside.total} insidePanel=${hlInside.inside}`
      );

      // c) 「邀请 TA 回答」可点入口。
      const inviteHref = await page.evaluate(() => {
        const a = [...document.querySelectorAll("a[href]")].find((x) =>
          /邀请 TA 回答/.test(x.textContent || "")
        );
        return a ? a.getAttribute("href") : null;
      });
      check(`${tag}-invite-link`, !!inviteHref, `href=${inviteHref}`);

      // d) 数据条 dt：含「关注者」、无独立「关注」。
      const dts = await page
        .locator(".profile__stats dt")
        .evaluateAll((els) => els.map((e) => (e.textContent || "").trim()));
      check(
        `${tag}-stats-follower-label`,
        dts.includes("关注者") && !dts.includes("关注"),
        `dts=${JSON.stringify(dts)}`
      );

      // e) 切「提问」tab：面板只剩提问内容，无轨迹块。
      await page.getByRole("tab", { name: /提问/ }).click();
      await page
        .waitForFunction(
          () => {
            const p = document.querySelector("[role=tabpanel]");
            return p && (p.querySelector(".plist__item") || /还没有提问/.test(p.textContent || ""));
          },
          { timeout: 10000 }
        )
        .catch(() => {});
      const qPanel = (await page.locator("[role=tabpanel]").first().textContent()) || "";
      check(`${tag}-questions-panel-clean`, !HL_RE.test(qPanel), qPanel.trim().slice(0, 40));
      const hlAfterSwitch = await page.evaluate(
        () => document.querySelectorAll(".phl").length
      );
      check(`${tag}-highlights-unmounted`, hlAfterSwitch === 0, `.phl=${hlAfterSwitch}`);

      // f) 无横向溢出 + __errs 为空。
      const sw = await page.evaluate(
        () => `${document.body.scrollWidth}|${document.body.clientWidth}`
      );
      const [scrollW, clientW] = sw.split("|").map(Number);
      check(`${tag}-no-hscroll`, scrollW === clientW, `scrollWidth=${scrollW} clientWidth=${clientW}`);
      const errs = await pageErrs(page);
      check(`${tag}-errs-empty`, errs.length === 0, errs.slice(0, 3).join(" | "));

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
        await shotPage.screenshot({ path: path.join(dir, `assert-profile-tabs-${ts}.png`), fullPage: true });
      }
    } catch {}
    await browser.close().catch(() => {});
  }
  const fails = results.filter((r) => !r.ok).length;
  console.log(`[ASSERT] profile-tabs ${fails ? "FAIL" : "PASS"} — ${results.length - fails}/${results.length} checks — ${BASE}`);
  process.exit(fails ? 1 : 0);
}

main();
