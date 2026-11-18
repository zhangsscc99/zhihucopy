// Z1213 — 窄屏（390）元信息换行时行尾悬挂分隔点修复。
//
// 断言（BASE 热榜，390×844，/?tab=hot）：
//   1. 前 5 张 .feed__item 的 .feed__meta：用 Range.getClientRects() 按行分组，
//      把每项的 ::before/text/::after 拼回行文本，每行 trim 后首字符与末字符
//      都不是「·」（不允许行首/行尾孤立分隔点）。
//   2. document.body.scrollWidth === 390（无横向溢出）。
//   3. window.__errs 为空。
// 桌面回归（1440×900）：同一页第一张卡 .feed__meta 行内文本仍含「·」≥1 处，
//   证明 ≥768px 的 ::before 分隔点未被改动。
//
// Env: E2E_BASE || http://127.0.0.1:3030/zhihucopy ；失败截图到 /root/logs。
// 退出码 0 PASS / 1 FAIL。

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

async function collect(page, nCards) {
  return page.evaluate((n) => {
    const pseudo = (el, which) => {
      const c = getComputedStyle(el, which).content;
      return c && c !== "none" && c !== "normal"
        ? c.replace(/^"|"$/g, "")
        : "";
    };
    // .feed__meta 直接子项都是 nowrap 内联块，一项必落在同一行：
    // 用 Range.getClientRects() 拿每项的行盒（首 rect 的垂直中心聚类成行），
    // 行文本 = 按 DOM 序拼接每项 ::before + textContent + ::after。
    const linesPerCard = [...document.querySelectorAll(".feed__item")]
      .slice(0, n)
      .map((item) => {
        const meta = item.querySelector(".feed__meta");
        if (!meta) return null;
        const parts = [];
        [...meta.children].forEach((child, idx) => {
          const range = document.createRange();
          range.selectNodeContents(child);
          const rect = [...range.getClientRects()].find(
            (r) => r.width > 0 && r.height > 0
          );
          range.detach();
          if (!rect) return; // display:none 的长文案项
          parts.push({
            idx,
            cy: rect.top + rect.height / 2,
            text:
              pseudo(child, "::before") +
              child.textContent +
              pseudo(child, "::after"),
          });
        });
        // 按垂直中心聚行（行距 ~20px，头像 24px 与文字行中心差 <6px），
        // 行内恢复 DOM 序拼接。
        const lines = [];
        for (const p of [...parts].sort((a, b) => a.cy - b.cy)) {
          const line = lines.find((l) => Math.abs(l.cy - p.cy) <= 8);
          if (line) line.parts.push(p);
          else lines.push({ cy: p.cy, parts: [p] });
        }
        return lines
          .sort((a, b) => a.cy - b.cy)
          .map((l) =>
            l.parts
              .sort((a, b) => a.idx - b.idx)
              .map((p) => p.text)
              .join("")
          );
      })
      .filter(Boolean);
    return {
      linesPerCard,
      bodySW: document.body.scrollWidth,
      winW: window.innerWidth,
    };
  }, nCards);
}

async function openHot(page) {
  await injectErrs(page);
  await page.goto(BASE + "/?tab=hot", { waitUntil: "networkidle" });
  await page.locator(".feed__item").first().waitFor({ state: "visible" });
}

run("feed-meta-separator", async ({ browser }) => {
  // ---- 390×844：换行处每行首/尾字符不得为「·」 ----
  const ctxM = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "zh-CN",
  });
  const pageM = await ctxM.newPage();
  pageM.setDefaultTimeout(15000);
  await openHot(pageM);

  const m = await collect(pageM, 5);
  expect(m.linesPerCard.length === 5, `热榜 .feed__item 不足 5 张：${m.linesPerCard.length}`);
  let wrapped = 0;
  m.linesPerCard.forEach((lines, i) => {
    if (lines.length > 1) wrapped++;
    lines.forEach((t, j) => {
      const s = t.trim();
      expect(
        s[0] !== "·" && s[s.length - 1] !== "·",
        `卡${i + 1} 第${j + 1}行行首/行尾孤立分隔点：「${s}」`
      );
    });
    console.log(`  卡${i + 1} 行=${lines.length}: ${lines.map((l) => `「${l.trim()}」`).join(" / ")}`);
  });
  expect(wrapped > 0, "前 5 张卡元信息均未换行，断言未覆盖换行场景");
  expect(
    m.bodySW === 390,
    `body 横向溢出 scrollWidth=${m.bodySW} innerWidth=${m.winW}`
  );
  const errsM = await pageM.evaluate(() => window.__errs || []);
  expect(errsM.length === 0, `页面错误：${errsM.join(" | ")}`);
  await ctxM.close();

  // ---- 1440×900 回归：桌面元信息行内仍含「·」 ----
  const ctxD = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
  });
  const pageD = await ctxD.newPage();
  pageD.setDefaultTimeout(15000);
  await openHot(pageD);

  const d = await collect(pageD, 1);
  const allText = d.linesPerCard.flat().join(" ");
  const dots = (allText.match(/·/g) || []).length;
  console.log(`  桌面1440 卡1: ${d.linesPerCard[0].map((l) => `「${l.trim()}」`).join(" / ")} (含「·」×${dots})`);
  expect(dots >= 1, `桌面 1440 下 .feed__meta 行内没有「·」，桌面分隔点被改动`);
  const errsD = await pageD.evaluate(() => window.__errs || []);
  expect(errsD.length === 0, `桌面页错误：${errsD.join(" | ")}`);
  await ctxD.close();
});
