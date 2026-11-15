// Z1028 — 搜索守卫：剔除标点/空白/emoji 后无有效词条，或整串仅 1 个非汉字字符 → too_short；
// 汉字单字与技术词（C++/Go/Vue3 等，有效词条短但原始 query 含符号/多字符）走正常检索。
// 动态：q=？、q=!!!、q=%20（空格）、q=a、q=x、q=😀 → items 空、total=0、reason="too_short"；
//      q=代码、q=编程、q=C++、q=Go、q=Vue3 → total≥1 且无 reason；
//      q=码（中文单字）→ 不触发守卫；q=ab → 不带 too_short 标记。
// 说明：库里没有 C++/Go/Vue3 命中内容，断言前用「真实」账号（example.com 保留可见域，
//      @test.dev 的 is_test=1 会被 testQuestionSql 过滤）各发 1 题作种子。
// 静态：Home.tsx 搜索空态在 reason==="too_short" 时渲染指定提示文案。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import path from "node:path";
import { ok, req, expect, main } from "./lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const requireFromServer = createRequire(join(root, "server", "package.json"));
const { isTestTitle, isTestNickname, isTestEmail } = requireFromServer(
  "./content-filter.js"
);

const created = { userIds: [], questionIds: [] };

// 自建「真实」用户：不用 lib.register（@test.dev 邮箱会被判为测试账号）。
// 昵称/邮箱/标题都先过一遍 content-filter 的 JS 判定，保证不命中测试模式。
async function registerReal() {
  const stamp = Date.now().toString(36);
  const nickname = `z1028user${stamp}`;
  const email = `z1028.${stamp}@example.com`;
  expect(!isTestNickname(nickname), `nickname ${nickname} 命中测试模式`);
  expect(!isTestEmail(email), `email ${email} 命中测试域`);
  const r = await req("POST", "/auth/register", {
    body: { email, password: "assert-pass-123", nickname },
  });
  expect(r.status === 201, `register real user -> ${r.status} ${JSON.stringify(r.data)}`);
  created.userIds.push(r.data.user.id);
  return { token: r.data.token, user: r.data.user };
}

// 级联顺序与 server/artifact-cleanup.js 一致：先问题/用户的子表，再主表。
function cleanup() {
  const dbPath = process.env.DB_PATH;
  if (!dbPath) {
    console.log("  note: 未设 DB_PATH，自建账号保留（问题已由 owned 清理）");
    return;
  }
  const Database = requireFromServer("better-sqlite3");
  const db = new Database(path.resolve(dbPath));
  const qids = created.questionIds;
  const uids = created.userIds;
  const qSel = qids.map(() => "?").join(",") || "NULL";
  const uSel = uids.map(() => "?").join(",") || "NULL";
  const aSel = `SELECT id FROM answers WHERE question_id IN (${qSel})`;
  try {
    db.transaction(() => {
      db.prepare(`DELETE FROM comments WHERE target_type = 'answer' AND target_id IN (${aSel})`).run(...qids);
      db.prepare(`DELETE FROM answer_revisions WHERE answer_id IN (${aSel})`).run(...qids);
      db.prepare(`DELETE FROM votes WHERE answer_id IN (${aSel})`).run(...qids);
      db.prepare(`DELETE FROM collection_items WHERE answer_id IN (${aSel})`).run(...qids);
      db.prepare(`DELETE FROM notifications WHERE target_type = 'answer' AND target_id IN (${aSel})`).run(...qids);
      db.prepare(`DELETE FROM reports WHERE target_type = 'answer' AND target_id IN (${aSel})`).run(...qids);
      db.prepare(`DELETE FROM comments WHERE target_type = 'question' AND target_id IN (${qSel})`).run(...qids);
      db.prepare(`DELETE FROM question_votes WHERE question_id IN (${qSel})`).run(...qids);
      db.prepare(`DELETE FROM follows WHERE target_type = 'question' AND target_id IN (${qSel})`).run(...qids);
      db.prepare(`DELETE FROM notifications WHERE target_type = 'question' AND target_id IN (${qSel})`).run(...qids);
      db.prepare(`DELETE FROM reports WHERE target_type = 'question' AND target_id IN (${qSel})`).run(...qids);
      db.prepare(`DELETE FROM question_topics WHERE question_id IN (${qSel})`).run(...qids);
      db.prepare(`DELETE FROM answers WHERE question_id IN (${qSel})`).run(...qids);
      db.prepare(`DELETE FROM questions WHERE id IN (${qSel})`).run(...qids);
      db.prepare(`DELETE FROM notifications WHERE user_id IN (${uSel}) OR actor_id IN (${uSel})`).run(...uids, ...uids);
      db.prepare(`DELETE FROM follows WHERE follower_id IN (${uSel}) OR (target_type = 'user' AND target_id IN (${uSel}))`).run(...uids, ...uids);
      db.prepare(`DELETE FROM votes WHERE user_id IN (${uSel})`).run(...uids);
      db.prepare(`DELETE FROM question_votes WHERE user_id IN (${uSel})`).run(...uids);
      db.prepare(`DELETE FROM comments WHERE author_id IN (${uSel})`).run(...uids);
      db.prepare(`DELETE FROM answers WHERE author_id IN (${uSel})`).run(...uids);
      db.prepare(`DELETE FROM user_badges WHERE user_id IN (${uSel})`).run(...uids);
      db.prepare(`DELETE FROM badge_grants_legacy WHERE user_id IN (${uSel})`).run(...uids);
      db.prepare(`DELETE FROM reports WHERE reporter_id IN (${uSel}) OR handled_by IN (${uSel})`).run(...uids, ...uids);
      db.prepare(`DELETE FROM collection_items WHERE collection_id IN (SELECT id FROM collections WHERE owner_id IN (${uSel}))`).run(...uids);
      db.prepare(`DELETE FROM collections WHERE owner_id IN (${uSel})`).run(...uids);
      db.prepare(`DELETE FROM mod_logs WHERE admin_id IN (${uSel})`).run(...uids);
      db.prepare(`DELETE FROM users WHERE id IN (${uSel})`).run(...uids);
    })();
    console.log("  cleanup: 已删除自建用户/问题");
  } finally {
    db.close();
  }
}

