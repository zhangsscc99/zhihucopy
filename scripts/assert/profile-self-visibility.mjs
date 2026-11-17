// Z1085 — 个人主页自见口径（viewer === author 时放开测试内容过滤）：
//   1) 测试账号（@test.dev 注册 → is_test=1）发 1 个测试标题问题 + 1 条回答；
//   2) 本人视角（带本人 token）：
//      - GET /users/<me> 的 stats.answers / stats.questions >= 1；
//      - GET /answers?author=<me> 含该回答、GET /questions?author=<me> 含该问题
//        （stats 与列表同口径互证）；
//      - 浏览器登录态打开 /u/<me>，回答 tab 出现指向该问题的链接；
//   3) 访客视角（另一账号 token 与匿名请求）：
//      - stats.answers / stats.questions === 0、两个 ?author= 列表 total === 0；
//      - /u/<me> 页面看不到该问题链接且落入「还没有回答」空态 ——
//        防「把测试过滤全删了」的假修。
// 跑法: API_BASE=http://127.0.0.1:3165/zhihucopy/api \
//       [E2E_BASE=http://127.0.0.1:3165/zhihucopy] \
//       node scripts/assert/profile-self-visibility.mjs
// 清理: 全部 POST 经 lib.req() 自动 trackOwned(u:/q:/a:)，进程退出自清理。
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { API, ok, req, register, expect, main, uniq } from "./lib.mjs";

const requireFromServer = createRequire(
  new URL("../../server/package.json", import.meta.url)
);
const { isTestTitle } = requireFromServer("./content-filter.js");

const TOKEN_KEY = "zhihu_token";

// ---- 页面校验（playwright-core，chromium 缺席时跳过，API 断言仍生效） ----------

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

async function profilePage(browser, e2eBase, token, userId) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "zh-CN",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  if (token) {
    await page.addInitScript(
      ([k, t]) => localStorage.setItem(k, t),
      [TOKEN_KEY, token]
    );
  }
  await page.goto(`${e2eBase}/u/${userId}`);
  await page.locator(".profile__name, h1").first().waitFor();
  return page;
}

async function checkPages({ userId, titleFrag, selfToken, visitorToken }) {
  const e2eBase = (process.env.E2E_BASE || API.replace(/\/api$/, "")).replace(
    /\/+$/,
    ""
  );
  let chromium;
  try {
    const requireFromE2E = createRequire(
      new URL("../e2e/lib.mjs", import.meta.url)
    );
    ({ chromium } = requireFromE2E("playwright-core"));
    chromePath(); // 无浏览器二进制时在此抛出
  } catch (e) {
    console.log(`  note: 无 playwright/chromium，跳过页面校验（${e.message}）`);
    return;
  }
  const browser = await chromium.launch({
    executablePath: chromePath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  try {
    // 本人主页：回答 tab 出现指向刚回答问题的链接。
    const mine = await profilePage(browser, e2eBase, selfToken, userId);
    await mine
      .getByRole("link", { name: titleFrag })
      .first()
      .waitFor({ timeout: 8000 });
    // 访客（登录态另一账号）看同一主页：列表落空态、无该链接。
    const other = await profilePage(browser, e2eBase, visitorToken, userId);
    await other.locator(".empty, .plist__item").first().waitFor();
    expect(
      (await other.getByRole("link", { name: titleFrag }).count()) === 0,
      "访客视角的个人主页仍能看到测试内容链接"
    );
    expect(
      ((await other.locator("body").textContent()) || "").includes(
        "还没有回答"
      ),
      "访客视角个人主页应落入「还没有回答」空态"
    );
    console.log("  E2E: 本人 /u/<me> 可见回答链接，访客视角不可见且空态");
  } finally {
    await browser.close();
  }
}

main("profile-self-visibility", async () => {
  // 本人：@test.dev 注册 → is_test=1；问题标题带 [t] 测试标记，
  // 双保险让回答对访客必然被 AUTHOR_ANSWERS_SQL 过滤。
  const me = await register(`assert-${uniq("u")}`);
  const frag = uniq("selfq");
  const title = `[t] ${frag} 个人主页自见性问题？`;
  expect(isTestTitle(title), `标题「${title}」未命中测试模式`);

  const { question } = await ok("POST", "/questions", {
    token: me.token,
    body: { title, detail_md: "profile-self-visibility 验收问题" },
  });
  const { answer } = await ok("POST", `/questions/${question.id}/answers`, {
    token: me.token,
    body: { content_md: `${frag} —— 自己主页要能看到自己写的内容。` },
  });

  // —— 本人视角（API）——
  const selfStats = (await ok("GET", `/users/${me.user.id}`, { token: me.token }))
    .stats;
  expect(
    selfStats.answers >= 1,
    `本人视角 stats.answers=${selfStats.answers}，期望 >=1`
  );
  expect(
    selfStats.questions >= 1,
    `本人视角 stats.questions=${selfStats.questions}，期望 >=1`
  );
  const selfAnswers = await ok("GET", `/answers?author=${me.user.id}&limit=20`, {
    token: me.token,
  });
  expect(
    selfAnswers.items.some((it) => it.id === answer.id),
    "本人视角 /answers?author= 未返回自己的回答"
  );
  const selfQuestions = await ok(
    "GET",
    `/questions?author=${me.user.id}&limit=20`,
    { token: me.token }
  );
  expect(
    selfQuestions.items.some((it) => it.id === question.id),
    "本人视角 /questions?author= 未返回自己的提问"
  );
  console.log(
    `  API(self): answers=${selfStats.answers}, questions=${selfStats.questions} — 与列表一致`
  );

  // —— 访客视角（另一账号 + 匿名）——
  const other = await register(`assert-${uniq("v")}`);
  for (const [label, token] of [
    ["visitor", other.token],
    ["anonymous", undefined],
  ]) {
    const stats = (await ok("GET", `/users/${me.user.id}`, { token })).stats;
    expect(
      stats.answers === 0 && stats.questions === 0,
      `${label} 视角 stats 应为 0，实际 answers=${stats.answers} questions=${stats.questions}`
    );
    const as = await ok("GET", `/answers?author=${me.user.id}&limit=20`, {
      token,
    });
    expect(
      as.total === 0,
      `${label} 视角 /answers?author= total=${as.total}，期望 0`
    );
    const qs = await ok("GET", `/questions?author=${me.user.id}&limit=20`, {
      token,
    });
    expect(
      qs.total === 0,
      `${label} 视角 /questions?author= total=${qs.total}，期望 0`
    );
    console.log(`  API(${label}): stats 与两个 ?author= 列表均为 0`);
  }

  // —— 页面校验 ——
  await checkPages({
    userId: me.user.id,
    titleFrag: frag,
    selfToken: me.token,
    visitorToken: other.token,
  });
});
