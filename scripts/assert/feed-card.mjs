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

// 取某个类选择器首个普通规则块（不匹配 :hover/:last-child 等伪类变体）。
// 注意：只取首个同名规则，@media 内的覆盖要用下面的 media767 单独看。
function rule(cls) {
  const m = css.match(new RegExp(`\\.${cls}\\s*\\{([\\s\\S]*?)\\}`));
  return m ? m[1] : "";
}

// 1. Home.tsx 信息流条目结构：纯文本卡 = 标题 + 摘要 + 元信息（无缩略图右栏）
ok(/feed__item/.test(home), "Home.tsx 缺少 .feed__item 卡片元素");
ok(/className="feed__title"/.test(home), "Home.tsx 缺少 .feed__title 标题元素");
ok(/className="feed__excerpt"/.test(home), "Home.tsx 缺少 .feed__excerpt 摘要元素");
ok(/className="feed__meta"/.test(home), "Home.tsx 缺少 .feed__meta 元信息元素");
ok(/个回答/.test(home) && /次浏览/.test(home), "Home.tsx 元信息缺少「N 个回答 / N 次浏览」");
ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(home), "Home.tsx 含 emoji，违反视觉契约");

// 2. 缩略图概念已整体删除：JSX 与 CSS 中均不得出现 .feed__thumb 或 120px 占位块
ok(!/feed__thumb/.test(home), "Home.tsx 仍含 .feed__thumb 节点，缩略图占位应删除");
ok(!/feed__thumb/.test(css), "styles.css 仍含 .feed__thumb 规则，缩略图占位应删除");
ok(!/\.feed[^{]*\{[^}]*width\s*:\s*120px/.test(css),
  "信息流卡片仍含 120px 固定宽占位块");
ok(!/display\s*:\s*flex/.test(rule("feed__item")),
  ".feed__item 仍是 flex 右栏布局，应回到纯文本块卡");

// 3. 话题胶囊：列表接口暂不返回 topics，断言「topics 非空才渲染」的条件路径存在
ok(/topics\?\.length|topics\.length\s*>\s*0/.test(home),
  "Home.tsx 缺少 topics 非空条件判断（胶囊应条件渲染而非恒渲染）");
ok(/className="feed__topics"/.test(home) && /className="tag"/.test(home),
  "Home.tsx 缺少话题胶囊渲染路径（.feed__topics > .tag）");
ok(/\.feed__topics\s*\{/.test(css), "styles.css 缺少 .feed__topics 规则");
ok(/\.feed__topics\s+\.tag:hover\s*\{[^}]*background\s*:\s*var\(--line\)/.test(css),
  "缺少 .feed__topics .tag:hover 变 var(--line) 规则");

// 4. 关键字号/字重/截断
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

// 5. 卡片规则：白底 + 1px 细边框 + 3px 圆角 + 8px 间距（行宽由内容撑满，无固定高度）
const item = rule("feed__item");
ok(/border\s*:\s*1px\s+solid\s+(var\(--line\)|#ebebeb)\s*;/i.test(item),
  ".feed__item 缺少 border: 1px solid var(--line)");
ok(/border-radius\s*:\s*(var\(--radius\)|3px)/.test(item),
  ".feed__item 缺少 border-radius: var(--radius) / 3px");
ok(/padding\s*:\s*16px\s+18px/.test(item), ".feed__item 内边距应为 16px 18px");
ok(!/height\s*:/.test(item), ".feed__item 不应有固定高度（高度由内容决定）");
ok(/gap\s*:\s*8px/.test(rule("feed")), ".feed 卡片间距应为 gap: 8px（白卡各自成块）");

// 6. 信息流卡片无重阴影：任何 .feed*/.sk-feed* 规则中的 box-shadow 不得大于 0 1px 3px
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

// 7. rule() 看不见 @media 覆盖，单独提取 767px 块：移动端应收窄卡内边距或改字号
const mediaM = css.match(/@media\s*\(max-width\s*:\s*767px\)\s*\{([\s\S]*?)\n\}/);
ok(!!mediaM, "缺少 @media (max-width: 767px) 移动端覆盖块");
const media767 = mediaM ? mediaM[1] : "";
ok(
  /\.feed__item\s*\{[^}]*padding\s*:\s*14px/.test(media767) ||
    /\.feed__(excerpt|meta|title)\s*\{[^}]*font-size\s*:/.test(media767),
  "@media <768px 内应覆盖信息流卡片内边距（14px）或摘要/元信息字号");

// 8. tab 行：白条 = 白底 var(--surface) + 底部 1px var(--line) + 上内边距（DESIGN.md §3）
const tabs = rule("tabs");
ok(/background\s*:\s*var\(--surface\)/.test(tabs), ".tabs 应为白底 var(--surface) 白条");
ok(/border-bottom\s*:\s*1px\s+solid\s+var\(--line\)/.test(tabs),
  ".tabs 缺少底部 1px solid var(--line) 分隔线");
ok(/padding-top\s*:\s*[1-9]|padding\s*:\s*[1-9]\d*px/.test(tabs),
  ".tabs 缺少上内边距");
ok(!/border-radius|box-shadow/.test(tabs), ".tabs 白条不应有圆角或阴影");
ok(/\.tabs__tab--active\s*\{[^}]*border-bottom-color\s*:\s*var\(--accent\)/.test(css),
  "激活 tab 缺少 2px 蓝色下划线（border-bottom-color: var(--accent)）");
ok(/\.tabs__tab\s*\{[^}]*color\s*:\s*var\(--ink-3\)/.test(css),
  "非激活 tab 字色应为 var(--ink-3) / #8590A6");

if (fails.length) {
  for (const f of fails) console.error(`[feed-card] FAIL ${f}`);
  process.exit(1);
}
console.log("[feed-card] ok");
