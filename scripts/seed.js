#!/usr/bin/env node
/**
 * scripts/seed.js — 幂等种子数据生成器
 *
 * 用法:
 *   node scripts/seed.js                          # 默认规模，写 <repo>/data/zhihu.db
 *   DB_PATH=/tmp/zh-seed-test.db node scripts/seed.js
 *   SEED_SCALE=0.2 node scripts/seed.js           # 线性缩放到 20%，用于快速自测
 *
 * 行为: 先按外键安全顺序清空全部业务表并重置 sqlite_sequence，再重新灌数据。
 * 因此重复执行结果稳定（同样的规模 -> 同样的行数与计数）。
 *
 * 反范式计数字段在全部写入完成后由 SQL 聚合回填，保证与真实行完全一致：
 *   questions.answer_count / follower_count / view_count
 *   answers.vote_up / vote_down / comment_count
 *   topics.follower_count
 *   users.salt_value / level
 */

"use strict";

const path = require("path");

// bcryptjs 装在 server/node_modules 下。用 server 目录作为解析起点，
// 这样即使 worktree 根目录没有 node_modules 软链也能跑（部署环境同样成立）。
function requireFromServer(name) {
  try {
    return require(name);
  } catch (e) {
    return require(require.resolve(name, { paths: [path.join(__dirname, "..", "server")] }));
  }
}
const bcrypt = requireFromServer("bcryptjs");
const { getDb } = require("../server/db");

// ---------------------------------------------------------------------------
// 随机数：固定种子 -> 内容可复现（便于对比两次执行的结果）
// ---------------------------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GLOBAL_SEED = 0x5eed2026;
const g = mulberry32(GLOBAL_SEED);
const ri = (n) => Math.floor(g() * n);
const pick = (arr) => arr[ri(arr.length)];
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = ri(i + 1);
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
};
const cnLen = (s) => [...s].length;
const pad2 = (n) => String(n).padStart(2, "0");
const fmtTs = (ms) => {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
  );
};

const NOW = Date.now() - 5 * 60 * 1000;
const DAY = 86400000;
const SPAN = 90 * DAY;
const T_START = NOW - SPAN;
const at = (frac) => {
  const f = Math.max(0, Math.min(0.9995, frac));
  return T_START + f * SPAN;
};
const jitter = (ms, maxMs) => Math.min(NOW - 60000, ms + Math.floor(g() * maxMs));

const TOPICS = [
  { name: "编程", slug: "programming", cat: "code", description: "写代码这件事的手艺、习惯与取舍。" },
  { name: "JavaScript", slug: "javascript", cat: "code", description: "从语言特性到运行时行为的实践讨论。" },
  { name: "Python", slug: "python", cat: "code", description: "脚本、数据处理与工程化的日常。" },
  { name: "前端开发", slug: "frontend", cat: "code", description: "浏览器里的一切：渲染、性能与协作。" },
  { name: "数据库", slug: "database", cat: "code", description: "索引、查询与数据建模的经验。" },
  { name: "职场", slug: "workplace", cat: "work", description: "汇报、协作与组织里的生存技巧。" },
  { name: "职业规划", slug: "career-planning", cat: "work", description: "选择、转型与长期路径。" },
  { name: "面试", slug: "interview", cat: "work", description: "面试准备、表达与双向选择。" },
  { name: "生活", slug: "life", cat: "life", description: "把日子过得有条理的琐碎经验。" },
  { name: "家居收纳", slug: "home-organization", cat: "life", description: "空间、物品与动线的整理方法。" },
  { name: "科学", slug: "science", cat: "sci", description: "研究方法、证据与可信度。" },
  { name: "统计学", slug: "statistics", cat: "sci", description: "数据里那些容易骗人的地方。" },
  { name: "心理学", slug: "psychology", cat: "psy", description: "情绪、动机与行为机制。" },
  { name: "情绪管理", slug: "emotion-management", cat: "psy", description: "和自己相处的具体方法。" },
  { name: "人际关系", slug: "relationships", cat: "psy", description: "沟通、边界与长期关系。" },
  { name: "教育", slug: "education", cat: "edu", description: "教学、家庭与成长中的现实问题。" },
  { name: "学习方法", slug: "learning-methods", cat: "edu", description: "记忆、练习与自学的有效路径。" },
  { name: "健康", slug: "health", cat: "health", description: "作息、运动与身体的日常维护。" },
  { name: "睡眠", slug: "sleep", cat: "health", description: "入睡、节律与睡眠质量。" },
  { name: "理财", slug: "personal-finance", cat: "money", description: "记账、配置与风险的基本盘。" },
];

