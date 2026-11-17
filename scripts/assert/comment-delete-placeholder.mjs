// Z1119 — 删自己的评论整行移除，不留「该评论已删除」占位（浏览器级断言）。
//
// 契约：
//   1) 自己删除成功的评论整行消失（可见评论条目数 -1），评论计数 -1；
//      「该评论已删除」字样出现次数不因本次删除 +1。
//   2) 他人删除/被折叠且无存活子回复的评论不再逐行渲染，合并为列表末尾
//      一行「N 条评论已删除」（不可点、无删除按钮）；自己删的不计入 N。
//   3) 已删除但仍有存活子回复的评论保留占位行（Z1101 契约不变）。
//   4) 刷新后状态保持；window.__errs 为空；1440/390 无横向溢出。
//
// 场景（同一回答下）：
//   user6: B（存活）+ C（发后即删、无子回复 → 合并行「1 条评论已删除」）
//          + D（发后即删、带存活子回复 E → 保留 1 行「该评论已删除」占位）
//   user5(浏览器身份): A（UI 删除 → 整行移除，不进合并行）
//
// 注意：@test.dev 注册号（is_test=1）的评论被公共评论列表过滤，评论区里
// 需要可见的留言一律用种子号（user5/user6@zhihucopy.dev）发。
//
// 环境：verify.sh 透传 API_BASE；e2e/lib.mjs 的 BASE/API 在模块加载时定型，
// 故先按 API_BASE 反推 E2E_BASE/E2E_API 再动态 import。
const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
if (!process.env.E2E_API) process.env.E2E_API = API_BASE;
if (!process.env.E2E_BASE) process.env.E2E_BASE = API_BASE.replace(/\/api$/, "");

const { run, expect, BASE, register, authedPage, api, apiOk, uniq } = await import(
  "../e2e/lib.mjs"
);

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

const noOverflow = (page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1
  );

// 评论区内「该评论已删除」字样出现次数（合并行「N 条评论已删除」不含「该」字，
// 不计入；逐项计叶子节点避免容器重复计）。
const countDeletedPlaceholders = (ans) =>
  ans.locator(".answer__comments").evaluate((box) => {
    const re = /该评论已删除/;
    return [...box.querySelectorAll("*")].filter(
      (el) =>
        re.test(el.textContent || "") &&
        ![...el.children].some((c) => re.test(c.textContent || ""))
    ).length;
  });

const seedLogin = async (email) => {
  const r = await api("POST", "/auth/login", {
    body: { email, password: "zhihu123456" },
  });
  expect(r.status === 200, `seed login ${email} -> ${r.status}`);
  return r.data;
};

