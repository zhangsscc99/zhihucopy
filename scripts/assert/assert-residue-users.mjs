// Z1050 — 断言残留「真实可见」测试账号的硬删通道与自清验收。
//
// search-scope.mjs 每 run 注册 z1044user<stamp> / z1044.<stamp>@example.com，
// 刻意不被 testUserSql 过滤（否则用户 scope 断言无意义），历史清理链删不掉
// → 「用户」tab 搜 z1044user 残留递增。本脚本验收 POST /test-support/purge-residue：
//   a) 复刻 search-scope 注册形态两次 → purge 后残留计数回到 0（自清生效）；
//   b) 未登录 401 / 非 admin 403；
//   c) 非白名单 pattern（"user"）→ 400 且没有任何用户被删；
//   d) 正常调用 deleted.u >= 1，被删账号再搜不到。
import { ok, req, expect, main, login, register } from "./lib.mjs";

const ADMIN_EMAIL = "admin@zhihucopy.dev"; // 种子管理员（scripts/seed.js）
const ADMIN_PASSWORD = "zhihu123456";
let seq = 0;

// 与 search-scope.mjs 同形态；后缀只取 [a-z0-9] 才能命中白名单正则。
async function registerResidue() {
  const stamp =
    Date.now().toString(36) +
    (seq++).toString(36) +
    Math.floor(Math.random() * 1e4).toString(36);
  const nickname = `z1044user${stamp}`;
  const email = `z1044.${stamp}@example.com`;
  const r = await req("POST", "/auth/register", {
    body: { email, password: "assert-pass-123", nickname },
  });
  expect(
    r.status === 201,
    `register residue -> ${r.status} ${JSON.stringify(r.data)}`
  );
  return { ...r.data.user, nickname };
}

async function residueUserCount() {
  const r = await ok("GET", "/search?q=z1044user&type=user");
  return typeof r.total === "number" ? r.total : (r.items || []).length;
}

async function userSearchHit(nickname) {
  const r = await ok(
    "GET",
    `/search?q=${encodeURIComponent(nickname)}&type=user`
  );
  return (r.items || []).find((it) => it.nickname === nickname) || null;
}

async function usersTotal(adminToken) {
  const stats = await ok("GET", "/admin/stats", { token: adminToken });
  expect(typeof stats.users === "number", `/admin/stats 缺 users 计数`);
  return stats.users;
}

main("assert-residue-users", async () => {
  const lr = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  expect(lr.status === 200 && lr.data.token, `admin 登录 -> ${lr.status}`);
  const adminToken = lr.data.token;
  const users0 = await usersTotal(adminToken);

  // a0) 全局清零基线：先按白名单全量 purge 再断言 residue===0，
  // 历史/并行 lane 残留不计入本 run 的「应清到 0」验收口径。
  const pre = await req("POST", "/test-support/purge-residue", {
    token: adminToken,
    body: {},
  });
  expect(
    pre.status === 200 && pre.data.ok,
    `基线 purge-residue -> ${pre.status} ${JSON.stringify(pre.data).slice(0, 200)}`
  );
  const residueBase = await residueUserCount();
  expect(
    residueBase === 0,
    `基线 purge 后残留计数应为 0，实际 ${residueBase}`
  );
  console.log(
    `  baseline: purged=${(pre.data.purged_nicknames || []).length} residue=0`
  );

  // a) 复刻 search-scope 注册形态两次（真实可见账号），量残留基线。
  const u1 = await registerResidue();
  const u2 = await registerResidue();
  const residueBefore = await residueUserCount();
  console.log(
    `  setup: users=${users0} residue(before)=${residueBefore} new=u:${u1.id},${u2.id}`
  );
  expect(
    residueBefore >= 2,
    `注册后残留计数应 >= 2，实际 ${residueBefore}`
  );

  // b) 鉴权：未登录 401；非 admin 登录 403。
  const anon = await req("POST", "/test-support/purge-residue", { body: {} });
  expect(
    anon.status === 401,
    `未登录 purge-residue -> ${anon.status}，期望 401`
  );
  const muggle = await register(); // @test.dev 普通号，is_admin=0
  const forb = await req("POST", "/test-support/purge-residue", {
    token: muggle.token,
    body: {},
  });
  expect(
    forb.status === 403,
    `非 admin purge-residue -> ${forb.status}，期望 403`
  );
  console.log(`  auth: anon=${anon.status} non-admin=${forb.status}`);

  // c) 非白名单 pattern → 400，且没有任何用户被删（users 总数前后不变）。
  const usersMid = await usersTotal(adminToken);
  const bad = await req("POST", "/test-support/purge-residue", {
    token: adminToken,
    body: { pattern: "user" },
  });
  expect(bad.status === 400, `pattern=user -> ${bad.status}，期望 400`);
  expect(
    !(bad.data.deleted && bad.data.deleted.u > 0),
    `pattern=user 不应删除任何用户: ${JSON.stringify(bad.data)}`
  );
  const usersAfterBad = await usersTotal(adminToken);
  const residueAfterBad = await residueUserCount();
  expect(
    usersAfterBad === usersMid,
    `400 后 users 总数应不变：${usersMid} -> ${usersAfterBad}`
  );
  expect(
    residueAfterBad === residueBefore,
    `400 后残留计数应不变：${residueBefore} -> ${residueAfterBad}`
  );
  console.log(
    `  bad-pattern: http=${bad.status} users ${usersMid}->${usersAfterBad} residue=${residueAfterBad}`
  );

  // d) 正常调用 → deleted.u >= 1，残留归零，被删账号再搜不到。
  const pr = await req("POST", "/test-support/purge-residue", {
    token: adminToken,
    body: {},
  });
  expect(
    pr.status === 200 && pr.data.ok,
    `purge-residue -> ${pr.status} ${JSON.stringify(pr.data).slice(0, 200)}`
  );
  const du = pr.data.deleted?.u ?? 0;
  expect(du >= 1, `deleted.u 应 >= 1，实际 ${du}`);
  const purged = pr.data.purged_nicknames || [];
  for (const u of [u1, u2]) {
    expect(
      purged.includes(u.nickname),
      `purged_nicknames 缺 ${u.nickname}：${JSON.stringify(purged)}`
    );
  }
  console.log(
    `  purge: deleted=${JSON.stringify(pr.data.deleted)} purged_n=${purged.length} skipped=${(pr.data.skipped || []).length}`
  );

  const residueAfter = await residueUserCount();
  expect(
    residueAfter === 0,
    `自清后残留计数应为 0，实际 ${residueAfter}`
  );
  for (const u of [u1, u2]) {
    const hit = await userSearchHit(u.nickname);
    expect(!hit, `已删账号仍能搜到: ${u.nickname} (u:${u.id})`);
  }
  const users1 = await usersTotal(adminToken);
  console.log(
    `  after: residue=${residueAfter} users ${users0}->${users1} (deleted.u=${du})`
  );
});
