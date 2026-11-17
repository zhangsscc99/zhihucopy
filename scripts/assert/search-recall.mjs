// Z1144 — 中文 bigram 召回 + 低命中「相关话题」兜底（API 级 + 浏览器级）。
//
// API 级（API_BASE，缺省 http://127.0.0.1:3030/zhihucopy/api）：
//   1) GET /search?q=代码质量&type=question：counts.question >= 5 且
//      items.length >= 5、total === counts.question（旧整串 LIKE 只回 2 条）。
//   2) GET /search?q=React：counts.question >= 1 且 total === counts.question；
//      type=answer 的 total === counts.answer（tab 数字与列表口径一致）。
//   3) GET /search?q=？（纯标点）：items 为空、total === 0（Z1006 守卫不回归）。
//   4) Z1110 回归：React/useEffect/数据库/职场 counts.question >= 只读 LIKE 基线、
//      answer>0（基线为 0 的词除外）、type=answer total 与 counts.answer 自洽、
//      React/react/REACT 三态 counts 完全一致（DB 不可读时跳过 SQL 基线比对）。
// 浏览器级（E2E_BASE，或 API_BASE 去掉 /api 后缀推导页面地址，system chromium）：
//   5) /search?q=代码质量（1440 与 390 双视口）：.feed__item >= 5、出现
//      「相关话题」区块且其中每个链接 href 含 /topic/、无横向溢出
//      （scrollWidth-clientWidth===0）、window.__errs 为空、
//      document.body.innerText.length > 300。
//   6) /search?q=React（1440）：条目 >=1、无溢出、__errs 为空、innerText>300。
//
// 反向自检：对改动前实例（如线上 https://openfolio.uk/zhihucopy）跑本脚本必须
// FAIL —— 预期失败点 q=代码质量 counts.question=2 <5。
//
// 运行：node scripts/assert/search-recall.mjs
//   Env: API_BASE / E2E_BASE / DB_PATH（SQL 基线用，缺省 ../../data/zhihu.db）/ CHROME。
// 退出码即结论：0 PASS / 1 FAIL。

import { API, db, expect, ok } from "./lib.mjs";
import { run } from "../e2e/lib.mjs";

const PAGE_BASE = (
  process.env.E2E_BASE || API.replace(/\/api\/?$/, "")
).replace(/\/+$/, "");

const Z1110_TERMS = ["React", "useEffect", "数据库", "职场"];

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
    const origError = console.error;
    console.error = (...args) => {
      w.__errs.push(`console:${args.map(String).join(" ")}`);
      return origError.apply(console, args);
    };
  });
}

async function checkSearchPage(browser, vp, q, { minItems, wantTopics }) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    locale: "zh-CN",
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const tag = `${vp.width}px ${q}`;
  try {
    await injectErrs(page);
    await page.goto(`${PAGE_BASE}/search?q=${encodeURIComponent(q)}`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator(".feed__item")
      .first()
      .waitFor({ state: "visible", timeout: 15000 });
    // 相关话题块晚于结果一拍（独立请求），显式等它落定再判。
    if (wantTopics) {
      await page
        .locator(".search-rel")
        .first()
        .waitFor({ state: "visible", timeout: 15000 });
    } else {
      await page.waitForTimeout(600);
    }

    const items = await page.locator(".feed__item").count();
    expect(items >= minItems, `${tag}: 列表条目=${items}，期望 >=${minItems}`);

    if (wantTopics) {
      const rel = page.locator(".search-rel");
      const relText = await rel.innerText();
      expect(relText.includes("相关话题"), `${tag}: 未出现「相关话题」区块`);
      const links = rel.locator("a");
      const n = await links.count();
      expect(n >= 2, `${tag}: 相关话题链接数=${n}，期望 >=2`);
      for (let i = 0; i < n; i++) {
        const href = (await links.nth(i).getAttribute("href")) || "";
        expect(
          href.includes("/topic/"),
          `${tag}: 相关话题链接 href=${href} 不含 /topic/`
        );
      }
    }

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
    );
    expect(overflow === 0, `${tag}: 横向溢出 scrollWidth-clientWidth=${overflow}`);

    const textLen = await page.evaluate(() => document.body.innerText.length);
    expect(textLen > 300, `${tag}: innerText.length=${textLen}，期望 >300`);

    const errs = await page.evaluate(() => window.__errs || []);
    expect(
      errs.length === 0,
      `${tag}: __errs ${errs.length} 条: ${errs.slice(0, 3).join(" | ")}`
    );
    console.log(
      `  [ok] ${tag}: items=${items} ovf=0 text=${textLen} errs=0 topics=${
        wantTopics ? "yes" : "-"
      }`
    );
  } finally {
    await ctx.close();
  }
}

