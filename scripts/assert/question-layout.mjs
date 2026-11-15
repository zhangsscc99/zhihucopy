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

// 提取某个 class 选择器的规则体（含 :hover/.is-active 等复合选择器，sel 需转义）
function rulesFor(selRe) {
  const bodies = [];
  const re = new RegExp(`(?:^|})\\s*${selRe}[^\\{]*\\{([^}]*)\\}`, "g");
  for (const m of css.matchAll(re)) bodies.push(m[1]);
  return bodies.join("\n");
}

// 1. Question.tsx 作者行：头像 + 昵称 + 简介 三段齐全
ok(/answer__avatar/.test(tsx), "Question.tsx 缺少作者头像（answer__avatar）");
ok(/answer__name/.test(tsx), "Question.tsx 缺少作者昵称（answer__name）");
ok(/answer__bio/.test(tsx), "Question.tsx 缺少作者简介段（answer__bio）");

// 2. 操作栏五项：赞同 / 反对 / 评论 / 收藏 / 分享
for (const w of ["赞同", "反对", "条评论", "收藏", "分享"]) {
  ok(tsx.includes(w), `Question.tsx 操作栏缺少「${w}」`);
}

// 3. 赞同按钮规则中出现主题蓝（#0066ff 或 var(--accent)）
const upRules = rulesFor(String.raw`\.answer__vote--up`);
ok(
  /#0066ff\b|var\(--accent\)/i.test(upRules),
  ".answer__vote--up 规则中未找到 #0066ff 或 var(--accent)"
);

// 4. 标题 class：font-size: 22px 且 font-weight: 700
const titleRules = rulesFor(String.raw`\.question__title`);
ok(/font-size\s*:\s*22px/.test(titleRules), "标题规则缺少 font-size: 22px");
ok(/font-weight\s*:\s*700/.test(titleRules), "标题规则缺少 font-weight: 700");

// 5. 回答正文：font-size: 15px 与 line-height: 1.7
const bodyRules = rulesFor(String.raw`\.answer__body\b`);
ok(/font-size\s*:\s*15px/.test(bodyRules), "回答正文规则缺少 font-size: 15px");
ok(/line-height\s*:\s*1\.7/.test(bodyRules), "回答正文规则缺少 line-height: 1.7");

// 6. 回答分隔：1px solid var(--line)；回答卡片无 box-shadow
const answerBlock = css.match(/\.answer\s*\{([^}]*)\}/);
ok(
  answerBlock && /border-(bottom|top)\s*:\s*1px solid var\(--line\)/.test(answerBlock[1]),
  "回答之间缺少 1px solid var(--line) 分隔线"
);
for (const m of css.matchAll(/\.answer[\w-]*[^{]*\{([^}]*)\}/g)) {
  ok(!/box-shadow\s*:/.test(m[1]), `回答卡片含 box-shadow：${m[0].split("{")[0].trim()}`);
}

if (fails.length) {
  for (const f of fails) console.error(`[question-layout] FAIL ${f}`);
  process.exit(1);
}
console.log("[question-layout] ok");