run("comment-delete-placeholder", async ({ browser }) => {
  const op = await register(uniq("op"));
  const me = await seedLogin("user5@zhihucopy.dev");
  const other = await seedLogin("user6@zhihucopy.dev");

  const { question } = await apiOk("POST", "/questions", {
    token: op.token,
    body: { title: `[e2e] ${uniq("q")} — 评论删除占位验证`, detail_md: "评论删除占位验收用问题。" },
  });
  const { answer } = await apiOk("POST", `/questions/${question.id}/answers`, {
    token: op.token,
    body: { content_md: "回答正文：评论删除占位断言挂点。" },
  });
  const aid = answer.id;
  const stamp = Date.now();

  // 他人（user6）埋点：1 存活 + 1 发后即删（无子回复，应进合并行）
  // + 1 发后即删（带存活子回复，应保留占位行）。
  await apiOk("POST", "/comments", {
    token: other.token,
    body: { target_type: "answer", target_id: aid, body: `占位断言存活 ${stamp}b` },
  });
  const { comment: gone1 } = await apiOk("POST", "/comments", {
    token: other.token,
    body: { target_type: "answer", target_id: aid, body: `占位断言他删 ${stamp}c` },
  });
  await apiOk("DELETE", `/comments/${gone1.id}`, { token: other.token });
  const { comment: gone2 } = await apiOk("POST", "/comments", {
    token: other.token,
    body: { target_type: "answer", target_id: aid, body: `占位断言他删父 ${stamp}d` },
  });
  await apiOk("POST", "/comments", {
    token: other.token,
    body: { target_type: "answer", target_id: aid, parent_id: gone2.id, body: `占位断言子 ${stamp}e` },
  });
  await apiOk("DELETE", `/comments/${gone2.id}`, { token: other.token });

  // 自己（user5）的评论：稍后走 UI 删除。
  const marker = `占位断言自发 ${stamp}a`;
  await apiOk("POST", "/comments", {
    token: me.token,
    body: { target_type: "answer", target_id: aid, body: marker },
  });

  const page = await authedPage(browser, me.token);
  await page.setViewportSize({ width: 1440, height: 900 });
  await injectErrs(page);
  await page.goto(`${BASE}/question/${question.id}`);
  await page.locator(".question__title").first().waitFor();

  const ans = page.locator(`#answer-${aid}`);
  const rows = ans.locator("li.answer__comment");
  const toggle = ans.getByRole("button", { name: /条评论|收起评论/ });
  await toggle.click();
  await rows.first().waitFor();

  const mainText = () => page.locator("main").innerText();

  // 初始：自发评论正文可见；渲染行 = B、D占位、E、A 共 4；合并行「1 条评论已删除」。
  expect((await mainText()).includes(marker), "初始 main 文本未含自发评论正文");
  const n0 = await rows.count();
  expect(n0 === 4, `初始可见评论条目数=${n0}，期望 4（含 1 行删除占位）`);
  const ph0 = await countDeletedPlaceholders(ans);
  expect(ph0 === 1, `初始「该评论已删除」次数=${ph0}，期望 1（带存活子回复的占位行）`);
  const merged = ans.locator("li.answer__comment-merged");
  await merged.waitFor();
  expect((await merged.innerText()).trim() === "1 条评论已删除",
    `合并行文案异常：「${await merged.innerText()}」期望「1 条评论已删除」`);
  expect(await merged.locator("button").count() === 0, "合并行内不应有按钮");

  // UI 删除自己的评论：删除 → 确认删除 → 整行消失。
  const myRow = ans.locator("li.answer__comment", { hasText: marker });
  await myRow.getByRole("button", { name: "删除", exact: true }).click();
  await myRow.getByRole("button", { name: "确认删除" }).click();
  await myRow.waitFor({ state: "detached" });

  expect(!(await mainText()).includes(marker), "删除后 main 文本仍含自发评论正文");
  const n1 = await rows.count();
  expect(n1 === n0 - 1, `删除后可见评论条目数=${n1}，期望 ${n0 - 1}（整行移除）`);
  const ph1 = await countDeletedPlaceholders(ans);
  expect(ph1 === ph0, `删除后「该评论已删除」次数=${ph1}，因本次删除 +1（原 ${ph0}）`);
  expect((await merged.innerText()).trim() === "1 条评论已删除",
    `自己删除的评论被计入合并行：「${await merged.innerText()}」期望「1 条评论已删除」`);

  // 刷新后重新展开：状态保持。
  await page.reload();
  await page.locator(".question__title").first().waitFor();
  const ans2 = page.locator(`#answer-${aid}`);
  await ans2.getByRole("button", { name: /条评论|收起评论/ }).click();
  await ans2.locator("li.answer__comment").first().waitFor();
  expect(!(await mainText()).includes(marker), "刷新后 main 文本仍含已删评论正文");
  const n2 = await ans2.locator("li.answer__comment").count();
  expect(n2 === n0 - 1, `刷新后可见评论条目数=${n2}，期望 ${n0 - 1}`);
  const ph2 = await countDeletedPlaceholders(ans2);
  expect(ph2 <= 1, `刷新后「该评论已删除」次数=${ph2}，期望 ≤1（合并行不计）`);
  const merged2 = ans2.locator("li.answer__comment-merged");
  expect((await merged2.innerText()).trim() === "1 条评论已删除",
    `刷新后合并行文案异常：「${await merged2.innerText()}」期望「1 条评论已删除」`);

  // 通用守卫：__errs 为空；1440 与 390 均无横向溢出。
  const errs = await pageErrs(page);
  expect(errs.length === 0, `页面出现错误：${errs.join(" | ")}`);
  expect(await noOverflow(page), "1440 视口出现横向溢出");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  expect(await noOverflow(page), "390 视口出现横向溢出");
});
