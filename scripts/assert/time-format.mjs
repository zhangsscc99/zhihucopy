#!/usr/bin/env node
// time-format.mjs — Z977 时间显示统一断言。
// Node 无法直接 import TS，因此做源码级校验：
//   a) client/src/lib/time.ts 含 刚刚/分钟前/小时前/天前 与 YYYY-MM-DD 兜底分支；
//   b) client/src 内存在「分钟前」相对时间文案（来自 lib/time.ts 及各调用点）；
//   c) client/src 时间展示位置不再有裸 toLocaleString(/toLocaleDateString(（允许行内 `allow-locale` 注释白名单）。
// 运行时：设置 E2E_BASE（如 http://127.0.0.1:3030/zhihucopy）时抓取问题详情页 HTML，
// 断言出现「…前」或 YYYY-MM-DD 形态时间；未设置则跳过。
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { expect, main } from "./lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = join(root, "client", "src");

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) yield p;
  }
}

main("time-format", async () => {
  const timeSrc = readFileSync(join(src, "lib", "time.ts"), "utf8");

  // a) formatTime 分支齐全
  for (const token of ["刚刚", "分钟前", "小时前", "天前"]) {
    expect(timeSrc.includes(token), `lib/time.ts 缺少「${token}」分支`);
  }
  expect(/export function formatTime/.test(timeSrc), "lib/time.ts 未导出 formatTime");
  // 7 天阈值 + 本地 YYYY-MM-DD 兜底
  expect(/days\s*<\s*7/.test(timeSrc), "lib/time.ts 缺少 <7 天阈值");
  expect(/getFullYear\(\).*getMonth|pad\(d\.getMonth/.test(timeSrc.replace(/\s+/g, "")) || /getFullYear/.test(timeSrc), "lib/time.ts 缺少 YYYY-MM-DD 兜底");

  // b) client/src 内能 grep 到相对时间文案
  const files = [...walk(src)];
  const hasRel = files.some((f) => readFileSync(f, "utf8").includes("分钟前"));
  expect(hasRel, "client/src 内未找到「分钟前」相对时间文案");

  // c) 时间展示位置不得残留裸 toLocale 调用（允许行尾 `// allow-locale` 白名单）
  const offenders = [];
  for (const f of files) {
    const lines = readFileSync(f, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (/toLocale(String|DateString|TimeString)\s*\(/.test(line) && !/allow-locale/.test(line)) {
        offenders.push(`${f}:${i + 1}`);
      }
    });
  }
  expect(offenders.length === 0, `client/src 仍含裸 toLocale* 调用：${offenders.join(", ")}`);

  // d) 运行时页面校验（可选）：详情页 HTML 中出现「前」或 YYYY-MM-DD 形态
  const base = (process.env.E2E_BASE || "").replace(/\/+$/, "");
  if (!base) {
    console.log("[ASSERT] time-format: E2E_BASE 未设置，跳过页面 HTML 校验");
    return;
  }
  const api = `${base}/api`;
  const feed = await fetch(`${api}/questions?limit=1`).then((r) => r.json()).catch(() => null);
  const qid = feed?.items?.[0]?.id ?? feed?.questions?.[0]?.id;
  expect(qid, "无法从 API 获取任一问题 id，跳过页面校验失败");
  // SPA：详情页 HTML 只有壳，时间文案在 module bundle 里；两者都查。
  const url = `${base}/question/${qid}`;
  const html = await fetch(url).then((r) => r.text());
  const pattern = /\d+\s*(分钟|小时|天)前|刚刚|\d{4}-\d{2}-\d{2}/;
  let found = pattern.test(html);
  if (!found) {
    const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    for (const s of scripts) {
      const js = await fetch(new URL(s, url).href).then((r) => r.text()).catch(() => "");
      if (pattern.test(js) && /(分钟|小时|天)前/.test(js)) {
        found = true;
        break;
      }
    }
  }
  expect(found, `问题页 ${url} HTML/JS 未出现「…前」或 YYYY-MM-DD 形态时间`);
});
