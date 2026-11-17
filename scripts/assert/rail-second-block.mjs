// rail-second-block.mjs — Z1100 桌面右栏只有一块（补「等你来答」第二模块）。
//
//   浏览器级（import { run } from ../e2e/lib.mjs）：
//     桌面 1440×900 首页：
//       a) .rail-block 数量 >= 2，且第二块就是「等你来答」；
//       b) 第二块内含 >= 3 条指向 /question/<id> 的链接，每条带「N 人关注」；
//       c) 第二块内存在指向 /unanswered 的「更多」入口；
//       d) 右栏末端下方视口空白 < 120px（innerHeight - 最后一个 .rail-block 底边）；
//       e) body 文本 > 200、无横向溢出、window.__errs 为空；
//       f) 视觉契约：白卡 #FFFFFF / 1px #EBEBEB / 圆角 3px、块标题 15px 700 #121212、
//          条目 14px #444、无 emoji。
//     桌面 1280×800：无横向溢出（右栏不得撑破布局）。
//     移动 390×844：.rail-block--unanswered 不可见、无横向溢出。
//
// 数据前提：本机库里 answer_count=0 的问题为 0 条，`GET /questions?tab=unanswered`
// 返回空 → 按 Z1100 的空数据兜底规格第二块整体不渲染。要验渲染路径必须有数据，
// 因此「未答问题 < 3 条」时用普通账号（非 test.dev 域，不会被 content-filter 滤掉）
// 发 5 条真实形态提问作夹具；对象经 e2e/lib 的 owned 跟踪在进程退出时由
// scripts/cleanup-artifacts.mjs 删除，不留在库里。
//
// Env: API_BASE（缺省 3030）、E2E_BASE（缺省 API_BASE 去掉 /api）。
// 反向自检：未修基线只有 1 个 .rail-block，桌面断言必 FAIL。

import { expect } from "./lib.mjs";

const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
const BASE = (process.env.E2E_BASE || API_BASE.replace(/\/api$/, "")).replace(/\/+$/, "");
process.env.E2E_BASE ||= BASE;
// e2e/lib.mjs 顶层按 env 求值 BASE，须在赋值后动态引入。
const { run, apiOk, cleanupOwned } = await import("../e2e/lib.mjs");

// 夹具标题：真实提问形态，不含 assert/e2e/巡检/复盘 等产物标记（否则会被公共列表过滤）。
const SEED_TITLES = [
  "想系统入门分布式事务，有哪些循序渐进的资料？",
  "工作三年一直做后台管理页面，下一步技术方向该怎么选？",
  "单元测试覆盖率应该定成硬指标吗？",
  "团队 code review 只走流程，怎么推动它真正起作用？",
  "十人左右的小团队要不要自建监控告警？",
];

const ERR_HOOK = () => {
  window.__errs = [];
  const push = (m) => {
    try {
      window.__errs.push(String(m && m.message ? m.message : m));
    } catch {}
  };
  window.addEventListener("error", (e) => push(e.message || e.error));
  window.addEventListener("unhandledrejection", (e) => push(e.reason));
  const orig = console.error.bind(console);
  console.error = (...a) => {
    push(a.map((x) => String(x)).join(" "));
    orig(...a);
  };
};

// 未答问题不足 3 条时补夹具（普通账号 + 真实形态标题，退出时自清理）。
async function ensureUnansweredFixture() {
  const before = await apiOk("GET", "/questions?tab=unanswered&limit=5");
  const have = (before.items || []).length;
  if (have >= 3) {
    console.log(`  夹具：库内已有 ${have} 条未答问题，不新建`);
    return;
  }
  const stamp = Date.now().toString(36);
  // POST /questions 限流：同一作者 5 分钟内最多 3 条，故按 3 条一组换账号。
  let seeded = 0;
  for (let i = 0; i < SEED_TITLES.length; i += 3) {
    const reg = await apiOk("POST", "/auth/register", {
      body: {
        email: `gu.yanzhou.${stamp}.${i}@qq.com`,
        password: "rail-pass-123456",
        nickname: "顾言舟",
      },
    });
    for (const title of SEED_TITLES.slice(i, i + 3)) {
      const r = await apiOk("POST", "/questions", { token: reg.token, body: { title } });
      if (r.question && r.question.id) seeded++;
    }
  }
  const after = await apiOk("GET", "/questions?tab=unanswered&limit=5");
  const got = (after.items || []).length;
  expect(got >= 3, `夹具创建后 /questions?tab=unanswered 仍只有 ${got} 条（新建 ${seeded} 条）`);
  console.log(`  夹具：未答问题 ${have} 条 → 新建 ${seeded} 条，接口现返回 ${got} 条`);
}

async function newCleanPage(browser, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: "zh-CN" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  await page.addInitScript(ERR_HOOK);
  return page;
}

async function checkCommon(page, tag) {
  const bodyLen = await page.evaluate(() => (document.body.innerText || "").length);
  expect(bodyLen > 200, `${tag} body 文本仅 ${bodyLen} 字符（疑似白屏）`);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow <= 1, `${tag} 横向溢出 ${overflow}px`);
  const errs = await page.evaluate(() => window.__errs || []);
  expect(errs.length === 0, `${tag} window.__errs ${errs.length} 条: ${errs.slice(0, 3).join(" | ")}`);
}

