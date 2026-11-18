// Z1190 — 390 宽下回答操作栏单行渲染，「反对」不再竖排、时间戳不截断。
//
// 断言（BASE/question/6，DOM 取第一个 .answerlist > li 内的 .answer__actions）：
//  1) 390×844：
//     - 操作栏高度 ≤ 同行内最高可点条目高度 × 1.2（单行，未挤成两排）；
//     - 栏内每个 button/a：innerText.trim().length > 1 时
//       getClientRects().length === 1（文字不折行）；
//     - 每个可点条目 getBoundingClientRect().width >= 40；
//     - 每个按钮 scrollWidth <= clientWidth + 1（无内部裁切）；
//     - .answer__date 的 innerText 不以「…」结尾且
//       scrollWidth <= clientWidth + 1（无省略号残句）；
//     - document.body.scrollWidth === 390（无横向溢出）；window.__errs 为空。
//  2) 360×640 同口径，唯 min-width 放宽到 >= 36px；body 横向溢出改为归因
//     断言：所有越出视口的元素必须位于可横向滚动的 .answer__actions 内
//     （被裁切、不贡献 body scrollWidth）或命中既有缺陷 .topnav
//     （360 顶栏溢出是独立缺陷，不在本条范围，同 Z1175 口径）。
//  3) 1440×900 回归：操作栏仍单行、.answer__date 文本以「发布于 」开头、
//     window.__errs 为空。
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

async function checkBar(page, tag, minWidth, knownOverflowSel) {
  await page.goto(`${BASE}/question/6`, { waitUntil: "networkidle" });
  const first = page.locator(".answerlist > li").first();
  await first.waitFor({ state: "visible" });
  const bar = first.locator(".answer__actions");
  await bar.waitFor({ state: "visible" });
  await page.waitForTimeout(300);

  const info = await bar.evaluate((el, knownSel) => {
    const items = [...el.querySelectorAll("button, a")];
    return {
      barH: el.getBoundingClientRect().height,
      items: items.map((it) => {
        const r = it.getBoundingClientRect();
        return {
          text: (it.innerText || "").trim(),
          rects: it.getClientRects().length,
          w: r.width,
          h: r.height,
          sw: it.scrollWidth,
          cw: it.clientWidth,
        };
      }),
      date: (() => {
        const d = el.querySelector(".answer__date");
        if (!d) return null;
        return {
          text: (d.innerText || "").trim(),
          sw: d.scrollWidth,
          cw: d.clientWidth,
        };
      })(),
      bodySW: document.body.scrollWidth,
      winW: window.innerWidth,
      // 越出视口且未被任何 overflow 裁切祖先拦住的元素（body 溢出归因）。
      strays: (() => {
        const clipped = (el) => {
          for (let n = el; n && n !== document.body; n = n.parentElement) {
            const ox = getComputedStyle(n).overflowX;
            if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip")
              return true;
          }
          return false;
        };
        return [...document.querySelectorAll("body *")]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return (r.right > window.innerWidth + 1 || r.left < -1) && !clipped(el);
          })
          .map((el) => ({
            name: `${el.tagName}.${el.className}`,
            known: knownSel ? Boolean(el.closest(knownSel)) : false,
          }))
          .slice(0, 20);
      })(),
    };
  }, knownOverflowSel);

  expect(info.items.length > 0, `${tag}：操作栏内没有可点条目`);
  const maxH = Math.max(...info.items.map((i) => i.h));
  expect(
    info.barH <= maxH * 1.2,
    `${tag}：操作栏高 ${info.barH.toFixed(1)}px > 最高条目 ${maxH.toFixed(1)}px × 1.2（疑似两行）`
  );
  for (const it of info.items) {
    if (it.text.length > 1) {
      expect(
        it.rects === 1,
        `${tag}：条目「${it.text}」折行（getClientRects=${it.rects}）`
      );
    }
    if (minWidth !== null) {
      expect(
        it.w >= minWidth,
        `${tag}：条目「${it.text}」宽 ${it.w.toFixed(1)}px < ${minWidth}px`
      );
    }
    expect(
      it.sw <= it.cw + 1,
      `${tag}：条目「${it.text}」内部裁切 scrollWidth=${it.sw} clientWidth=${it.cw}`
    );
  }
  expect(info.date, `${tag}：.answer__date 不存在`);
  expect(
    !info.date.text.endsWith("…"),
    `${tag}：时间戳被截断：「${info.date.text}」`
  );
  expect(
    info.date.sw <= info.date.cw + 1,
    `${tag}：.answer__date 内部裁切 scrollWidth=${info.date.sw} clientWidth=${info.date.cw}`
  );
  if (knownOverflowSel === null) {
    expect(
      info.bodySW === info.winW,
      `${tag}：body 横向溢出 scrollWidth=${info.bodySW} innerWidth=${info.winW}`
    );
  } else {
    // 归因口径：未被裁切的越界元素只允许是既有缺陷（如 360 顶栏）。
    for (const s of info.strays) {
      expect(
        s.known,
        `${tag}：非预期横向溢出元素 ${s.name}（bodySW=${info.bodySW} winW=${info.winW}）`
      );
    }
  }
  const errs = await page.evaluate(() => window.__errs || []);
  expect(errs.length === 0, `${tag}：页面错误：${errs.join(" | ")}`);
  return info;
}

run("answer-actionbar-390", async ({ browser }) => {
  for (const [w, h, minW, known] of [
    [390, 844, 40, null],
    [360, 640, 36, ".topnav"],
  ]) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      locale: "zh-CN",
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    await injectErrs(page);
    await checkBar(page, `${w}px`, minW, known);
    await ctx.close();
  }

  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    await injectErrs(page);
    const info = await checkBar(page, "1440px", null, null);
    expect(
      info.date.text.startsWith("发布于 "),
      `1440px：.answer__date 文本不以「发布于 」开头：「${info.date.text}」`
    );
    await ctx.close();
  }
});
