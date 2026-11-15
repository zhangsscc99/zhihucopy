// Z988 — 个人主页内容列表（统计与内容互证）：
//   1) 造一个「真实」用户 + 1 个问题 + 1 个回答；
//   2) GET /answers?author=<id> 与 GET /questions?author=<id> 都返回该内容；
//   3) GET /users/<id> 的 stats.answers / stats.questions 与两个列表的 total 相等；
//   4) 设了 E2E_BASE 时，再用 playwright-core（chromium --no-sandbox）打开 /u/<id>，
//      断言页面里存在回答卡片文本与「回答 / 提问」tab。
//
// 关于「[t] 测试标记」的口径说明：Z983 起 content-filter 会把测试标记标题/账号
//   从 ?author= 列表与 stats 里整体过滤 —— 标题带 [t] 时列表必然为空，与
//   「列表返回该内容」直接冲突。故本脚本沿用 stats-consistency.mjs 的做法：
//   标题/昵称/邮箱都不命中测试模式（保证可见），产物按 id 跟踪，跑完物理删除。
//
// 跑法: API_BASE=http://127.0.0.1:3176/zhihucopy/api \
//       [E2E_BASE=http://127.0.0.1:3176/zhihucopy] [DB_PATH=<db>] \
//       node scripts/assert/profile-lists.mjs
// 清理: req() 的 POST 响应自动 trackOwned(q:/a:/u:)，退出时 cleanup-artifacts
//   按 owned id 删问题/回答；设 DB_PATH 时脚本结尾再物理删自建账号。
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { ok, req, expect, main } from "./lib.mjs";

const requireFromServer = createRequire(
  new URL("../../server/package.json", import.meta.url)
);
const { isTestTitle, isTestNickname, isTestEmail } = requireFromServer(
  "./content-filter.js"
);

const created = { userIds: [], questionIds: [], answerIds: [] };
const stamp = Date.now().toString(36);

// 真实用户：昵称/邮箱都不命中 content-filter 的测试形态，内容才会出现在
// ?author= 列表与 stats 里。不走 lib.register（@test.dev 会被判测试账号）。
async function registerReal() {
  const nickname = `z988user${stamp}`;
  const email = `z988.${stamp}@example.com`;
  expect(!isTestNickname(nickname), `nickname ${nickname} 命中测试模式`);
  expect(!isTestEmail(email), `email ${email} 命中测试域`);
  const r = await req("POST", "/auth/register", {
    body: { email, password: "assert-pass-123", nickname },
  });
  expect(r.status === 201, `register real user -> ${r.status} ${JSON.stringify(r.data)}`);
  created.userIds.push(r.data.user.id);
  return { token: r.data.token, user: r.data.user };
}

function cleanup() {
  const dbPath = process.env.DB_PATH;
  if (!dbPath) {
    console.log("  note: 未设 DB_PATH，自建账号保留（其问题/回答已由 owned 清理）");
    return;
  }
  const Database = requireFromServer("better-sqlite3");
  const db = new Database(path.resolve(dbPath));
  try {
    db.transaction(() => {
      for (const id of created.answerIds)
        db.prepare("DELETE FROM answers WHERE id = ?").run(id);
      for (const id of created.questionIds) {
        db.prepare("DELETE FROM question_topics WHERE question_id = ?").run(id);
        db.prepare("DELETE FROM answers WHERE question_id = ?").run(id);
        db.prepare("DELETE FROM questions WHERE id = ?").run(id);
      }
      for (const id of created.userIds) {
        db.prepare("DELETE FROM notifications WHERE user_id = ? OR actor_id = ?").run(id, id);
        db.prepare("DELETE FROM follows WHERE follower_id = ?").run(id);
        db.prepare("DELETE FROM users WHERE id = ?").run(id);
      }
    })();
    console.log("  cleanup: 已删除自建用户/问题/回答");
  } finally {
    db.close();
  }
}

// ---- E2E（仅 E2E_BASE 设置时执行） -------------------------------------------

function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = "/root/.cache/ms-playwright";
  for (const d of fs.readdirSync(root).filter((d) => d.startsWith("chromium-")).sort().reverse()) {
    const p = path.join(root, d, "chrome-linux", "chrome");
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`no chromium under ${root}`);
}

