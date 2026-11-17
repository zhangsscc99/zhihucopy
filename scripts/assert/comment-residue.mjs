// Z1101 — 生产残留断言评论 + 删除占位渲染断言（浏览器级）。
//
// 契约（/question/6 公开评论区，匿名可访问）：
//   a) 评论区 .answer__comment-body 文本中，以 ≥5 位纯数字结尾（断言脚本
//      随机尾标，如「…清理函数就是退租 411293」comment#497）或含「冰结束」
//      残留串的评论为 0；
//   b) 孤儿删除占位为 0：每条含 --deleted 正文的评论行，其后必须紧跟属于
//      它的存活子回复行（--child）；没有存活子回复的「该评论已删除」占位
//      行不再渲染。注意：已删除但仍有存活子回复的评论按产品契约保留占位
//      （否则子回复成孤儿），所以不断言「全页无该文案」，断言的是孤儿占位。
//   c) 防恒真：可见评论行数 > 0、innerText > 200、__errs 为空；
//   d) 无横向溢出。
//
// 反向自检：未修改基线上 comment#497（尾标 411293）仍在公开评论区 → (a)
//   命中 FAIL；基线跑过清理脚本后旧前端仍把孤儿软删评论渲染成占位 → (b)
//   命中 FAIL。
//
// 环境：verify.sh 透传 API_BASE；e2e/lib.mjs 的 BASE/API 在模块加载时定型，
// 故先按 API_BASE 反推 E2E_BASE/E2E_API 再动态 import。
const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
if (!process.env.E2E_API) process.env.E2E_API = API_BASE;
if (!process.env.E2E_BASE) process.env.E2E_BASE = API_BASE.replace(/\/api$/, "");

const { run, expect, BASE, newPage } = await import("../e2e/lib.mjs");

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

const RE_RESIDUE_TAIL = /\d{5,}\s*$/;
const RE_RESIDUE_MARK = /冰结束/;

run("comment-residue", async ({ browser }) => {
  const page = await newPage(browser);
  await injectErrs(page);
  await page.goto(`${BASE}/question/6`);

  // 等回答列表出现。
  await page.waitForFunction(
    () => document.querySelectorAll("li.answer").length > 0,
    null,
    { timeout: 15000 }
  );

  // 展开前 3 条回答的评论区。
  const answers = page.locator("li.answer");
  const n = Math.min(3, await answers.count());
  expect(n > 0, "question/6 没有可展开的回答");
  for (let i = 0; i < n; i++) {
    const ans = answers.nth(i);
    const toggle = ans.getByRole("button", { name: /条评论|收起评论/ });
    await toggle.click();
    // 等评论区落地：出现评论行或空态提示。
    await ans
      .locator("li.answer__comment, .answer__comment-empty")
      .first()
      .waitFor();
  }

  // ---- (a) 残留正文：尾标纯数字 / 「冰结束」 ----
  const residue = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll(".answer__comment-body")) {
      const t = (el.textContent || "").trim();
      if (/\d{5,}\s*$/.test(t) || /冰结束/.test(t)) out.push(t.slice(0, 60));
    }
    return out;
  });
  expect(
    residue.length === 0,
    `评论区仍有断言残留正文：${JSON.stringify(residue)}`
  );

  // ---- (b) 孤儿删除占位：--deleted 行后无存活 --child 行 ----
  const orphanPlaceholders = await page.evaluate(() => {
    const lis = [...document.querySelectorAll("li.answer__comment")];
    const orphans = [];
    for (let i = 0; i < lis.length; i++) {
      if (!lis[i].querySelector(".answer__comment-body--deleted")) continue;
      let hasAliveChild = false;
      for (let j = i + 1; j < lis.length; j++) {
        if (lis[j].classList.contains("answer__comment--child")) hasAliveChild = true;
        else break;
      }
      if (!hasAliveChild) {
        const t = (lis[i].textContent || "").replace(/\s+/g, " ").trim();
        orphans.push(t.slice(0, 60));
      }
    }
    return orphans;
  });
  expect(
    orphanPlaceholders.length === 0,
    `存在无存活子回复的「该评论已删除」孤儿占位：${JSON.stringify(orphanPlaceholders)}`
  );

  // ---- (c) 防恒真 + 页面守卫 ----
  const visibleRows = await page.locator("li.answer__comment").count();
  expect(visibleRows > 0, "评论可见行数为 0，断言失效（防恒真）");
  const bodyLen = await page.evaluate(() => document.body.innerText.length);
  expect(bodyLen > 200, `页面内容过少：innerText=${bodyLen}`);
  const errs = await pageErrs(page);
  expect(errs.length === 0, `页面出现错误：${errs.join(" | ")}`);

  // ---- (d) 无横向溢出 ----
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  expect(!overflow, "页面出现横向溢出");

  console.log(
    `[comment-residue] /question/6 评论区无残留正文、无孤儿删除占位（可见行 ${visibleRows}）`
  );
});
