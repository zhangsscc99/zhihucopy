// Z042 — 管理后台接口：举报队列 / 处理 / 禁言 / 统计；非管理员被拒。
import { ok, req, login, register, expect, main } from "./lib.mjs";

main("admin-api", async () => {
  const r = await login("admin@zhihucopy.dev", "zhihu123456");
  expect(r.status === 200, `admin login -> ${r.status}`);
  const adminToken = r.data.token;

  const reports = await ok("GET", "/admin/reports?status=pending", { token: adminToken });
  expect(Array.isArray(reports.items) || Array.isArray(reports.reports) || Array.isArray(reports), "admin reports not a list");

  const stats = await ok("GET", "/admin/stats", { token: adminToken });
  expect(typeof stats === "object" && stats !== null, "admin stats not an object");

  const users = await ok("GET", "/admin/users?q=user", { token: adminToken });
  expect(Array.isArray(users.items) || Array.isArray(users.users), "admin users not a list");

  const muggle = await register();
  const denied = await req("GET", "/admin/reports", { token: muggle.token });
  expect(denied.status === 401 || denied.status === 403, `non-admin /admin/reports -> ${denied.status}, expected 401/403`);
});
