// Z1078 — 公共信息流不得混入「回归 <token> 复盘？」型自动化残留。
//
//   1) GET /questions?limit=30、/feed/recommended、/feed/hot 任何标题不得匹配
//      RESIDUE_RE（与线上实测的 qmwjz* 残留同形态）；
//   2) 正向守卫：现造一条 `链路回归 <uniq> 复盘？`（真实账号发出，只可能被
//      标题规则过滤）→ 必须不出现在三个公共流；再造一条真实形态
//      「回归分析怎么做才不容易过拟合？」→ 必须出现 —— 证明断言非恒真；
//   3) 已知残留 id（1349/1355/1356/1357）不得出现在任何公共流；
//   4) playwright 打开首页（桌面 1440 / 移动 390）：console error 为 0，
//      首屏 .feed__title 文本不含 RESIDUE_RE 形态。
//
// 产物由 lib.mjs 退出钩子按 owned 清单自清理（u: 仅测试形态账号才删，
// 本脚本刻意注册真实形态账号走查员* —— 账号残留与 z1044user 同类，调度器兜底）。
//
// Env: API_BASE（HTTP 断言）、E2E_BASE（页面断言，缺省由 API_BASE 去掉 /api）、
//      CHROME（chromium 路径，缺省取 /root/.cache/ms-playwright/chromium-*）。
import { createRequire } from "node:module";
import fs from "node:fs";
import { ok, req, expect, main, API, uniq } from "./lib.mjs";

const requireHere = createRequire(import.meta.url);
const { isTestTitle } = requireHere("../../server/content-filter.js");
// playwright-core 装在 scripts/e2e/node_modules（e2e 套件共用），经该目录解析。
const { chromium } = createRequire(
  new URL("../e2e/lib.mjs", import.meta.url)
)("playwright-core");

// 任务规定的残留形态正则（大小写敏感 —— 产物 token 恒为小写）。
const RESIDUE_RE =
  /回归\s*[a-z0-9]{8,}|[a-z0-9]{8,}\s*复盘\s*[?？]?$|巡检|^assert-|^e2e-|^验收-/;

const BASE = (process.env.E2E_BASE || API.replace(/\/api$/, "")).replace(
  /\/+$/,
  ""
);
const KNOWN_IDS = [1355, 1356, 1357, 1349];

function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = "/root/.cache/ms-playwright";
  for (const d of fs
    .readdirSync(root)
    .filter((d) => d.startsWith("chromium-"))
    .sort()
    .reverse()) {
    const p = `${root}/${d}/chrome-linux/chrome`;
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`no chromium under ${root}`);
}

function titlesOf(data) {
  return (data.items || []).map((q) => ({ id: q.id, title: q.title || "" }));
}

async function fetchFeeds() {
  const feeds = {};
  feeds["/questions?limit=30"] = titlesOf(await ok("GET", "/questions?limit=30"));
  feeds["/feed/recommended"] = titlesOf(
    await ok("GET", "/feed/recommended?page=1&limit=30")
  );
  feeds["/feed/hot"] = titlesOf(await ok("GET", "/feed/hot"));
  return feeds;
}

function scanFeeds(feeds, label) {
  for (const [name, items] of Object.entries(feeds)) {
    for (const it of items) {
      expect(
        !RESIDUE_RE.test(it.title),
        `${label} ${name} 命中残留形态: #${it.id} ${JSON.stringify(it.title)}`
      );
      expect(
        !KNOWN_IDS.includes(it.id),
        `${label} ${name} 出现已知残留 id #${it.id}`
      );
    }
  }
}

main("feed-no-regression-residue", async () => {
  // ---- 形态自校：正反例 ----
  const tok = `q${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)
    .toString(36)
    .padStart(5, "0")}`; // 全小写字母数字、含数字、≥8 位
  const badTitle = `链路回归 ${tok} 复盘？`;
  const realTitle = `回归分析怎么做才不容易过拟合？`;
  expect(RESIDUE_RE.test(badTitle), "夹具标题未命中 RESIDUE_RE —— 断言形同虚设");
  expect(isTestTitle(badTitle), `isTestTitle 漏判 ${JSON.stringify(badTitle)}`);
  for (const t of [
    realTitle,
    "A/B 测试回归怎么排查？",
    "线上回归测试应该由谁负责？",
  ]) {
    expect(!isTestTitle(t), `isTestTitle 误杀真实标题 ${JSON.stringify(t)}`);
  }

  // ---- 真实形态账号（避免作者命中测试账号规则，只让标题规则起作用）----
  const stamp = Date.now().toString(36);
  const reg = await req("POST", "/auth/register", {
    body: {
      email: `z1078.${stamp}@example.com`,
      password: "assert-pass-123",
      nickname: `走查员${stamp.slice(-4)}`,
    },
  });
  expect(reg.status === 201, `register -> ${reg.status}`);
  const token = reg.data.token;

  // ---- 正向守卫：残留形态问题必须被公共流过滤；真实问题必须可见 ----
  const bad = await req("POST", "/questions", {
    token,
    body: { title: badTitle, detail_md: "Z1078 断言夹具" },
  });
  expect(bad.status === 201, `create bad question -> ${bad.status}`);
  const real = await req("POST", "/questions", {
    token,
    body: { title: realTitle, detail_md: "Z1078 断言夹具" },
  });
  expect(real.status === 201, `create real question -> ${real.status}`);

  const feeds = await fetchFeeds();
  scanFeeds(feeds, "公共流");
  for (const [name, items] of Object.entries(feeds)) {
    expect(
      !items.some((q) => q.id === bad.data.question.id),
      `残留形态问题 #${bad.data.question.id} 泄漏到 ${name}`
    );
  }
  expect(
    feeds["/questions?limit=30"].some((q) => q.id === real.data.question.id),
    `真实问题 #${real.data.question.id} 未出现在 /questions?limit=30 —— 误杀或断言失真`
  );
  expect(
    feeds["/feed/recommended"].some((q) => q.id === real.data.question.id),
    `真实问题 #${real.data.question.id} 未出现在 /feed/recommended`
  );

  // ---- 页面断言：首屏无残留形态标题 + console error = 0（1440 / 390）----
  const browser = await chromium.launch({ executablePath: chromePath() });
  try {
    for (const [w, h, tag] of [
      [1440, 900, "desktop1440"],
      [390, 844, "mobile390"],
    ]) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      const errors = [];
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      await page.waitForSelector(".feed__title", { timeout: 15000 });
      const titles = await page.$$eval(".feed__title", (els) =>
        els.map((e) => (e.textContent || "").trim())
      );
      for (const t of titles) {
        expect(
          !RESIDUE_RE.test(t),
          `${tag} 首屏标题命中残留形态: ${JSON.stringify(t)}`
        );
      }
      expect(
        errors.length === 0,
        `${tag} console error ${errors.length} 条: ${errors.slice(0, 3).join(" | ")}`
      );
      console.log(`  ${tag}: 首屏标题 ${titles.length} 条，console error 0`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
