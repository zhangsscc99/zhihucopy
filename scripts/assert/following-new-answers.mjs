// Z1096 — 关注流「有新回答」提示 pill（浏览器级断言，playwright-core + chromium）。
//
// 跑法：env API_BASE=http://127.0.0.1:<port>/zhihucopy/api E2E_BASE=http://127.0.0.1:<port>/zhihucopy \
//        node scripts/assert/following-new-answers.mjs
//
// 契约：
//   1) API 造数据：种子号 A(user5) 关注 B(user6)（POST /users/:id/follow），
//      B 在 A 关注之后造一个问题并自答一条。
//   2) API 层：GET /feed/following?since=<B 发答之前> 响应带 new_count >= 1。
//   3) 浏览器以 A 登录：localStorage 里 zhihu_following_seen_<uidA> 设为
//      「B 发答之前」的时间 → 进 /?tab=following → pill 出现且文案
//      匹配 /^\d+ 条新回答$/。
//   4) 点 pill → pill 消失、列表顶部是 B 刚回答的那张问题卡、
//      document.body.innerText.length > 200、window.__errs 为空。
//   5) 反向：点击回写访问时间后刷新 → new_count=0 → 页面无「条新回答」文案；
//      未登录访问关注 tab → 同样无该文案、不报错。
//   6) finally 里解除 A→B 关注，不污染种子关系（创建的问题/回答走 owned 自清理）。
//
// 基线（无 new_count 字段、无 .new-pill）：步骤 3 的 pill waitFor 超时 FAIL。
const API_BASE = (
  process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api"
).replace(/\/+$/, "");
if (!process.env.E2E_API) process.env.E2E_API = API_BASE;
if (!process.env.E2E_BASE) process.env.E2E_BASE = API_BASE.replace(/\/api$/, "");

const { run, expect, BASE, authedPage, api, apiOk } = await import(
  "../e2e/lib.mjs"
);

async function injectErrs(page) {
  await page.addInitScript(() => {
    const w = window;
    w.__errs = [];
    w.addEventListener("error", (e) => w.__errs.push(`error:${e.message}`));
    w.addEventListener("unhandledrejection", (e) =>
      w.__errs.push(
        `rejection:${e.reason && e.reason.message ? e.reason.message : e.reason}`
      )
    );
    const origError = console.error;
    console.error = (...args) => {
      w.__errs.push(`console:${args.map(String).join(" ")}`);
      return origError.apply(console, args);
    };
  });
}

const pageErrs = (page) => page.evaluate(() => window.__errs || []);

const seedLogin = async (email) => {
  const r = await api("POST", "/auth/login", {
    body: { email, password: "zhihu123456" },
  });
  expect(
    r.status === 200,
    `seed login ${email} -> ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`
  );
  return r.data;
};

