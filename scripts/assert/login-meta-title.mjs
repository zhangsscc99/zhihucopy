// Z1191 — 登录/注册页 document.title 残留来源页标题（浏览器级断言）。
//
// 契约：/login 与 /register 走 usePageTitle，title 恰为「登录 · 知乎（仿）」/
// 「注册 · 知乎（仿）」；前一页（如 /question/54）的标题不得残留到分享卡片。
// 登录成功回跳后由目标路由自己的钩子覆盖为「<问题标题> · 知乎（仿）」。
//
// 自检有效性：title 全部硬断言（includes/endsWith），不包 if(exists) ——
// hooks 未生效时 title=默认站点标题或来源页残留，必然 FAIL。
//
// 通用守卫：body.innerText>200；window.__errs 为空；1440×900 与 390×844
// 两视口都跑匿名用例，390 视口另查无横向溢出（scrollWidth===390）。
//
// 登录用例注册一个 e2e 临时号（邮箱/昵称带 e2e，退出自清理回收），
// 不写提问/回答/评论等生产数据。
const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
if (!process.env.E2E_API) process.env.E2E_API = API_BASE;
if (!process.env.E2E_BASE) process.env.E2E_BASE = API_BASE.replace(/\/api$/, "");

const { run, expect, BASE, authedPage, api } = await import("../e2e/lib.mjs");

const LOGIN_URL = `${BASE}/login?next=/question/54`;
const REGISTER_URL = `${BASE}/register`;
const QUESTION_KEYWORD = "虚无感";
const TITLE_SUFFIX = "· 知乎（仿）";

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

// 防空页守卫：1440 下整页（顶栏+热榜rail）innerText>200；390 下 rail 隐藏，
// 登录卡片实测仅 ~70 字，阈值降为 40——仍能把白屏/未渲染（≈0 字）判 FAIL。
async function assertGuards(page, tag, minLen = 200) {
  const bodyLen = await page.evaluate(() => document.body.innerText.length);
  expect(bodyLen > minLen, `${tag}：页面内容过少：innerText=${bodyLen}`);
  const errs = await pageErrs(page);
  expect(errs.length === 0, `${tag}：页面错误：${errs.join(" | ")}`);
}

async function checkLoginTitle(page, tag, minLen = 200) {
  await page.goto(LOGIN_URL);
  // 等标题稳定：等 SPA 渲染出登录表单后再取 title（hook 已同步执行）。
  await page.getByRole("button", { name: "登录" }).waitFor();
  const title = await page.evaluate(() => document.title);
  expect(title.includes("登录"), `${tag}：/login 标题不含「登录」：「${title}」`);
  expect(!title.includes(QUESTION_KEYWORD), `${tag}：/login 标题残留问题标题：「${title}」`);
  expect(title.endsWith(TITLE_SUFFIX), `${tag}：/login 标题未以「${TITLE_SUFFIX}」结尾：「${title}」`);
  await assertGuards(page, `${tag}:/login`, minLen);
}

async function checkRegisterTitle(page, tag, minLen = 200) {
  await page.goto(REGISTER_URL);
  await page.getByRole("button", { name: "注册" }).waitFor();
  const title = await page.evaluate(() => document.title);
  expect(title.includes("注册"), `${tag}：/register 标题不含「注册」：「${title}」`);
  expect(!title.includes(QUESTION_KEYWORD), `${tag}：/register 标题残留问题标题：「${title}」`);
  expect(title.endsWith(TITLE_SUFFIX), `${tag}：/register 标题未以「${TITLE_SUFFIX}」结尾：「${title}」`);
  await assertGuards(page, `${tag}:/register`, minLen);
}

run("login-meta-title", async ({ browser }) => {
  // ---- ①② 匿名 1440×900 ----
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    await injectErrs(page);
    await checkLoginTitle(page, "匿名1440");
    await checkRegisterTitle(page, "匿名1440");
    await ctx.close();
  }

  // ---- ④ 匿名 390×844（另断言无横向溢出）----
  {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "zh-CN",
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    await injectErrs(page);
    await checkLoginTitle(page, "匿名390", 40);
    await checkRegisterTitle(page, "匿名390", 40);
    const noOverflow = await page.evaluate(() => document.body.scrollWidth === 390);
    expect(noOverflow, "匿名390：存在横向溢出");
    await ctx.close();
  }

  // ---- ③ 登录成功回跳后标题恢复为问题标题 ----
  {
    const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`;
    const password = "e2e-pass-123456";
    const nickname = `e2e-title-${Math.random().toString(36).slice(2, 8)}`;
    const reg = await api("POST", "/auth/register", {
      body: { email, password, nickname },
    });
    expect(reg.status === 201, `register -> ${reg.status} ${JSON.stringify(reg.data).slice(0, 200)}`);

    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    await injectErrs(page);
    // 与 lib.mjs uiLogin() 同口径填表，但入口带 next 参数。
    await page.goto(LOGIN_URL);
    await page.getByLabel("邮箱").fill(email);
    await page.getByLabel("密码").fill(password);
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL(/\/question\/54/, { timeout: 15000 });
    await page.locator(".question__title").first().waitFor();
    const title = await page.evaluate(() => document.title);
    expect(
      title.includes(QUESTION_KEYWORD) || !title.includes("登录"),
      `${`回跳后`}：标题既不是问题标题也未脱离登录页：「${title}」`
    );
    expect(title.endsWith(TITLE_SUFFIX), `回跳后：标题未以「${TITLE_SUFFIX}」结尾：「${title}」`);
    await assertGuards(page, "回跳后");
    await ctx.close();
  }
});
