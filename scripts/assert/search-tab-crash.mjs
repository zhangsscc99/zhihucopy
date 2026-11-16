// Z1044b — 搜索切 tab 白屏修复的源码级断言（e2e/search.mjs 的静态补充）。
//   1. Home.tsx 渲染器与数据同源：存在 itemsScope 门控（itemsScope !== scope 时不渲染列表）。
//   2. 结果行组件无裸字段访问：nickname/bio 有 ?. / || / && 守卫，
//      不存在无守卫的 `nickname.slice(`；author/created_at 同样有防御。
//   3. ErrorBoundary 存在且被搜索结果区使用：组件导出 + getDerivedStateFromError/
//      componentDidCatch + 中文错误卡 + 「重试」；styles.css 有 .crashbox 白卡样式。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, main } from "./lib.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const homePath = path.join(root, "client", "src", "pages", "Home.tsx");
const boundaryPath = path.join(root, "client", "src", "components", "ErrorBoundary.tsx");
const cssPath = path.join(root, "client", "src", "styles.css");

main("search-tab-crash", async () => {
  const home = fs.readFileSync(homePath, "utf8");

  // 1) 渲染器-数据同源门控：scope 与 items 所属 scope 不一致时不渲染结果列表。
  expect(
    /itemsScope\s*!==\s*scope/.test(home) && /setItemsScope/.test(home),
    "Home.tsx 缺少 itemsScope 门控（切 tab 时旧 scope 数据仍会配新渲染器）"
  );

  // 2) 行组件字段防御：不允许裸 `nickname.slice(`（必须 ?. 守卫）。
  expect(
    !/(?<![?\w])nickname\.slice\(/.test(home),
    "Home.tsx 仍存在无守卫的 nickname.slice( —— 旧 shape 渲染即 TypeError"
  );
  expect(
    /nickname\?\.slice\(/.test(home) || /nickname\s*\|\|\s*""/.test(home),
    "UserResultRow 的 nickname 缺少 ?. 或 || 守卫"
  );
  expect(
    !/(?<![?\w])author\.nickname/.test(home),
    "Home.tsx 仍存在无守卫的 author.nickname"
  );
  expect(/author\?\.nickname/.test(home), "行组件 author?.nickname 守卫缺失");
  expect(
    /created_at\s*\|\|/.test(home),
    "AnswerResultCard 的 created_at 未兜底（formatTime(undefined) 会抛）"
  );
  expect(
    /!kw\s*\|\|\s*!text/.test(home),
    "Highlight 未对空 text 早退（text.toLowerCase 会抛）"
  );

  // 3) ErrorBoundary：独立组件 + 捕获钩子 + 中文卡 + 重试 + 被结果区使用。
  expect(fs.existsSync(boundaryPath), "components/ErrorBoundary.tsx 不存在");
  const eb = fs.readFileSync(boundaryPath, "utf8");
  expect(/export\s+class\s+ErrorBoundary/.test(eb), "ErrorBoundary 未导出 class 组件");
  expect(
    /getDerivedStateFromError|componentDidCatch/.test(eb),
    "ErrorBoundary 缺少 getDerivedStateFromError/componentDidCatch"
  );
  expect(/重试/.test(eb), "ErrorBoundary 错误卡缺「重试」按钮");
  expect(
    /import\s*\{\s*ErrorBoundary\s*\}/.test(home) && /<ErrorBoundary>/.test(home),
    "Home.tsx 未把搜索结果区包进 <ErrorBoundary>"
  );

  // 4) 错误卡样式：白卡 1px --line 3px 圆角（.crashbox）。
  const css = fs.readFileSync(cssPath, "utf8");
  expect(/\.crashbox\s*\{[^}]*--line/.test(css), "styles.css 缺 .crashbox 白卡样式");

  console.log("  Home.tsx 行组件守卫 + itemsScope 门控 + ErrorBoundary/crashbox 就位");
});
