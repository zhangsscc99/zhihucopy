// Z987 — 用户公开接口去隐私：
//   GET /users/:id 对匿名 / 他人 / 本人一律只返回公开字段 + stats，
//   响应 JSON 递归不得出现 email / salt_value / is_admin / password* / muted_until。
//   私有字段只在本人接口返回：GET /auth/me（自己的 token）应含 email 与 is_admin。
// 跑法: API_BASE=http://127.0.0.1:3176/zhihucopy/api node scripts/assert/user-public.mjs
// 清理：register() 走 lib.mjs 产物跟踪，进程退出时自清理。
import { ok, register, expect, main } from "./lib.mjs";

const FORBIDDEN_KEYS = [
  "email",
  "salt_value",
  "is_admin",
  "password",
  "password_hash",
  "muted_until",
];
const PUBLIC_USER_KEYS = ["id", "nickname", "avatar_url", "bio", "created_at"];
const STATS_KEYS = ["answers", "questions", "followers", "following", "vote_up"];

// 递归收集响应 JSON 里的所有对象键（含嵌套 user/stats/数组元素）。
function collectKeys(node, acc = new Set()) {
  if (Array.isArray(node)) {
    for (const v of node) collectKeys(v, acc);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      acc.add(k);
      collectKeys(v, acc);
    }
  }
  return acc;
}

function checkPublicShape(data, label) {
  const keys = collectKeys(data);
  for (const k of FORBIDDEN_KEYS) {
    expect(
      !keys.has(k),
      `${label}: /users/:id 响应泄露了「${k}」 —— ${JSON.stringify(data).slice(0, 200)}`
    );
  }
  const u = data.user;
  expect(u && typeof u === "object", `${label}: 响应缺少 user`);
  for (const k of PUBLIC_USER_KEYS) {
    expect(k in u, `${label}: user 缺少公开字段「${k}」`);
  }
  for (const k of Object.keys(u)) {
    expect(
      PUBLIC_USER_KEYS.includes(k),
      `${label}: user 多出非公开字段「${k}」`
    );
  }
  const s = data.stats;
  expect(s && typeof s === "object", `${label}: 响应缺少 stats`);
  for (const k of STATS_KEYS) {
    expect(typeof s[k] === "number", `${label}: stats.${k} 不是数字`);
  }
}

main("user-public", async () => {
  const a = await register();
  const b = await register();

  // 匿名视角
  const anon = await ok("GET", `/users/${a.user.id}`);
  checkPublicShape(anon, "anon");

  // 他人（B 的 token）视角
  const asB = await ok("GET", `/users/${a.user.id}`, { token: b.token });
  checkPublicShape(asB, "other-user");

  // 本人视角：/users/:id 也保持公开形态，私有字段只从 /auth/me 取
  const asA = await ok("GET", `/users/${a.user.id}`, { token: a.token });
  checkPublicShape(asA, "self");

  // 本人接口：/auth/me 应回 email 与 is_admin（仅本人可读）
  const me = await ok("GET", "/auth/me", { token: a.token });
  expect(me.user.email === a.email, `/auth/me 应返回本人 email，实际 ${me.user.email}`);
  expect("is_admin" in me.user, "/auth/me 应返回本人 is_admin");

  console.log(
    `  /users/${a.user.id} 三种视角均只含 ${PUBLIC_USER_KEYS.length} 个公开字段 + stats；/auth/me 含 email`
  );
});
