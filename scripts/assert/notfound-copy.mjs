#!/usr/bin/env node
// Z1048 — NotFound detail 归一化：英文原始错误串不得透出给用户。
//
// 源码级：
//   NotFound.tsx 必须定义 friendlyDetail 映射函数，且在渲染 .notfound__detail
//   前实际调用（防止「定义了没用」/ 直接渲染 raw detail 的回退）。
//
// 浏览器级：
//   拦截 **/api/questions/* 返回 500 {error:"internal"} → /question/1 显示
//   「服务暂时不可用」，.notfound__detail 文本不含 internal / Failed to fetch /
//   undefined，且字符全是中文/中文标点。
//   真 404（/question/99999999）→ 「你访问的内容不存在或已被删除」+
//   「回到首页」「去搜索」两个出口均在。
//
// env：API_BASE 或 E2E_BASE/E2E_API（同其它 assert 脚本）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

if (!process.env.E2E_API && process.env.API_BASE) {
  process.env.E2E_API = process.env.API_BASE;
}
if (!process.env.E2E_BASE) {
  const api = process.env.E2E_API || "http://127.0.0.1:3030/zhihucopy/api";
  process.env.E2E_BASE = api.replace(/\/api\/?$/, "");
}

const { run, expect, BASE } = await import("../e2e/lib.mjs");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

// ---- 源码级断言 ----
const src = readFileSync(join(ROOT, "client/src/pages/NotFound.tsx"), "utf8");
expect(
  /export function friendlyDetail\s*\(/.test(src),
  "NotFound.tsx 缺少 friendlyDetail 归一化函数"
);
expect(
  /friendlyDetail\s*\(\s*detail\s*\)/.test(src),
  "friendlyDetail 定义了但渲染前未调用（detail 未经过归一化）"
);
// detail 不得绕过归一化直接渲染
expect(
  !/notfound__detail">\s*\{detail\}/.test(src) &&
    !/\{detail\s*&&\s*<p className="notfound__detail"/.test(src),
  "NotFound.tsx 仍在直接渲染原始 detail"
);
console.log("[notfound-copy] 源码级断言 PASS");

const CN_ONLY = /^[一-龥，。、；：！？（）·—…0-9]+$/;

run("notfound-copy", async ({ page }) => {
  // ---- 服务异常：500 internal → 中文友好文案，不透英文 ----
  await page.route("**/api/questions/*", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "internal" }),
    })
  );
  await page.goto(`${BASE}/question/1`);
  await page.locator("main").getByText("服务暂时不可用").first().waitFor();

  const detail = page.locator(".notfound__detail");
  const count = await detail.count();
  if (count > 0) {
    const text = (await detail.first().textContent()) || "";
    for (const bad of ["internal", "Failed to fetch", "undefined"]) {
      expect(
        !text.includes(bad),
        `.notfound__detail 透出原始串 "${bad}"：${text}`
      );
    }
    expect(
      CN_ONLY.test(text.trim()),
      `.notfound__detail 含非中文字符：${text}`
    );
  }
  // main 区域整体也不得透出这些原始串
  const mainText = (await page.locator("main").textContent()) || "";
  for (const bad of ["internal", "Failed to fetch", "undefined"]) {
    expect(!mainText.includes(bad), `main 透出原始串 "${bad}"`);
  }
  await page.unroute("**/api/questions/*");

  // ---- 真 404：文案不变 + 两个出口 ----
  const resp = await page.goto(`${BASE}/question/99999999`);
  expect(
    resp && resp.status() === 404,
    `/question/99999999 HTTP ${resp ? resp.status() : "无响应"}，期望 404`
  );
  await page
    .locator("main")
    .getByText("你访问的内容不存在或已被删除")
    .first()
    .waitFor();
  await page.locator("main").getByText("回到首页").first().waitFor();
  await page.locator("main").getByText("去搜索").first().waitFor();
});
