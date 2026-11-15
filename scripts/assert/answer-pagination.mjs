#!/usr/bin/env node
// answer-pagination.mjs — Z961 问题详情页回答分页验收。
// 静态：Question.tsx 调用 /questions/:id/answers? 分页接口、存在 answer_count
// 比较逻辑与「查看全部/加载更多」入口，不再是单一 LIMIT 5 渲染路径。
// 动态：分页接口条数 == answer_count 且不少于 detail 首屏；新发布的回答
// 在 sort=newest 第一页可见（刷新后不丢）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ok, register, expect, main, uniq } from "./lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tsx = readFileSync(join(root, "client/src/pages/Question.tsx"), "utf8");

// ---------- 静态断言 ----------
expect(/\/answers\?/.test(tsx), "Question.tsx 未调用 /questions/:id/answers? 分页接口");
expect(/answer_count\s*>/.test(tsx), "Question.tsx 缺少 answer_count 与已渲染条数的比较");
expect(/查看全部|加载更多/.test(tsx), "Question.tsx 缺少「查看全部/加载更多回答」入口");
expect(/sort=/.test(tsx) && /newest/.test(tsx), "Question.tsx 缺少回答排序切换（sort/newest）");

// ---------- 动态断言 ----------
main("answer-pagination", async () => {
  const { token } = await register();

  // 造一个 answer_count >= 2 的问题（[assert] 前缀不进公共列表/热榜）
  const { question } = await ok("POST", "/questions", {
    token,
    body: { title: `[assert] ${uniq("q")} — 回答分页验收？`, detail_md: "" },
  });
  for (let i = 0; i < 2; i++) {
    await ok("POST", `/questions/${question.id}/answers`, {
      token,
      body: { content_md: `[assert] ${uniq("a")} — 分页前置回答 ${i + 1}` },
    });
  }

  const detail = await ok("GET", `/questions/${question.id}`);
  const shown = detail.answers.length;
  const count = detail.question.answer_count;
  expect(count >= 2, `answer_count=${count}，预期 >= 2`);
  expect(shown >= 1 && shown <= 5, `detail 首屏返回 ${shown} 条，超出 1–5 预期`);

  const page = await ok("GET", `/questions/${question.id}/answers?page=1&limit=50`);
  expect(
    page.items.length === count,
    `分页接口返回 ${page.items.length} 条 != answer_count=${count}`
  );
  expect(page.items.length >= shown, `分页 ${page.items.length} 条 < detail 首屏 ${shown} 条`);

  // created_at 秒级精度：隔开 1.2s 保证新回答时间戳严格更大，newest 首位确定
  await new Promise((r) => setTimeout(r, 1200));
  const marker = uniq("mine");
  const { answer } = await ok("POST", `/questions/${question.id}/answers`, {
    token,
    body: { content_md: `[assert] ${marker} — 发布后刷新不能丢的新回答` },
  });
  const newest = await ok(
    "GET",
    `/questions/${question.id}/answers?sort=newest&page=1&limit=10`
  );
  expect(
    newest.items.some((a) => a.id === answer.id),
    `新回答 #${answer.id} 未出现在 sort=newest 第一页`
  );
  expect(
    newest.items[0]?.id === answer.id,
    `sort=newest 首条是 #${newest.items[0]?.id}，不是刚发布的 #${answer.id}`
  );
});
