const express = require("express");
const { getDb } = require("../db");
const { parsePage } = require("../util");
const { requireAuth } = require("../auth");
const { questionRow, topicsForQuestions, HOT_SCORE_SQL } = require("./questions");
const { testQuestionSql, testUserSql } = require("../content-filter");
const {
  questionCategory,
  rerankRecommended,
  summarizeDiversity,
} = require("../feed-diversity");

const router = express.Router();

const AUTHOR_COLS =
  "u.id AS author_id, u.nickname AS author_nickname, u.avatar_url AS author_avatar, u.bio AS author_bio";

// 关注流候选集：四路来源 UNION ALL，每行带一个时间戳，外层 GROUP BY 问题去重后按 MAX(ts) 倒序。
//   1. 关注的人提的问题（ts = 提问时间）
//   2. 关注的人写的回答所属的问题（ts = 回答时间，已删回答不算动态）
//   3. 关注的话题下的问题（ts = 提问时间）
//   4. 关注的问题（ts = 最近动态 = max(更新时间, 最新回答时间)）
// 「我的关注」都走 follows 主键前缀 (follower_id, target_type)；
// 反向 JOIN 走 idx_questions_author / idx_answers_author / idx_qt_topic，全程无 N+1。
const FOLLOWING_CANDIDATES = `
  SELECT q.id AS qid, q.created_at AS ts
  FROM follows f
  JOIN questions q ON q.author_id = f.target_id
  WHERE f.follower_id = ? AND f.target_type = 'user'

  UNION ALL

  SELECT a.question_id AS qid, a.created_at AS ts
  FROM follows f
  JOIN answers a ON a.author_id = f.target_id AND a.is_deleted = 0
  WHERE f.follower_id = ? AND f.target_type = 'user'

  UNION ALL

  SELECT qt.question_id AS qid, q.created_at AS ts
  FROM follows f
  JOIN question_topics qt ON qt.topic_id = f.target_id
  JOIN questions q ON q.id = qt.question_id
  WHERE f.follower_id = ? AND f.target_type = 'topic'

  UNION ALL

  SELECT q.id AS qid,
         MAX(q.updated_at,
             COALESCE((SELECT MAX(a.created_at) FROM answers a
                       WHERE a.question_id = q.id AND a.is_deleted = 0),
                      q.updated_at)) AS ts
  FROM follows f
  JOIN questions q ON q.id = f.target_id
  WHERE f.follower_id = ? AND f.target_type = 'question'
`;

// GET /feed/following?page=&limit= — 本人关注内容流，item 与 GET /questions 列表项一致。
// 需登录（与 notifications/votes 一致：未登录 401）。私域流只按作者身份过滤
// （testUserSql）：按标题形态猜「像不像测试内容」会误吞被关注者的真实提问
// （Z1079 回归修复）；公共出口仍走标题+作者双滤。
router.get("/following", requireAuth, (req, res) => {
  const { page, limit, offset } = parsePage(req);
  const db = getDb();
  const uid = req.user.id;

  const rows = db
    .prepare(
      `SELECT q.*, ${AUTHOR_COLS}, MAX(c.ts) AS activity_ts
       FROM (${FOLLOWING_CANDIDATES}) c
       JOIN questions q ON q.id = c.qid
       JOIN users u ON u.id = q.author_id
       WHERE ${testUserSql("u")}
       GROUP BY c.qid
       ORDER BY activity_ts DESC, c.qid DESC
       LIMIT ? OFFSET ?`
    )
    .all(uid, uid, uid, uid, limit, offset);
  const topicsByQ = topicsForQuestions(db, rows.map((r) => r.id));
  const items = rows.map((r) =>
    questionRow({ ...r, topics: topicsByQ.get(r.id) || [] })
  );

  const total = db
    .prepare(
      `SELECT COUNT(*) AS c FROM (
         SELECT c.qid FROM (${FOLLOWING_CANDIDATES}) c
         JOIN questions q ON q.id = c.qid
         JOIN users u ON u.id = q.author_id
         WHERE ${testUserSql("u")}
         GROUP BY c.qid
       )`
    )
    .get(uid, uid, uid, uid).c;

  res.json({ items, total, has_more: page * limit < total, page });
});

// GET /feed/recommended?page=&limit= — 推荐流（首页「推荐」tab 数据源，无需登录）。
// Z1045 返修：不再按 detail_md 非空门控 —— detail_md 是可选字段，空详情是
// 合法真实问题（由前端「暂无补充说明」兜底展示）；过滤会藏掉用户刚提的问题。
// Z1114：纯时间序改为大类配额重排（server/feed-diversity.js，算法与口径见
// 该文件头注释）——候选全集一次取出、内存重排、再按页切片，多次请求结果
// 可复现；响应多带一个 diversity 字段供断言/运维核对，items 契约不变。
router.get("/recommended", (req, res) => {
  const { page, limit, offset } = parsePage(req);
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT q.*, ${AUTHOR_COLS} FROM questions q
       JOIN users u ON u.id = q.author_id
       WHERE ${testQuestionSql("q", "u")}
       ORDER BY q.created_at DESC, q.id DESC`
    )
    .all();
  // 全候选（不只是本页）的话题一次捞回：分类映射与同题降权都要用；
  // perQuestion 取上限 5（发帖接口最多挂 5 个），出参仍按原契约截前 3。
  const topicsByQ = topicsForQuestions(db, rows.map((r) => r.id), 5);
  const candidates = rows.map((r) => {
    const tps = topicsByQ.get(r.id) || [];
    return {
      row: r,
      topics: tps.slice(0, 3),
      cat: questionCategory(
        tps.map((t) => t.name),
        r.author_bio
      ),
      topicIds: new Set(tps.map((t) => t.id)),
    };
  });
  const { items: ranked, missing } = rerankRecommended(candidates, limit);
  const pageCands = ranked.slice(offset, offset + limit);
  const items = pageCands.map((c) =>
    questionRow({ ...c.row, topics: c.topics })
  );
  const total = db
    .prepare(
      `SELECT COUNT(*) c FROM questions q JOIN users u ON u.id = q.author_id
       WHERE ${testQuestionSql("q", "u")}`
    )
    .get().c;
  res.json({
    items,
    total,
    has_more: page * limit < total,
    page,
    diversity: summarizeDiversity(pageCands, missing),
  });
});

// GET /feed/hot — 热榜 Top20（与 /questions?tab=hot 同一段 HOT_SCORE_SQL，热度分随行返回）。
router.get("/hot", (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT q.*, ${AUTHOR_COLS}, ${HOT_SCORE_SQL} AS hot_score FROM questions q
       JOIN users u ON u.id = q.author_id
       WHERE ${testQuestionSql("q", "u")}
       ORDER BY ${HOT_SCORE_SQL} DESC, q.created_at DESC
       LIMIT 20`
    )
    .all();
  const topicsByQ = topicsForQuestions(db, rows.map((r) => r.id));
  const items = rows.map((r) =>
    questionRow({ ...r, topics: topicsByQ.get(r.id) || [] })
  );
  res.json({ items });
});

module.exports = router;