async function checkPage({ userId, questionTitle, answerText }) {
  const base = (process.env.E2E_BASE || "").replace(/\/+$/, "");
  if (!base) {
    console.log("  note: 未设 E2E_BASE，跳过页面校验");
    return;
  }
  // playwright-core 装在 scripts/e2e/node_modules（e2e lib 同款解析路径）。
  const requireFromE2E = createRequire(new URL("../e2e/lib.mjs", import.meta.url));
  const { chromium } = requireFromE2E("playwright-core");
  const browser = await chromium.launch({
    executablePath: chromePath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: "zh-CN",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(`${base}/u/${userId}`);

    // 回答 / 提问 两个 tab 存在
    for (const label of ["回答", "提问"]) {
      await page
        .locator(".profile__tabs .tabs__tab", { hasText: label })
        .first()
        .waitFor();
    }

    // 默认回答 tab：回答卡片（问题标题 + 回答摘要）出现在列表里
    const plist = page.locator(".plist");
    await plist.locator(".plist__item").first().waitFor();
    expect(
      (await plist.textContent()).includes(questionTitle),
      "回答 tab 未显示所属问题标题"
    );
    expect(
      (await plist.textContent()).includes(answerText.slice(0, 20)),
      "回答 tab 未显示回答摘要"
    );

    // 切到提问 tab：同一问题标题以提问卡片出现（「N 个回答」元信息是提问卡特征，
    // 避免等的是尚未卸载的回答卡）。
    await page.locator(".profile__tabs .tabs__tab", { hasText: "提问" }).first().click();
    await page
      .locator(".plist .plist__item", { hasText: "个回答" })
      .first()
      .waitFor();
    expect(
      (await plist.textContent()).includes(questionTitle),
      "提问 tab 未显示问题标题"
    );
    console.log("  E2E: /u/<id> 页面 tab 与回答/提问卡片均在");
  } finally {
    await browser.close();
  }
}

main("profile-lists", async () => {
  try {
    const { token, user } = await registerReal();

    const title = `Z988 个人主页可见性问题 ${stamp}?`;
    const answerText = `Z988 个人主页可见性回答 ${stamp}：用于校验回答卡片摘要与统计互证。`;
    expect(!isTestTitle(title), `标题「${title}」命中测试模式，会被 ?author= 过滤`);

    const q = await ok("POST", "/questions", {
      token,
      body: { title, detail_md: "profile-lists 验收问题" },
    });
    created.questionIds.push(q.question.id);
    const a = await ok("POST", `/questions/${q.question.id}/answers`, {
      token,
      body: { content_md: answerText },
    });
    created.answerIds.push(a.answer.id);

    // 两个 ?author= 列表都返回该内容
    const qs = await ok("GET", `/questions?author=${user.id}&limit=50`);
    expect(qs.total === 1, `/questions?author total=${qs.total}，期望 1`);
    expect(
      qs.items.some((it) => it.id === q.question.id && it.title === title),
      "问题列表未返回新建问题"
    );
    const as = await ok("GET", `/answers?author=${user.id}&limit=50`);
    expect(as.total === 1, `/answers?author total=${as.total}，期望 1`);
    const hit = as.items.find((it) => it.id === a.answer.id);
    expect(hit, "回答列表未返回新建回答");
    expect(
      hit.question_title === title && hit.question_id === q.question.id,
      "回答卡片缺少所属问题标题/链接"
    );

    // stats 与列表 total 互证
    const { stats } = await ok("GET", `/users/${user.id}`);
    expect(
      stats.questions === qs.total,
      `stats.questions=${stats.questions} != /questions?author total=${qs.total}`
    );
    expect(
      stats.answers === as.total,
      `stats.answers=${stats.answers} != /answers?author total=${as.total}`
    );
    console.log(
      `  API: /users/${user.id} questions=${stats.questions}, answers=${stats.answers} — 与列表一致`
    );

    await checkPage({ userId: user.id, questionTitle: title, answerText });
  } finally {
    cleanup();
  }
});