async function checkVisualContract(second) {
  const s = await second.evaluate((el) => {
    const cs = getComputedStyle(el);
    const title = el.querySelector(".rail-block__title");
    const link = el.querySelector(".answerlist__link");
    const t = title ? getComputedStyle(title) : null;
    const l = link ? getComputedStyle(link) : null;
    return {
      bg: cs.backgroundColor,
      border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
      radius: cs.borderTopLeftRadius,
      titleSize: t && t.fontSize,
      titleWeight: t && t.fontWeight,
      titleColor: t && t.color,
      linkSize: l && l.fontSize,
      linkColor: l && l.color,
      text: el.innerText,
    };
  });
  expect(s.bg === "rgb(255, 255, 255)", `第二块背景 ${s.bg}（需 #FFFFFF）`);
  expect(s.border === "1px solid rgb(235, 235, 235)", `第二块边框 ${s.border}（需 1px solid #EBEBEB）`);
  expect(s.radius === "3px", `第二块圆角 ${s.radius}（需 3px）`);
  expect(s.titleSize === "15px" && s.titleWeight === "700", `块标题 ${s.titleSize}/${s.titleWeight}（需 15px/700）`);
  expect(s.titleColor === "rgb(18, 18, 18)", `块标题色 ${s.titleColor}（需 #121212）`);
  expect(
    s.linkSize === "14px" && s.linkColor === "rgb(68, 68, 68)",
    `条目标题 ${s.linkSize}/${s.linkColor}（需 14px/#444）`
  );
  expect(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s.text), "第二块含 emoji");
}

async function checkDesktop(page) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".rail-block");
  // 等异步拉取落地；基线无该模块时等满 5s 后仍走到下面的块数断言，报错信息更直白。
  await page
    .locator(".rail-block--unanswered")
    .first()
    .waitFor({ state: "visible", timeout: 5000 })
    .catch(() => {});

  const blocks = await page.locator(".rail-block").count();
  expect(blocks >= 2, `桌面右栏 .rail-block 仅 ${blocks} 块（需 >= 2）`);

  const second = page.locator(".rail-block").nth(1);
  const isUnanswered = await second.evaluate((el) => el.classList.contains("rail-block--unanswered"));
  expect(isUnanswered, "右栏第二块不是「等你来答」模块");
  const headText = await second.locator(".rail-block__title").innerText();
  expect(headText.trim() === "等你来答", `第二块标题为 ${JSON.stringify(headText)}（需「等你来答」）`);

  const qLinks = await second.locator('a[href*="/question/"]').count();
  expect(qLinks >= 3, `第二块仅 ${qLinks} 条问题链接（需 >= 3）`);

  const meta = await second.locator(".answerlist__meta").allInnerTexts();
  expect(meta.length >= 3, `第二块「N 人关注」元信息仅 ${meta.length} 条`);
  expect(
    meta.every((t) => /\d+\s*人关注/.test(t)),
    `第二块元信息格式不符：${JSON.stringify(meta.slice(0, 3))}`
  );

  const more = await second.locator('a[href$="/unanswered"]').count();
  expect(more >= 1, "第二块缺少指向 /unanswered 的「更多」入口");

  await checkVisualContract(second);

  // 右栏末端到视口底边的空白：右栏高于一屏时为负值（无空白）。
  const tailGap = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll(".rail-block")];
    const last = blocks[blocks.length - 1];
    return window.innerHeight - last.getBoundingClientRect().bottom;
  });
  expect(tailGap < 120, `右栏末端下方视口空白 ${Math.round(tailGap)}px（需 < 120）`);

  await checkCommon(page, "desktop1440");
  console.log(
    `  desktop1440: ${blocks} 块 .rail-block，第二块 ${qLinks} 条问题链接，底部空白 ${Math.round(tailGap)}px`
  );
}

async function checkNarrow(page) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".rail-block");
  await checkCommon(page, "desktop1280");
  console.log("  desktop1280: 无横向溢出");
}

async function checkMobile(page) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".rail-block");
  const visible = await page.locator(".rail-block--unanswered").isVisible().catch(() => false);
  expect(!visible, "mobile390 下「等你来答」右栏模块仍然可见");
  await checkCommon(page, "mobile390");
  console.log("  mobile390: 「等你来答」模块不可见");
}

run("rail-second-block", async ({ browser }) => {
  await ensureUnansweredFixture();
  const desktop = await newCleanPage(browser, 1440, 900);
  try {
    await checkDesktop(desktop);
  } finally {
    await desktop.context().close();
  }
  const narrow = await newCleanPage(browser, 1280, 800);
  try {
    await checkNarrow(narrow);
  } finally {
    await narrow.context().close();
  }
  const mobile = await newCleanPage(browser, 390, 844);
  try {
    await checkMobile(mobile);
  } finally {
    await mobile.context().close();
  }
  // 夹具立即清理，不等进程退出（playwright 已关浏览器）。
  cleanupOwned();
});
