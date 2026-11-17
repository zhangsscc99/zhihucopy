#!/usr/bin/env node
// scripts/assert/seed-persona-domain.mjs — Z1097 回答人设与问题领域对齐断言
//
// 口径：
//   抽查 ≥20 条未删除回答，对每条判定「回答者领域 ∩ 回答所属问题的话题大类
//   可接受域」是否非空（领域与相邻关系口径统一取自 ../persona-domains.js，
//   与 seed.js / fix-answer-authors-by-domain.js 同源）。非空比例须 ≥ 90%。
//   - 作者领域 = PERSONA_DOMAINS(昵称去数字后缀) ∪ bio 关键词。
//   - bio 为空的作者不参与比例计算，但单独计数且须 < 10%（防止「空 bio 全跳
//     过」造成的恒真）。
//   - bio 非空但领域不可判定的按错位计，不豁免。
//   - 问题无已知话题大类的跳过并单独计数。
//
// 数据源：DATA_SOURCE=api（默认）走 REST（API_BASE，取样 = 若干问题详情里
// 的全部可见回答）；DATA_SOURCE=db 走 DB_PATH 只读直查。
// 基线上随机派作者约 2/3 错位，本断言在基线必须 FAIL。

import { createRequire } from "node:module";
import { API, db, expect, ok, main } from "./lib.mjs";

const reqScripts = createRequire(new URL("./seed-persona-domain.mjs", import.meta.url));
const { domainsOf, acceptedDomains } = reqScripts("../persona-domains.js");
const { TOPICS } = reqScripts("../seed.js");

const topicCat = new Map(TOPICS.map((t) => [t.name, t.cat]));
const SRC = (process.env.DATA_SOURCE || "api").toLowerCase();
const MIN_SAMPLE = 20;
const MIN_FIT_RATIO = 0.9;
const MAX_EMPTY_BIO_RATIO = 0.1;
const MAX_QUESTIONS = 24;

function catSetOfTopicNames(names) {
  const cats = new Set();
  for (const n of names) {
    const c = topicCat.get(n);
    if (c) cats.add(c);
  }
  return cats;
}

async function sampleViaApi() {
  const ids = new Set();
  for (const tab of ["new", "hot"]) {
    const d = await ok("GET", `/questions?tab=${tab}&limit=40`);
    for (const q of d.items || []) ids.add(q.id);
  }
  const samples = [];
  for (const qid of [...ids].slice(0, MAX_QUESTIONS)) {
    const d = await ok("GET", `/questions/${qid}`);
    const topicNames = (d.question.topics || []).map((t) => t.name);
    for (const a of [...(d.answers || []), ...(d.my_answers || [])]) {
      samples.push({
        answer_id: a.id,
        qid,
        topicNames,
        nickname: a.author && a.author.nickname,
        bio: a.author && a.author.bio,
      });
    }
  }
  return samples;
}

function sampleViaDb() {
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
  return rows.map((r) => ({
    answer_id: r.answer_id,
    qid: r.qid,
    topicNames: r.topic_names ? r.topic_names.split("") : [],
    nickname: r.nickname,
    bio: r.bio,
  }));
}

await main("seed-persona-domain", async () => {
  const raw = SRC === "db" ? sampleViaDb() : await sampleViaApi();
  // 按 answer id 去重（详情接口 answers/my_answers 可能重叠）
  const seen = new Set();
  const samples = raw.filter((s) => !seen.has(s.answer_id) && seen.add(s.answer_id));

  let emptyBio = 0;
  let noTopic = 0;
  let fit = 0;
  const misfits = [];
  const judged = [];
  for (const s of samples) {
    if (!s.bio || !String(s.bio).trim()) {
      emptyBio++;
      continue;
    }
    const cats = catSetOfTopicNames(s.topicNames);
    if (!cats.size) {
      noTopic++;
      continue;
    }
    const okDomains = new Set();
    for (const c of cats) for (const dm of acceptedDomains(c)) okDomains.add(dm);
    const mine = domainsOf(s.nickname, s.bio);
    const hit = [...mine].some((dm) => okDomains.has(dm));
    judged.push(s);
    if (hit) fit++;
    else
      misfits.push(
        `#${s.answer_id} ${s.nickname}[${[...mine].join("+") || "∅"}] ` +
          `on q#${s.qid}<${s.topicNames.join("/")}>[${[...cats].join("+")}]`
      );
  }

  const ratio = judged.length ? fit / judged.length : 0;
  console.log(`数据源=${SRC} 抽样回答=${samples.length} 判定=${judged.length}`);
  console.log(
    `bio 为空=${emptyBio} (${((emptyBio / Math.max(1, samples.length)) * 100).toFixed(1)}%) ` +
      `无话题大类=${noTopic} 命中=${fit} 错位=${misfits.length} 命中率=${(ratio * 100).toFixed(1)}%`
  );
  for (const m of misfits.slice(0, 10)) console.log(`  错位 ${m}`);
  if (misfits.length > 10) console.log(`  … 其余 ${misfits.length - 10} 条略`);

  expect(judged.length >= MIN_SAMPLE, `可判定样本不足 ${MIN_SAMPLE}（实际 ${judged.length}）`);
  expect(
    emptyBio / samples.length < MAX_EMPTY_BIO_RATIO,
    `bio 为空作者占比 ${emptyBio}/${samples.length} ≥ 10%`
  );
  expect(
    ratio >= MIN_FIT_RATIO,
    `人设-领域命中率 ${(ratio * 100).toFixed(1)}% < 90%（错位 ${misfits.length}/${judged.length}）`
  );
});
