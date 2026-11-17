// Z1095 — 通知动作文案断言（浏览器级）。
//
// 契约：
//   1) /notifications 可见行里不得出现兜底文案「与你互动了」；
//   2) 若库中有 type='reply' 的通知，至少一行文案为「回复了你的评论」；
//   3) 每行动作文案 ∈ 白名单（赞同了你的回答 / 评论了你的回答 /
//      回复了你的评论 / 关注了你 / 回答了你的问题）；
//   4) 1440×900 与 390×844 各跑一遍：window.__errs 为空、无横向溢出、非白屏；
//   5) API 侧 GET /api/notifications 每个 item 的 event_label 非空且不含「互动」。
//
// 受体账号：reply 通知只能由种子数据产生（服务端回复评论时落的是 'comment'），
// 故从 DB_PATH 指一个「有 reply、无 moderation、类型均在白名单映射内」的种子
// 账号（user<id>@zhihucopy.dev / zhihu123456）登录；造不出账号直接 FAIL，不伪造。
//
// 环境：verify.sh 透传 API_BASE；e2e/lib.mjs 的 BASE/API 在模块加载时定型，
// 故先按 API_BASE 反推 E2E_BASE/E2E_API 再动态 import。
const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
if (!process.env.E2E_API) process.env.E2E_API = API_BASE;
if (!process.env.E2E_BASE) process.env.E2E_BASE = API_BASE.replace(/\/api$/, "");

const { run, expect, BASE, authedPage, api, apiOk } = await import("../e2e/lib.mjs");
const { db } = await import("./lib.mjs");

const SEED_PASSWORD = "zhihu123456";
const WHITELIST = new Set([
  "赞同了你的回答",
  "评论了你的回答",
  "回复了你的评论",
  "关注了你",
  "回答了你的问题",
]);
const COVERED_TYPES = new Set(["agree", "vote", "comment", "reply", "follow", "answer"]);

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

const pageErrs = (page) => page.evaluate(() => window.__errs || []);

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];

// 挑受体：有 reply 通知、type 集合 ⊆ 已覆盖类型（无 moderation 等未白名单文案），
// 邮箱形态 user<id>@zhihucopy.dev 的种子号；类型覆盖越多越好。
function pickRecipient() {
  const uids = db()
    .prepare("SELECT DISTINCT user_id FROM notifications WHERE type = 'reply'")
    .all()
    .map((r) => r.user_id);
  let best = null;
  for (const uid of uids) {
    const u = db().prepare("SELECT id, email FROM users WHERE id = ?").get(uid);
    if (!u || u.email !== `user${uid}@zhihucopy.dev`) continue;
    const types = db()
      .prepare("SELECT DISTINCT type FROM notifications WHERE user_id = ?")
      .all(uid)
      .map((r) => r.type);
    if (!types.every((t) => COVERED_TYPES.has(t))) continue;
    if (!best || types.length > best.types.length) best = { uid, email: u.email, types };
  }
  return best;
}

// 行的动作片段：`.ntf__action` 渲染成「 · <文案>」，剥掉分隔符比对。
function actionTexts(page) {
  return page.$$eval(".ntf__item .ntf__action", (els) =>
    els.map((e) => e.textContent.replace(/^[\s·]+/, "").trim())
  );
}

run("notification-copy", async ({ browser }) => {
  const recipient = pickRecipient();
  expect(
    recipient,
    "库里没有可用的 reply 通知受体（需 user<id>@zhihucopy.dev 种子号，且其通知类型均在白名单映射内）"
  );

  const login = await api("POST", "/auth/login", {
    body: { email: recipient.email, password: SEED_PASSWORD },
  });
  expect(login.status === 200, `种子号 ${recipient.email} 登录失败 -> ${login.status}`);
  const token = login.data.token;

  // ---- API 侧：每个 item 的 event_label 非空、无「互动」、在白名单内 ----
  const list = await apiOk("GET", "/notifications?limit=50", { token });
  const items = list.items || [];
  expect(items.length > 0, `${recipient.email} 的通知列表为空，断言无意义`);
  for (const n of items) {
    expect(
      typeof n.event_label === "string" && n.event_label.length > 0,
      `通知 #${n.id} (type=${n.type}) event_label 为空`
    );
    expect(
      !n.event_label.includes("互动"),
      `通知 #${n.id} (type=${n.type}) event_label 含糊：「${n.event_label}」`
    );
    expect(
      WHITELIST.has(n.event_label),
      `通知 #${n.id} (type=${n.type}) event_label「${n.event_label}」不在白名单`
    );
  }
  const replyItem = items.find((n) => n.type === "reply");
  expect(replyItem, `${recipient.email} 列表里找不到 type='reply' 的通知`);
  expect(
    replyItem.event_label === "回复了你的评论",
    `reply 通知 event_label 应为「回复了你的评论」，实际「${replyItem.event_label}」`
  );

  // ---- 浏览器侧：两视口各断言一遍 ----
  const page = await authedPage(browser, token);
  await injectErrs(page);
  for (const vp of VIEWPORTS) {
    await page.setViewportSize(vp);
    await page.goto(`${BASE}/notifications`);
    await page.locator(".ntf__item").first().waitFor();

    const texts = await actionTexts(page);
    expect(texts.length > 0, `${vp.width}px 视口下没有通知行`);
    expect(
      texts.every((t) => !t.includes("互动")),
      `${vp.width}px 视口出现含糊文案：${JSON.stringify(texts.filter((t) => t.includes("互动")))}`
    );
    for (const t of texts) {
      expect(WHITELIST.has(t), `${vp.width}px 视口动作文案「${t}」不在白名单`);
    }
    expect(
      texts.includes("回复了你的评论"),
      `${vp.width}px 视口没有「回复了你的评论」行：${JSON.stringify(texts)}`
    );

    const bodyLen = await page.evaluate(() => document.body.innerText.length);
    expect(bodyLen > 200, `${vp.width}px 视口页面内容过少：innerText=${bodyLen}`);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    );
    expect(!overflow, `${vp.width}px 视口出现横向溢出`);
    const errs = await pageErrs(page);
    expect(errs.length === 0, `${vp.width}px 视口页面错误：${errs.join(" | ")}`);
  }

  console.log(
    `[notification-copy] 受体=${recipient.email} types=${recipient.types.join(",")} ` +
      `items=${items.length} 两视口文案白名单/无「互动」/reply 文案全部通过`
  );
});
