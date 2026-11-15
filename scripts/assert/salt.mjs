// Z050 — 盐值/等级：回答获赞 +2；每日配额限制存在。
import { ok, req, register, expect, main, uniq } from "./lib.mjs";

main("salt", async () => {
  const author = await register();
  const voter = await register();
  const { question } = await ok("POST", "/questions", { token: author.token, body: { title: `[assert] ${uniq("q")}?`, detail_md: "" } });
  const { answer } = await ok("POST", `/questions/${question.id}/answers`, { token: author.token, body: { content_md: "盐值验收回答" } });

  const before = (await ok("GET", "/auth/me", { token: author.token })).user.salt_value ?? 0;
  await req("POST", "/votes", { token: voter.token, body: { target_type: "answer", target_id: answer.id, value: 1 } });
  const after = (await ok("GET", "/auth/me", { token: author.token })).user.salt_value ?? 0;
  expect(after === before + 2, `salt_value ${before} -> ${after}, expected +2`);

  // 等级字段存在
  const me = (await ok("GET", "/auth/me", { token: author.token })).user;
  expect(typeof me.level === "number" && me.level >= 1, `no level on user (${me.level})`);
});
