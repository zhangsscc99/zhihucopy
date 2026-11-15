// Z020 — 关注用户接口（follow/unfollow + following/followers 列表）。
import { ok, req, register, expect, main, uniq } from "./lib.mjs";

main("follows", async () => {
  const a = await register();
  const b = await register();

  const r = await req("POST", `/users/${b.user.id}/follow`, { token: a.token });
  expect(r.status < 300, `follow -> ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);

  const following = await ok("GET", `/users/${a.user.id}/following`, { token: a.token });
  expect((following.items || []).some((u) => u.id === b.user.id), "B not in A's following list");
  const followers = await ok("GET", `/users/${b.user.id}/followers`);
  expect((followers.items || []).some((u) => u.id === a.user.id), "A not in B's followers list");

  const unf = await req("DELETE", `/users/${b.user.id}/follow`, { token: a.token });
  expect(unf.status < 300, `unfollow -> ${unf.status}`);

  // —— 关注问题：POST/DELETE /questions/:id/follow（幂等 + follower_count）——
  const { question } = await ok("POST", "/questions", {
    token: a.token,
    body: { title: `[assert] ${uniq("q")} — 关注问题验收？`, detail_md: "assert probe", topic_ids: [] },
  });
  const qid = question.id;
  expect(qid > 0, "no question id returned");

  const fq = await req("POST", `/questions/${qid}/follow`, { token: a.token });
  expect(fq.status < 300, `follow question -> ${fq.status} ${JSON.stringify(fq.data).slice(0, 120)}`);
  expect(fq.data.following === true, "follow question did not return following:true");

  const detail = await ok("GET", `/questions/${qid}`);
  if (typeof detail.question.follower_count === "number") {
    expect(detail.question.follower_count >= 1, `question follower_count=${detail.question.follower_count} < 1`);
  } else {
    const again = await req("POST", `/questions/${qid}/follow`, { token: a.token });
    expect(again.status < 300, `idempotent re-follow -> ${again.status}`);
  }

  const unfq1 = await req("DELETE", `/questions/${qid}/follow`, { token: a.token });
  expect(unfq1.status < 300, `unfollow question -> ${unfq1.status}`);
  const unfq2 = await req("DELETE", `/questions/${qid}/follow`, { token: a.token });
  expect(unfq2.status < 300, `second unfollow question -> ${unfq2.status}`);
});
