// Z1110 — 搜索召回与库内命中对齐：接口 counts 不得窄于只读 LIKE 计数。
//
// 取数口径：
//   问题 SQL 基线 = questions.title/detail_md LIKE %term%（含折叠/测试产物，纯子串口径）；
//   接口 question 命中 = 标题/详情子串 + 所属话题名命中（Z962 特性），再排除折叠/测试
//   产物。话题名命中恒为增量，故断言 counts.question >= SQL 基线（±0 为恰好对齐）。
//   回答 SQL 基线 = answers.content_md LIKE %term%；接口还排除已删/测试产物，
//   故只要求 counts.answer > 0（基线为 0 的词除外）且不大于基线太多无意义——
//   用 >= 对齐已删过滤后的可比下限即 counts.answer >= 未删除 LIKE 计数? 不，
//   接口测试过滤可再减，只按任务口径断言 > 0。
//   大小写：SQLite LIKE 对 ASCII 大小写不敏感，React/react/REACT 三态一致。
//
// 运行：node scripts/assert/search-recall.mjs
//   DB_PATH 指向与接口同库的副本；API_BASE 缺省打 127.0.0.1:3030。

import { API, db, expect, main, ok } from "./lib.mjs";

const TERMS = ["React", "useEffect", "数据库", "职场"];

async function search(q, type = "question") {
  const d = await ok("GET", `/search?q=${encodeURIComponent(q)}&type=${type}&limit=1`);
  expect(d && d.counts, `GET /search?q=${q} 响应缺 counts 字段`);
  return d;
}

main("search-recall", async () => {
  const sqlite = db();
  const qLike = sqlite.prepare(
    "SELECT COUNT(*) c FROM questions WHERE title LIKE ? OR detail_md LIKE ?"
  );
  const aLike = sqlite.prepare("SELECT COUNT(*) c FROM answers WHERE content_md LIKE ?");

  for (const term of TERMS) {
    const pat = `%${term}%`;
    const qSql = qLike.get(pat, pat).c;
    const aSql = aLike.get(pat).c;

    const d = await search(term);
    expect(
      d.counts.question >= qSql,
      `q=${term}: question 命中 ${d.counts.question} < SQL LIKE 基线 ${qSql}`
    );
    expect(
      aSql === 0 ? true : d.counts.answer > 0,
      `q=${term}: answer 命中 ${d.counts.answer}，SQL LIKE 基线 ${aSql}`
    );
    // 回答 tab 的 items 也应能取到（total 与 counts.answer 一致）。
    const da = await search(term, "answer");
    expect(
      da.total === d.counts.answer,
      `q=${term} type=answer total=${da.total} != counts.answer=${d.counts.answer}`
    );
  }

  // 大小写不敏感：React / react / REACT 三态 counts 完全一致。
  const [up, low, allup] = await Promise.all([
    search("React"),
    search("react"),
    search("REACT"),
  ]);
  expect(
    up.counts.question === low.counts.question &&
      up.counts.question === allup.counts.question &&
      up.counts.answer === low.counts.answer &&
      up.counts.answer === allup.counts.answer &&
      up.counts.user === low.counts.user &&
      up.counts.user === allup.counts.user,
    `大小写不一致: React=${JSON.stringify(up.counts)} react=${JSON.stringify(
      low.counts
    )} REACT=${JSON.stringify(allup.counts)}`
  );

  sqlite.close();
});
