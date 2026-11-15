// probe-auth.mjs — 为什么注入 token 后仍显示未登录？同时对比 UI 登录。
import { BASE, SHOT_DIR, register, launch, newPage, authedPage } from "./lib.mjs";
import fs from "node:fs";

const main = async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const { token, email, password } = await register("probe-ui");
  const browser = await launch();

  const p1 = await authedPage(browser, token);
  p1.on("console", (m) => console.log("  [c1]", m.type(), m.text().slice(0, 160)));
  await p1.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await p1.waitForTimeout(1000);
  console.log("injected token:", token.slice(0, 12), "len", token.length);
  console.log("localStorage:", await p1.evaluate(() => JSON.stringify({ ...localStorage })).catch((e) => "ERR " + e.message));
  console.log("nav text:", (await p1.locator("header").innerText()).replace(/\s+/g, " ").slice(0, 120));

  const p2 = await newPage(browser);
  p2.on("console", (m) => console.log("  [c2]", m.type(), m.text().slice(0, 160)));
  await p2.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  console.log("login page text:", (await p2.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 200));
  const inputs = await p2.locator("input").evaluateAll((els) => els.map((e) => ({ type: e.type, name: e.name, ph: e.placeholder, aria: e.getAttribute("aria-label") })));
  console.log("login inputs:", JSON.stringify(inputs));
  await p2.getByLabel("邮箱").fill(email).catch((e) => console.log("fill email fail", e.message));
  await p2.getByLabel("密码").fill(password).catch((e) => console.log("fill pw fail", e.message));
  await p2.getByRole("button", { name: "登录" }).click().catch((e) => console.log("click fail", e.message));
  await p2.waitForTimeout(2000);
  console.log("after login url:", p2.url().replace(BASE, ""), "| nav:", (await p2.locator("header").innerText()).replace(/\s+/g, " ").slice(0, 120));
  console.log("storage after login:", await p2.evaluate(() => JSON.stringify({ ...localStorage })));
  await p2.screenshot({ path: SHOT_DIR + "/probe-after-login.png", fullPage: true });

  // 登录后直接访问详情页，看编辑器是否出现
  await p2.goto(`${BASE}/question/127`, { waitUntil: "networkidle" });
  await p2.waitForTimeout(1200);
  console.log("q127 authed has textarea:", await p2.locator("textarea").count(), "| body:", (await p2.locator("main").innerText()).replace(/\s+/g, " ").slice(-180));

  // p1 注 token 后刷新详情页
  await p1.goto(`${BASE}/question/127`, { waitUntil: "networkidle" });
  await p1.waitForTimeout(1200);
  console.log("q127 injected has textarea:", await p1.locator("textarea").count(), "| nav:", (await p1.locator("header").innerText()).replace(/\s+/g, " ").slice(0, 80));
  await browser.close();
};
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