const USERS = [
  ["陈默", "写后端，也读点书。"],
  ["林间有风", "前端工程师，关注可访问性。"],
  ["阿澈", "在做一个很小的产品，什么都得自己来。"],
  ["半山腰", "数据分析师，喜欢把不确定说清楚。"],
  ["老周写代码", "十年 CRUD，见过太多重写。"],
  ["苏晚", "产品经理，负责把话说清楚。"],
  ["不加班的周五", "努力不加班的运营。"],
  ["白露", "两个孩子的妈妈，兼职做设计。"],
  ["何人在此", "研究生在读，方向是认知科学。"],
  ["麦田守望", "中学老师，教语文。"],
  ["南栀", "自由职业，做内容也做咨询。"],
  ["一叶知秋", "刚工作两年，什么都想学。"],
  ["周吴郑王", "工程效率团队，专治流程。"],
  ["沈青", "心理咨询方向，做科普不做诊断。"],
  ["顾言", "写点技术笔记，偶尔翻译。"],
  ["小满", "在一家小公司做全栈。"],
  ["山月", "喜欢整理房间，也喜欢整理代码。"],
  ["陆离", "架构师，做过支付和风控。"],
  ["余光", "HR，看简历看到眼花。"],
  ["程一", "创业者，第二次了。"],
  ["夏至未至", "护士，值夜班第七年。"],
  ["温故", "统计出身，现在做增长。"],
  ["青柠", "产品设计师，专注阅读类产品。"],
  ["海边的卡夫卡", "白天写 SQL，晚上写小说。"],
  ["南山南", "健身教练，也带康复训练。"],
  ["拾光", "做纪录片，长期在外拍摄。"],
  ["阿罗", "运维，负责不被叫醒。"],
  ["简宁", "会计，喜欢把账算明白。"],
  ["木子李", "刚转行做测试，还在补基础。"],
  ["第五个季节", "在读博士，方向是流行病学。"],
];

// ---------------------------------------------------------------------------
// 问题语料：按 story 显式编写（scripts/seed-data/<cat>.js），
// 保证标题、补充说明、回答三者语义对齐。加载时即校验结构与长度。
// ---------------------------------------------------------------------------
const TOPIC_INDEX = new Map(TOPICS.map((t, i) => [t.name, i]));
const NICK_INDEX = new Map(USERS.map((u, i) => [u[0], i]));

const { stories: STORIES } = require("./seed-data");
{
  const seenTitle = new Set();
  const seenDetail = new Set();
  for (const s of STORIES) {
    const where = `seed-data/${s.cat}.js: 「${s.title.slice(0, 24)}…」`;
    const tIdx = TOPIC_INDEX.get(s.topic);
    if (tIdx === undefined) throw new Error(`${where} 未知话题「${s.topic}」`);
    if (TOPICS[tIdx].cat !== s.cat) {
      throw new Error(`${where} 话题「${s.topic}」不属于大类 ${s.cat}`);
    }
    s.topicIdx = tIdx;
    if (seenTitle.has(s.title)) throw new Error(`seed-data: 标题重复「${s.title}」`);
    seenTitle.add(s.title);
    if (seenDetail.has(s.detail)) throw new Error(`${where} detail 与其它 story 重复`);
    seenDetail.add(s.detail);
    const dLen = cnLen(s.detail);
    if (dLen < 180 || dLen > 420) throw new Error(`${where} detail 长度 ${dLen} 超出 180-420`);
    if (!Array.isArray(s.answers) || s.answers.length < 3) {
      throw new Error(`${where} answers 至少需要 3 条`);
    }
    for (const [k, a] of s.answers.entries()) {
      const aLen = cnLen(a.content || "");
      if (aLen < 200 || aLen > 800) {
        throw new Error(`${where} 第 ${k + 1} 条回答长度 ${aLen} 超出 200-800`);
      }
      if (a.author !== undefined && !NICK_INDEX.has(a.author)) {
        throw new Error(`${where} 第 ${k + 1} 条回答指定了未知作者「${a.author}」`);
      }
    }
  }
}

