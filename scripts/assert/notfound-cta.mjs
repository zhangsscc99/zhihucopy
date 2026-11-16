#!/usr/bin/env node
// Z1034 — 404 归因、真 404 状态码、≥2 可点出口（浏览器级断言）。
//
// 校验：
//   /question/99999999 → HTTP 404；「不存在」文案、无「检查网络」；main 内 a,button ≥2
//   /u/99999999        → 同上
//   /no-such-xyz       → HTTP 404；「回到首页」是可点 a[href]/button，点击回首页
//   /question/1        → 反向用例：HTTP 200 且标题正常渲染
//   /u/1 + API 500     → 「服务暂时不可用」，无「不存在」，「重试」可点且真重发请求
//   /u/1 + API abort   → 同上归因：网络中断 ≠ 内容不存在
//
// env：API_BASE（verify.sh 传入）或 E2E_BASE/E2E_API。
// 注意：e2e/lib.mjs 在模块加载时读取 env，必须先设好再动态 import。
if (!process.env.E2E_API && process.env.API_BASE) {
  process.env.E2E_API = process.env.API_BASE;
}
if (!process.env.E2E_BASE) {
  const api = process.env.E2E_API || "http://127.0.0.1:3030/zhihucopy/api";
  process.env.E2E_BASE = api.replace(/\/api\/?$/, "");
}

const { run, expect, BASE } = await import("../e2e/lib.mjs");

async function expectMissingPage(page, path, name) {
  const resp = await page.goto(`${BASE}${path}`);
  expect(
    resp && resp.status() === 404,
    `${name} HTTP ${resp ? resp.status() : "无响应"}，期望 404`
  );
  // 「不存在」文案出现（统一 404 页：你访问的内容不存在或已被删除）
  await page.locator("main").getByText("不存在").first().waitFor();
  const text = await page.locator("main").textContent();
  expect(
    !text.includes("检查网络"),
    `${name} 仍含「检查网络」——内容不存在被误归因为网络问题`
  );
  const clickables = await page.locator("main").locator("a, button").count();
  expect(clickables >= 2, `${name} main 内可点元素 ${clickables} 个，期望 ≥2 出口`);
}

// 服务故障（5xx/断网）必须归因「服务暂时不可用」，不得落到「不存在」，
// 且给出可点的「重试」出口。
async function expectServiceError(page, name) {
  await page
    .locator("main")
    .getByText("服务暂时不可用")
    .first()
    .waitFor();
  const text = await page.locator("main").textContent();
  expect(
    !text.includes("不存在"),
    `${name} 服务故障被误归因成「不存在」`
  );
  const retry = page.locator("main").getByRole("button", { name: "重试" });
  await retry.waitFor();
  return retry;
}

run("notfound-cta", async ({ page }) => {
  await expectMissingPage(page, "/question/99999999", "/question/99999999");
  await expectMissingPage(page, "/u/99999999", "/u/99999999");

  // 未知路由：404 +「回到首页」是真实可点元素，点击回到首页
  const resp = await page.goto(`${BASE}/no-such-xyz`);
  expect(
    resp && resp.status() === 404,
    `/no-such-xyz HTTP ${resp ? resp.status() : "无响应"}，期望 404`
  );
  const homeCta = page.locator("main").getByText("回到首页");
  await homeCta.waitFor();
  const tag = await homeCta.evaluate((el) => el.tagName.toLowerCase());
  const href = await homeCta.evaluate((el) => el.getAttribute("href"));
  expect(
    tag === "a" ? Boolean(href) : tag === "button",
    `「回到首页」不是可点元素（<${tag}> href=${href}）`
  );
  await homeCta.click();
  await page.waitForURL(/\/zhihucopy\/?$/, { timeout: 15000 });

  // 反向用例：存在的问题仍 200 且正常渲染标题
  const ok = await page.goto(`${BASE}/question/1`);
  expect(
    ok && ok.status() === 200,
    `/question/1 HTTP ${ok ? ok.status() : "无响应"}，期望 200`
  );
  await page.locator(".question__title").waitFor();

  // 归因守卫：/api/users/1 拦截成 500 → 服务异常文案 + 可点重试（重发请求）
  const userApi = "**/zhihucopy/api/users/1";
  await page.route(userApi, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "internal" }),
    })
  );
  await page.goto(`${BASE}/u/1`);
  const retry = await expectServiceError(page, "/u/1 API 500");
  const retried = page.waitForRequest(userApi);
  await retry.click();
  await retried;

  // 拦截成 abort（网络中断）→ 同样归因服务异常，不归「不存在」
  await page.unroute(userApi);
  await page.route(userApi, (route) => route.abort());
  await page.goto(`${BASE}/u/1`);
  await expectServiceError(page, "/u/1 API abort");
});
