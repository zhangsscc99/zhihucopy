// Z1062 — 顶栏用户菜单可访问名读两遍（浏览器级断言）。
//
// 契约：
//   .usermenu__trigger 的可访问名 == 昵称原文；不得是「首字母+昵称」
//   拼接（avatar 首字被读两遍的旧形态）。头像装饰元素要么
//   aria-hidden="true"，要么按钮自带 aria-label 覆盖。
//   未登录态（登录/注册按钮）不受影响。
//
// 反向自检：基线上按钮无 aria-label、avatar span 无 aria-hidden →
//   可访问名为「首字母+昵称」→ 断言 FAIL。
//
// 通用守卫：body.innerText>200（防白屏假绿）、window.__errs 为空。
//
// 环境：verify.sh 透传 API_BASE；e2e/lib.mjs 的 BASE/API 在模块加载时定型，
// 故先按 API_BASE 反推 E2E_BASE/E2E_API 再动态 import。
const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3030/zhihucopy/api").replace(/\/+$/, "");
if (!process.env.E2E_API) process.env.E2E_API = API_BASE;
if (!process.env.E2E_BASE) process.env.E2E_BASE = API_BASE.replace(/\/api$/, "");

const { run, expect, BASE, api, authedPage } = await import("../e2e/lib.mjs");

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

run("usermenu-a11y-name", async ({ browser, page }) => {
  const login = await api("POST", "/auth/login", {
    body: { email: "user2@zhihucopy.dev", password: "zhihu123456" },
  });
  expect(login.status === 200, `seed login -> ${login.status}`);
  const nickname = login.data.user.nickname;
  console.log(`[seed] user2 nickname="${nickname}"`);

  const authed = await authedPage(browser, login.data.token);
  await injectErrs(authed);
  await authed.goto(`${BASE}/`);
  await authed.locator(".usermenu__trigger").waitFor();

  // ---- 通用守卫：页面非白屏 ----
  const bodyLen = await authed.evaluate(() => document.body.innerText.length);
  expect(bodyLen > 200, `页面内容过少：innerText=${bodyLen}`);

  const info = await authed.evaluate(() => {
    const btn = document.querySelector(".usermenu__trigger");
    if (!btn) return null;
    const avatar = btn.querySelector(".avatar");
    // 可访问名近似：aria-label 优先；否则拼接未被 aria-hidden 的文本。
    const accName = () => {
      const label = btn.getAttribute("aria-label");
      if (label && label.trim()) return label.trim();
      let text = "";
      for (const node of btn.querySelectorAll("*")) {
        if (node.getAttribute("aria-hidden") === "true") continue;
        if (node.children.length === 0) text += node.textContent || "";
      }
      return text.trim();
    };
    return {
      ariaLabel: btn.getAttribute("aria-label"),
      accName: accName(),
      rawText: (btn.textContent || "").trim(),
      avatarHidden: avatar ? avatar.getAttribute("aria-hidden") === "true" : null,
    };
  });
  console.log(`[trigger] ${JSON.stringify(info)}`);
  expect(info, "未找到 .usermenu__trigger");

  // 可访问名 == 昵称原文，且不等于「首字母+昵称」拼接
  expect(
    info.accName === nickname,
    `可访问名「${info.accName}」≠ 昵称「${nickname}」（原文 rawText="${info.rawText}"）`
  );
  expect(
    info.accName !== `${nickname.slice(0, 1)}${nickname}`,
    `可访问名仍是「首字母+昵称」拼接：「${info.accName}」`
  );

  // 装饰元素治理：avatar aria-hidden，或按钮自带 aria-label
  expect(
    info.avatarHidden === true || (info.ariaLabel || "").trim().length > 0,
    `avatar 未 aria-hidden 且按钮无 aria-label：avatarHidden=${info.avatarHidden} ariaLabel=${info.ariaLabel}`
  );

  const errs = await authed.evaluate(() => window.__errs || []);
  expect(errs.length === 0, `页面出现错误：${errs.join(" | ")}`);
});