const COMMENTS = [
  "写得很实在，很多细节一看就是真做过的人写的。",
  "补充一点：这个方法在小团队里要打个折扣，人手不够的时候根本执行不下去。",
  "看完之后我最大的感受是，很多问题真的不是技术问题。",
  "不同意最后一段，大多数人都没有你说的那个前提条件。",
  "有个疑问，如果资源更紧张一些，你会怎么排优先级？",
  "有些地方我还得再看一遍才能消化，先收藏了。",
  "刚好在做类似的事，明天就试试，回来反馈。",
  "这个思路我在一本书里见过，但你说得更具体。",
  "收藏了，慢慢看。",
  "说得好，但执行起来最难的是坚持。",
  "我自己踩过一模一样的坑，看完会心一笑。",
  "讲得太抽象了，能不能给个具体的例子？",
  "这个结论我保留意见，感觉样本太小。",
  "说到点子上了，比那些只讲原则的回答实在多了。",
  "有几个细节想请教，方便的话能展开说说吗？",
  "感谢分享，这种来自一线的经验比教程有用多了。",
  "我觉得还有一点没说：人的因素往往比方法更重要。",
  "这条我有不同经验，可能跟行业有关系。",
  "第一段就把我说服了。",
  "写得真好，已转发给同事。",
  "说实话有点理想化，现实里没这么多时间给你折腾。",
  "想问下你做了多久才看到效果？",
  "看完觉得自己以前都在瞎努力。",
  "有一个小细节我可能理解得不对，回头再读一遍。",
  "作为刚入行的人，这篇帮我省了不少弯路。",
  "能不能出一篇详细的操作版？",
  "同意大方向，细节上我觉得要分场景。",
  "楼主是不是漏了成本这一项？",
  "我试了，有用，但没你说的那么明显。",
  "这种内容太少了，希望多写。",
  "看完默默关掉了正在刷的手机。",
  "最后一句话值得单独抄下来。",
  "请问有没有推荐的入门资料？",
  "部分同意，有些场景下可能还要再分情况讨论。",
  "同感，里面的好几个坑我都踩过。",
  "写得很克制，没有贩卖焦虑，难得。",
  "看完对照了下自己的情况，确实是这样。",
  "有个反例：我们团队就是靠重度流程撑起来的。",
  "感谢，正好这周要做决策，参考了。",
  "这个话题下终于看到一篇说人话的。",
  "能感觉到是真做过的人写的。",
  "想问下大概需要投入多少时间？",
  "逻辑很清晰，收藏了。",
  "道理都懂，做起来还是难。",
  "我补充一个：环境因素往往被低估。",
  "第一条就中了，我一直以为是我自己的问题。",
  "看完有点被安慰到。",
  "希望有机会看到后续。",
  "这种回答应该置顶。",
  "有没有更多的例子？想再看看其他场景下的情况。",
  "不太理解为什么这么多人赞，感觉有点老生常谈。",
  "看完之后我改了三个习惯，一个月后确实不一样。",
  "同意大方向，不过落地的时候还得看具体环境。",
  "这篇我读了三遍，每遍都有新收获。",
  "有点长，但值得看完。",
  "提问的人运气好，遇到这种回答。",
  "第一次看到有人把这件事讲这么细。",
];

const REPLIES = [
  "你说的情况我也遇到过，可能是执行顺序的问题。",
  "这个补充很有价值，我加到正文里了。",
  "同意，我原文写得太绝对了。",
  "不完全是这样，得看具体场景。",
  "能具体说说你当时的数据吗？",
  "谢谢，这个点我确实没想到。",
  "我的经验刚好相反，可能是行业差异。",
  "对，而且成本这块还要再算一遍。",
  "这个前提很重要，值得单独展开。",
  "哈哈，同款经历。",
  "有道理，我回去验证一下。",
  "有一点我持保留态度。",
  "收藏了，感谢补充。",
  "这个问题我也想问。",
  "我补充个案例：去年我们就是这么做的。",
  "说得对，但落地时还得看团队配合。",
  "受教了。",
  "这个角度很新，之前没想过。",
  "麻烦问下能再展开一点吗？",
  "是的，尤其是人少的时候。",
  "我按这个思路试了，确实有效。",
  "那如果条件不满足呢？",
  "赞同，方法本身没那么重要，执行才是。",
  "这条应该置顶。",
];


// ---------------------------------------------------------------------------
// 清空
// ---------------------------------------------------------------------------
const CLEAR_ORDER = [
  "collection_items",
  "notifications",
  "reports",
  "mod_logs",
  "badges",
  "votes",
  "answer_revisions",
  "answers",
  "question_topics",
  "questions",
  "follows",
  "collections",
  "topics",
  "users",
];

function clearAll(db) {
  // 评论有自引用外键：先删子级
  db.prepare("DELETE FROM comments WHERE parent_id IS NOT NULL").run();
  db.prepare("DELETE FROM comments").run();
  for (const table of CLEAR_ORDER) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
  try {
    db.prepare("DELETE FROM answer_fts").run();
  } catch (e) {
    /* FTS 表可能不存在（迁移未跑） */
  }
  try {
    db.prepare("DELETE FROM sqlite_sequence").run();
  } catch (e) {
    /* 表还不存在时忽略 */
  }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
function readScale() {
  const raw = process.env.SEED_SCALE;
  if (!raw) return 1;
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`SEED_SCALE 必须是正数，收到: ${raw}`);
  }
  return v;
}

