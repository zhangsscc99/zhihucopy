const express = require("express");
const { getDb } = require("../db");
const { parsePage, pageResult, badRequest } = require("../util");
const { requireAuth } = require("../auth");
const { notifyQuestionAuthor } = require("./answers");
const { collectedAnswerIds, isCollected } = require("./collections");
const { testQuestionSql } = require("../content-filter");
const { grantFor } = require("../badges");

const router = express.Router();

const AUTHOR_COLS =
  "u.id AS author_id, u.nickname AS author_nickname, u.avatar_url AS author_avatar, u.bio AS author_bio";

// 热榜热度分：互动加权（回答*3 + 关注*2 + 浏览），与 ORDER BY 用同一表达式，
// 「分数即顺序」，无随机成分。/feed/hot 复用同一常量，两处口径一致。
const HOT_SCORE_SQL =
  "(q.answer_count * 3 + q.follower_count * 2 + q.view_count)";

// 注意（Z1045 返修）：公共流不按 detail_md 是否为空做门控。detail_md 是
// POST /questions 的可选字段（见下方 detail_md || ""），真实用户只填标题
// 的问题若被过滤，会同时从最新/推荐/热榜消失 —— 提完刷新看不到自己的问题。
// 无摘要的展示问题由前端「暂无补充说明」灰字兜底；自动化残留走
// content-filter 的标题形态规则（如「复盘 <token> ？」）。

// 热榜排名快照（进程内存，无快照表/库列时的轻量口径）：上一次请求的整榜
// id -> 名次，用于 rank_delta = 上次名次 - 本次名次（>0 即上升）。
// 进程重启清零；首轮请求没有基线，不返回 rank_delta，前端不渲染上升标记。
let prevHotRanks = null;

// 自动化产物（巡检/e2e/assert 脚本创建的问题及其账号）不进公共列表与热榜；
// 判定口径集中在 server/content-filter.js。详情页不受限，老链接仍可打开。

function questionRow(q) {
  return {
    id: q.id,
    title: q.title,
    detail_md: q.detail_md,
    created_at: q.created_at,
    updated_at: q.updated_at,
    answer_count: q.answer_count,
    follower_count: q.follower_count,
    view_count: q.view_count,
    // hot 分支 SQL 里才算出的热度分，其他出口不夹带。
    ...(q.hot_score === undefined ? {} : { hot_score: q.hot_score }),
    author: {
      id: q.author_id,
      nickname: q.author_nickname,
      avatar_url: q.author_avatar,
      bio: q.author_bio,
    },
    topics: q.topics || [],
  };
}

// 批量取一组问题的话题（id+name，按名称稳定排序、每题最多 3 个）：一次 IN 查询，
// 列表页 30 条只多 1 次 SQL，无 N+1。feed/topics/search 之外的列表路由复用同一口径。
function topicsForQuestions(db, questionIds, perQuestion = 3) {
  const map = new Map();
  const ids = [...new Set(questionIds)].filter((x) => Number.isInteger(x));
  if (!ids.length) return map;
  for (const t of db
    .prepare(
      `SELECT qt.question_id, t.id, t.name FROM question_topics qt
       JOIN topics t ON t.id = qt.topic_id
       WHERE qt.question_id IN (${ids.map(() => "?").join(",")})
       ORDER BY t.name ASC, t.id ASC`
    )
    .all(...ids)) {
    const arr = map.get(t.question_id) || [];
    if (arr.length < perQuestion) arr.push({ id: t.id, name: t.name });
    map.set(t.question_id, arr);
  }
  return map;
}

function answerRow(a) {
  return {
    id: a.id,
    question_id: a.question_id,
    question_title: a.question_title,
    content_md: a.content_md,
    vote_up: a.vote_up,
    vote_down: a.vote_down,
    comment_count: a.comment_count,
    is_collapsed: a.is_collapsed,
    created_at: a.created_at,
    updated_at: a.updated_at,
    author: {
      id: a.author_id,
      nickname: a.author_nickname,
      avatar_url: a.author_avatar,
      bio: a.author_bio,
    },
  };
}

const ANSWER_SELECT = `
  SELECT a.*, q.title AS question_title, ${AUTHOR_COLS}
  FROM answers a
  JOIN users u ON u.id = a.author_id
  JOIN questions q ON q.id = a.question_id`;

