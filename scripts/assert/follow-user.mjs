// Z1027 — 他人主页「关注」按钮（浏览器级验收，playwright-core + chromium）：
//   a) A 登录访问 /u/<B.id>：存在可点「关注」按钮（非「已关注」）→ 点击后变
//      「已关注」、页面「粉丝 N」变 N+1 → reload 后仍「已关注」/N+1 →
//      再点取消回「关注」/N。
//   b) A 访问自己主页 /u/<A.id>：没有「关注」按钮（不能关注自己）。
//   c) 未登录访问 /u/<B.id>：按钮在，点击跳 /login?next=/u/<B.id>，
//      登录后回到 B 的主页。
//   d) 频次守卫：以上所有主页打开合计不得触发 >2 次
//      /users/<id>/following?page= 请求（初始态来自 is_following 字段，
//      不允许回退成分页扫描）。
//   基线（/u/:id 无关注按钮、无 is_following）在 a) 的首个 waitFor 即超时 FAIL。
//
// 口径注意：stats.followers / 页面「粉丝 N」会过滤测试形态账号
//   （content-filter），故 A/B 必须注册「真实形态」账号（非测试域邮箱 +
//   非测试昵称），否则关注动作在公共读口径下不可见、断言恒假。
//
// URL 推导：BASE 在本脚本内自行推导（E2E_BASE → API_BASE 去掉结尾 /api →
//   默认实例），再经 E2E_BASE 透传给共享的 e2e/lib.mjs —— lib 本身不认
//   API_BASE 反推 BASE，避免影响其它 e2e 套件寻址。
// 跑法: env API_BASE=http://127.0.0.1:3157/zhihucopy/api \
//       node scripts/assert/follow-user.mjs
//
// 自清理：真实形态账号过不了 cleanup 的测试形态守卫 —— finally 里先
//   DELETE 断 follow（幂等），再把 A/B 昵称 PATCH 成 assert-* 命中口径，
//   lib 退出自清理经 /test-support/cleanup 删除（删用户级联 follows 行）。
import { createRequire } from "node:module";

// BASE 推导留在本脚本：E2E_BASE → API_BASE 去结尾 /api → 默认实例。
// 先于 lib import 设好 E2E_BASE，让共享 lib 寻址到同一实例。
const API_ENV = (process.env.API_BASE || "").replace(/\/+$/, "");
const BASE = (
  process.env.E2E_BASE ||
  API_ENV.replace(/\/api$/, "") ||
  "http://127.0.0.1:3030/zhihucopy"
).replace(/\/+$/, "");
process.env.E2E_BASE ||= BASE;

const { run, expect, api, apiOk, authedPage, uniq } = await import(
  "../e2e/lib.mjs"
);

const requireFromServer = createRequire(
  new URL("../../server/package.json", import.meta.url)
);
const { isTestNickname, isTestEmail } = requireFromServer("./content-filter.js");

// 真实形态账号（同 profile-lists.mjs 思路）：昵称/邮箱都不命中测试模式，
// 其 follow 才计入公共「粉丝 N」口径；返回 email/password 供 UI 登录。
async function registerReal() {
  const nickname = `真人${uniq("n").replace(/-/g, "")}`.slice(0, 24);
  const email = `${uniq("real")}@zhihucopy.dev`;
  const password = "assert-pass-123";
  expect(!isTestNickname(nickname), `nickname ${nickname} 命中测试模式`);
  expect(!isTestEmail(email), `email ${email} 命中测试域`);
  const r = await api("POST", "/auth/register", {
    body: { email, password, nickname },
  });
  expect(
    r.status === 201,
    `register -> ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`
  );
  return { token: r.data.token, user: r.data.user, email, password };
}

// 改名为 assert-* 测试形态，让退出自清理可以删这个账号。
async function markForCleanup(u) {
  const r = await api("PATCH", "/users/me", {
    token: u.token,
    body: { nickname: `assert-fu${uniq("x").replace(/-/g, "")}`.slice(0, 24) },
  });
  expect(r.status < 300, `rename for cleanup -> ${r.status}`);
}

// 「粉丝 N」统计格：.profile__stats 里 dt=粉丝 的格子，整格文本须恰为「粉丝N」。
const fansStat = (page, n) =>
  page
    .locator(".profile__stats > div")
    .filter({ hasText: new RegExp(`^\\s*粉丝\\s*${n}\\s*$`) });

