const express = require("express");
const { getDb } = require("../db");
const { parsePage, pageResult } = require("../util");
const { questionRow } = require("./questions");
const { testQuestionSql, testUserSql } = require("../content-filter");

const router = express.Router();

const AUTHOR_COLS =
  "u.id AS author_id, u.nickname AS author_nickname, u.avatar_url AS author_avatar, u.bio AS author_bio";


// LIKE 元字符转义，关键词按普通子串匹配。
function likePattern(q) {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// 命中词附近的纯文本摘要（结果卡片用；前端另做高亮）。
function snippet(md, q) {
  const text = String(md || "")
    .replace(/[#>*`\-[\]()!]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i === -1) return text.length > 90 ? text.slice(0, 90) + "…" : text;
  const start = Math.max(0, i - 30);
  const end = Math.min(text.length, i + q.length + 60);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

// match_rank → 命中来源：标题 > 摘要 > 话题名。
const MATCHED = { 1: "title", 2: "detail", 3: "topic" };

// Z1028 搜索守卫：剔除标点/空白/符号（含 emoji）后的「有效词条」为空，或整串
// 只有 1 个非汉字有效字符（"a"/"x"）时直接空结果——否则单字符 LIKE 会兜底成
// 全站列表、属漏召回污染。汉字单字（"码"）与技术词（"C++"/"C#"/".NET"/"Go"）
// 词条有效、原始 query 不止一字符，仍走正常检索。
function effectiveTerm(q) {
  return q.replace(/[^\p{L}\p{N}]+/gu, "");
}
const HAS_HAN = /\p{Script=Han}/u;

// 一次性捞回一组问题的话题（id/name/slug），避免逐题查询（N+1）。
function topicsForQuestions(db, questionIds) {
  const map = new Map();
  if (!questionIds.length) return map;
  for (const t of db
    .prepare(
      `SELECT qt.question_id, t.id, t.name, t.slug FROM question_topics qt
       JOIN topics t ON t.id = qt.topic_id
       WHERE qt.question_id IN (${questionIds.map(() => "?").join(",")})`
    )
    .all(...questionIds)) {
    const arr = map.get(t.question_id) || [];
    arr.push({ id: t.id, name: t.name, slug: t.slug });
    map.set(t.question_id, arr);
  }
  return map;
}

const ZERO_COUNTS = { question: 0, answer: 0, user: 0 };

// GET /search?q=&page=&limit=&type=question|answer|user — 关键词搜索。
// 说明：库内 FTS5 仅有 answer_fts（索引回答，缺答案的问题无法命中），且不得改表结构，
// 故各 scope 检索都用 LIKE。type=question 按标题/详情/所属话题名子串匹配（原行为）；
// type=answer 按回答正文子串匹配（排除已删/测试产物），结果跳 /question/:qid#answer-:id；
// type=user 按昵称/bio 子串匹配（排除测试账号），结果跳 /u/:id。
// 未知 type 保守返回空页；counts 在任意 type 下都返回各 scope 的 total 供 tab 显示。
router.get("/", (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 100);
  const { page, limit, offset } = parsePage(req);
  const type = String(req.query.type || "question");
  const term = effectiveTerm(q);
  if (
    term.length === 0 ||
    (term.length === 1 && q.trim().length === 1 && !HAS_HAN.test(term))
  ) {
    return res.json({
      ...pageResult([], 0, page, limit),
      page,
      limit,
      reason: "too_short",
      counts: { ...ZERO_COUNTS },
    });
  }
  const pat = likePattern(q);
  const db = getDb();

  // 三个 scope 共用的 WHERE 片段：问题 scope 的话题名命中用 EXISTS 子查询而非 JOIN，
  // 避免一题多话题时重复行影响分页与 total；回答 scope 还要套所属问题/回答作者的
  // 测试产物过滤；用户 scope 用 testUserSql 排除测试账号。
  const qWhere = `${testQuestionSql("q", "u")} AND (
    q.title LIKE ? ESCAPE '\\' OR q.detail_md LIKE ? ESCAPE '\\' OR
    EXISTS (SELECT 1 FROM question_topics qt JOIN topics t ON t.id = qt.topic_id
            WHERE qt.question_id = q.id AND t.name LIKE ? ESCAPE '\\')
  )`;
  const aJoins = `FROM answers a
    JOIN questions q ON q.id = a.question_id
    JOIN users u ON u.id = a.author_id
    JOIN users qu ON qu.id = q.author_id`;
  const aWhere = `a.is_deleted = 0 AND a.content_md LIKE ? ESCAPE '\\'
    AND ${testQuestionSql("q", "qu")} AND ${testUserSql("u")}`;
  const uWhere = `${testUserSql("u")} AND (
    u.nickname LIKE ? ESCAPE '\\' OR u.bio LIKE ? ESCAPE '\\'
  )`;

  // counts：各 scope 的 total，tab 计数用；只走 COUNT，不把全表拉进内存。
  const counts = {
    question: db
      .prepare(
        `SELECT COUNT(*) c FROM questions q JOIN users u ON u.id = q.author_id WHERE ${qWhere}`
      )
      .get(pat, pat, pat).c,
    answer: db.prepare(`SELECT COUNT(*) c ${aJoins} WHERE ${aWhere}`).get(pat).c,
    user: db.prepare(`SELECT COUNT(*) c FROM users u WHERE ${uWhere}`).get(pat, pat).c,
  };

  if (type === "answer") {
    const rows = db
      .prepare(
        `SELECT a.id, a.question_id, a.content_md, a.vote_up, a.created_at,
           q.title AS question_title, ${AUTHOR_COLS}
         ${aJoins}
         WHERE ${aWhere}
         ORDER BY a.vote_up DESC, a.created_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(pat, limit, offset);
    const topicsByQ = topicsForQuestions(db, [...new Set(rows.map((r) => r.question_id))]);
    const items = rows.map((row) => ({
      id: row.id,
      question_id: row.question_id,
      question_title: row.question_title,
      snippet: snippet(row.content_md, q),
      vote_up: row.vote_up,
      created_at: row.created_at,
      author: {
        id: row.author_id,
        nickname: row.author_nickname,
        avatar_url: row.author_avatar,
        bio: row.author_bio,
      },
      topics: topicsByQ.get(row.question_id) || [],
    }));
    return res.json({
      ...pageResult(items, counts.answer, page, limit),
      page,
      limit,
      counts,
    });
  }

  if (type === "user") {
    const rows = db
      .prepare(
        `SELECT u.id, u.nickname, u.avatar_url, u.bio, u.created_at,
           (SELECT COUNT(*) FROM answers a2 WHERE a2.author_id = u.id AND a2.is_deleted = 0)
             AS answer_count,
           (SELECT COUNT(*) FROM follows f WHERE f.target_type = 'user' AND f.target_id = u.id)
             AS follower_count
         FROM users u
         WHERE ${uWhere}
         ORDER BY follower_count DESC, answer_count DESC, u.id ASC
         LIMIT ? OFFSET ?`
      )
      .all(pat, pat, limit, offset);
    return res.json({
      ...pageResult(rows, counts.user, page, limit),
      page,
      limit,
      counts,
    });
  }

  if (type !== "question") {
    return res.json({ ...pageResult([], 0, page, limit), page, limit, counts });
  }

  const rows = db
    .prepare(
      `SELECT q.*, ${AUTHOR_COLS},
         CASE WHEN q.title LIKE ? ESCAPE '\\' THEN 1
              WHEN q.detail_md LIKE ? ESCAPE '\\' THEN 2
              ELSE 3 END AS match_rank
       FROM questions q
       JOIN users u ON u.id = q.author_id
       WHERE ${qWhere}
       ORDER BY match_rank ASC, q.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(pat, pat, pat, pat, pat, limit, offset);

  // 结果卡需要展示话题胶囊：一次性捞回本页问题的话题（id/name/slug），避免逐题查询。
  const topicsByQ = topicsForQuestions(db, rows.map((r) => r.id));

  const items = rows.map((row) => ({
    ...questionRow({ ...row, topics: topicsByQ.get(row.id) || [] }),
    snippet: snippet(row.detail_md, q),
    matched: MATCHED[row.match_rank],
  }));
  res.json({ ...pageResult(items, counts.question, page, limit), page, limit, counts });
});

module.exports = router;