main("search-guard", async () => {
  try {
    // ---------- 静态断言 ----------
    const home = readFileSync(join(root, "client/src/pages/Home.tsx"), "utf8");
    expect(
      home.includes("请至少输入 2 个字符的关键词（如：代码、职场）"),
      "Home.tsx 缺少 too_short 空态文案"
    );
    expect(/reason\s*===\s*"too_short"/.test(home), "Home.tsx 未按 reason===\"too_short\" 分支渲染空态");

    // ---------- 种子数据：C++/Go/Vue3 各 1 题（真实账号，不被过滤） ----------
    const { token } = await registerReal();
    for (const title of [
      "C++ 的模板元编程为什么让这么多人头疼？",
      "Go 的 goroutine 和系统线程到底差在哪？",
      "Vue3 的组合式 API 相比选项式好在哪？",
    ]) {
      expect(!isTestTitle(title), `种子标题「${title}」命中测试模式`);
      const r = await ok("POST", "/questions", {
        token,
        body: { title, detail_md: "Z1028 搜索守卫断言种子" },
      });
      created.questionIds.push(r.question.id);
    }

    // ---------- 动态断言：守卫词条 → too_short ----------
    // 空格经 encodeURIComponent 后在线上即 ?q=%20。
    for (const q of ["？", "!!!", " ", "a", "x", "😀"]) {
      const res = await ok("GET", `/search?q=${encodeURIComponent(q)}`);
      expect(Array.isArray(res.items) && res.items.length === 0,
        `q=${JSON.stringify(q)} items 应为空数组，实际 ${JSON.stringify(res.items).slice(0, 120)}`);
      expect(res.total === 0, `q=${JSON.stringify(q)} total=${res.total}，期望 0（全站兜底污染）`);
      expect(res.reason === "too_short", `q=${JSON.stringify(q)} reason=${res.reason}，期望 "too_short"`);
    }

    // ---------- 动态断言：正常词条不受影响 ----------
    for (const q of ["代码", "编程", "C++", "Go", "Vue3"]) {
      const res = await ok("GET", `/search?q=${encodeURIComponent(q)}`);
      expect(res.reason === undefined, `q=${q} reason=${res.reason}，正常词条不应带标记`);
      expect(res.total >= 1, `q=${q} total=${res.total}，期望 ≥1`);
      expect(Array.isArray(res.items) && res.items.length > 0, `q=${q} items 应非空`);
    }

    // 汉字单字按现状处理：不触发守卫，且因「代码」命中故必有结果。
    const han = await ok("GET", `/search?q=${encodeURIComponent("码")}`);
    expect(han.reason === undefined, `q=码 reason=${han.reason}，汉字单字不应被守卫拦截`);
    expect(han.total >= 1, `q=码 total=${han.total}，期望 ≥1`);

    // 两字符 ASCII 走正常检索路径：即使无命中也不能带 too_short 标记。
    const ab = await ok("GET", `/search?q=${encodeURIComponent("ab")}`);
    expect(ab.reason === undefined, `q=ab reason=${ab.reason}，正常词条不应带标记`);
  } finally {
    cleanup();
  }
});