function main() {
  const startedAt = process.hrtime.bigint();
  const S = readScale();

  // 先做生产库保护，再打开数据库（避免 migrate 顺手写到生产库）
  const dbPath = path.resolve(
    process.env.DB_PATH || path.join(__dirname, "..", "data", "zhihu.db")
  );
  const PROD_DB = "/www/zhihucopy/data/zhihu.db";
  if (dbPath === PROD_DB && process.env.SEED_ALLOW_PROD !== "1") {
    console.error(
      `[seed] 拒绝对生产库写入: ${dbPath}\n` +
        `[seed] 请使用 DB_PATH=/tmp/zh-seed-test.db；确需写入生产库请显式设置 SEED_ALLOW_PROD=1`
    );
    process.exit(1);
  }

  const db = getDb();

  const N_USERS = Math.max(6, Math.round(30 * S));
  const N_TOPICS = Math.max(4, Math.min(TOPICS.length, Math.round(20 * S)));
  const N_QUESTIONS = Math.max(6, Math.round(60 * S));
  const N_COMMENTS = Math.max(40, Math.round(560 * S));
  const N_NOTIF = Math.max(12, Math.round(120 * S));
  const N_REPORTS = Math.max(3, Math.round(24 * S));

  const counts = {};
  const bump = (k, n = 1) => {
    counts[k] = (counts[k] || 0) + n;
  };

  const passwordHash = bcrypt.hashSync("zhihu123456", 10);

  const tx = db.transaction(() => {
    clearAll(db);

    // ---------------- users ----------------
    const insUser = db.prepare(
      `INSERT INTO users (email, password_hash, nickname, avatar_url, bio, salt_value, level, is_admin, muted_until, created_at)
       VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?, ?)`
    );
    const userIds = [];
    for (let i = 0; i < N_USERS; i++) {
      const [nick, bio] = USERS[i % USERS.length];
      const suffix = i >= USERS.length ? `${i + 1}` : "";
      const nickname = nick + suffix;
      const isAdmin = i === 0 ? 1 : 0;
      const email = i === 0 ? "admin@zhihucopy.dev" : `user${i + 1}@zhihucopy.dev`;
      const avatar = `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(nickname)}&size=200`;
      // 禁言样本：第 8 和第 20 个用户（存在时）
      let mutedUntil = null;
      if (i === 7) mutedUntil = fmtTs(NOW + 3 * DAY);
      if (i === 19 && i < N_USERS) mutedUntil = fmtTs(NOW + 12 * DAY);
      const createdAt = fmtTs(at((i + 1) / (N_USERS + 4) * 0.6));
      const info = insUser.run(email, passwordHash, nickname, avatar, bio, isAdmin, mutedUntil, createdAt);
      userIds.push(Number(info.lastInsertRowid));
      bump("users");
    }
    const adminId = userIds[0];

    // ---------------- topics ----------------
    const insTopic = db.prepare(
      "INSERT INTO topics (name, slug, description, follower_count) VALUES (?, ?, ?, 0)"
    );
    const topicIds = [];
    for (let i = 0; i < N_TOPICS; i++) {
      const t = TOPICS[i];
      const info = insTopic.run(t.name, t.slug, t.description);
      topicIds.push({ id: Number(info.lastInsertRowid), cat: t.cat, name: t.name, idx: i });
      bump("topics");
    }
    // 每个大类里，用户有一个「擅长领域」，用于挑选回答作者
    const catOf = (uIdx) => ["code", "work", "life", "sci", "psy", "edu", "health", "money"][uIdx % 8];

    // ---------------- questions ----------------
    const insQuestion = db.prepare(
      `INSERT INTO questions (author_id, title, detail_md, created_at, updated_at, answer_count, follower_count, view_count)
       VALUES (?, ?, ?, ?, ?, 0, 0, 0)`
    );
    const insQT = db.prepare("INSERT INTO question_topics (question_id, topic_id) VALUES (?, ?)");

    const availableStories = STORIES.filter((s) => s.topicIdx < N_TOPICS);
    const questionPlan = [];
    for (let i = 0; i < N_QUESTIONS; i++) {
      const story = availableStories[i % availableStories.length];
      const round = Math.floor(i / availableStories.length);
      const title =
        round === 0
          ? story.title
          : story.title.replace(/？$/, "") + `——再补一个具体场景（${round}）？`;
      questionPlan.push({ title, topic: topicIds[story.topicIdx], story });
    }

    for (let i = 0; i < questionPlan.length; i++) {
      const { title, topic, story } = questionPlan[i];
      const cat = topic.cat;
      const authorIdx = ri(N_USERS);
      const detail = story.detail;
      const createdAt = fmtTs(at(((i + 0.5) / questionPlan.length) * 0.86 + g() * 0.02));
      const info = insQuestion.run(
        userIds[authorIdx],
        title,
        detail,
        createdAt,
        createdAt
      );
      const qid = Number(info.lastInsertRowid);
      bump("questions");

      // 1-3 个话题：主话题 + 同类话题
      insQT.run(qid, topic.id);
      let extra = ri(3); // 0..2
      const sameCat = topicIds.filter((t) => t.cat === cat && t.id !== topic.id);
      const others = topicIds.filter((t) => t.cat !== cat);
      const candidates = shuffle([...sameCat, ...others]);
      let picked = 0;
      for (const t of candidates) {
        if (picked >= extra) break;
        insQT.run(qid, t.id);
        picked++;
        bump("question_topics");
      }
      bump("question_topics");
      questionPlan[i] = { qid, cat, authorIdx, topicId: topic.id, story };
    }

    // ---------------- answers ----------------
    const insAnswer = db.prepare(
      `INSERT INTO answers (question_id, author_id, content_md, vote_up, vote_down, comment_count, is_collapsed, is_deleted, created_at, updated_at)
       VALUES (?, ?, ?, 0, 0, 0, 0, 0, ?, ?)`
    );
    const insRevision = db.prepare(
      "INSERT INTO answer_revisions (answer_id, content_md, created_at) VALUES (?, ?, ?)"
    );
    const updateAnswerBody = db.prepare("UPDATE answers SET content_md = ?, updated_at = ? WHERE id = ?");

    const answerPlan = [];
    let answerSeq = 0;
    // 每个问题的回答数 = 该 story 显式编写的回答数（默认每题 3 条，60 题共 180 条）
    for (let qi = 0; qi < questionPlan.length; qi++) {
      const q = questionPlan[qi];
      const cat = q.cat;
      const nAns = q.story.answers.length;
      // 作者不重复且不是提问者；story 显式指定作者（昵称）时优先用指定者
      const preferred = userIds
        .map((id, idx) => ({ id, idx }))
        .filter((u) => catOf(u.idx) === cat && u.idx !== q.authorIdx);
      const fallback = userIds.map((id, idx) => ({ id, idx })).filter((u) => u.idx !== q.authorIdx);
      const pool = shuffle(preferred.length >= nAns ? preferred : fallback);
      const authors = [];
      let poolPos = 0;
      for (let k = 0; k < nAns; k++) {
        let uid = null;
        const want = q.story.answers[k].author;
        if (want) {
          const wi = NICK_INDEX.get(want);
          if (wi !== undefined && wi < N_USERS && wi !== q.authorIdx && !authors.includes(userIds[wi])) {
            uid = userIds[wi];
          }
        }
        while (uid === null && poolPos < pool.length) {
          const cand = pool[poolPos++].id;
          if (!authors.includes(cand)) uid = cand;
        }
        while (uid === null) {
          const cand = userIds[ri(N_USERS)];
          if (!authors.includes(cand)) uid = cand;
        }
        authors.push(uid);
      }

      for (let k = 0; k < nAns; k++) {
        answerSeq++;
        const content = q.story.answers[k].content;
        const createdMs = jitter(T_START + ((q.qid + k * 0.7) / (questionPlan.length + 4)) * SPAN, 20 * DAY) + 4 * 3600000 * k;
        const createdAt = fmtTs(Math.min(createdMs, NOW - 3600000));
        const info = insAnswer.run(q.qid, authors[k], content, createdAt, createdAt);
        const aid = Number(info.lastInsertRowid);
        bump("answers");
        let finalCreated = createdAt;

        // 约 1/6 的回答有编辑记录
        if (answerSeq % 6 === 0) {
          const alpha = ["评论区有人问到成本，这里补一句", "有读者提醒我漏了一种情况，补在这里", "补充一个反例，免得被误解为绝对结论"];
          const extra = `\n\n> 补充：${pick(alpha)}——任何方法都有适用边界，先确认你的约束和我的一致，再决定要不要照做。`;
          const revTime = fmtTs(Math.min(NOW - 1800000, createdMs + 2 * DAY));
          insRevision.run(aid, content, revTime);
          updateAnswerBody.run(content + extra, revTime, aid);
          finalCreated = revTime;
          bump("answer_revisions");
        }
        answerPlan.push({ aid, qid: q.qid, authorId: authors[k], createdMs, created: finalCreated });
      }
    }

    // ---------------- votes ----------------
    const insVote = db.prepare("INSERT INTO votes (user_id, answer_id, value, created_at) VALUES (?, ?, ?, ?)");
    // 冷热分布：每题只有一个「高赞」回答，其余长尾
    const byQuestion = new Map();
    for (const a of answerPlan) {
      if (!byQuestion.has(a.qid)) byQuestion.set(a.qid, []);
      byQuestion.get(a.qid).push(a);
    }
    const votePlan = [];
    for (const [, list] of byQuestion) {
      const hotIdx = ri(list.length);
      list.forEach((a, idx) => {
        const maxV = Math.min(N_USERS - 1, 24);
        let up;
        if (idx === hotIdx) up = 8 + ri(Math.max(1, maxV - 8));
        else up = Math.floor(Math.pow(g(), 2.2) * (maxV * 0.45));
        const down = g() < 0.25 ? 1 + ri(2) : 0;
        a.targetUp = up;
        a.targetDown = down;
        votePlan.push({ a, up, down });
      });
    }
    for (const { a, up, down } of votePlan) {
      const pool = shuffle(userIds.filter((u) => u !== a.authorId));
      const chosen = pool.slice(0, Math.min(up + down, pool.length));
      chosen.forEach((uid, i) => {
        const value = i < up ? 1 : -1;
        const t = fmtTs(Math.min(NOW - 600000, a.createdMs + 3600000 + ri(6 * DAY)));
        insVote.run(uid, a.aid, value, t);
        bump("votes");
      });
    }

    // ---------------- comments (500+，含两级) ----------------
    const insComment = db.prepare(
      "INSERT INTO comments (answer_id, author_id, parent_id, content, is_deleted, created_at) VALUES (?, ?, ?, ?, 0, ?)"
    );
    // 按热度加权分配评论
    const weights = answerPlan.map((a) => 1 + (a.targetUp || 0) * 1.5 + (a.targetDown || 0));
    const totalW = weights.reduce((x, y) => x + y, 0);
    const commentTimes = new Map();
    for (let i = 0; i < N_COMMENTS; i++) {
      let r = g() * totalW;
      let pickIdx = 0;
      for (let j = 0; j < weights.length; j++) {
        r -= weights[j];
        if (r <= 0) {
          pickIdx = j;
          break;
        }
      }
      const a = answerPlan[pickIdx];
      const existing = commentTimes.get(a.aid) || [];
      const author = userIds[ri(N_USERS)];
      const isReply = existing.length > 0 && g() < 0.34;
      let parentId = null;
      if (isReply) {
        const parents = existing.filter((c) => c.parentId === null);
        if (parents.length) parentId = parents[ri(parents.length)].id;
      }
      const text = parentId ? pick(REPLIES) : pick(COMMENTS);
      const t = Math.min(NOW - 300000, a.createdMs + 1800000 + ri(9 * DAY));
      const info = insComment.run(a.aid, author, parentId, text, fmtTs(t));
      const cid = Number(info.lastInsertRowid);
      existing.push({ id: cid, parentId });
      commentTimes.set(a.aid, existing);
      bump("comments");
    }
    // 少量软删除样本
    const del = db.prepare("UPDATE comments SET is_deleted = 1 WHERE id = ?");
    for (let i = 0; i < Math.max(1, Math.round(6 * S)); i++) {
      const c = db.prepare("SELECT id FROM comments ORDER BY id LIMIT 1 OFFSET ?").get(ri(Math.max(1, N_COMMENTS)));
      if (c) del.run(c.id);
    }

    // ---------------- reports / mod_logs（会改 is_collapsed / is_deleted） ----------------
    const insReport = db.prepare(
      `INSERT INTO reports (reporter_id, target_type, target_id, reason, detail, status, handled_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insModLog = db.prepare(
      "INSERT INTO mod_logs (admin_id, action, target_type, target_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const reasons = ["spam", "harassment", "misinformation", "plagiarism", "other"];
    const statuses = ["pending", "rejected", "removed", "collapsed"];
    for (let i = 0; i < N_REPORTS; i++) {
      const target = answerPlan[ri(answerPlan.length)];
      const status = pick(statuses);
      const reason = pick(reasons);
      const reporter = userIds[1 + ri(Math.max(1, N_USERS - 1))];
      const handled = status === "pending" ? null : adminId;
      const t = fmtTs(Math.min(NOW - 600000, target.createdMs + 2 * DAY + ri(10 * DAY)));
      const info = insReport.run(
        reporter,
        "answer",
        target.aid,
        reason,
        "内容与问题无关，且有明显引流嫌疑。" ,
        status,
        handled,
        t
      );
      bump("reports");
      if (status === "collapsed") {
        db.prepare("UPDATE answers SET is_collapsed = 1 WHERE id = ?").run(target.aid);
        insModLog.run(adminId, "collapse_answer", "answer", target.aid, "多名用户举报，标记为争议内容", t);
        bump("mod_logs");
      } else if (status === "removed") {
        db.prepare("UPDATE answers SET is_deleted = 1 WHERE id = ?").run(target.aid);
        insModLog.run(adminId, "remove_answer", "answer", target.aid, "确认为垃圾内容，已删除", t);
        bump("mod_logs");
      } else if (status === "rejected") {
        insModLog.run(adminId, "reject_report", "report", Number(info.lastInsertRowid), "证据不足，驳回举报", t);
        bump("mod_logs");
      }
    }

    // ---------------- follows ----------------
    const insFollow = db.prepare(
      "INSERT OR IGNORE INTO follows (follower_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?)"
    );
    for (let ui = 0; ui < N_USERS; ui++) {
      const uid = userIds[ui];
      // 关注用户
      const others = shuffle(userIds.filter((u) => u !== uid));
      const nUsers = 2 + ri(Math.min(8, Math.max(1, N_USERS - 1)));
      for (let k = 0; k < Math.min(nUsers, others.length); k++) {
        insFollow.run(uid, "user", others[k], fmtTs(at(0.1 + g() * 0.8)));
        bump("follows");
      }
      // 关注话题（偏向自己的擅长领域）
      const tPool = shuffle(topicIds);
      const nTopics = 2 + ri(Math.min(7, topicIds.length));
      for (let k = 0; k < nTopics && k < tPool.length; k++) {
        insFollow.run(uid, "topic", tPool[k].id, fmtTs(at(0.1 + g() * 0.8)));
        bump("follows");
      }
      // 关注问题
      const qPool = shuffle(questionPlan);
      const nQ = 3 + ri(Math.min(10, questionPlan.length));
      for (let k = 0; k < nQ && k < qPool.length; k++) {
        insFollow.run(uid, "question", qPool[k].qid, fmtTs(at(0.2 + g() * 0.7)));
        bump("follows");
      }
    }

    // ---------------- collections ----------------
    const insCollection = db.prepare(
      "INSERT INTO collections (owner_id, name, is_public, created_at) VALUES (?, ?, ?, ?)"
    );
    const insItem = db.prepare(
      "INSERT OR IGNORE INTO collection_items (collection_id, answer_id, created_at) VALUES (?, ?, ?)"
    );
    const collectionNames = ["值得重读", "干活用的笔记", "慢慢看", "方法论收集", "留给孩子看", "周末读"];
    for (let ui = 0; ui < N_USERS; ui += 4) {
      const nCol = 1 + ri(2);
      for (let k = 0; k < nCol; k++) {
        const owner = userIds[ui];
        const info = insCollection.run(
          owner,
          collectionNames[(ui + k) % collectionNames.length],
          g() < 0.75 ? 1 : 0,
          fmtTs(at(0.3 + g() * 0.6))
        );
        const cid = Number(info.lastInsertRowid);
        bump("collections");
        const picks = shuffle(answerPlan).slice(0, 3 + ri(7));
        for (const a of picks) {
          insItem.run(cid, a.aid, fmtTs(Math.min(NOW - 600000, a.createdMs + 86400000)));
          bump("collection_items");
        }
      }
    }

    // ---------------- notifications ----------------
    const insNotif = db.prepare(
      `INSERT INTO notifications (user_id, type, actor_id, target_type, target_id, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const events = [];
    for (const a of answerPlan) {
      const q = questionPlan.find((x) => x.qid === a.qid);
      if (q && q.authorIdx !== undefined && userIds[q.authorIdx] !== a.authorId) {
        events.push({ user_id: userIds[q.authorIdx], type: "answer", actor: a.authorId, tt: "answer", tid: a.aid, t: a.createdMs });
      }
      const cs = commentTimes.get(a.aid) || [];
      for (const c of cs.slice(0, 3)) {
        events.push({ user_id: a.authorId, type: c.parentId ? "reply" : "comment", actor: userIds[ri(N_USERS)], tt: "answer", tid: a.aid, t: a.createdMs + 3600000 });
      }
      if ((a.targetUp || 0) > 6) {
        events.push({ user_id: a.authorId, type: "vote", actor: userIds[ri(N_USERS)], tt: "answer", tid: a.aid, t: a.createdMs + 7200000 });
      }
      if (a.aid % 41 === 0) {
        events.push({ user_id: a.authorId, type: "moderation", actor: adminId, tt: "answer", tid: a.aid, t: a.createdMs + 86400000 });
      }
    }
    for (let i = 0; i < Math.min(N_USERS, 10); i++) {
      events.push({
        user_id: userIds[i],
        type: "follow",
        actor: userIds[(i + 3) % N_USERS],
        tt: "user",
        tid: userIds[i],
        t: NOW - ri(20 * DAY),
      });
    }
    // 各类型都保证有样本：按类型分组后轮流取
    const byType = new Map();
    for (const ev of shuffle(events)) {
      if (!byType.has(ev.type)) byType.set(ev.type, []);
      byType.get(ev.type).push(ev);
    }
    const typeQueues = [...byType.values()];
    const pickedEvents = [];
    let round = 0;
    while (pickedEvents.length < N_NOTIF) {
      let added = false;
      for (const q of typeQueues) {
        if (pickedEvents.length >= N_NOTIF) break;
        if (q[round]) {
          pickedEvents.push(q[round]);
          added = true;
        }
      }
      if (!added) break;
      round++;
    }

    for (const ev of pickedEvents) {
      insNotif.run(
        ev.user_id,
        ev.type,
        ev.actor,
        ev.tt,
        ev.tid,
        g() < 0.55 ? 1 : 0,
        fmtTs(Math.max(T_START + 3600000, Math.min(NOW - 60000, ev.t)))
      );
      bump("notifications");
    }

    // ---------------- 计数回填（全部由真实行聚合） ----------------
    db.prepare(
      `UPDATE answers SET
         vote_up = (SELECT COUNT(*) FROM votes v WHERE v.answer_id = answers.id AND v.value = 1),
         vote_down = (SELECT COUNT(*) FROM votes v WHERE v.answer_id = answers.id AND v.value = -1),
         comment_count = (SELECT COUNT(*) FROM comments c WHERE c.answer_id = answers.id AND c.is_deleted = 0)`
    ).run();

    db.prepare(
      `UPDATE questions SET
         answer_count = (SELECT COUNT(*) FROM answers a WHERE a.question_id = questions.id AND a.is_deleted = 0),
         follower_count = (SELECT COUNT(*) FROM follows f WHERE f.target_type = 'question' AND f.target_id = questions.id),
         view_count = 120
           + (SELECT COUNT(*) FROM answers a WHERE a.question_id = questions.id AND a.is_deleted = 0) * 420
           + (SELECT COALESCE(SUM(a.vote_up + a.vote_down), 0) FROM answers a WHERE a.question_id = questions.id) * 96
           + (questions.id * 137) % 600`
    ).run();

    db.prepare(
      `UPDATE questions SET updated_at = COALESCE(
         (SELECT MAX(a.updated_at) FROM answers a WHERE a.question_id = questions.id AND a.is_deleted = 0),
         questions.created_at)`
    ).run();

    db.prepare(
      `UPDATE topics SET follower_count =
         (SELECT COUNT(*) FROM follows f WHERE f.target_type = 'topic' AND f.target_id = topics.id)`
    ).run();

    // 盐值 = 获赞*2 + 该问题下最高赞*5 - 被折叠*10；等级按区间映射
    db.prepare(
      `UPDATE users SET
         salt_value = MAX(0,
           2 * (SELECT COALESCE(SUM(a.vote_up), 0) FROM answers a WHERE a.author_id = users.id AND a.is_deleted = 0)
           + 5 * (SELECT COUNT(*) FROM answers a
                  WHERE a.author_id = users.id AND a.is_deleted = 0
                    AND a.vote_up = (SELECT MAX(b.vote_up) FROM answers b
                                     WHERE b.question_id = a.question_id AND b.is_deleted = 0)
                    AND a.vote_up > 0)
           - 10 * (SELECT COUNT(*) FROM answers a WHERE a.author_id = users.id AND a.is_collapsed = 1)
         )`
    ).run();
    db.prepare(
      `UPDATE users SET level = CASE
         WHEN salt_value >= 300 THEN 7
         WHEN salt_value >= 200 THEN 6
         WHEN salt_value >= 130 THEN 5
         WHEN salt_value >= 80  THEN 4
         WHEN salt_value >= 40  THEN 3
         WHEN salt_value >= 15  THEN 2
         ELSE 1 END`
    ).run();

    // ---------------- badges ----------------
    const insBadge = db.prepare("INSERT INTO badges (user_id, code, granted_at) VALUES (?, ?, ?)");
    const perUserAnswers = db
      .prepare(
        `SELECT author_id, COUNT(*) c, SUM(vote_up) up, MAX(vote_up) top
         FROM answers WHERE is_deleted = 0 GROUP BY author_id`
      )
      .all();
    for (const row of perUserAnswers) {
      const t = fmtTs(at(0.6 + g() * 0.3));
      const grant = (code) => {
        insBadge.run(row.author_id, code, t);
        bump("badges");
      };
      if (row.c >= 1) grant("first_answer");
      if (row.c >= 3) grant("answers_3");
      if (row.c >= 8) grant("answers_8");
      if ((row.up || 0) >= 10) grant("votes_10");
      if ((row.up || 0) >= 30) grant("votes_30");
      if ((row.top || 0) >= 12) grant("popular_answer");
    }
    const qAuthors = db.prepare("SELECT author_id, COUNT(*) c FROM questions GROUP BY author_id").all();
    for (const row of qAuthors) {
      insBadge.run(row.author_id, "first_question", fmtTs(at(0.5)));
      bump("badges");
    }
    if (adminId) {
      insBadge.run(adminId, "steward", fmtTs(at(0.95)));
      bump("badges");
    }

    counts.admin_email = "admin@zhihucopy.dev";
    counts.demo_password = "zhihu123456";
  });

  tx();

  // ---------------- 统计 ----------------
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE 'answer_fts_%'
         AND name <> 'answer_fts'
       ORDER BY name`
    )
    .all()
    .map((r) => r.name);

  let total = 0;
  const rows = tables.map((t) => {
    const c = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
    total += c;
    return [t, c];
  });

  const fts = db.prepare("SELECT COUNT(*) c FROM answer_fts").get().c;
  const lv = db.prepare("SELECT level, COUNT(*) c FROM users GROUP BY level ORDER BY level").all();
  const sample = db
    .prepare("SELECT id, content_md FROM answers ORDER BY id LIMIT 3")
    .all()
    .map((r) => ({ id: r.id, cn_len: cnLen(r.content_md) }));

  const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;

  console.log("");
  console.log(`seed 完成  scale=${S}  db=${path.resolve(db.name)}`);
  console.log("-".repeat(34));
  for (const [t, c] of rows) {
    console.log(`  ${t.padEnd(16, " ")} ${String(c).padStart(6, " ")}`);
  }
  console.log(`  ${"answer_fts".padEnd(16, " ")} ${String(fts).padStart(6, " ")}`);
  console.log("-".repeat(34));
  console.log(`  合计 ${total} 行，耗时 ${ms.toFixed(0)} ms`);
  console.log(`  等级分布: ${lv.map((r) => `Lv${r.level}×${r.c}`).join("  ")}`);
  console.log(`  回答长度抽样: ${sample.map((s) => `#${s.id}=${s.cn_len}字`).join("  ")}`);
  console.log("");

  db.close();
  // 显式退出：避免 better-sqlite3 在部分 Node 版本上退出时的 abort
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { TOPICS, USERS, COMMENTS, REPLIES, STORIES, clearAll };
