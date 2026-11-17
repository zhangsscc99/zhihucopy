#!/usr/bin/env node
// scripts/assert/seed-bio-consistency.mjs — Z1106 种子作者 bio 与作答话题口吻一致断言
//
// 口径（话题级，取代 Z1097 的大类口径）：
//   对全库每条未删除回答判定「作者领域 ∩ 回答所属问题的话题可接受域」
//   是否非空（话题 -> 可接受域取自 ../persona-domains.js TOPIC_DOMAINS）。
//   - 作者领域 = PERSONA_DOMAINS(昵称去数字后缀) ∪ bio 关键词。
//   - 可接受域 = 问题全部话题的 TOPIC_DOMAINS 并集；话题未进 TOPIC_DOMAINS
//     的记「大类兜底」，兜底命中数必须 = 0（覆盖不全直接 FAIL）。
//   - 命中率必须 = 100%。
//   - 温故*/半山腰*/南山南* 等跨界人设的回答单列打印，命中率必须 100%。
//   - 「跨域作答」的合法姿势只有两种：改派同域作者，或 bio 显式声明跨域
//     （如「统计出身，现在做增长，也写前端」——bio 关键词命中即视为声明）。
//     二者都不满足即错位 FAIL。命中里「仅靠 bio 声明的域」单独计数，
//     方便审计哪些命中来自 bio 跨域声明而非人设本职。
//   - bio 为空的作者单独计数且须 < 10%（防空 bio 全跳过造成恒真）。
//
// 数据源：DB_PATH 只读直查（默认 ./data/zhihu.db，生产库请显式
// DB_PATH=/www/zhihucopy/data/zhihu.db）。本断言在 Z1106 修复前的库上必须
// FAIL（温故52 答 /question/6 React useEffect），修复后 PASS。

import { createRequire } from "node:module";
import { db, expect, main } from "./lib.mjs";

const reqScripts = createRequire(new URL("./seed-bio-consistency.mjs", import.meta.url));
const {
  PERSONA_DOMAINS,
  TOPIC_DOMAINS,
  baseNickname,
  bioDomains,
  domainsOf,
  acceptedForTopics,
} = reqScripts("../persona-domains.js");
const { TOPICS } = reqScripts("../seed.js");

const topicCat = new Map(TOPICS.map((t) => [t.name, t.cat]));
const CROSS_PERSONAS = ["温故", "半山腰", "南山南"]; // 走查点名的人设，必列
const MIN_JUDGED = 30;
const MAX_EMPTY_BIO_RATIO = 0.1;

await main("seed-bio-consistency", async () => {
  const d = db();
  const rows = d
    .prepare(
      `SELECT a.id AS answer_id, a.question_id AS qid,
              u.nickname, u.bio,
              (SELECT GROUP_CONCAT(t.name, char(31)) FROM question_topics qt
                 JOIN topics t ON t.id = qt.topic_id
                WHERE qt.question_id = a.question_id) AS topic_names
         FROM answers a JOIN users u ON u.id = a.author_id
        WHERE a.is_deleted = 0 ORDER BY a.id`
    )
    .all();
  d.close();

  let emptyBio = 0;
  let noTopic = 0;
  let fit = 0;
  let fitViaBioOnly = 0; // 命中域只来自 bio 声明（人设本职不含该域）——合法跨域
  const fallbackTopics = new Map(); // 话题名 -> 兜底次数
  const misfits = [];
  const crossAnswers = []; // 跨界人设逐条
  const judged = [];

  for (const r of rows) {
    const topicNames = r.topic_names ? r.topic_names.split("\x1f") : [];
    if (!r.bio || !String(r.bio).trim()) {
      emptyBio++;
      continue;
    }
    if (!topicNames.length) {
      noTopic++;
      continue;
    }
    const acc = acceptedForTopics(topicNames, (n) => topicCat.get(n));
    for (const n of acc.viaCat)
      fallbackTopics.set(n, (fallbackTopics.get(n) || 0) + 1);
    for (const n of acc.unknown)
      fallbackTopics.set(`${n}(未知)`, (fallbackTopics.get(`${n}(未知)`) || 0) + 1);
    if (!acc.domains.size) {
      noTopic++;
      continue;
    }
    const mine = domainsOf(r.nickname, r.bio);
    const bioDs = bioDomains(r.bio);
    const persona = PERSONA_DOMAINS[baseNickname(r.nickname)] || [];
    const hitDs = [...mine].filter((dm) => acc.domains.has(dm));
    const hit = hitDs.length > 0;
    judged.push(r);
    if (hit) {
      fit++;
      if (hitDs.every((dm) => bioDs.has(dm) && !persona.includes(dm)))
        fitViaBioOnly++;
    } else {
      misfits.push(
        `#${r.answer_id} ${r.nickname}[${[...mine].join("+") || "∅"}] bio「${r.bio}」 ` +
          `on q#${r.qid}<${topicNames.join("/")}>[${[...acc.domains].join("+")}]`
      );
    }
    if (CROSS_PERSONAS.includes(baseNickname(r.nickname))) {
      crossAnswers.push(
        `  ${hit ? "✓" : "✗"} #${r.answer_id} ${r.nickname}[${[...mine].join("+") || "∅"}] ` +
          `on q#${r.qid}<${topicNames.join("/")}>`
      );
    }
  }

  const ratio = judged.length ? fit / judged.length : 0;
  const fallbackN = [...fallbackTopics.values()].reduce((a, b) => a + b, 0);
  console.log(`全库回答=${rows.length} 判定=${judged.length} bio 为空=${emptyBio} 无话题=${noTopic}`);
  console.log(
    `命中=${fit}（其中仅靠 bio 跨域声明=${fitViaBioOnly}）错位=${misfits.length} ` +
      `命中率=${(ratio * 100).toFixed(1)}%`
  );
  console.log(
    `大类兜底话题命中=${fallbackN}` +
      (fallbackN ? `：${[...fallbackTopics].map(([n, c]) => `${n}×${c}`).join(" ")}` : "（话题级覆盖 100%）")
  );
  console.log(`跨界人设回答=${crossAnswers.length}：`);
  for (const line of crossAnswers) console.log(line);
  for (const m of misfits.slice(0, 15)) console.log(`  错位 ${m}`);
  if (misfits.length > 15) console.log(`  … 其余 ${misfits.length - 15} 条略`);

  expect(
    fallbackN === 0,
    `${fallbackN} 个话题引用未覆盖 TOPIC_DOMAINS（兜底比例必须为 0），` +
      `请先在 scripts/persona-domains.js 补映射：${[...fallbackTopics.keys()].join("、")}`
  );
  expect(judged.length >= MIN_JUDGED, `可判定回答不足 ${MIN_JUDGED}（实际 ${judged.length}）`);
  expect(
    emptyBio / rows.length < MAX_EMPTY_BIO_RATIO,
    `bio 为空作者占比 ${emptyBio}/${rows.length} ≥ 10%`
  );
  expect(
    ratio >= 1.0,
    `人设-话题命中率 ${(ratio * 100).toFixed(1)}% < 100%（错位 ${misfits.length}/${judged.length}）；` +
      `错位回答须改派同域作者或在 users.bio 显式补跨域声明`
  );
});