run("following-new-answers", async ({ browser, page }) => {
  const a = await seedLogin("user5@zhihucopy.dev");
  const b = await seedLogin("user6@zhihucopy.dev");
  const uidA = a.user.id;
  const uidB = b.user.id;

  // 幂等重建 A→B 关注关系（先解除再关注，保证「A 关注 B 之后 B 才发答」的时序）。
  await api("DELETE", `/users/${uidB}/follow`, { token: a.token }).catch(
    () => {}
  );
  await apiOk("POST", `/users/${uidB}/follow`, { token: a.token });

  // B 造一个问题再自答。标题/正文刻意走真实形态（避开 content-filter 的产物
  // 口径），否则 new_count 按契约应把它滤掉。
  const stamp = Date.now().toString(36);
  const { question } = await apiOk("POST", "/questions", {
    token: b.token,
    body: {
      title: `关注流新回答场景的提问 ${stamp}`,
      detail_md: "",
    },
  });
  // 「B 发答之前」的时间戳：比回答插入早几秒，盖住 API 往返与秒级精度差。
  const sinceIso = new Date(Date.now() - 5000).toISOString();
  await apiOk("POST", `/questions/${question.id}/answers`, {
    token: b.token,
    body: {
      content_md:
        "关注流新回答场景的回答正文。这里随便写几句正常内容，凑成一条普通用户会写的回答，不夹带任何机器标记。",
    },
  });

  try {
    // ---- 2) API 层：since 之后关注对象的新回答数 ----
    const probe = await apiOk(
      "GET",
      `/feed/following?page=1&limit=20&since=${encodeURIComponent(sinceIso)}`,
      { token: a.token }
    );
    expect(
      Number(probe.new_count) >= 1,
      `GET /feed/following?since=... 应回 new_count>=1，实际 ${JSON.stringify(probe.new_count)}`
    );
    const probeNone = await apiOk("GET", "/feed/following?page=1&limit=20", {
      token: a.token,
    });
    expect(
      Number(probeNone.new_count) === 0,
      `不带 since 时 new_count 应为 0，实际 ${JSON.stringify(probeNone.new_count)}`
    );
    console.log(`  [api] new_count=${probe.new_count}（since=${sinceIso}）`);

    // ---- 3) 浏览器：seen 设为 B 发答之前 → pill 出现且文案正确 ----
    const p = await authedPage(browser, a.token);
    await injectErrs(p);
    // init script 每次导航（含后面的 reload）都会重放：用 sessionStorage 做
    // 一次性开关，只在首个文档播种 seen，否则 reload 会把「B 发答之前」的
    // 旧时间写回去，点击/离开回写的新时间被覆盖，pill 永远消不掉。
    await p.addInitScript(
      ([k, v]) => {
        try {
          if (!sessionStorage.getItem("z1096-seeded")) {
            localStorage.setItem(k, v);
            sessionStorage.setItem("z1096-seeded", "1");
          }
        } catch {}
      },
      [`zhihu_following_seen_${uidA}`, sinceIso]
    );
    await p.goto(`${BASE}/?tab=following`);
    const pill = p.locator(".new-pill");
    await pill.waitFor({ timeout: 15000 });
    const label = ((await pill.textContent()) || "").trim();
    expect(
      /^\d+ 条新回答$/.test(label),
      `pill 文案应匹配 /^\\d+ 条新回答$/，实际「${label}」`
    );
    console.log(`  [ui] pill 文案「${label}」`);

    // ---- 4) 点 pill → 消失 + B 的新内容卡置顶 ----
    await pill.click();
    await p.waitForSelector(".new-pill", {
      state: "detached",
      timeout: 5000,
    });
    await p.locator(".feed__item").first().waitFor({ timeout: 15000 });
    const topTitle = (
      (await p.locator(".feed__item .feed__title").first().textContent()) || ""
    ).trim();
    expect(
      topTitle === question.title,
      `点击后列表顶部应为 B 刚回答的问题「${question.title}」，实际「${topTitle}」`
    );
    const bodyLen = await p.evaluate(() => document.body.innerText.length);
    expect(bodyLen > 200, `页面内容过少：innerText=${bodyLen}`);
    const errs = await pageErrs(p);
    expect(errs.length === 0, `页面错误：${errs.join(" | ")}`);
    console.log(`  [ui] 点击后 pill 消失，置顶卡=「${topTitle}」`);

    // ---- 5a) 访问时间已回写：刷新后 new_count=0 → 无 pill 文案 ----
    await p.reload();
    await p.waitForSelector(".feed__item, .empty", { timeout: 15000 });
    const textAfter = await p.evaluate(() => document.body.innerText);
    expect(
      !/条新回答/.test(textAfter),
      "点击清零并回写访问时间后，刷新页面仍出现「条新回答」文案"
    );
    expect(
      (await p.locator(".new-pill").count()) === 0,
      "点击清零并回写访问时间后，刷新页面仍渲染 .new-pill"
    );
    const errs2 = await pageErrs(p);
    expect(errs2.length === 0, `刷新后页面错误：${errs2.join(" | ")}`);

    // ---- 5b) 未登录：空态兜底，无 pill 文案 ----
    await page.goto(`${BASE}/?tab=following`);
    await page.locator(".empty").waitFor({ timeout: 15000 });
    const anonText = await page.evaluate(() => document.body.innerText);
    expect(
      !/条新回答/.test(anonText),
      "未登录关注 tab 不应出现「条新回答」文案"
    );
    console.log("  [neg] 清零后刷新与未登录场景均无 pill 文案");
  } finally {
    // 解除本 run 建立的 A→B 关注，还原种子关系。
    await api("DELETE", `/users/${uidB}/follow`, { token: a.token }).catch(
      () => {}
    );
  }
});
