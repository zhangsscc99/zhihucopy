// Z1175 — 问题页 /question/6 头部元信息在移动端不再逐字断行。
//
// 断言（BASE/question/6，需已有种子数据：昵称 + 提问时间 + 关注/回答/浏览数）：
//  1) 390×844 与 360×640：`.question__meta` 内每个非空直接子片段高度
//     < 1.6 × 行高（flex 子项是 block 盒，折行时高度≈2×行高 → 稳定判定
//     「片段内部不折行」，等价于 getClientRects 单行但不受 inline/block 差异影响）；
//     整行总高 < 2.2 × 行高（最多 2 行）；
//     可见文本完整含「人关注」「个回答」「次浏览」「提问于」；
//     元信息自身不溢出：meta.scrollWidth <= meta.clientWidth + 1，且每个
//     片段 right <= meta.right + 1；window.__errs 为空。
//     （360 下顶栏 body 横向溢出是既有独立缺陷，不在本条断言范围。）
//  2) 1440×900：meta 仍为单行（高度 < 1.6 × 行高）——桌面回归保护。
//
// Env: E2E_BASE || http://127.0.0.1:3030/zhihucopy ；CHROME 可覆盖浏览器路径；
//      失败截图到 /root/logs。退出码 0 PASS / 1 FAIL。

import { run, expect, launch, BASE } from "../e2e/lib.mjs";

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

async function checkMeta(page, tag, maxLines) {
  await page.goto(`${BASE}/question/6`, { waitUntil: "networkidle" });
  const meta = page.locator(".question__meta");
  await meta.waitFor({ state: "visible" });
  await page.waitForTimeout(300);

  const info = await meta.evaluate((el) => {
    const lh = parseFloat(getComputedStyle(el).lineHeight);
    const metaRect = el.getBoundingClientRect();
    const kids = [...el.children]
      .map((k) => ({
        text: (k.innerText || "").trim(),
        h: k.getBoundingClientRect().height,
        left: k.getBoundingClientRect().left,
        right: k.getBoundingClientRect().right,
      }))
      .filter((k) => k.text.length > 0);
    return {
      lh,
      boxH: metaRect.height,
      left: metaRect.left,
      kids,
      text: el.innerText,
      sw: el.scrollWidth,
      cw: el.clientWidth,
      right: metaRect.right,
    };
  });

  for (const k of info.kids) {
    expect(
      k.h < 1.6 * info.lh,
      `${tag}：片段「${k.text}」内部折行（高 ${k.h.toFixed(1)}px ≥ 1.6×${info.lh.toFixed(1)}px）`
    );
  }
  expect(
    info.boxH < (maxLines + 0.2) * info.lh,
    `${tag}：meta 总高 ${info.boxH.toFixed(1)}px 超过 ${maxLines} 行（行高 ${info.lh.toFixed(1)}px）`
  );
  for (const kw of ["人关注", "个回答", "次浏览", "提问于"]) {
    expect(info.text.includes(kw), `${tag}：meta 文本缺「${kw}」：「${info.text}」`);
  }
  expect(
    info.sw <= info.cw + 1,
    `${tag}：meta 自身横向溢出 scrollWidth=${info.sw} clientWidth=${info.cw}`
  );
  for (const k of info.kids) {
    expect(
      k.right <= info.right + 1,
      `${tag}：片段「${k.text}」越出 meta 容器 right=${k.right.toFixed(1)} > ${info.right.toFixed(1)}`
    );
  }
  // 行首不得悬挂分隔符：flex 换行后每行第一个片段的 left 与容器 left
  // 基本对齐（<2px）；这些行首片段的文本不得以「·」开头。
  for (const k of info.kids) {
    if (Math.abs(k.left - info.left) < 2) {
      expect(
        !k.text.startsWith("·"),
        `${tag}：行首片段以分隔符开头：「${k.text}」`
      );
    }
  }
  const errs = await page.evaluate(() => window.__errs || []);
  expect(errs.length === 0, `${tag}：页面错误：${errs.join(" | ")}`);
}

run("question-meta-mobile", async ({ browser }) => {
  for (const [w, h] of [
    [390, 844],
    [360, 640],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: "zh-CN" });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    await injectErrs(page);
    await checkMeta(page, `${w}px`, 2);
    if (w === 360) {
      const regBtn = page.locator(".topnav__actions .btn--outline");
      expect(await regBtn.count() > 0, "360px：顶栏「注册」按钮不存在");
      expect(
        await regBtn.first().isVisible(),
        "360px：顶栏「注册」按钮被隐藏"
      );
      console.log("360px：顶栏「注册」按钮存在且可见");
    }
    await ctx.close();
  }

  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    await injectErrs(page);
    await checkMeta(page, "1440px", 1);
    await ctx.close();
  }
});
