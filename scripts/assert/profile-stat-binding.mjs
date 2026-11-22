// Z1267 — 个人页统计字段绑定：三项固定「获赞 / 粉丝 / 关注」，
//   分别读 GET /api/users/:id 的 {vote_up, followers, following}；
//   页面不得再出现「关注者」label。
//
// 契约：
//   1) 取种子用户 uid（默认 6824，取不到退化为 GET /users?limit=50 第一项）；
//      GET /users/<uid> 拿 {vote_up, followers, following}。
//   2) 匿名访问 /u/<uid>，读 .profile__stats 下 dt 文本数组 + dd 数字数组。
//   3) label 数组 === ["获赞","粉丝","关注"]（顺序一致，无「关注者」）。
//   4) 三项数字与接口严格相等：获赞===vote_up、粉丝===followers、关注===following。
//   5) page.reload() 后 label 与数字仍与接口一致。
//   6) 390×844：三项容器等宽（宽差 ≤2px）、scrollWidth===390、不换行；
//      1440×900 再跑一遍 label + 数值断言。
//   7) window.__errs（error/unhandledrejection/console.error）为空。
//   8) 全程只读：不关注/取关、不写库、不建号。
//
// 基线（旧代码 label「关注者」+ 绑 stats.following）：步骤 3 的 label 断言
//   首先 FAIL（实得 ["获赞","关注者","粉丝"]），且即使放过 label，旧 DOM 的
//   dd[1]===following 也会在「粉丝===followers」上 FAIL。
//
// Env: E2E_BASE / E2E_API / API_BASE / CHROME（见 scripts/e2e/lib.mjs）。
//   默认 http://127.0.0.1:3030/zhihucopy。
const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
if (!process.env.E2E_API) process.env.E2E_API = API_BASE;
if (!process.env.E2E_BASE) process.env.E2E_BASE = API_BASE.replace(/\/api$/, "");

const { run, expect, BASE, apiOk } = await import("../e2e/lib.mjs");

const LABELS = ["获赞", "粉丝", "关注"];

async function injectErrs(page) {
  await page.addInitScript(() => {
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

async function pickUid() {
  try {
    const d = await apiOk("GET", "/users/6824");
    if (d && d.user && d.user.id) return d.user.id;
  } catch {
    /* fall through to list */
  }
  const list = await apiOk("GET", "/users?limit=50");
  const item = (list.items || [])[0];
  expect(item && item.id, "no seed user found via /users?limit=50");
  return item.id;
}

// 读 .profile__stats：{labels, values, widths}
async function readStats(page) {
  return page.evaluate(() => {
    const box = document.querySelector(".profile__stats");
    if (!box) return null;
    const divs = [...box.querySelectorAll(":scope > div")];
    return {
      labels: divs.map((d) => d.querySelector("dt")?.textContent.trim() || ""),
      values: divs.map((d) => Number(d.querySelector("dd")?.textContent.trim())),
      widths: divs.map((d) => d.getBoundingClientRect().width),
    };
  });
}

function expectStats(got, stats, where) {
  expect(got, `${where}: .profile__stats 不存在`);
  expect(
    JSON.stringify(got.labels) === JSON.stringify(LABELS),
    `${where}: labels ${JSON.stringify(got.labels)} !== ${JSON.stringify(LABELS)}（不得含「关注者」）`
  );
  const want = [stats.vote_up, stats.followers, stats.following];
  expect(
    JSON.stringify(got.values) === JSON.stringify(want),
    `${where}: values ${JSON.stringify(got.values)} !== api ${JSON.stringify(want)}`
  );
}

run("profile-stat-binding", async ({ page }) => {
  const uid = await pickUid();
  const { stats } = await apiOk("GET", `/users/${uid}`);
  expect(
    ["vote_up", "followers", "following"].every((k) => Number.isFinite(stats[k])),
    `GET /users/${uid} stats 缺字段: ${JSON.stringify(stats)}`
  );
  console.log(`  uid=${uid} api stats: vote_up=${stats.vote_up} followers=${stats.followers} following=${stats.following}`);

  await injectErrs(page);

  // ---- 390×844 ----
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/u/${uid}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".profile__stats dd");
  let got = await readStats(page);
  expectStats(got, stats, "390 首载");

  // 刷新后仍稳定一致
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".profile__stats dd");
  got = await readStats(page);
  expectStats(got, stats, "390 刷新后");

  // 等宽 + 不横向溢出
  const w = got.widths;
  expect(w.length === 3, `390: 统计项个数 ${w.length} !== 3`);
  const spread = Math.max(...w) - Math.min(...w);
  expect(spread <= 2, `390: 三项不等宽 spread=${spread.toFixed(2)}px widths=${JSON.stringify(w)}`);
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollW === 390, `390: scrollWidth=${scrollW} !== 390`);

  // ---- 1440×900 ----
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/u/${uid}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".profile__stats dd");
  got = await readStats(page);
  expectStats(got, stats, "1440 首载");

  const errs = await page.evaluate(() => window.__errs || []);
  expect(errs.length === 0, `window.__errs 非空: ${JSON.stringify(errs.slice(0, 5))}`);
});
