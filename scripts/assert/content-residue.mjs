// content-residue.mjs — Z1045 验收断言：
//   1) /question/1 首个回答的评论区不再出现自动化产物文案
//      （「评论回写验证 rv6-*」「评论功能验证 comment-ui-*」「巡检第N轮/巡检甲*」）；
//   2) /questions?tab=new 与 /feed/recommended 前 20 条不含测试形态标题
//      （含「复盘 <token> ？」自动化残留），且都包含 id 339 —— 该问题是
//      detail_md 为空的真实种子问题，防止将来有人再给公共流加 detail 门控；
//   3) 计数一致性：随机抽 3 个问题，answers 接口 total 与 question.answer_count 一致。
//
// 判定口径直接复用 server/content-filter.js 的 isTestBody/isTestNickname，
// 与运行时过滤、清理脚本同源 —— 不出现「断言自己的词表」。
//
// 本脚本只读：不创建任何内容，不产生残留。Env: API_BASE（同 assert/lib.mjs）。

import { createRequire } from "node:module";
import { ok, expect, main } from "./lib.mjs";

const requireFromServer = createRequire(
  new URL("../../server/package.json", import.meta.url)
);
const { isTestBody, isTestNickname, isTestTitle } = requireFromServer(
  "./content-filter.js"
);

// 扁平化两级评论树，收集 {content, nickname}。
function flattenComments(items) {
  const out = [];
  const walk = (list) => {
    for (const c of list || []) {
      if (!c.is_deleted) {
        out.push({
          content: c.content || "",
          nickname: (c.author && c.author.nickname) || "",
        });
      }
      walk(c.children);
    }
  };
  walk(items);
  return out;
}

main("content-residue", async () => {
  // ---- 1) /question/1 首个回答的评论产物 ----
  const det = await ok("GET", "/questions/1");
  const firstAnswer = (det.answers || [])[0];
  expect(firstAnswer, "/questions/1 没有可见回答");
  const comments = await ok(
    "GET",
    `/comments?target_type=answer&target_id=${firstAnswer.id}`
  );
  const flat = flattenComments(comments.items);
  const residue = flat.filter(
    (c) => isTestBody(c.content) || isTestNickname(c.nickname)
  );
  console.log(
    `[residue] /question/1 answer#${firstAnswer.id} 评论 total=${comments.total} 可见=${flat.length} 产物=${residue.length}`
  );
  for (const c of residue) {
    console.log(`  残留: [${c.nickname}] ${c.content.slice(0, 60)}`);
  }
  expect(
    residue.length === 0,
    `/question/1 首个回答评论区仍有 ${residue.length} 条测试产物`
  );

  // ---- 2) 公共流前 20 条：无测试形态标题 + 空详情的真实问题（id 339）可见 ----
  // Z1045 返修口径：detail_md 是可选字段，空详情问题必须照常出现在
  // 最新/推荐流里；「复盘 <token> ？」这类自动化残留由标题形态规则抓出。
  const feed = await ok("GET", "/feed/recommended?page=1&limit=20");
  const newest = await ok("GET", "/questions?tab=new&page=1&limit=20");
  for (const [name, list] of [
    ["/feed/recommended", feed.items],
    ["/questions?tab=new", newest.items],
  ]) {
    const hits = list.filter((q) => isTestTitle(q.title));
    console.log(
      `[residue] ${name} 前20条: items=${list.length} 测试形态标题=${hits.length}`
    );
    for (const q of hits) console.log(`  命中: q#${q.id} ${q.title}`);
    expect(
      hits.length === 0,
      `${name} 前 20 条含 ${hits.length} 个测试形态标题（如「复盘 <token> ？」残留）`
    );
    expect(
      list.some((q) => q.id === 339),
      `${name} 前 20 条看不到 id 339（空 detail_md 真实问题）—— 疑似又加了 detail 门控`
    );
  }

  // ---- 3) 计数一致性：随机 3 个问题 answer_count === answers total ----
  const pool = newest.items.length ? newest.items : feed.items;
  expect(pool.length >= 3, `可用问题不足 3 个（${pool.length}），无法抽查计数`);
  const picked = [...pool].sort(() => Math.random() - 0.5).slice(0, 3);
  for (const q of picked) {
    const list = await ok(
      "GET",
      `/questions/${q.id}/answers?page=1&limit=100`
    );
    const detail = await ok("GET", `/questions/${q.id}`);
    const ac = detail.question.answer_count;
    console.log(
      `[residue] q#${q.id} answer_count=${ac} answers.total=${list.total} items=${list.items.length}`
    );
    expect(
      list.total === ac,
      `q#${q.id} answer_count=${ac} 与 answers.total=${list.total} 不一致`
    );
    expect(
      list.items.length === Math.min(ac, 100),
      `q#${q.id} answers.items=${list.items.length} 与预期 ${Math.min(ac, 100)} 不一致`
    );
  }
});
