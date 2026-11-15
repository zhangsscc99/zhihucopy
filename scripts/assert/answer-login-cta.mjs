#!/usr/bin/env node
// Z1023 — 未登录「写回答」CTA：源码契约 + API 契约（不起浏览器）。
// 源码：Question.tsx 携带 next= 回跳、含「登录后即可回答」、无「登录 后」残留空格。
// API：未登录 GET /questions/:id 返回 200 且含 answer_count（防回归）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ok, req, expect, main } from "./lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = readFileSync(join(root, "client/src/pages/Question.tsx"), "utf8");

main("answer-login-cta", async () => {
  // ---- 源码契约 ----
  expect(/next=/.test(src), "Question.tsx 缺少 next= 回跳参数");
  expect(/登录后即可回答/.test(src), "Question.tsx 缺少「登录后即可回答」文案");
  expect(!/登录 后/.test(src), "Question.tsx 仍残留「登录 后」多余空格");

  // ---- API 契约：未登录也能读问题详情 ----
  const list = await ok("GET", "/questions?limit=1");
  const items = list.items ?? list.questions ?? [];
  expect(items.length > 0, "题库为空，无法取到问题 id");
  const qid = items[0].id;

  const detail = await req("GET", `/questions/${qid}`); // 不带 token
  expect(detail.status === 200, `未登录 GET /questions/${qid} -> ${detail.status}，期望 200`);
  expect(
    detail.data.question && Number.isInteger(detail.data.question.answer_count),
    "未登录问题详情缺少 answer_count 字段"
  );
});
