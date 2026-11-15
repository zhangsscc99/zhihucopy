#!/usr/bin/env node
// question-layout.mjs — Z903 问题详情页排版仿知乎（纯静态断言：读源文件 + 正则，不联网不起浏览器）
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tsx = readFileSync(join(root, "client/src/pages/Question.tsx"), "utf8");
const css = readFileSync(join(root, "client/src/styles.css"), "utf8");

const fails = [];
const ok = (cond, msg) => {
  if (!cond) fails.push(msg);
};

// 精确取某个选择器的规则体：按选择器列表逐项匹配，避免 :hover/.is-active
// 等复合选择器被并进同一条规则体（旧实现用 [^{]* 会把它们混在一起）。
function bodiesFor(selector) {
  const bodies = [];
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sels = m[1].split(",").map((s) => s.trim());
    if (sels.includes(selector)) bodies.push(m[2]);
  }
  return bodies.join("\n");
}

// 1. Question.tsx 作者行：头像 + 昵称 + 简介 三段齐全，且 bio 仅在非空时渲染
ok(/answer__avatar/.test(tsx), "Question.tsx 缺少作者头像（answer__avatar）");
ok(/answer__name/.test(tsx), "Question.tsx 缺少作者昵称（answer__name）");
ok(/answer__bio/.test(tsx), "Question.tsx 缺少作者简介段（answer__bio）");
ok(
  /author\.bio\s*&&/.test(tsx),
  "作者简介应有非空分支（author.bio && …），不允许空简介硬渲染"
);

// 2. 操作栏五项：赞同 / 反对 / 评论 / 收藏 / 分享
for (const w of ["赞同", "反对", "条评论", "收藏", "分享"]) {
  ok(tsx.includes(w), `Question.tsx 操作栏缺少「${w}」`);
}

// 3. 赞同按钮：常态白底蓝字蓝边；--active 态实心蓝底白字（知乎样式）
const upBase = bodiesFor(".answer__vote--up");
ok(
  /background\s*:\s*#fff(?:fff)?\b/i.test(upBase),
  ".answer__vote--up 常态应为白底（#ffffff）"
);
ok(
  /color\s*:\s*(#0066ff|var\(--accent\))/i.test(upBase) &&
    /border-color\s*:\s*(#0066ff|var\(--accent\))/i.test(upBase),
  ".answer__vote--up 常态应为蓝字 + 1px 蓝边（#0066ff / var(--accent)）"
);
const upActive = bodiesFor(".answer__vote--up.is-active");
ok(
  /background\s*:\s*(#0066ff|var\(--accent\))/i.test(upActive) &&
    /color\s*:\s*#fff(?:fff)?\b/i.test(upActive),
  ".answer__vote--up.is-active 应为实心蓝底白字"
);

// 4. follow 必须同时存在 POST 与 DELETE 两条调用路径（关注/取关状态机）
ok(
  /\bpost(?:<[^>]*>)?\(\s*`\/questions\/\$\{id\}\/follow`/.test(tsx),
  "缺少 POST /questions/:id/follow 调用路径"
);
ok(
  /\bdel(?:<[^>]*>)?\(\s*`\/questions\/\$\{id\}\/follow`/.test(tsx),
  "缺少 DELETE /questions/:id/follow 调用路径"
);

// 5. followed 初值须来自接口返回（出现 .followed 取值），不得字面量 useState(false)
ok(/\.followed\b/.test(tsx), "Question.tsx 未使用接口返回的 followed 字段");
ok(
  !/\[following\s*,\s*setFollowing\]\s*=\s*useState(?:<[^>]*>)?\(false\)/.test(tsx),
  "following 仍是字面量 useState(false)，未取自接口"
);

// 6. 标题 class：font-size: 22px 且 font-weight: 700
const titleRules = bodiesFor(".question__title");
ok(/font-size\s*:\s*22px/.test(titleRules), "标题规则缺少 font-size: 22px");
ok(/font-weight\s*:\s*700/.test(titleRules), "标题规则缺少 font-weight: 700");

// 7. 回答正文：font-size: 15px 与 line-height: 1.7
const bodyRules = bodiesFor(".answer__body");
ok(/font-size\s*:\s*15px/.test(bodyRules), "回答正文规则缺少 font-size: 15px");
ok(/line-height\s*:\s*1\.7/.test(bodyRules), "回答正文规则缺少 line-height: 1.7");

// 8. 回答分隔：1px solid var(--line)；.answer* 规则一律不得 box-shadow
const answerRules = bodiesFor(".answer");
ok(
  /border-(bottom|top)\s*:\s*1px solid var\(--line\)/.test(answerRules),
  "回答之间缺少 1px solid var(--line) 分隔线"
);
for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
  const hit = m[1]
    .split(",")
    .map((s) => s.trim())
    .find((s) => /^\.answer[\w-]*/.test(s));
  if (hit && /box-shadow\s*:/.test(m[2])) {
    ok(false, `回答卡片含 box-shadow：${hit}`);
  }
}

if (fails.length) {
  for (const f of fails) console.error(`[question-layout] FAIL ${f}`);
  process.exit(1);
}
console.log("[question-layout] ok");
