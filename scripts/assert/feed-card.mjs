#!/usr/bin/env node
// feed-card.mjs — Z902 首页信息流卡片静态断言（node:fs + 正则，不联网、不起浏览器）
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const home = readFileSync(join(root, "client/src/pages/Home.tsx"), "utf8");
const css = readFileSync(join(root, "client/src/styles.css"), "utf8");

const fails = [];
const ok = (cond, msg) => {
  if (!cond) fails.push(msg);
};

// 取某个类选择器首个普通规则块（不匹配 :hover/:last-child 等伪类变体）
function rule(cls) {
  const m = css.match(new RegExp(`\\.${cls}\\s*\\{([\\s\\S]*?)\\}`));
  return m ? m[1] : "";
}

// 1. Home.tsx 信息流条目结构：标题 + 摘要 + 元信息 + 缩略图占位 + 话题胶囊
ok(/feed__item/.test(home), "Home.tsx 缺少 .feed__item 卡片元素");
ok(/className="feed__title"/.test(home), "Home.tsx 缺少 .feed__title 标题元素");
ok(/className="feed__excerpt"/.test(home), "Home.tsx 缺少 .feed__excerpt 摘要元素");
ok(/className="feed__meta"/.test(home), "Home.tsx 缺少 .feed__meta 元信息元素");
ok(/className="feed__thumb"/.test(home), "Home.tsx 缺少 .feed__thumb 缩略图占位元素");
ok(/className="feed__topics"/.test(home) && /className="tag"/.test(home),
  "Home.tsx 缺少话题胶囊渲染（.feed__topics > .tag）");
ok(/个回答/.test(home) && /次浏览/.test(home), "Home.tsx 元信息缺少「N 个回答 / N 次浏览」");
ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(home), "Home.tsx 含 emoji，违反视觉契约");

// 2. 关键字号/字重/截断
const title = rule("feed__title");
ok(/font-size\s*:\s*18px/.test(title), ".feed__title 缺少 font-size: 18px");
ok(/font-weight\s*:\s*(700|bold)/.test(title), ".feed__title 缺少 font-weight: 700");
ok(/line-clamp\s*:\s*2/.test(title), ".feed__title 缺少两行截断 line-clamp: 2");

const excerpt = rule("feed__excerpt");
ok(/line-clamp\s*:\s*2/.test(excerpt), ".feed__excerpt 缺少 line-clamp: 2 两行截断");
ok(/font-size\s*:\s*15px/.test(excerpt), ".feed__excerpt 缺少 font-size: 15px");

const meta = rule("feed__meta");
ok(/font-size\s*:\s*13px/.test(meta), ".feed__meta 缺少 font-size: 13px");
ok(/(#8590a6|var\(--ink-3\))/i.test(meta), ".feed__meta 缺少元信息灰 #8590A6 / var(--ink-3)");
ok(/content\s*:\s*["']·["']/.test(css), "元信息缺少分隔点「·」（.feed__meta ::before）");

// 3. 卡片规则：白底 + 1px 细边框 + 3px 圆角 + 8px 间距
const item = rule("feed__item");
ok(/border\s*:\s*1px\s+solid\s+(var\(--line\)|#ebebeb)\s*;/i.test(item),
  ".feed__item 缺少 border: 1px solid var(--line)");
ok(/border-radius\s*:\s*(var\(--radius\)|3px)/.test(item),
  ".feed__item 缺少 border-radius: var(--radius) / 3px");
ok(/padding\s*:\s*16px\s+18px/.test(item), ".feed__item 内边距应为 16px 18px");
ok(/gap\s*:\s*8px/.test(rule("feed")), ".feed 卡片间距应为 gap: 8px（白卡各自成块）");

// 4. 信息流卡片无重阴影：任何 .feed*/.sk-feed* 规则中的 box-shadow 不得大于 0 1px 3px
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const [_, sel, body] = m;
  if (!/(^|[\s,])\.?(?:sk-)?feed/.test(sel.trim())) continue;
  const sm = body.match(/box-shadow\s*:\s*([^;]+);/);
  if (!sm) continue;
  const nums = (sm[1].match(/-?\d+(?:\.\d+)?px/g) || []).map(parseFloat);
  const [x = 0, y = 0, blur = 0] = nums;
  ok(x === 0 && Math.abs(y) <= 1 && blur <= 3,
    `信息流卡片规则 ${sel.trim()} 存在超过 0 1px 3px 的阴影：${sm[1].trim()}`);
}

// 5. 缩略图占位：120×80 灰底纯色块，移动端隐藏
const thumb = rule("feed__thumb");
ok(/width\s*:\s*120px/.test(thumb) && /height\s*:\s*80px/.test(thumb),
  ".feed__thumb 应为 120×80");
ok(/background\s*:\s*(var\(--paper\)|#f6f6f6)\s*;/i.test(thumb),
  ".feed__thumb 应为灰底 var(--paper) / #F6F6F6");
ok(/border-radius\s*:\s*(var\(--radius\)|3px)/.test(thumb),
  ".feed__thumb 应为 3px 圆角");
const mobile = css.match(/@media\s*\(max-width\s*:\s*767px\)\s*\{([\s\S]*?)\n\}/);
ok(mobile && /\.feed__thumb\s*\{[^}]*display\s*:\s*none/.test(mobile[1]),
  "移动端 <768px 应隐藏 .feed__thumb");

// 6. 话题胶囊：灰底、12px、24px 高、3px 圆角（复用 .tag）
const tag = rule("tag");
ok(tag, "缺少话题胶囊规则 .tag");
ok(/font-size\s*:\s*12px/.test(tag), "话题胶囊缺少 font-size: 12px");
ok(/background\s*:\s*(var\(--paper\)|#f6f6f6)\s*;/i.test(tag),
  "话题胶囊背景应为 var(--paper) / #F6F6F6");
ok(/height\s*:\s*24px/.test(tag), "话题胶囊高度应为 24px");
ok(/border-radius\s*:\s*(var\(--radius\)|3px)/.test(tag), "话题胶囊应为 3px 圆角");
ok(/\.feed__topics\s+\.tag:hover\s*\{[^}]*background\s*:\s*(var\(--line\)|#ebebeb)/i.test(css),
  "话题胶囊 hover 应变 #EBEBEB / var(--line)");

// 7. tab 行：无背景 + 激活态蓝色 2px 下划线
const tabs = rule("tabs");
ok(!/background/.test(tabs) && !/border\s*:/.test(tabs),
  ".tabs 应无背景、无卡片边框");
ok(/\.tabs__tab--active\s*\{[^}]*border-bottom-color\s*:\s*var\(--accent\)/.test(css),
  "激活 tab 缺少 2px 蓝色下划线（border-bottom-color: var(--accent)）");
ok(/\.tabs__tab\s*\{[^}]*color\s*:\s*var\(--ink-3\)/.test(css),
  "非激活 tab 字色应为 var(--ink-3) / #8590A6");

if (fails.length) {
  for (const f of fails) console.error(`[feed-card] FAIL ${f}`);
  process.exit(1);
}
console.log("[feed-card] ok");
