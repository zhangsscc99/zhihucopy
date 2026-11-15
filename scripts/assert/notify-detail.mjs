// Z1007 — 通知详情字段：列表项必须带 event_label（中文事件文案）与
// excerpt（去 Markdown 摘要，≤80 字），且不同来源的两条通知
// (event_label, excerpt) 组合不得相同 —— 同作者多条通知要可区分。
import { ok, expect, main, uniq, register } from "./lib.mjs";

main("notify-detail", async () => {
  const a = await register();
  const b = await register();

  const { question } = await ok("POST", "/questions", {
    token: a.token,
    body: { title: `[assert] ${uniq()}`, detail_md: "" },
  });

  // 两条不同来源的通知：B 对同一问题先后发两条内容不同的回答。
  await ok("POST", `/questions/${question.id}/answers`, {
    token: b.token,
    body: { content_md: "**第一条**回答：参考 [资料](https://example.com) 与 `inline code`。" },
  });
  await ok("POST", `/questions/${question.id}/answers`, {
    token: b.token,
    body: { content_md: "第二条回答，内容不同，用来生成另一条通知。" },
  });

  const list = await ok("GET", "/notifications", { token: a.token });
  const items = (list.items || []).filter(
    (n) => n.actor && n.actor.id === b.user.id
  );
  expect(
    items.length >= 2,
    `expected >=2 notifications from B, got ${items.length} (items: ${JSON.stringify(list.items).slice(0, 300)})`
  );

  for (const n of items) {
    expect(
      typeof n.event_label === "string" && n.event_label.length > 0,
      `notification ${n.id} missing event_label (got ${JSON.stringify(n.event_label)})`
    );
    expect(
      typeof n.excerpt === "string" && n.excerpt.length > 0,
      `notification ${n.id} missing excerpt (got ${JSON.stringify(n.excerpt)})`
    );
    expect(
      n.excerpt.length <= 80,
      `notification ${n.id} excerpt too long: ${n.excerpt.length} chars`
    );
    // 摘要必须是剥过 Markdown 的纯文本。
    expect(
      !/```|\*\*|\]\(|^#{1,6}\s/m.test(n.excerpt),
      `notification ${n.id} excerpt still contains markdown: ${n.excerpt}`
    );
  }

  // 同作者两条通知：event_label 相同可以接受，组合必须不同（靠 excerpt 区分）。
  const combos = new Set(items.map((n) => `${n.event_label}${n.excerpt}`));
  expect(
    combos.size === items.length,
    `duplicate (event_label, excerpt) pairs: ${JSON.stringify(
      items.map((n) => [n.event_label, n.excerpt])
    )}`
  );
});
