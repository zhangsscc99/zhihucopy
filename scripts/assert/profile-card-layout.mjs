// Z1194 — 主页资料卡：移动端头部换行使成就区撑满卡片宽、胶囊横向≤2行、
//            数据条三等分、main 内仅 1 个实心主按钮。
// 核心原则：不许裁剪内容——所有徽章胶囊必须真实可见，禁止 max-height/overflow 隐藏。
//
// 断言（BASE + /u/<id>，真实用户：有成就胶囊且粉丝数≥1，遍历 /api/users 前 8 个）：
//   390×844：
//     ① .profile__badges .medals 宽度 ≥ .profile clientWidth - 2*水平padding - 4
//        （撑满卡片内容区，不许再是 ~150px 的 flex 剩余宽）；
//     ② 所有 .medals__pill 可见且未被裁：每枚 rect.bottom <= medals.bottom + 0.5、
//        height > 0，数量 === 接口 badges 数；胶囊 top distinct 值 ≤ 2（最多两行）；
//     ③ .profile__stats 三项 offsetWidth 极差 < 8px；
//     ④ main 内 computed background-color === rgb(0,102,255) 的元素数 === 1
//        （导航栏「提问」在 header，不在 main 内）；
//     ⑤ document.body.scrollWidth === 390；window.__errs 为空。
//   1440×900：.profile__info 与头像同一行（top 差 < 8px）、④ === 1、无横向溢出。
//
// Env: E2E_BASE || http://127.0.0.1:3030/zhihucopy ；CHROME 可覆盖浏览器路径；
//      失败截图到 /root/logs。退出码 0 PASS / 1 FAIL。

import { run, expect, BASE } from "../e2e/lib.mjs";

function injectErrs(page) {
  return page.addInitScript(() => {
    const w = window;
    w.__errs = [];
    w.addEventListener("error", (e) => w.__errs.push(`error:${e.message}`));
    w.addEventListener("unhandledrejection", (e) =>
      w.__errs.push(
        `rejection:${e.reason && e.reason.message ? e.reason.message : e.reason}`
      )
    );
  });
}

