// a11y.mjs — 可访问性：键盘焦点可见、prefers-reduced-motion、图片 alt、nav 有 aria-label。
import { run, expect, BASE } from "./lib.mjs";

run("a11y", async ({ page }) => {
  await page.goto(`${BASE}/`);
  await page.waitForLoadState("networkidle");

  // 键盘 Tab：焦点元素必须可见且有非 none 的轮廓/阴影
  await page.keyboard.press("Tab");
  const focus = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      outline: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      boxShadow: cs.boxShadow,
      visible: r.width > 0 && r.height > 0,
    };
  });
  expect(focus && focus.visible, "Tab did not land on a visible focusable element");
  const hasRing = (focus.outline !== "none" && focus.outlineWidth !== "0px") || (focus.boxShadow && focus.boxShadow !== "none");
  expect(hasRing, `focused ${focus.tag} has no visible focus indicator`);

  // reduced-motion 规则存在
  const hasRM = await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule instanceof CSSMediaRule && rule.media.mediaText.includes("prefers-reduced-motion")) return true;
        }
      } catch {}
    }
    return false;
  });
  expect(hasRM, "no prefers-reduced-motion media rule in stylesheets");

  // 底部导航 aria-label + 图片 alt
  expect((await page.locator("nav[aria-label]").count()) > 0, "no nav with aria-label");
  const imgsNoAlt = await page.locator("img:not([alt])").count();
  expect(imgsNoAlt === 0, `${imgsNoAlt} <img> without alt`);
});
