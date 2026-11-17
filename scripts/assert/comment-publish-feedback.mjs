// Z1159 — 评论发布成功反馈（浏览器级断言）。
//
// 契约：
//   点「发布评论」成功后：
//     · 1.5s 内 .toast-stack 出现「评论已发布」（同文案不叠加成多条）；
//     · 新评论行（li.answer__comment[data-comment-id]，按接口返回 id 定位）
//       被滚入视口（getBoundingClientRect().top ∈ 0..innerHeight）；
//     · 该回答评论计数 = 发布前 +1；
//     · 连发第二条同样 1.5s 内有 toast，且同文案不同时可见两条；
//     · 1440 与 390 均无横向溢出、window.__errs 为空。
//   反向自检：未修基线无 .toast-stack（toast 挂在 .notify-stack），本断言 FAIL。
//
// 同 comment-enter-submit 的口径：@test.dev 注册号评论被公共列表过滤，
// 浏览器操作用种子号（user4@zhihucopy.dev / zhihu123456）；
// 收尾按正文找回 id 走 API 删除，不留残留。
//
// 环境：verify.sh 透传 API_BASE；e2e/lib.mjs 的 BASE/API 在模块加载时定型，
// 故先按 API_BASE 反推 E2E_BASE/E2E_API 再动态 import。
const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
if (!process.env.E2E_API) process.env.E2E_API = API_BASE;
if (!process.env.E2E_BASE) process.env.E2E_BASE = API_BASE.replace(/\/api$/, "");

const { run, expect, BASE, authedPage, api, apiOk } = await import("../e2e/lib.mjs");

const QID = 6;

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

const num = (s) => {
  const m = String(s || "").match(/\d+/);
  return m ? Number(m[0]) : null;
};

// 1.5s 内 .toast-stack 出现「评论已发布」；返回实际耗时 ms。
async function waitPublishToast(page) {
  const t0 = Date.now();
  const loc = page.locator(".toast-stack .toast", { hasText: "评论已发布" });
  for (;;) {
    if ((await loc.count()) > 0) return Date.now() - t0;
    if (Date.now() - t0 > 1500) {
      throw new Error("1.5s 内 .toast-stack 未出现「评论已发布」toast");
    }
    await page.waitForTimeout(80);
  }
}

// 等新评论行滚入视口（top ∈ 0..innerHeight），最多 3.5s（smooth 滚动耗时）。
async function waitRowInViewport(page, marker) {
  const row = page.locator("li.answer__comment[data-comment-id]", { hasText: marker });
  await row.waitFor({ timeout: 3000 });
  const t0 = Date.now();
  for (;;) {
    const r = await row.evaluate((el) => {
      const b = el.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, ih: window.innerHeight };
    });
    if (r.top >= 0 && r.top < r.ih) return r;
    if (Date.now() - t0 > 3500) {
      throw new Error(
        `新评论行未滚入视口：top=${r.top.toFixed(0)} bottom=${r.bottom.toFixed(0)} innerHeight=${r.ih}`
      );
    }
    await page.waitForTimeout(120);
  }
}

async function exercise(page, aid, markers) {
  const ans = page.locator(`#answer-${aid}`);
  await ans.getByRole("button", { name: /条评论|收起评论/ }).click();
  const form = ans.locator(".answer__comment-form");
  const input = form.locator("textarea");
  await input.waitFor();

  const countText = async () =>
    (await ans.getByRole("button", { name: /收起评论/ }).innerText()).trim();
  const c0 = num(await countText());
  expect(c0 !== null && c0 >= 3, `前置：评论数应 ≥3，实际「${await countText()}」`);

  // ---- 第一条 ----
  await input.fill(markers[0]);
  await form.getByRole("button", { name: "发布评论", exact: true }).click();
  const dt1 = await waitPublishToast(page);
  expect(dt1 <= 1500, `toast 耗时 ${dt1}ms 超 1.5s`);
  await waitRowInViewport(page, markers[0]);
  const c1 = num(await countText());
  expect(c1 === c0 + 1, `第一条后计数应为 ${c0 + 1}，实际「${await countText()}」`);

  // ---- 第二条（连发）：toast 仍出，且同文案不同时可见两条 ----
  await input.fill(markers[1]);
  await form.getByRole("button", { name: "发布评论", exact: true }).click();
  await waitPublishToast(page);
  await waitRowInViewport(page, markers[1]);
  const sameToast = await page
    .locator(".toast-stack .toast", { hasText: "评论已发布" })
    .count();
  expect(sameToast <= 1, `同文案 toast 同时可见 ${sameToast} 条，期望 ≤1`);
  const c2 = num(await countText());
  expect(c2 === c0 + 2, `第二条后计数应为 ${c0 + 2}，实际「${await countText()}」`);

  // ---- 溢出 / 错误 ----
  const ovf = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(ovf === 0, `横向溢出 scrollWidth-clientWidth=${ovf}`);
  const errs = await page.evaluate(() => window.__errs || []);
  expect(errs.length === 0, `window.__errs 非空: ${errs.join(" | ")}`);
}

run("comment-publish-feedback", async ({ browser }) => {
  const login = await api("POST", "/auth/login", {
    body: { email: "user4@zhihucopy.dev", password: "zhihu123456" },
  });
  expect(login.status === 200, `seed login -> ${login.status}`);
  const me = login.data;

  const detail = await apiOk("GET", `/questions/${QID}`);
  const answer = (detail.answers || []).find((a) => a.comment_count >= 3);
  expect(answer, `question ${QID} 无评论数 ≥3 的回答`);
  const aid = answer.id;

  const ts = Date.now();
  const markers = [
    `评论反馈断言甲 ${ts}`,
    `评论反馈断言乙 ${ts}`,
    `评论反馈断言丙 ${ts}`,
    `评论反馈断言丁 ${ts}`,
  ];

  try {
    for (const [vp, pair] of [
      [{ width: 1440, height: 900 }, [markers[0], markers[1]]],
      [{ width: 390, height: 844 }, [markers[2], markers[3]]],
    ]) {
      const page = await authedPage(browser, me.token);
      await page.setViewportSize(vp);
      await injectErrs(page);
      await page.goto(`${BASE}/question/${QID}`);
      await page.locator(".question__title").first().waitFor();
      const bodyLen = await page.evaluate(() => document.body.innerText.length);
      expect(bodyLen > 200, `页面内容过少：innerText=${bodyLen}`);
      await exercise(page, aid, pair);
      await page.close();
    }
  } finally {
    // UI 发布的评论不在 api() 跟踪网内：按正文找回 id 删除，不留残留。
    const list = await api("GET", `/comments?target_type=answer&target_id=${aid}`).catch(() => null);
    const items = (list && list.data && list.data.items) || [];
    for (const marker of markers) {
      const mine = items.find((c) => c.content === marker);
      if (mine && mine.id > 0) {
        await api("DELETE", `/comments/${mine.id}`, { token: me.token }).catch(() => {});
      }
    }
  }
});
