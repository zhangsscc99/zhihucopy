// Z1181 — 「评论已发布」toast 双节点（DOM 计数不诚实）断言。
//
// 契约：
//   堆栈容器自身不含 "toast" 子串类名（Z1109 修过 role=status 下放后，
//   容器类名 `toast-stack` 仍会命中 `[class*=toast]` 选择器，被走查/断言
//   数成「两条 toast」）；容器仅作布局，可见 toast 节点 === 实际条数；
//   同文案同类型在存活期内替换不叠加；toast ≤4s 自动消失（全局 3.2s）。
//
// 场景：
//   A. 桌面 1440：/question/6 首条回答发评论 → 「评论已发布」在
//      `[class*=toast]` 与 `[role=status]` 两套口径下可见节点数均 = 1；
//      ≤4s 自动消失；window.__errs 为空。
//   B. 手机 390×844：同问题再发一条（不同文案内容避免去重干扰），
//      两套口径同样 = 1；无横向溢出（scrollWidth===clientWidth）；
//      toast 底边不越过 .bottomnav 顶边（tabbar 存在时）；≤4s 消失。
//   C. 同文案 1.5s 内连触发两次（回答卡「分享」按钮连点两次）→
//      同文案可见节点数 ≤ 1。
//
// Env: API_BASE（缺省 3030）、E2E_BASE（缺省 API_BASE 去 /api）。
// 反向自检：容器类名改回含 toast 的形式后，A/B 匹配节点数 = 2 必 FAIL。
const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
if (!process.env.E2E_API) process.env.E2E_API = API_BASE;
if (!process.env.E2E_BASE) process.env.E2E_BASE = API_BASE.replace(/\/api$/, "");

const { run, expect, BASE, TOKEN_KEY, register, apiOk, uniq } = await import(
  "../e2e/lib.mjs"
);

// 页面级错误收集：error / unhandledrejection / console.error 全记 window.__errs；
// 同帧写入 localStorage token（SPA 启动前），等价 authedPage + __errs。
const INIT = ([k, t]) => {
  const w = window;
  w.__errs = [];
  w.addEventListener("error", (e) => w.__errs.push(`error:${e.message}`));
  w.addEventListener("unhandledrejection", (e) =>
    w.__errs.push(`rejection:${e.reason && e.reason.message ? e.reason.message : e.reason}`)
  );
  const orig = console.error.bind(console);
  console.error = (...a) => {
    w.__errs.push(`console:${a.map(String).join(" ")}`);
    return orig(...a);
  };
  if (t) localStorage.setItem(k, t);
};

async function authedViewportPage(browser, token, viewport) {
  const context = await browser.newContext({ viewport, locale: "zh-CN" });
  const page = await context.newPage();
  await page.addInitScript(INIT, [TOKEN_KEY, token]);
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  return page;
}

// 统计匹配 selector 且可见、文本含 text 的节点数。
function visibleCount(page, selector, text) {
  return page.evaluate(
    ([sel, t]) =>
      [...document.querySelectorAll(sel)].filter((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return (
          r.width > 0 &&
          r.height > 0 &&
          cs.visibility !== "hidden" &&
          cs.display !== "none" &&
          (el.textContent || "").includes(t)
        );
      }).length,
    [selector, text]
  );
}

// 在 /question/:qid 的 #answer-:aid 卡片内展开评论并发布一条。
async function publishComment(page, qid, aid, body) {
  await page.goto(`${BASE}/question/${qid}`);
  await page.locator(".question__title").first().waitFor();
  const ans = page.locator(`#answer-${aid}`);
  const toggle = ans.getByRole("button", { name: /条评论|收起评论/ });
  await toggle.click();
  const form = ans.locator(".answer__comment-form");
  await form.locator("textarea").waitFor();
  await form.locator("textarea").fill(body);
  await form.getByRole("button", { name: "发布评论", exact: true }).click();
  await page.locator(".toast", { hasText: "评论已发布" }).waitFor();
}

async function expectSingleToast(page, tag) {
  const byClass = await visibleCount(page, "[class*=toast]", "评论已发布");
  const byRole = await visibleCount(page, "[role=status]", "评论已发布");
  console.log(
    `  [${tag}] 「评论已发布」[class*=toast]=${byClass}、[role=status]=${byRole}（期望各 1）`
  );
  expect(byClass === 1, `${tag}: [class*=toast] 可见节点数=${byClass}，期望 1（容器冒充 toast？）`);
  expect(byRole === 1, `${tag}: [role=status] 可见节点数=${byRole}，期望 1`);
  // ≤4s 自动消失（全局存活 3.2s，不改短）。
  await page
    .locator(".toast", { hasText: "评论已发布" })
    .waitFor({ state: "hidden", timeout: 4000 });
}