// ?author= 列表的附加过滤（在 testQuestionSql 之上）；users.js stats.questions 复用。
const AUTHOR_QUESTIONS_WHERE = "q.author_id = ?";

// POST /questions — create a question.
router.post("/", requireAuth, (req, res) => {
  const { title, detail_md, topic_ids } = req.body || {};
  if (typeof title !== "string" || !title.trim() || title.trim().length > 100) {
    return badRequest(res, "标题需要 1–100 个字符");
  }
  const recentQuestions = getDb()
    .prepare(
      "SELECT COUNT(*) c FROM questions WHERE author_id = ? AND created_at >= datetime('now', '-5 minutes')"
    )
    .get(req.user.id).c;
  if (recentQuestions >= 3) {
    return res.status(429).json({ error: "操作太频繁，请稍后再试" });
  }
  if (detail_md !== undefined && (typeof detail_md !== "string" || detail_md.length > 20000)) {
    return badRequest(res, "补充说明过长");
  }
  const ids = Array.isArray(topic_ids)
    ? topic_ids.filter((t) => Number.isInteger(t)).slice(0, 5)
    : [];

  const db = getDb();
  const created = db.transaction(() => {
    const info = db
      .prepare("INSERT INTO questions (author_id, title, detail_md) VALUES (?, ?, ?)")
      .run(req.user.id, title.trim(), detail_md || "");
    const qid = info.lastInsertRowid;
    if (ids.length) {
      const exists = db.prepare("SELECT id FROM topics WHERE id = ?");
      const link = db.prepare(
        "INSERT OR IGNORE INTO question_topics (question_id, topic_id) VALUES (?, ?)"
      );
      for (const tid of ids) if (exists.get(tid)) link.run(qid, tid);
    }
    return qid;
  })();

  const q = db
    .prepare(
      `SELECT q.*, ${AUTHOR_COLS} FROM questions q JOIN users u ON u.id = q.author_id WHERE q.id = ?`
    )
    .get(created);
  const createdTopics = topicsForQuestions(db, [q.id]).get(q.id) || [];
  grantFor(req.user.id, "first_question");
  res.status(201).json({ question: questionRow({ ...q, topics: createdTopics }) });
});

