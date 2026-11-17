// Z1098 — 关注用户产生 follow 通知（API 级 + 浏览器级验收）：
//   API 级：
//     a) 关注前：B 的 /notifications 无 A 的 follow 通知，unread-count = 0。
//     b) A POST /users/<B>/follow → B 的 /notifications?type=follow 恰有 1 条：
//        type='follow'、actor=A、target={type:'user',id:B}、
//        event='followed_you'、event_label='关注了你'；unread-count 变 1。
//     c) 幂等：A 取消再关注，B 的 follow 通知仍恰 1 条（不翻倍），未读仍 1。
//     d) 自关注：POST /users/<A>/follow → 400，且 A 自己没有 follow 通知。
//   浏览器级：
//     e) B 登录打开 /notifications：存在含「关注了你」的行，行内可见 A 的
//        昵称，且该行的整块链接（.ntf__hit）href 指向 /u/<A.id>。
//   基线（follow 不写 notifications）在 b) 的 items.length 断言即 FAIL。
//
// 口径注意：通知列表经 testNotificationResidueSql 过滤残留昵称 actor
//   （巡检*/走查<数字>/巡检探针*），故 A/B 必须注册「真实形态」账号
//   （真人<9位数字> 昵称 + 非测试域邮箱），否则断言恒假。
//
// 跑法: env API_BASE=http://127.0.0.1:3162/zhihucopy/api \
//       node scripts/assert/follow-notify.mjs
//
// 自清理：真实形态账号过不了 cleanup 的测试形态守卫 —— finally 里先
//   DELETE 断 follow（幂等），再把 A/B 昵称 PATCH 成 assert-* 命中口径，
//   lib 退出自清理删用户时级联删 follows 与 notifications 行。
import { createRequire } from "node:module";

// BASE 推导留在本脚本：E2E_BASE → API_BASE 去结尾 /api → 默认实例。
// 先于 lib import 设好 E2E_BASE，让共享 lib 寻址到同一实例。
const API_ENV = (process.env.API_BASE || "").replace(/\/+$/, "");
const BASE = (
  process.env.E2E_BASE ||
  API_ENV.replace(/\/api$/, "") ||
  "http://127.0.0.1:3030/zhihucopy"
).replace(/\/+$/, "");
process.env.E2E_BASE ||= BASE;

const { run, expect, api, apiOk, authedPage } = await import("../e2e/lib.mjs");

const requireFromServer = createRequire(
  new URL("../../server/package.json", import.meta.url)
);
const { isTestNickname, isTestEmail } = requireFromServer("./content-filter.js");

// 真实形态账号（同 follow-user.mjs 思路）：昵称/邮箱都不命中测试模式，
// 其产出的通知才会出现在公共通知口径里；返回 email/password 供 UI 登录。
async function registerReal() {
  const nickname = `真人${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
  const email = `real-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}@zhihucopy.dev`;
  const password = "assert-pass-123";
  expect(!isTestNickname(nickname), `nickname ${nickname} 命中测试模式`);
  expect(!isTestEmail(email), `email ${email} 命中测试域`);
  const r = await api("POST", "/auth/register", {
    body: { email, password, nickname },
  });
  expect(
    r.status === 201,
    `register -> ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`
  );
  return { token: r.data.token, user: r.data.user, email, password };
}

// 改名为 assert-* 测试形态，让退出自清理可以删这个账号（级联清通知）。
async function markForCleanup(u) {
  const r = await api("PATCH", "/users/me", {
    token: u.token,
    body: { nickname: `assert-fn${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.slice(0, 24) },
  });
  expect(r.status < 300, `rename for cleanup -> ${r.status}`);
}

// B 的 follow 通知里 actor=A 的条目列表。
async function followNotifsFrom(bToken, aId) {
  const list = await apiOk("GET", "/notifications?type=follow&limit=50", {
    token: bToken,
  });
  return (list.items || []).filter((n) => n.actor && n.actor.id === aId);
}