await run("search-recall", async ({ browser }) => {
  // ---------- API 级：Z1144 ----------
  const q1 = await ok(
    "GET",
    `/search?q=${encodeURIComponent("代码质量")}&type=question&limit=20`
  );
  expect(q1.counts, "q=代码质量 响应缺 counts");
  expect(
    q1.counts.question >= 5,
    `q=代码质量 counts.question=${q1.counts.question}，期望 >=5（bigram 召回）`
  );
  expect(
    Array.isArray(q1.items) && q1.items.length >= 5,
    `q=代码质量 items.length=${q1.items && q1.items.length}，期望 >=5`
  );
  expect(
    q1.total === q1.counts.question,
    `q=代码质量 total=${q1.total} != counts.question=${q1.counts.question}`
  );
  console.log(
    `  [ok] q=代码质量 counts.question=${q1.counts.question} items=${q1.items.length}`
  );

  const qr = await ok("GET", "/search?q=React&type=question&limit=20");
  expect(
    qr.counts && qr.counts.question >= 1,
    `q=React counts.question=${qr.counts && qr.counts.question}，期望 >=1`
  );
  expect(
    qr.total === qr.counts.question,
    `q=React total=${qr.total} != counts.question=${qr.counts.question}`
  );
  const qra = await ok("GET", "/search?q=React&type=answer&limit=1");
  expect(
    qra.total === qra.counts.answer,
    `q=React type=answer total=${qra.total} != counts.answer=${qra.counts.answer}`
  );

  const qm = await ok("GET", `/search?q=${encodeURIComponent("？")}`);
  expect(
    Array.isArray(qm.items) && qm.items.length === 0 && qm.total === 0,
    `q=？ total=${qm.total} items=${qm.items && qm.items.length}，期望 0 条（Z1006）`
  );
  console.log(`  [ok] q=React total=${qr.total} q=？ total=0`);

  // ---------- API 级：Z1110 回归（counts 不窄于只读 LIKE 基线） ----------
  let sqlite = null;
  try {
    sqlite = db();
  } catch {
    sqlite = null; // 反向自检打线上时本机无可读库：跳过基线比对。
  }
  const qLike = sqlite
    ? sqlite.prepare(
        "SELECT COUNT(*) c FROM questions WHERE title LIKE ? OR detail_md LIKE ?"
      )
    : null;
  const aLike = sqlite
    ? sqlite.prepare("SELECT COUNT(*) c FROM answers WHERE content_md LIKE ?")
    : null;

  for (const term of Z1110_TERMS) {
    const pat = `%${term}%`;
    const d = await ok(
      "GET",
      `/search?q=${encodeURIComponent(term)}&type=question&limit=1`
    );
    expect(d && d.counts, `q=${term} 响应缺 counts`);
    if (qLike) {
      const qSql = qLike.get(pat, pat).c;
      expect(
        d.counts.question >= qSql,
        `q=${term}: question 命中 ${d.counts.question} < SQL LIKE 基线 ${qSql}`
      );
    }
    if (aLike) {
      const aSql = aLike.get(pat).c;
      expect(
        aSql === 0 ? true : d.counts.answer > 0,
        `q=${term}: answer 命中 ${d.counts.answer}，SQL LIKE 基线 ${aSql}`
      );
    }
    const da = await ok(
      "GET",
      `/search?q=${encodeURIComponent(term)}&type=answer&limit=1`
    );
    expect(
      da.total === da.counts.answer,
      `q=${term} type=answer total=${da.total} != counts.answer=${da.counts.answer}`
    );
  }

  // 大小写不敏感：React / react / REACT 三态 counts 完全一致。
  const [up, low, allup] = await Promise.all([
    ok("GET", "/search?q=React&limit=1"),
    ok("GET", "/search?q=react&limit=1"),
    ok("GET", "/search?q=REACT&limit=1"),
  ]);
  expect(
    up.counts.question === low.counts.question &&
      up.counts.question === allup.counts.question &&
      up.counts.answer === low.counts.answer &&
      up.counts.answer === allup.counts.answer &&
      up.counts.user === low.counts.user &&
      up.counts.user === allup.counts.user,
    `大小写不一致: React=${JSON.stringify(up.counts)} react=${JSON.stringify(
      low.counts
    )} REACT=${JSON.stringify(allup.counts)}`
  );
  if (sqlite) sqlite.close();
  console.log("  [ok] Z1110 四词基线 + 大小写三态一致");

  // ---------- 浏览器级 ----------
  for (const vp of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await checkSearchPage(browser, vp, "代码质量", {
      minItems: 5,
      wantTopics: true,
    });
  }
  await checkSearchPage(
    browser,
    { width: 1440, height: 900 },
    "React",
    { minItems: 1, wantTopics: false }
  );
});
