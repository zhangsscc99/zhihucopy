// Z003 — 认证：注册/登录/JWT/me + 错误路径。
import { req, register, login, expect, main, uniq } from "./lib.mjs";

main("auth", async () => {
  const nickname = uniq("user").slice(0, 20);
  const { token, user, email } = await register(nickname);
  expect(token && user.nickname === nickname, "register did not return token+user");

  const me = await req("GET", "/auth/me", { token });
  expect(me.status === 200 && me.data.user.id === user.id, "GET /auth/me mismatch");

  const again = await login(email, "assert-pass-123");
  expect(again.status === 200 && again.data.token, "login failed");

  const bad = await login(email, "wrong-pass-999");
  expect(bad.status === 401, `wrong password -> ${bad.status}, expected 401`);

  const anon = await req("GET", "/auth/me");
  expect(anon.status === 401, `anonymous /me -> ${anon.status}, expected 401`);

  const dup = await req("POST", "/auth/register", { body: { email, password: "assert-pass-123", nickname: "x" } });
  expect(dup.status === 409, `duplicate register -> ${dup.status}, expected 409`);
});
