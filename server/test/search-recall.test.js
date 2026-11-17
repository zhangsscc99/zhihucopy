const { test } = require("node:test");
const assert = require("node:assert");
const { recallPlan, MAX_RECALL_TERMS } = require("../search-recall");

// recallPlan(q, term) 入参与 routes/search.js 一致：q 已 trim，term = effectiveTerm(q)。

test("Z1144: ≥2 汉字无空格 → bigram 词组（代码质量 → 代码/码质/质量）", () => {
  const p = recallPlan("代码质量", "代码质量");
  assert.equal(p.kind, "terms");
  assert.deepEqual(p.terms, ["代码", "码质", "质量"]);
});

test("Z1144: 三字中文 → 两个 bigram", () => {
  const p = recallPlan("数据库", "数据库");
  assert.equal(p.kind, "terms");
  assert.deepEqual(p.terms, ["数据", "据库"]);
});

test("Z1144: 两字中文的 bigram 即原词 → 退化 single（不放宽）", () => {
  const p = recallPlan("职场", "职场");
  assert.equal(p.kind, "single");
  assert.equal(p.word, "职场");
});

test("Z1144: 纯英文 → single，保持原子串 LIKE", () => {
  assert.deepEqual(recallPlan("React", "React"), { kind: "single", word: "React" });
  assert.deepEqual(recallPlan("C++", "C"), { kind: "single", word: "C++" });
});

test("Z1144: 单汉字 → single（不放宽成任意 1 字符全站）", () => {
  assert.deepEqual(recallPlan("码", "码"), { kind: "single", word: "码" });
});

test("Z1144: 含空格 → 空格分词 OR 召回", () => {
  const p = recallPlan("代码 质量", "代码质量");
  assert.equal(p.kind, "terms");
  assert.deepEqual(p.terms, ["代码", "质量"]);
});

test("Z1144: 空格分词只剩 1 个有效词 → single（按该词检索）", () => {
  const p = recallPlan("React ？", "React");
  assert.equal(p.kind, "single");
  assert.equal(p.word, "React");
});

test("Z1144: 空格分词全是单字符拉丁 → none（单字符不许 OR 全站）", () => {
  assert.equal(recallPlan("a b", "ab").kind, "none");
  assert.equal(recallPlan("？ ！", "").kind, "none");
});

test("Z1144: 拉丁+汉字混合 → 汉字段 bigram + ≥2 字符拉丁整词", () => {
  const p = recallPlan("go语言学习", "go语言学习");
  assert.equal(p.kind, "terms");
  assert.deepEqual(p.terms, ["go", "语言", "言学", "学习"]);
});

test("Z1144: 词组数量上限 ≤ MAX_RECALL_TERMS（首尾必含）", () => {
  const p = recallPlan("这是一个很长的中文查询词组", "这是一个很长的中文查询词组");
  assert.equal(p.kind, "terms");
  assert.ok(p.terms.length <= MAX_RECALL_TERMS);
  assert.equal(p.terms[0], "这是");
  assert.equal(p.terms[p.terms.length - 1], "词组");
});
