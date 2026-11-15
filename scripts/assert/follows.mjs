// Z020 — 关注用户接口（follow/unfollow + following/followers 列表）。
import { ok, req, register, expect, main } from "./lib.mjs";

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
});
