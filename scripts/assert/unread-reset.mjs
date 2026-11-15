// Z1025 — 浏览器级断言（Playwright）：进入 /notifications 列表成功加载后，
// 前端必须自动把当前未读通知标为已读：顶栏未读角标消失、页头显示「全部已读」、
// 服务端 unread-count 落 0，刷新页面后仍为 0（已读已落库，非仅前端态）。
// 「自动已读」是纯前端行为，HTTP 级断言在基线上恒真，故必须用真实浏览器跑；
// 基线（无自动已读）上本断言在「等待清零」处超时 FAIL。

// URL 推导需在 e2e/lib.mjs 求值前写入 env（lib 在模块顶层固化 BASE/API），故用动态 import。
const apiBaseEnv = (process.env.API_BASE || "").replace(/\/+$/, "");
const derivedBase = apiBaseEnv.replace(/\/api$/, "");
process.env.E2E_BASE =
  process.env.E2E_BASE || derivedBase || "http://127.0.0.1:3030/zhihucopy";
process.env.E2E_API =
  process.env.E2E_API || apiBaseEnv || `${process.env.E2E_BASE}/api`;

const { run, expect, BASE, register, authedPage, apiOk, uniq } = await import(
  "../e2e/lib.mjs"
);

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
  apiOk("GET", "/notifications/unread-count", { token }).then(
    (d) => d.count ?? -1
  );

// 顶栏铃铛角标 + 底栏角标（两处都由同一 unread 驱动，任一残留都算未清零）。
const badgeCount = (page) =>
  page.locator(".topnav__bell .badge, .bottomnav .badge").count();

run("unread-reset", async ({ browser }) => {
  const a = await register(uniq("ntf-recv")); // 通知接收者（进入通知页的用户）
  const b = await register(uniq("ntf-actor")); // 触发者

  // B 回答 A 的问题 → A 收到一条未读通知。
  // register/question/answer 的响应自动入 owned，进程退出时自清理（含级联通知）。
  const q = await apiOk("POST", "/questions", {
    token: a.token,
    body: { title: `[e2e] ${uniq("q")} — 未读自动已读验证？`, detail_md: "" },
  });
  await apiOk("POST", `/questions/${q.question.id}/answers`, {
    token: b.token,
    body: { content_md: "触发未读通知的回答。" },
  });

  await until(async () => (await unreadCount(a.token)) > 0, {
    label: "A 的 unread-count 未变成 >0（未读通知未造出来）",
  });

  // 浏览器以 A 登录：app JS 启动前向 localStorage 写入 zhihu_token。
  const page = await authedPage(browser, a.token);

  // 前置条件：先在首页确认顶栏角标确实渲染出未读数，
  // 证明后面的「消失」是通知页清掉的，而不是角标从未出现。
  await page.goto(`${BASE}/`);
  await until(async () => (await badgeCount(page)) > 0, {
    label: "首页顶栏未读角标未出现（前置条件失败）",
  });

  // 进入通知页，等列表把 B 触发的那条渲染出来。
  await page.goto(`${BASE}/notifications`);
  await page
    .locator(".ntf .ntf__item", { hasText: b.user.nickname })
    .first()
    .waitFor();

  // 核心断言：角标消失 + 服务端 unread-count=0 + 页头显示「全部已读」。
  // 基线上 unread 不落库，此条件永不成立 → 超时 FAIL。
  await until(
    async () =>
      (await badgeCount(page)) === 0 &&
      (await unreadCount(a.token)) === 0 &&
      /全部已读/.test(
        (await page.locator(".ntf-head__meta").textContent()) || ""
      ),
    { timeout: 15000, label: "进入 /notifications 后未读未自动清零" }
  );
  expect(
    (await page.locator(".ntf .ntf__item--unread").count()) === 0,
    "列表中仍有 .ntf__item--unread 未读样式项"
  );

  // 刷新页面再断言：角标仍无、计数仍 0（落库生效，非临时前端态）。
  await page.reload();
  await page.locator(".ntf .ntf__item").first().waitFor();
  await until(
    async () =>
      (await badgeCount(page)) === 0 && (await unreadCount(a.token)) === 0,
    { timeout: 10000, label: "刷新后未读角标/计数复现" }
  );
});