// 找一个「有成就且粉丝数≥1」的真实用户：先取 /api/users 列表，再逐个查详情。
async function pickUser() {
  const list = await fetch(`${BASE}/api/users?limit=200`).then((r) => r.json());
  const items = Array.isArray(list.items) ? list.items : [];
  const tried = [];
  for (const u of items.slice(0, 8)) {
    tried.push(u.id);
    const d = await fetch(`${BASE}/api/users/${u.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (
      d &&
      Array.isArray(d.badges) &&
      d.badges.length > 0 &&
      d.stats &&
      d.stats.followers >= 1
    ) {
      return { id: u.id, badgeCount: d.badges.length, tried };
    }
  }
  return { id: null, badgeCount: 0, tried };
}

async function measure(page) {
  return page.evaluate(() => {
    const card = document.querySelector(".profile");
    const medals = document.querySelector(".profile__badges .medals");
    const pills = [
      ...document.querySelectorAll(".profile__badges .medals__pill"),
    ];
    const medalsRect = medals ? medals.getBoundingClientRect() : null;
    const pillRects = pills.map((p) => {
      const r = p.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height, width: r.width };
    });
    const cs = card ? getComputedStyle(card) : null;
    const cardContentW = card
      ? card.clientWidth -
        parseFloat(cs.paddingLeft) -
        parseFloat(cs.paddingRight)
      : null;
    const avatar = document.querySelector(".profile__head .avatar");
    const info = document.querySelector(".profile__info");
    const head = document.querySelector(".profile__head");
    const follow = document.querySelector(".profile__head .profile__follow");
    const statDivs = [...document.querySelectorAll(".profile__stats > div")];
    const solidInMain = [
      ...document.querySelectorAll("main button, main a, main .btn"),
    ].filter(
      (el) => getComputedStyle(el).backgroundColor === "rgb(0, 102, 255)"
    );
    return {
      cardContentW,
      cardW: card ? card.clientWidth : null,
      medalsW: medals ? medals.getBoundingClientRect().width : null,
      medalsBottom: medalsRect ? medalsRect.bottom : null,
      infoW: info ? info.getBoundingClientRect().width : null,
      pillCount: pills.length,
      pillRects,
      distinctTops: [...new Set(pillRects.map((r) => Math.round(r.top)))],
      avatarTop: avatar ? avatar.getBoundingClientRect().top : null,
      infoTop: info ? info.getBoundingClientRect().top : null,
      headRight: head ? head.getBoundingClientRect().right : null,
      followRight: follow ? follow.getBoundingClientRect().right : null,
      followTop: follow ? follow.getBoundingClientRect().top : null,
      statW: statDivs.map((d) => d.offsetWidth),
      statCount: statDivs.length,
      solidCount: solidInMain.length,
      solidTexts: solidInMain.map((el) => (el.textContent || "").trim()),
      bodySW: document.body.scrollWidth,
      docClientW: document.documentElement.clientWidth,
    };
  });
}

run("profile-card-layout", async ({ browser }) => {
  const { id, badgeCount, tried } = await pickUser();
  expect(
    id !== null,
    `/api/users 前 8 个用户（${tried.join(",")}）均无「成就胶囊 + 粉丝≥1」，无法验证`
  );

  // ---------- 移动端 390×844 ----------
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "zh-CN",
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  await injectErrs(page);
  await page.goto(`${BASE}/u/${id}`, { waitUntil: "networkidle" });
  await page.locator(".profile__stats").waitFor({ state: "visible" });
  await page
    .locator(".profile__badges .medals__pill")
    .first()
    .waitFor({ state: "visible" });

  const m = await measure(page);

  // ① 成就容器撑满卡片内容区（容差 4px），不许仍是 flex 挤压后的窄列
  expect(
    m.medalsW !== null && m.cardContentW !== null && m.medalsW >= m.cardContentW - 4,
    `成就容器未撑满卡片内容区：medals.w=${m.medalsW} < card内容宽 ${m.cardContentW}-4` +
      `（card.clientWidth=${m.cardW} info.w=${m.infoW}）`
  );

  // ② 全部胶囊真实可见、未被裁剪，且最多两行
  expect(
    m.pillCount === badgeCount,
    `胶囊数量 ${m.pillCount} ≠ 接口徽章数 ${badgeCount}（疑似被裁/未渲染）`
  );
  const clipped = m.pillRects.filter(
    (r) => r.height <= 0 || r.bottom > m.medalsBottom + 0.5
  );
  expect(
    clipped.length === 0,
    `有 ${clipped.length} 枚胶囊不可见/被裁出容器（medals.bottom=${m.medalsBottom}）：` +
      JSON.stringify(clipped)
  );
  expect(
    m.distinctTops.length <= 2 && m.distinctTops.length >= 1,
    `胶囊行数应为 1~2 行，实测 top distinct=${JSON.stringify(m.distinctTops)}`
  );

  // ③ 数据条三项均分
  expect(m.statCount === 3, `数据条应有 3 项，实测 ${m.statCount}`);
  const spread = Math.max(...m.statW) - Math.min(...m.statW);
  expect(
    spread < 8,
    `数据条三项未均分：widths=${JSON.stringify(m.statW)} 极差 ${spread}px ≥ 8px`
  );

  // ④ main 内实心主按钮恰好 1 个（关注；「邀请 TA 回答」为描边）
  expect(
    m.solidCount === 1,
    `main 内实心主按钮应恰好 1 个，实测 ${m.solidCount}：${JSON.stringify(
      m.solidTexts
    )}`
  );

  // ④.5 关注按钮与头像同行、右对齐到卡片内容区右缘
  expect(
    m.headRight !== null &&
      m.followRight !== null &&
      Math.abs(m.headRight - m.followRight) <= 2,
    `关注按钮未右对齐到卡片内容区右缘：follow.right=${m.followRight} head.right=${m.headRight}`
  );
  expect(
    m.followTop !== null &&
      m.avatarTop !== null &&
      Math.abs(m.followTop - m.avatarTop) < 8,
    `关注按钮未与头像同一行：follow.top=${m.followTop} avatar.top=${m.avatarTop}`
  );

  // ⑤ 无横向溢出、无页面错误
  expect(
    m.bodySW === 390,
    `body 横向溢出 scrollWidth=${m.bodySW}（viewport=390）`
  );
  const errs = await page.evaluate(() => window.__errs || []);
  expect(errs.length === 0, `页面错误：${errs.join(" | ")}`);
  await ctx.close();

  // ---------- 桌面 1440×900 ----------
  const dctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
  });
  const dpage = await dctx.newPage();
  dpage.setDefaultTimeout(15000);
  await injectErrs(dpage);
  await dpage.goto(`${BASE}/u/${id}`, { waitUntil: "networkidle" });
  await dpage.locator(".profile__stats").waitFor({ state: "visible" });
  await dpage
    .locator(".profile__badges .medals__pill")
    .first()
    .waitFor({ state: "visible" });

  const d = await measure(dpage);

  // ⑥ 桌面端布局不回归：头像左、信息右同一行并排
  expect(
    d.avatarTop !== null &&
      d.infoTop !== null &&
      Math.abs(d.infoTop - d.avatarTop) < 8,
    `桌面端头像与信息区未同一行：avatar.top=${d.avatarTop} info.top=${d.infoTop}`
  );
  expect(
    d.solidCount === 1,
    `桌面端 main 内实心主按钮应恰好 1 个，实测 ${d.solidCount}：${JSON.stringify(
      d.solidTexts
    )}`
  );
  expect(
    d.bodySW === d.docClientW,
    `桌面端横向溢出：scrollWidth=${d.bodySW} clientWidth=${d.docClientW}`
  );
  const derrs = await dpage.evaluate(() => window.__errs || []);
  expect(derrs.length === 0, `桌面端页面错误：${derrs.join(" | ")}`);
  await dctx.close();
});
