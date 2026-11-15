// Z051 — 勋章系统：首次回答授予 first_answer 类勋章，主页可查。
import { ok, register, expect, main, uniq } from "./lib.mjs";

main("badges", async () => {
  const { token, user } = await register();
  const { question } = await ok("POST", "/questions", { token, body: { title: `[assert] ${uniq("q")}?`, detail_md: "" } });
  await ok("POST", `/questions/${question.id}/answers`, { token, body: { content_md: "首答拿勋章" } });

  const profile = await ok("GET", `/users/${user.id}`);
  const badges = profile.badges || profile.user?.badges || [];
  expect(
    Array.isArray(badges) && badges.some((b) => /first|首答|answer/i.test(typeof b === "string" ? b : b.code || "")),
    "no first-answer badge granted after first answer"
  );
});