// GET /questions?tab=hot|new|unanswered&author=<id>&page=&limit=
router.get("/", (req, res) => {
  const tab =
    req.query.tab === "hot" || req.query.tab === "unanswered"
      ? req.query.tab
      : "new";
  const { page, limit, offset } = parsePage(req);
  const db = getDb();
  const order =
    tab === "hot"
      ? `${HOT_SCORE_SQL} DESC, q.created_at DESC`
      : "q.created_at DESC";
  // 热度分随行返回（仅热榜），前端元信息行直接展示，无需二次计算。
  const hotScoreCol = tab === "hot" ? `, ${HOT_SCORE_SQL} AS hot_score` : "";
  // ?author= 个人页口径：与 users.js stats.questions 同一段 WHERE（含测试内容过滤）。
  const conds = [testQuestionSql("q", "u")];
  const params = [];
  if (req.query.author !== undefined) {
    const authorId = parseInt(req.query.author, 10);
    if (!Number.isInteger(authorId) || authorId <= 0) {
      return badRequest(res, "author 参数不合法");
    }
    conds.push(AUTHOR_QUESTIONS_WHERE);
    params.push(authorId);
  }
  if (tab === "unanswered") {
    conds.push("q.answer_count = 0");
  }
  const where = conds.join(" AND ");
  const rows = db
    .prepare(
      `SELECT q.*, ${AUTHOR_COLS}${hotScoreCol} FROM questions q
       JOIN users u ON u.id = q.author_id
       WHERE ${where}
       ORDER BY ${order} LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);
  // 本页问题的话题一次捞回（id+name，最多 3 个/题），卡片胶囊数据源。
  const topicsByQ = topicsForQuestions(db, rows.map((r) => r.id));
  const items = rows.map((r) =>
    questionRow({ ...r, topics: topicsByQ.get(r.id) || [] })
  );
  // rank_delta：本次整榜名次 vs 上次内存快照（author 过滤的列表不算整榜，
  // 不比也不污染基线）。snapshot 用同一条 WHERE/ORDER 的全量 id 序重建。
  if (tab === "hot" && req.query.author === undefined) {
    const ranks = new Map(
      db
        .prepare(
          `SELECT q.id FROM questions q
           JOIN users u ON u.id = q.author_id
           WHERE ${where} ORDER BY ${order}`
        )
        .all(...params)
        .map((r, i) => [r.id, i + 1])
    );
    if (prevHotRanks) {
      for (const it of items) {
        const prev = prevHotRanks.get(it.id);
        const now = ranks.get(it.id);
        if (prev !== undefined && now !== undefined && prev !== now) {
          it.rank_delta = prev - now;
        }
      }
    }
    prevHotRanks = ranks;
  }
  const total = db
    .prepare(
      `SELECT COUNT(*) c FROM questions q JOIN users u ON u.id = q.author_id
       WHERE ${where}`
    )
    .get(...params).c;
  res.json(pageResult(items, total, page, limit));
});

// GET /questions/:id — detail + first 5 answers.
router.get("/:id", (req, res) => {
  const db = getDb();
  const q = db
    .prepare(
      `SELECT q.*, ${AUTHOR_COLS} FROM questions q JOIN users u ON u.id = q.author_id WHERE q.id = ?`
    )
    .get(req.params.id);
  if (!q) return res.status(404).json({ error: "问题不存在" });
  db.prepare("UPDATE questions SET view_count = view_count + 1 WHERE id = ?").run(q.id);

  const topics = db
    .prepare(
      `SELECT t.id, t.name FROM topics t
       JOIN question_topics qt ON qt.topic_id = t.id WHERE qt.question_id = ?`
    )
    .all(q.id);
  // 默认排序是公开口径：纯赞数序，作者与匿名访客看到同一顺序。
  const answerRows = db
    .prepare(
      `${ANSWER_SELECT}
       WHERE a.question_id = ? AND a.is_deleted = 0
       ORDER BY a.vote_up DESC, a.created_at ASC, a.id ASC LIMIT 5`
    )
    .all(q.id);
  // 登录用户本人的回答单独成栏返回（前端「你的回答」固定条用）：
  // 不改写公开排序，也能让作者刷新后在首屏找到自己的回答。
  const myAnswerRows = req.user
    ? db
        .prepare(
          `${ANSWER_SELECT}
           WHERE a.question_id = ? AND a.is_deleted = 0 AND a.author_id = ?
           ORDER BY a.created_at DESC, a.id DESC`
        )
        .all(q.id, req.user.id)
    : [];
  const collected = collectedAnswerIds(
    db,
    req.user && req.user.id,
    [...answerRows, ...myAnswerRows].map((a) => a.id)
  );
  const answers = answerRows.map((a) => ({
    ...answerRow(a),
    is_collected: collected.has(a.id),
  }));
  const my_answers = myAnswerRows.map((a) => ({
    ...answerRow(a),
    is_collected: collected.has(a.id),
  }));

  const followed = req.user
    ? !!db
        .prepare(
          "SELECT EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND target_type = 'question' AND target_id = ?) AS followed"
        )
        .get(req.user.id, q.id).followed
    : false;

  res.json({
    question: { ...questionRow({ ...q, topics }), followed },
    answers,
    my_answers,
  });
});

// GET /questions/:id/answers?sort=default|newest&page=&limit=
router.get("/:id/answers", (req, res) => {
  const db = getDb();
  const qid = db.prepare("SELECT id FROM questions WHERE id = ?").get(req.params.id);
  if (!qid) return res.status(404).json({ error: "问题不存在" });
  const { page, limit, offset } = parsePage(req);
  // 两种排序都是公开口径：default 纯赞数序，newest 纯时间序；
  // 本人回答不进列表前位，由 detail 的 my_answers 单独成栏。
  const order =
    req.query.sort === "newest"
      ? "a.created_at DESC, a.id DESC"
      : "a.vote_up DESC, a.created_at ASC, a.id ASC";
  const answerRows = db
    .prepare(
      `${ANSWER_SELECT}
       WHERE a.question_id = ? AND a.is_deleted = 0
       ORDER BY ${order} LIMIT ? OFFSET ?`
    )
    .all(req.params.id, limit, offset);
  const collected = collectedAnswerIds(
    db,
    req.user && req.user.id,
    answerRows.map((a) => a.id)
  );
  const items = answerRows.map((a) => ({
    ...answerRow(a),
    is_collected: collected.has(a.id),
  }));
  const total = db
    .prepare("SELECT COUNT(*) c FROM answers WHERE question_id = ? AND is_deleted = 0")
    .get(req.params.id).c;
  res.json(pageResult(items, total, page, limit));
});

// POST /questions/:id/answers — publish an answer.
router.post("/:id/answers", requireAuth, (req, res) => {
  const { content_md } = req.body || {};
  if (typeof content_md !== "string" || !content_md.trim() || content_md.length > 50000) {
    return badRequest(res, "回答内容需要 1–50000 个字符");
  }
  const db = getDb();
  const q = db.prepare("SELECT id FROM questions WHERE id = ?").get(req.params.id);
  if (!q) return res.status(404).json({ error: "问题不存在" });

  const recentAnswers = db
    .prepare(
      "SELECT COUNT(*) c FROM answers WHERE author_id = ? AND is_deleted = 0 AND created_at >= datetime('now', '-10 minutes')"
    )
    .get(req.user.id).c;
  if (recentAnswers >= 10) {
    return res.status(429).json({ error: "操作太频繁，请稍后再试" });
  }

  const aid = db.transaction(() => {
    const info = db
      .prepare(
        "INSERT INTO answers (question_id, author_id, content_md) VALUES (?, ?, ?)"
      )
      .run(q.id, req.user.id, content_md);
    db.prepare(
      "UPDATE questions SET answer_count = answer_count + 1 WHERE id = ?"
    ).run(q.id);
    notifyQuestionAuthor(db, q.id, req.user.id, info.lastInsertRowid);
    return info.lastInsertRowid;
  })();

  const a = db.prepare(`${ANSWER_SELECT} WHERE a.id = ?`).get(aid);
  grantFor(req.user.id, "first_answer");
  grantFor(req.user.id, "answer_5");
  res
    .status(201)
    .json({ answer: { ...answerRow(a), is_collected: isCollected(db, req.user.id, a.id) } });
});

function questionFollowerCount(db, qid) {
  return db.prepare("SELECT follower_count FROM questions WHERE id = ?").get(qid)
    .follower_count;
}

// POST /questions/:id/follow — 关注问题（幂等，只在真正新插入时 follower_count +1）。
router.post("/:id/follow", requireAuth, (req, res) => {
  const db = getDb();
  const q = db.prepare("SELECT id FROM questions WHERE id = ?").get(req.params.id);
  if (!q) return res.status(404).json({ error: "问题不存在" });

  db.transaction(() => {
    const info = db
      .prepare(
        "INSERT OR IGNORE INTO follows (follower_id, target_type, target_id) VALUES (?, 'question', ?)"
      )
      .run(req.user.id, q.id);
    if (info.changes > 0) {
      db.prepare(
        "UPDATE questions SET follower_count = follower_count + 1 WHERE id = ?"
      ).run(q.id);
    }
  })();

  res.json({ following: true, follower_count: questionFollowerCount(db, q.id) });
});

// DELETE /questions/:id/follow — 取消关注（幂等，真的删掉了才 follower_count -1）。
router.delete("/:id/follow", requireAuth, (req, res) => {
  const db = getDb();
  const q = db.prepare("SELECT id FROM questions WHERE id = ?").get(req.params.id);
  if (!q) return res.status(404).json({ error: "问题不存在" });

  db.transaction(() => {
    const info = db
      .prepare(
        "DELETE FROM follows WHERE follower_id = ? AND target_type = 'question' AND target_id = ?"
      )
      .run(req.user.id, q.id);
    if (info.changes > 0) {
      db.prepare(
        "UPDATE questions SET follower_count = MAX(follower_count - 1, 0) WHERE id = ?"
      ).run(q.id);
    }
  })();

  res.json({ following: false, follower_count: questionFollowerCount(db, q.id) });
});

module.exports = router;
module.exports.questionRow = questionRow;
module.exports.topicsForQuestions = topicsForQuestions;
module.exports.AUTHOR_QUESTIONS_WHERE = AUTHOR_QUESTIONS_WHERE;
module.exports.HOT_SCORE_SQL = HOT_SCORE_SQL;