// 计数器：命中「我关注的人」分页扫描式请求（初始关注态只允许走
// /users/:id 的 is_following 字段，不再翻 following 列表）。
let followScanReqs = 0;
const watchFollowScan = (p) =>
  p.on("request", (r) => {
    const u = r.url();
    if (/\/users\/\d+\/following\?/.test(u) && /[?&]page=\d+/.test(u)) {
      followScanReqs += 1;
    }
  });

run("follow-user", async ({ browser, page }) => {
  const a = await registerReal();
  const b = await registerReal();
  const aId = a.user.id;
  const bId = b.user.id;
  watchFollowScan(page);

  try {
    // 服务器口径的基线粉丝数（与页面「粉丝 N」同源）。
    const base = (await apiOk("GET", `/users/${bId}`)).stats.followers;

    // ---- a) A → B：关注 → 刷新保持 → 取消 --------------------------------
    const pa = await authedPage(browser, a.token);
    watchFollowScan(pa);
    await pa.goto(`${BASE}/u/${bId}`);
    await pa.locator(".profile__name").waitFor();

    // 可点的「关注」按钮存在，且文案不是「已关注」（基线无此按钮 → 超时 FAIL）。
    const btn = pa.getByRole("button", { name: /关注/ });
    await btn.waitFor();
    expect(
      (await btn.textContent()).trim() === "关注",
      `关注按钮初始文案应为「关注」，实际「${(await btn.textContent()).trim()}」`
    );
    await fansStat(pa, base).waitFor();

    await btn.click();
    await pa.getByRole("button", { name: "已关注", exact: true }).waitFor();
    await fansStat(pa, base + 1).waitFor();

    // reload 后仍为「已关注」且粉丝数保持 N+1（初始态来自 is_following 字段）。
    await pa.reload();
    await pa.getByRole("button", { name: "已关注", exact: true }).waitFor();
    await fansStat(pa, base + 1).waitFor();

    // 再点一次取消关注：文案回「关注」，粉丝数回 N。
    await pa.getByRole("button", { name: "已关注", exact: true }).click();
    await pa.getByRole("button", { name: "关注", exact: true }).waitFor();
    await fansStat(pa, base).waitFor();

    // ---- b) A → A：自己主页没有「关注」按钮 -------------------------------
    await pa.goto(`${BASE}/u/${aId}`);
    await pa.locator(".profile__name").waitFor();
    // 「收藏」tab 仅 isMe 渲染 —— 等它出现说明 auth 与 isMe 判定都已落定，
    // 此时数按钮为 0 才是真的「没有」，而不是 auth 未就绪的暂态。
    await pa.getByRole("link", { name: /收藏/ }).waitFor();
    expect(
      (await pa.getByRole("button", { name: /关注/ }).count()) === 0,
      "自己主页不应出现「关注」按钮"
    );

    // ---- c) 未登录 → B：点关注跳 /login?next=，登录后回 B 主页 -------------
    await page.goto(`${BASE}/u/${bId}`);
    await page.getByRole("button", { name: "关注", exact: true }).waitFor();
    await page.getByRole("button", { name: /关注/ }).click();
    await page.waitForURL(/\/login(\?|$)/);
    const here = new URL(page.url());
    expect(
      here.searchParams.get("next") === `/u/${bId}`,
      `点击关注应跳 /login?next=/u/${bId}，实际 ${page.url()}`
    );

    // 在带 next 的登录页直接登录 → 应回到 B 的主页。
    await page.getByLabel("邮箱").fill(a.email);
    await page.getByLabel("密码").fill(a.password);
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL(new RegExp(`/u/${bId}$`));
    await page.locator(".profile__name").waitFor();
    await page.getByRole("button", { name: /关注/ }).waitFor();

    // ---- d) 频次守卫：主页打开不再触发 following 分页扫描 ------------------
    expect(
      followScanReqs <= 2,
      `打开他人主页触发 ${followScanReqs} 次 /users/<id>/following?page= 分页扫描（应 ≤2）`
    );
  } finally {
    // 断 follow（幂等）+ 改名测试形态，交给 lib 退出自清理删账号。
    await api("DELETE", `/users/${bId}/follow`, { token: a.token }).catch(() => {});
    for (const u of [a, b]) await markForCleanup(u).catch(() => {});
  }
});
