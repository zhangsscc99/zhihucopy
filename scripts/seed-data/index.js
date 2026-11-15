// scripts/seed-data — 按 story 显式编写的种子语料
//
// 每个分类文件导出一个 story 数组：
//   {
//     title: "问题标题",
//     topic: "话题名（须与 seed.js 的 TOPICS.name 一致）",
//     detail: "补充说明（Markdown，只针对这个标题）",
//     answers: [
//       { author: "可选：USERS 里的昵称，缺省随机", content: "回答正文（Markdown）" },
//       ...
//     ]
//   }
"use strict";

const CATS = ["code", "work", "life", "sci", "psy", "edu", "health", "money"];

const stories = [];
for (const cat of CATS) {
  for (const s of require(`./${cat}`)) {
    stories.push({ ...s, cat });
  }
}

module.exports = { CATS, stories };