run("toast-dedupe", async ({ browser }) => {
  // /question/6 首条回答 id（API 口径，不硬编码）。
  const detail = await apiOk("GET", "/questions/6");
  const aid = detail.answers && detail.answers[0] && detail.answers[0].id;
  expect(aid > 0, "question 6 无回答可挂载评论");
  const markerA = `Z1181-A ${uniq("c")}`;
  const markerB = `Z1181-B ${uniq("c")}`;

  // ---- 场景 A：桌面 1440 -----------------------------------------------------
  const opA = await register(uniq("dz1181a"));
  const pageA = await authedViewportPage(browser, opA.token, { width: 1440, height: 900 });
  await publishComment(pageA, 6, aid, markerA);
  await expectSingleToast(pageA, "A/1440");
  const errsA = await pageA.evaluate(() => window.__errs || []);
  expect(errsA.length === 0, `A: window.__errs 非空 ${errsA.join(" | ")}`);
  await pageA.close();

  // ---- 场景 B：手机 390×844 ---------------------------------------------------
  const opB = await register(uniq("dz1181b"));
  const pageB = await authedViewportPage(browser, opB.token, { width: 390, height: 844 });
  await publishComment(pageB, 6, aid, markerB);
  await expectSingleToast(pageB, "B/390");

  const ovf = await pageB.evaluate(
    () => document.body.scrollWidth - document.body.clientWidth
  );
  console.log(`  [B] 横向溢出 scrollWidth-clientWidth=${ovf}（期望 0）`);
  expect(ovf === 0, `B: 横向溢出 ${ovf}px`);

  // 发一条新 toast 量几何（上一条已消失），确认底边不越过底部 tabbar 顶边。
  await pageB.locator(`#answer-${aid}`).locator(".answer__action", { hasText: "分享" }).click();
  await pageB.locator(".toast").first().waitFor();
  const geo = await pageB.evaluate(() => {
    const t = document.querySelector(".toast");
    const bar = document.querySelector(".bottomnav");
    if (!t || !bar) return null;
    const tr = t.getBoundingClientRect();
    const br = bar.getBoundingClientRect();
    return { toastBottom: tr.bottom, barTop: br.top };
  });
  if (geo) {
    console.log(
      `  [B] toast.bottom=${geo.toastBottom.toFixed(1)}、tabbar.top=${geo.barTop.toFixed(1)}`
    );
    expect(
      geo.toastBottom <= geo.barTop + 0.5,
      `B: toast 底边 ${geo.toastBottom} 越过 tabbar 顶边 ${geo.barTop}`
    );
  } else {
    console.log("  [B] 无 .bottomnav，跳过 tabbar 几何断言");
  }

  // ---- 场景 C：同文案 1.5s 内连触发两次 --------------------------------------
  // 稳定复用触发点：回答卡「分享」按钮（clipboard 成功 → 「链接已复制，去分享吧」，
  // 权限被拒 → 退化为 URL 本体；两条路径同 key 去重口径一致）。
  await pageB.locator(".toast").first().waitFor({ state: "hidden", timeout: 4000 });
  const shareBtn = pageB
    .locator(`#answer-${aid}`)
    .locator(".answer__action", { hasText: "分享" });
  await shareBtn.click();
  await shareBtn.click();
  const cSuccess = await visibleCount(pageB, "[class*=toast]", "链接已复制，去分享吧");
  const cFallback = await visibleCount(pageB, "[class*=toast]", "/zhihucopy/question/6");
  const cMax = Math.max(cSuccess, cFallback);
  console.log(`  [C] 连点两次「分享」同文案节点=${cMax}（期望 ≤1）`);
  expect(cMax <= 1, `C: 1.5s 内重复触发同文案 toast，可见节点数=${cMax}，期望 ≤1`);

  const errsB = await pageB.evaluate(() => window.__errs || []);
  expect(errsB.length === 0, `B/C: window.__errs 非空 ${errsB.join(" | ")}`);
  await pageB.close();
});
