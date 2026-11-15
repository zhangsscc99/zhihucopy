// notifications.mjs — 他人回答我的问题 → 通知链路端到端验证。
// 契约（Z1025 起）：进 /notifications 前顶栏有未读信号（badge/dot 或 aria-label 含「未读」）；
// 列表渲染出该条后未读自动清零——顶栏角标消失、服务端 unread-count=0、页头「全部已读」；
// 刷新后仍为 0（已读已落库，非仅前端态）。基线（无自动已读）上在「等待清零」处超时 FAIL。
import { run, expect, BASE, register, authedPage, apiOk, uniq } from "./lib.mjs";

// 轮询工具：不靠固定 sleep，条件满足即返回，超时抛错（含最后一次观测值）。
async function until(fn, { timeout = 15000, step = 250, label } = {}) {
  const t0 = Date.now();
  let last;
  for (;;) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    if (Date.now() - t0 >= timeout) {
      const detail =
        last instanceof Error
          ? `；last error: ${last.message}`
          : last !== undefined
            ? `；last: ${JSON.stringify(last)}`
            : "";
      throw new Error(`${label} — ${timeout}ms 内未满足${detail}`);
    }
    await new Promise((r) => setTimeout(r, step));
  }
}

const unreadCount = (token) =>
  apiOk("GET", "/notifications/unread-count", { token }).then((d) => d.count ?? -1);

// 顶栏未读信号元素：角标数字 / 测试标记 / 红点。
const unreadMarks = (page) =>
  page.locator(".topnav .badge, .topnav [data-testid='unread-badge'], .topnav .unread-dot");

// 顶栏无可见未读标记（元素不存在或全部隐藏）。
async function noVisibleUnreadMark(page) {
  const marks = unreadMarks(page);
  const n = await marks.count();
  for (let i = 0; i < n; i++) {
    if (await marks.nth(i).isVisible()) return false;
  }
  return true;
}

run("notifications", async ({ browser }) => {
  const asker = await register(uniq("asker"));
  const answerer = await register(uniq("answerer"));

  const title = `[e2e] ${uniq("q")} — 通知链路验证问题？`;
  const q = await apiOk("POST", "/questions", { token: asker.token, body: { title, detail_md: "e2e notification probe" } });
  await apiOk("POST", `/questions/${q.question.id}/answers`, { token: answerer.token, body: { content_md: "e2e 回答，用于触发通知。" } });

  // 前置：确认服务端已产生未读（通知确实造出来了）。
  await until(async () => (await unreadCount(asker.token)) > 0, {
    label: "asker 的 unread-count 未变 >0（未读通知未造出来）",
  });

  const page = await authedPage(browser, asker.token);

  // 1) 先进首页（尚未进通知页）：顶栏通知入口必须有未读信号，
  //    证明后面的「清零」是通知页触发的，而非信号从未存在。
  await page.goto(`${BASE}/`);
  await until(
    async () =>
      (!(await noVisibleUnreadMark(page))) ||
      (await page.locator(".topnav [aria-label*='未读']").count()) > 0,
    { label: "首页顶栏未出现未读标记（badge/dot/aria-label 未读）" }
  );

  // 2) 进入通知页：等列表把 answerer 触发的那条渲染出来。
  await page.goto(`${BASE}/notifications`);
  const item = page
    .locator(".ntf .ntf__item")
    .filter({ hasText: new RegExp(`${answerer.user.nickname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|回答了你的问题|回答了你的提问`) })
    .first();
  await item.waitFor();

  // 3) 新契约核心：未读自动清零——顶栏角标消失 + 服务端 unread-count=0
  //    + 页头「全部已读」。任一不满足即超时 FAIL。
  await until(
    async () =>
      (await noVisibleUnreadMark(page)) &&
      (await unreadCount(asker.token)) === 0 &&
      /全部已读/.test((await page.locator(".ntf-head__meta").textContent()) || ""),
    { timeout: 15000, label: "进入 /notifications 后未读未自动清零" }
  );
  expect(
    (await page.locator(".ntf .ntf__item--unread").count()) === 0,
    "列表中仍有 .ntf__item--unread 未读样式项"
  );

  // 4) 刷新后仍为 0（已读落库，非临时前端态）。
  await page.reload();
  await page.locator(".ntf .ntf__item").first().waitFor();
  await until(
    async () =>
      (await noVisibleUnreadMark(page)) &&
      (await unreadCount(asker.token)) === 0,
    { timeout: 10000, label: "刷新后未读角标/计数复现" }
  );
});
