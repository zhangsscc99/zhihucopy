#!/usr/bin/env node
// topic-page.mjs — Z904 话题页与话题胶囊 混合断言：
// 1) 源码静态检查（Topic.tsx / App.tsx / Question.tsx / Home.tsx / styles.css）
// 2) 线上 HTTP 接口检查（GET /topics、GET /topics/:key、404 行为）
// 不起浏览器、不写库；逐条收集失败原因，任一失败即非 0 退出。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { API, req } from "./lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fails = [];
const ok = (cond, msg) => {
  if (!cond) fails.push(msg);
};
const read = (p) => {
  try {
    return readFileSync(join(root, p), "utf8");
  } catch {
    return null;
  }
};

// ---------- 源码断言 ----------

// 1. Topic.tsx 存在：头部（名称+简介+元信息）、关注两态、follow 接口、内容流、相关话题、404 空态
const topic = read("client/src/pages/Topic.tsx");
ok(topic !== null, "缺少 client/src/pages/Topic.tsx");
if (topic) {
  ok(/topic-head__name/.test(topic), "Topic.tsx 缺少话题名渲染（.topic-head__name）");
  ok(/topic\.description/.test(topic), "Topic.tsx 未渲染话题简介（topic.description）");
  ok(/topic-head__meta/.test(topic) && /关注/.test(topic) && /讨论/.test(topic),
    "Topic.tsx 缺少「N 关注 · N 讨论」元信息");
  ok(/topic-head__follow/.test(topic) && /已关注/.test(topic),
    "Topic.tsx 缺少关注按钮（关注/已关注 两态）");
  ok(/\/topics\/.*\/follow/.test(topic) || /`\/topics\/\$\{[^}]*\}\/follow`/.test(topic),
    "Topic.tsx 缺少 POST/DELETE /topics/:key/follow 调用");
  ok(/useNavigate|navigate\(/.test(topic) && /\/login/.test(topic),
    "Topic.tsx 未登录点关注应跳 /login");
  ok(/feed__item/.test(topic) && /feed__title/.test(topic) && /feed__meta/.test(topic),
    "Topic.tsx 内容流未复用 feed__item/feed__title/feed__meta 卡片结构");
  ok(/加载更多/.test(topic) && /has_more|hasMore/.test(topic),
    "Topic.tsx 缺少「加载更多」分页（禁止无限滚动）");
  ok(/话题不存在|<NotFound/.test(topic), "Topic.tsx 缺少 404「话题不存在」空态");
  ok(/去提问|提问/.test(topic) && /\/ask/.test(topic),
    "Topic.tsx 空态缺少提问引导（链接 /ask）");
  ok(/相关话题/.test(topic) && /sort=followers/.test(topic),
    "Topic.tsx 缺少「相关话题」模块（GET /topics?sort=followers）");
}

// 2. App.tsx 注册 /topic/:key 路由
const app = read("client/src/App.tsx");
ok(app !== null, "缺少 client/src/App.tsx");
if (app) {
  ok(/path="\/topic\/:key"/.test(app), "App.tsx 缺少 /topic/:key 路由");
  ok(/pages\/Topic/.test(app), "App.tsx 未引入 pages/Topic");
}

// 3. 话题胶囊变链接：Question.tsx 与 Home.tsx 的 .tag 必须是 Link -> /topic/，不得再是纯 span
const question = read("client/src/pages/Question.tsx");
ok(question !== null, "缺少 client/src/pages/Question.tsx");
if (question) {
  ok(/<Link[^>]*to=\{`\/topic\//.test(question) && /className="tag"/.test(question),
    "Question.tsx 话题胶囊不是 <Link to=`/topic/…` className=\"tag\">");
  ok(!/<span[^>]*className="tag"/.test(question) && !/<Tag\b/.test(question),
    "Question.tsx 话题胶囊仍是纯 span/Tag，未变链接");
}
const home = read("client/src/pages/Home.tsx");
ok(home !== null, "缺少 client/src/pages/Home.tsx");
if (home) {
  ok(/<Link[^>]*to=\{`\/topic\//.test(home) && /className="tag"/.test(home),
    "Home.tsx 话题胶囊不是 <Link to=`/topic/…` className=\"tag\">");
  ok(!/<span[^>]*className="tag"/.test(home), "Home.tsx 话题胶囊仍是纯 span，未变链接");
}

// 4. styles.css：.tag 有 hover 与 focus-visible 态
const css = read("client/src/styles.css");
ok(css !== null, "缺少 client/src/styles.css");
if (css) {
  const tagHover = css.match(/\.tag:hover\s*\{([^}]*)\}/);
  ok(tagHover && /(background|color)\s*:/.test(tagHover[1]),
    "styles.css 缺少 .tag:hover 样式（背景/颜色变化）");
  ok(/\.tag:focus-visible\s*\{[^}]*outline/.test(css),
    "styles.css 缺少 .tag:focus-visible 焦点样式");
  ok(/\.topic-head__name\s*\{[^}]*font-weight\s*:\s*700/.test(css),
    "styles.css .topic-head__name 缺少大号加粗（font-weight: 700）");
}

// ---------- 线上 HTTP 断言 ----------

// 5. GET /topics：items 非空数组，首项含 name/slug/follower_count/question_count
const list = await req("GET", "/topics?sort=followers&limit=5");
ok(list.status === 200, `GET /topics -> ${list.status}（期望 200）`);
ok(Array.isArray(list.data?.items), "GET /topics 响应 items 非数组");
ok((list.data?.items?.length ?? 0) > 0, "GET /topics items 为空");
const first = list.data?.items?.[0];
if (first) {
  for (const f of ["name", "slug", "follower_count", "question_count"]) {
    ok(first[f] !== undefined && first[f] !== null, `GET /topics 首项缺少字段 ${f}`);
  }
}

// 6. GET /topics/:key（slug 与 id 皆可寻址）：200 + topic 详情 + items 数组
if (first) {
  const key = first.slug || first.id;
  const detail = await req("GET", `/topics/${encodeURIComponent(key)}`);
  ok(detail.status === 200, `GET /topics/${key} -> ${detail.status}（期望 200）`);
  ok(detail.data?.topic?.name === first.name,
    `GET /topics/${key} 返回话题名不符：${JSON.stringify(detail.data?.topic ?? null).slice(0, 120)}`);
  ok(Array.isArray(detail.data?.items), `GET /topics/${key} 问题流 items 非数组`);
  const byId = await req("GET", `/topics/${first.id}`);
  ok(byId.status === 200 && byId.data?.topic?.id === first.id,
    `GET /topics/${first.id}（按 id 寻址）-> ${byId.status}`);
}

// 7. 不存在的话题返回 404（前端「话题不存在」空态依赖此约定）
const miss = await req("GET", "/topics/__assert_missing_topic__");
ok(miss.status === 404, `GET /topics/<不存在> -> ${miss.status}（期望 404）`);

if (fails.length) {
  for (const f of fails) console.error(`[ASSERT] topic-page FAIL ${f}`);
  process.exit(1);
}
console.log(`[ASSERT] topic-page PASS (api=${API})`);
process.exit(0);