run("follow-notify", async ({ browser }) => {
  const a = await registerReal();
  const b = await registerReal();
  const aId = a.user.id;
  const bId = b.user.id;

  try {
    // ---- a) 关注前：B 无 A 的 follow 通知、未读 0（防恒真） -----------------
    expect(
      (await followNotifsFrom(b.token, aId)).length === 0,
      "关注前 B 不应有 A 的 follow 通知"
    );
    const unreadBefore = await apiOk("GET", "/notifications/unread-count", {
      token: b.token,
    });
    expect(
      unreadBefore.count === 0,
      `关注前 B 未读应为 0，实际 ${unreadBefore.count}`
    );

    // ---- b) A 关注 B → B 收到恰 1 条 follow 通知 --------------------------
    const fr = await api("POST", `/users/${bId}/follow`, { token: a.token });
    expect(
      fr.status === 200 && fr.data.following === true,
      `follow -> ${fr.status} ${JSON.stringify(fr.data).slice(0, 160)}`
    );

    const list1 = await followNotifsFrom(b.token, aId);
    expect(
      list1.length === 1,
      `关注后 B 应有恰 1 条来自 A 的 follow 通知，实际 ${list1.length}`
    );
    const n1 = list1[0];
    expect(n1.type === "follow", `通知 type 应为 follow，实际 ${n1.type}`);
    expect(
      n1.target && n1.target.type === "user" && n1.target.id === bId,
      `通知 target 应为 user/${bId}，实际 ${JSON.stringify(n1.target)}`
    );
    expect(
      n1.event_label === "关注了你",
      `通知文案应为「关注了你」，实际 ${JSON.stringify(n1.event_label)}`
    );

    const unreadAfter = await apiOk("GET", "/notifications/unread-count", {
      token: b.token,
    });
    expect(
      unreadAfter.count === 1,
      `关注后 B 未读应为 1，实际 ${unreadAfter.count}`
    );

    // ---- c) 幂等：取消再关注，通知条数不翻倍 --------------------------------
    await apiOk("DELETE", `/users/${bId}/follow`, { token: a.token });
    await apiOk("POST", `/users/${bId}/follow`, { token: a.token });
    const list2 = await followNotifsFrom(b.token, aId);
    expect(
      list2.length === 1,
      `取消再关注后 B 的 follow 通知应仍恰 1 条（幂等），实际 ${list2.length}`
    );
    const unreadAgain = await apiOk("GET", "/notifications/unread-count", {
      token: b.token,
    });
    expect(
      unreadAgain.count === 1,
      `重复关注后 B 未读应仍为 1，实际 ${unreadAgain.count}`
    );

    // ---- d) 自关注：400 且不产生通知 ---------------------------------------
    const self = await api("POST", `/users/${aId}/follow`, { token: a.token });
    expect(self.status === 400, `自关注应 400，实际 ${self.status}`);
    expect(
      (await followNotifsFrom(a.token, aId)).length === 0,
      "自关注不应产生任何 follow 通知"
    );

    // ---- e) 浏览器级：B 打开 /notifications 看到「关注了你」行 -------------
    const pb = await authedPage(browser, b.token);
    await pb.goto(`${BASE}/notifications`);
    const row = pb.locator(".ntf__item").filter({ hasText: "关注了你" });
    await row.first().waitFor();
    expect(
      (await row.count()) === 1,
      `通知页应恰有 1 行「关注了你」，实际 ${await row.count()}`
    );
    await row
      .first()
      .locator(".ntf__name")
      .filter({ hasText: a.user.nickname })
      .waitFor();
    const href = await row.first().locator(".ntf__hit").getAttribute("href");
    const basePath = new URL(BASE).pathname.replace(/\/+$/, "");
    expect(
      href === `${basePath}/u/${aId}`,
      `关注通知行链接应指向 ${basePath}/u/${aId}，实际 ${href}`
    );
  } finally {
    // 断 follow（幂等）+ 改名测试形态，交给 lib 退出自清理删账号、级联清通知。
    await api("DELETE", `/users/${bId}/follow`, { token: a.token }).catch(() => {});
    for (const u of [a, b]) await markForCleanup(u).catch(() => {});
  }
});
