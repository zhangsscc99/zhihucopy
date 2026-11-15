// Z002 — 数据库 schema：SPEC §3 全部表 + FTS5 触发器。
import { db, expect, main } from "./lib.mjs";

const TABLES = [
  "users", "topics", "questions", "question_topics", "answers", "answer_revisions",
  "votes", "comments", "follows", "collections", "collection_items",
  "notifications", "reports", "mod_logs", "badges", "answer_fts", "question_votes",
];
const TRIGGERS = ["answers_fts_ai", "answers_fts_au", "answers_fts_ad"];

main("schema", async () => {
  const d = db();
  const names = new Set(d.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','trigger','view')").all().map((r) => r.name));
  for (const t of TABLES) expect(names.has(t), `missing table: ${t}`);
  for (const t of TRIGGERS) expect(names.has(t), `missing trigger: ${t}`);
  const fts = d.prepare("SELECT sql FROM sqlite_master WHERE name='answer_fts'").get();
  expect(/fts5/i.test(fts.sql), "answer_fts is not FTS5");
  d.close();
});
