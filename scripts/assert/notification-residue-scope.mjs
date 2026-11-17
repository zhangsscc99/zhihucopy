// notification-residue-scope.mjs — 通知过滤窄口径验收（Z1088）。
//
// 场景：收件人 R 提一个真实问题；残留昵称 actor（巡检探针<tag>）与
// 普通测试号 actor（e2echeck<6位数字>，@test.dev、is_test=1）各回答一次，
// 各产生一条 answer 通知。
//
// 断言：
//   a) DB 层两条通知都真实落库（排除「根本没造出来」的假阴性）；
//   b) 残留 actor 的通知不进 /notifications 列表、不计 unread-count；
//   c) 普通测试号 actor 的通知出现在列表中、且 unread-count=1 ——
//      证明过滤没有按测试邮箱域/is_test 一刀切（Z1082 过宽回归的反向校验）。
// 反向自检：在修复前代码（宽口径 testNotificationSql）上 c) 必 FAIL
// （普通测试号 actor 也被吞，列表为空、count=0）。
//
// Env: API_BASE / DB_PATH（直连库做 a) 步验证；缺席则跳过 DB 步）。
import { ok, register, expect, main, db } from "./lib.mjs";

main("notification-residue-scope", async () => {
  const tag = Date.now().toString(36).slice(-6);
  const digits = String(Date.now()).slice(-6);

  const recv = await register(`nr${tag}`);
  const residue = await register(`巡检探针${tag}`); // 残留昵称 actor
  const normal = await register(`e2echeck${digits}`); // 普通测试号 actor（非残留昵称）

  const q = await ok("POST", "/questions", {
    token: recv.token,
    body: { title: `通知窄口径验证 ${tag}：残留与正常 actor 如何区分？`, detail_md: "notification residue scope probe" },
  });
  await ok("POST", `/questions/${q.question.id}/answers`, {
    token: residue.token,
    body: { content_md: "残留 actor 的回答（自动清理）。", },
  });
  await ok("POST", `/questions/${q.question.id}/answers`, {
    token: normal.token,
    body: { content_md: "普通测试号 actor 的回答（自动清理）。", },
  });

  // a) 两条通知都已落库（actor_id 各一）。
  const d = db();
  const dbActors = d
    .prepare("SELECT actor_id FROM notifications WHERE user_id = ?")
    .all(recv.user.id)
    .map((r) => r.actor_id);
  d.close();
  expect(dbActors.includes(residue.user.id), `残留 actor 通知未落库: ${JSON.stringify(dbActors)}`);
  expect(dbActors.includes(normal.user.id), `普通 actor 通知未落库: ${JSON.stringify(dbActors)}`);

  // b/c) 列表口径：残留被排、普通被留。
  const list = await ok("GET", "/notifications?limit=50", { token: recv.token });
  const listActors = list.items.map((i) => i.actor && i.actor.id);
  expect(
    !listActors.includes(residue.user.id),
    `残留昵称 actor（${residue.user.nickname}）的通知未被过滤`
  );
  expect(
    listActors.includes(normal.user.id),
    `普通测试号 actor（${normal.user.nickname}）的通知被误吞 —— 过滤仍过宽`
  );

  // unread-count 与列表同源：只计普通 actor 那一条。
  const uc = await ok("GET", "/notifications/unread-count", { token: recv.token });
  expect(
    uc.count === 1,
    `unread-count 应为 1（仅普通 actor），实得 ${uc.count}`
  );
});
