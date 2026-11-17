// Z1130 — 「走查」探针评论残留清零断言（数据级，只读打开 DB）。
//
// 契约：
//   a) is_deleted=0 的评论中，命中 R2b(第N轮走查)/R2c(走查+≥4位数字)/R2d(行首走查)
//      形态的评论数 = 0 —— 与 clean-residue-comments.js 的 matchRules 同一份判定；
//   b) 抽样 20 条真实评论（作者非测试号：is_test=0 且非测试邮箱域）不得被
//      新规则误判（防恒真/防过宽）；
//   c) answers#18.comment_count == COUNT(*) WHERE target_type='answer'
//      AND target_id=18 AND is_deleted=0（冗余计数列口径一致）。
//
// --self-test：把生产库（或 DB_PATH 指向的库）复制到临时文件，插入一条
//   is_deleted=0 的「第二十七轮走查 desk」，断言必须 FAIL；不 fail 则自检失败。
//
// 环境：DB_PATH（默认 ../data/zhihu.db，只读打开）。脚本自身绝不写原库。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, main } from "./lib.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const requireHere = createRequire(import.meta.url);
const { matchRules } = requireHere("../clean-residue-comments.js");

const DB_PATH = path.resolve(
  process.env.DB_PATH || path.join(SCRIPT_DIR, "..", "..", "data", "zhihu.db")
);
const SELF_TEST = process.argv.includes("--self-test");

// R2b/R2c/R2d 是本轮新增的「走查」探针形态；a) 只验收这三种。
const RE_NEW_RULE = /^R2[bcd]:/;

const TEST_EMAIL = /@(test\.dev|t\.dev|test\.local|example\.com)$/i;

function openDb(p, readonly = true) {
  const requireFromServer = createRequire(
    path.join(SCRIPT_DIR, "..", "..", "server", "package.json")
  );
  const Database = requireFromServer("better-sqlite3");
  return new Database(p, { readonly });
}

function checkResidue(db) {
  const rows = db
    .prepare(
      `SELECT c.id, c.content, u.nickname AS author, u.is_test, u.email
       FROM comments c JOIN users u ON u.id = c.author_id
       WHERE c.is_deleted = 0 ORDER BY c.id`
    )
    .all();

  // a) 走查探针形态 0 命中。
  const probeHits = rows
    .map((r) => ({ ...r, rules: matchRules(r.content).filter((x) => RE_NEW_RULE.test(x)) }))
    .filter((r) => r.rules.length > 0);
  for (const h of probeHits) {
    console.error(
      `  残留命中 id=${h.id} | ${h.author} | ${h.rules.join("+")} | ${String(h.content).slice(0, 40)}`
    );
  }
  expect(
    probeHits.length === 0,
    `is_deleted=0 评论仍有 ${probeHits.length} 条走查探针残留（见上）`
  );

  // b) 抽样 20 条真实评论（非测试号）不得被走查新规则误判。
  const real = rows.filter((r) => !r.is_test && !TEST_EMAIL.test(r.email || ""));
  expect(real.length > 0, "库里没有可抽样的真实评论（防恒真）");
  const sample = real
    .map((r) => [Math.random(), r])
    .sort((a, b) => a[0] - b[0])
    .slice(0, 20)
    .map(([, r]) => r);
  const falsePos = sample.filter((r) =>
    matchRules(r.content).some((x) => RE_NEW_RULE.test(x))
  );
  expect(
    falsePos.length === 0,
    `真实评论抽样被走查规则误判: ${falsePos.map((r) => `#${r.id}`).join(",")}`
  );
  console.log(`  抽样 ${sample.length} 条真实评论，走查规则误判 0 条`);

  // c) answer#18 冗余计数列与实数一致。
  const a18 = db
    .prepare(
      `SELECT comment_count,
              (SELECT COUNT(*) FROM comments
                WHERE target_type = 'answer' AND target_id = 18 AND is_deleted = 0) AS real_count
       FROM answers WHERE id = 18`
    )
    .get();
  expect(a18, "answers#18 不存在");
  expect(
    a18.comment_count === a18.real_count,
    `answers#18.comment_count=${a18.comment_count} != 实数 ${a18.real_count}`
  );
  console.log(`  answer#18 comment_count=${a18.comment_count}（与实数一致）`);
}

main("comment-residue-clean", async () => {
  if (!SELF_TEST) {
    const db = openDb(DB_PATH);
    try {
      checkResidue(db);
    } finally {
      db.close();
    }
    return;
  }

  // --self-test：临时副本上插入探针，断言必须 FAIL。
  const tmp = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "z1130-selftest-")),
    "zhihu.db"
  );
  fs.copyFileSync(DB_PATH, tmp);
  const db = openDb(tmp, false);
  try {
    const author = db.prepare("SELECT id FROM users WHERE is_test = 0 LIMIT 1").get();
    db.prepare(
      `INSERT INTO comments (target_type, target_id, author_id, content, is_deleted)
       VALUES ('answer', 18, ?, '第二十七轮走查 desk', 0)`
    ).run(author.id);
    let failed = false;
    try {
      checkResidue(db);
    } catch (e) {
      failed = true;
      console.log(`  self-test: 探针插入后断言如期 FAIL（${e.message.slice(0, 80)}）`);
    }
    expect(failed, "self-test 失败：插入「第二十七轮走查 desk」后断言没有 FAIL");
  } finally {
    db.close();
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  }
});
