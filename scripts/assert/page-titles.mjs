// Z1160 — document.title 恒定：每页「主体 · 知乎（仿）」，首页为默认站点标题。
// 覆盖 首页 / 问题 / 搜索 / 用户主页 / 通知 / 热榜 tab：≥5 个 title 两两不同、
// 均以「 · 知乎（仿）」结尾（首页为默认全名）、无 undefined/null/空主体；
// 回首页恢复默认标题；1440/390 无横向溢出、window.__errs 为空。
// 反向自检：对未修基线 /www/zhihucopy（E2E_BASE 指向其端口）跑本脚本必须 FAIL。
import {
  run, expect, BASE, apiOk,
} from "../e2e/lib.mjs";

const SITE_TITLE = "知乎（仿） · 有问题，就会有答案";
const SUFFIX = " · 知乎（仿）";

const ROUTES = [
  { key: "home", path: "/" },
  { key: "question", path: "/question/6" },
  { key: "search", path: "/search?q=React" },
  { key: "user", path: "/u/27" },
  { key: "notifications", path: "/notifications" },
  { key: "hot", path: "/?tab=hot" },
];

function watchErrs(page) {
  return page.addInitScript(() => {
    window.__errs = [];
    window.addEventListener("error", (e) => window.__errs.push(String(e.message || e)));
    window.addEventListener("unhandledrejection", (e) => window.__errs.push(String(e.reason)));
    const ce = console.error.bind(console);
    console.error = (...a) => {
      window.__errs.push(a.map(String).join(" "));
      return ce(...a);
    };
  });
}

// title 稳定后取值：100ms 轮询，连续两次采样一致（非空）即定稿，上限 2s。
async function stableTitle(page) {
  let prev = "";
  let cur = await page.title();
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(100);
    cur = await page.title();
    if (cur && cur === prev) break;
    prev = cur;
  }
  return cur;
}

async function checkChrome(page, key, vw) {
  const sw = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
  );
  expect(sw <= vw, `${key} ${vw}px：横向溢出 scrollWidth=${sw}`);
  const errs = await page.evaluate(() => window.__errs || []);
  expect(errs.length === 0, `${key} ${vw}px：页面错误：${errs.join(" | ")}`);
}

run("page-titles", async ({ page }) => {
  await watchErrs(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  // 期望素材：问题 6 标题、用户 27 昵称（基线/工作树同一种子库）。
  const q6 = await apiOk("GET", "/questions/6");
  const qTitle = String(q6.question.title);
  const u27 = await apiOk("GET", "/users/27");
  const nickname = String(u27.user.nickname);

  const titles = {};
  for (const r of ROUTES) {
    await page.goto(`${BASE}${r.path}`, { waitUntil: "domcontentloaded" });
    const t = await stableTitle(page);
    titles[r.key] = t;
    console.log(`  ${r.key.padEnd(13)} ${r.path.padEnd(18)} → ${t}`);

    // 任一 title 不得含 undefined / null，也不得是「 · 知乎（仿）」开头的空主体。
    expect(!/undefined|null/i.test(t), `${r.path} title 含 undefined/null：${t}`);
    expect(!t.startsWith(SUFFIX), `${r.path} title 空主体：${t}`);
    expect(t.trim().length > 0, `${r.path} title 为空`);

    await checkChrome(page, r.key, 1440);
  }

  // ≥5 个 title 两两不同。
  const uniq = new Set(Object.values(titles));
  expect(uniq.size >= 5, `title 去重后仅 ${uniq.size} 个（期望 ≥5）：${JSON.stringify(titles)}`);

  // 除首页默认标题外，每页均以「 · 知乎（仿）」结尾。
  for (const r of ROUTES) {
    const t = titles[r.key];
    if (r.key === "home") {
      expect(t === SITE_TITLE, `/ title 应为默认站点标题，实际：${t}`);
    } else {
      expect(t.endsWith(SUFFIX), `${r.path} title 未以「 · 知乎（仿）」结尾：${t}`);
      expect(t !== SITE_TITLE, `${r.path} title 仍是默认站点标题：${t}`);
    }
  }

  // 页面主体与数据对账。
  expect(
    titles.question.includes(Array.from(qTitle).slice(0, 8).join("")),
    `问题页 title 未含标题前 8 字「${Array.from(qTitle).slice(0, 8).join("")}」：${titles.question}`
  );
  expect(titles.search.includes("React"), `搜索页 title 未含关键词 React：${titles.search}`);
  expect(
    titles.user.startsWith(nickname),
    `用户页 title 未以昵称「${nickname}」开头：${titles.user}`
  );
  expect(titles.hot.startsWith("热榜"), `热榜 title 异常：${titles.hot}`);
  expect(titles.notifications.startsWith("通知"), `通知页 title 异常：${titles.notifications}`);

  // 返回首页：title 恢复默认站点标题。
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  const back = await stableTitle(page);
  expect(back === SITE_TITLE, `返回 / 后 title 未恢复默认：${back}`);

  // 390 移动宽度复检（取问题页 + 搜索页两个代表路由）。
  await page.setViewportSize({ width: 390, height: 844 });
  for (const r of [ROUTES[1], ROUTES[2]]) {
    await page.goto(`${BASE}${r.path}`, { waitUntil: "domcontentloaded" });
    await stableTitle(page);
    await checkChrome(page, r.key, 390);
  }
});
