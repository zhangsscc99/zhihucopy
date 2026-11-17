/**
 * scripts/persona-domains.js — 种子用户「人设领域」单一来源（Z1097）
 *
 * 背景：seed.js 原来按 `uIdx % 8` 给用户定大类，与 bio 人设无关，
 * 导致「健身教练答 React」「HR 答前端」式错位。本模块统一三处口径：
 *   - scripts/seed.js                          派回答作者时挑同域/相邻域用户
 *   - scripts/fix-answer-authors-by-domain.js  重排存量回答作者
 *   - scripts/assert/seed-persona-domain.mjs   验收断言（bio 领域 ∩ 问题大类）
 *
 * 数据结构：
 *   PERSONA_DOMAINS   昵称 -> 领域数组（权威表，覆盖 USERS 里全部种子人设；
 *                     旧库昵称后的数字序号是 clone 后缀，查表前剥掉）
 *   ALIAS_TO_BASE     真实感别名 -> 种子原型（Z1115：clone 用户改用
 *                     nickname-pool 的真实感别名，查表前先还原原型）
 *   BIO_DOMAIN_RULES  bio 关键词 -> 领域，给非种子用户兜底
 *   TOPIC_DOMAINS     话题名 -> 可接受的作者领域（Z1106：判定下沉到话题级）
 *   DOMAINS_BY_CAT    问题大类 -> 可接受的作者领域（话题未覆盖时的兜底；
 *                     断言要求兜底命中数 = 0，覆盖不全直接抛错）
 *
 * 判定一律用「领域集合」：一个人可以跨界（白露 = 妈妈 + 设计师），
 * 命中条件是「作者领域集合 ∩ 该题话题可接受域」非空。
 *
 * Z1106 背景：旧口径只看大类，code 可接受域含 data，于是「统计出身做增长
 * 的温故52 在 /question/6 教 React useEffect」被判命中（假绿）。话题级口径
 * 把 React/JavaScript/前端类话题的可接受域收紧到 frontend（最多一个真正
 * 相邻域，绝不含 data），数据库类才允许 data。
 */
"use strict";

// Z1115：clone 用户真实感别名表（scripts/nickname-pool.js），别名 -> 原型。
const { CLONE_ALIASES } = require("./nickname-pool");

const DOMAINS = [
  "frontend",
  "backend",
  "data",
  "work",
  "psy",
  "edu",
  "life",
  "sci",
  "health",
  "money",
];

// 与 seed.js USERS 一一对应。跨界人设给多个域（与 bio 自述一致）。
const PERSONA_DOMAINS = {
  陈默: ["backend"], // 写后端，也读点书。
  林间有风: ["frontend"], // 前端工程师，关注可访问性。
  阿澈: ["backend", "work"], // 在做一个很小的产品，什么都得自己来。
  半山腰: ["data"], // 数据分析师，喜欢把不确定说清楚。
  老周写代码: ["backend"], // 十年 CRUD，见过太多重写。
  苏晚: ["work"], // 产品经理，负责把话说清楚。
  不加班的周五: ["work"], // 努力不加班的运营。
  白露: ["life", "frontend"], // 两个孩子的妈妈，兼职做设计。
  何人在此: ["psy", "sci"], // 研究生在读，方向是认知科学。
  麦田守望: ["edu"], // 中学老师，教语文。
  南栀: ["work"], // 自由职业，做内容也做咨询。
  一叶知秋: ["work"], // 刚工作两年，什么都想学。
  周吴郑王: ["backend"], // 工程效率团队，专治流程。
  沈青: ["psy"], // 心理咨询方向，做科普不做诊断。
  顾言: ["backend"], // 写点技术笔记，偶尔翻译。
  小满: ["frontend", "backend"], // 在一家小公司做全栈。
  山月: ["life", "backend"], // 喜欢整理房间，也喜欢整理代码。
  陆离: ["backend", "money"], // 架构师，做过支付和风控。
  余光: ["work"], // HR，看简历看到眼花。
  程一: ["work"], // 创业者，第二次了。
  夏至未至: ["health"], // 护士，值夜班第七年。
  温故: ["data", "sci"], // 统计出身，现在做增长。
  青柠: ["frontend", "work"], // 产品设计师，专注阅读类产品。
  海边的卡夫卡: ["data"], // 白天写 SQL，晚上写小说。
  南山南: ["health"], // 健身教练，也带康复训练。
  拾光: ["life"], // 做纪录片，长期在外拍摄。
  阿罗: ["backend"], // 运维，负责不被叫醒。
  简宁: ["money"], // 会计，喜欢把账算明白。
  木子李: ["backend"], // 刚转行做测试，还在补基础。
  第五个季节: ["sci", "health"], // 在读博士，方向是流行病学。
};

// bio 关键词兜底：命中即把对应领域加入集合（并集，不是首个胜出）。
// 只放辨识度高的词；拿不准的宁缺毋滥（空集合 = 不可判定）。
const BIO_DOMAIN_RULES = [
  [/前端|可访问性|网页设计|视觉设计/, "frontend"],
  [/后端|全栈|CRUD|架构|运维|测试|技术|写代码|工程效率|代码|程序员|开发/, "backend"],
  [/数据分析|统计|增长|SQL|数据/, "data"],
  [/产品经理|产品|运营|HR|简历|创业|自由职业|工作|职场|汇报/, "work"],
  [/心理|认知|情绪|咨询|内耗/, "psy"],
  [/老师|教师|中学|语文|教学|孩子.*课|课堂/, "edu"],
  [/妈妈|孩子|整理房间|收纳|纪录片|拍摄|家务/, "life"],
  [/博士|研究生|流行病学|科学|科研|论文/, "sci"],
  [/健身|康复|护士|夜班|运动|作息|医生/, "health"],
  [/会计|算账|理财|支付|风控|本金|记账/, "money"],
];

// 话题名 -> 可接受的作者领域（Z1106 新增，判定主口径）。
// 覆盖 seed.js TOPICS 全部 20 个话题，须与生产库 topics 表保持一致；
// 新加话题时必须同步本表，否则断言按「兜底比例 > 0」抛错。
// 原则：前端类话题绝不含 data；Python/数据库允许 data（数据处理本就是
// Python 主场，DBA/数仓都是真实人设）；其余按语义归域，逐条注释。
const TOPIC_DOMAINS = {
  编程: ["frontend", "backend"], // 通用编程手艺：前后端工程师都算同行
  JavaScript: ["frontend", "backend"], // Node.js 让后端算相邻域；绝不含 data
  Python: ["backend", "data"], // 脚本+数据处理双主场：后端与数据分析都算同域
  前端开发: ["frontend"], // 纯前端域，不给相邻域
  数据库: ["backend", "data"], // 数据库类可含 data（DBA/数仓真实存在）
  职场: ["work", "money", "data", "backend"], // 职场通识：运营/财务/分析师/工程师都会谈
  职业规划: ["work", "money", "data", "backend"], // 转型路径：从业者视角都可谈
  面试: ["work", "money", "data", "backend", "frontend"], // HR 面 + 技术面（前端岗常见）
  生活: ["life", "work", "money", "psy"], // 过日子经验：生活/职场/算账/心理都能谈
  家居收纳: ["life", "work", "psy"], // 收纳是生活主场；工位整理、秩序感也算相邻
  科学: ["sci", "data", "health", "psy"], // 研究方法与证据：科研/数据/医学/心理都沾边
  统计学: ["data", "sci"], // 统计是数据人设主场，科研人同域
  心理学: ["psy", "edu", "life", "work", "health"], // 情绪动机：心理/教育/生活/医护视角
  情绪管理: ["psy", "edu", "life", "work", "health"], // 同心理学
  人际关系: ["psy", "edu", "life", "work"], // 沟通边界：心理/教育/生活/职场
  教育: ["edu", "psy", "life", "work", "sci", "data"], // 教学成长：老师/心理/家长/统计方法派
  学习方法: ["edu", "psy", "life", "work", "sci", "data"], // 自学路径：教育+认知+统计背景都可谈
  健康: ["health", "sci", "life", "psy"], // 身体维护：医护/科研/生活/心理
  睡眠: ["health", "sci", "life", "psy"], // 节律与作息：同健康
  理财: ["money", "work", "data", "backend"], // 记账配置：会计/职场/数据/风控工程师
};

// 问题大类 -> 可接受的作者领域。Z1106 起仅作「话题未覆盖时」的兜底，
// 断言要求兜底命中数 = 0（实际判定走 TOPIC_DOMAINS）。
// code 兜底已剔除 data（Z1106 假绿根因：温故[data,sci] 答 React 被判命中）。
const DOMAINS_BY_CAT = {
  code: ["frontend", "backend"],
  work: ["work", "money", "data", "backend"],
  life: ["life", "work", "money", "psy"],
  sci: ["sci", "data", "health", "psy"],
  psy: ["psy", "edu", "life", "work", "health"],
  edu: ["edu", "psy", "life", "work", "sci", "data"],
  health: ["health", "sci", "life", "psy"],
  money: ["money", "work", "data", "backend"],
};

// 旧版 seed 给 clone 昵称追加 `${i+1}` 数字后缀（存量库仍可能遇到）；
// 剥掉后再查人设表。Z1115 起新 clone 用真实感别名，走 ALIAS_TO_BASE 还原。
function baseNickname(nickname) {
  return String(nickname || "").replace(/\d+$/, "");
}

// Z1115：真实感别名 -> 种子原型（clone 第 N 轮用别名表第 N 项）。
// 别名表的键必须恰好是 PERSONA_DOMAINS 的种子原型集，否则加载即抛错——
// 人设来源唯一，不允许别名指向表外。
const ALIAS_TO_BASE = {};
for (const [base, list] of Object.entries(CLONE_ALIASES)) {
  if (!PERSONA_DOMAINS[base]) {
    throw new Error(`persona-domains: 别名表原型「${base}」不在 PERSONA_DOMAINS`);
  }
  for (const alias of list) ALIAS_TO_BASE[alias] = base;
}

// 昵称 -> 种子原型名（命中 PERSONA_DOMAINS 的键）；非种子/未知返回 null。
// 依次尝试：剥数字尾 -> 本名 -> 别名表还原。
function personaBaseOf(nickname) {
  const n = String(nickname || "");
  const stripped = baseNickname(n);
  if (PERSONA_DOMAINS[stripped]) return stripped;
  if (PERSONA_DOMAINS[n]) return n;
  return ALIAS_TO_BASE[n] || null;
}

function bioDomains(bio) {
  const out = new Set();
  const text = String(bio || "");
  for (const [re, domain] of BIO_DOMAIN_RULES) {
    if (re.test(text)) out.add(domain);
  }
  return out;
}

// 作者领域集合 = 人设表（昵称命中，含数字尾/真实感别名还原）∪ bio 关键词。
// 都不命中返回空集合。
function domainsOf(nickname, bio) {
  const out = bioDomains(bio);
  const base = personaBaseOf(nickname);
  if (base) for (const d of PERSONA_DOMAINS[base]) out.add(d);
  return out;
}

// 优先话题级：key 命中 TOPIC_DOMAINS（话题名）用话题域；
// 否则按大类兜底；都不认识返回全域（= 不可判定，调用方须另行计数）。
function acceptedDomains(key) {
  if (key && TOPIC_DOMAINS[key]) return new Set(TOPIC_DOMAINS[key]);
  if (key && DOMAINS_BY_CAT[key]) return new Set(DOMAINS_BY_CAT[key]);
  return new Set(DOMAINS);
}

function topicCovered(name) {
  return Object.prototype.hasOwnProperty.call(TOPIC_DOMAINS, name);
}

// 一道题的可接受域 = 其全部话题的可接受域并集。
// 话题在 TOPIC_DOMAINS 里走话题级；未覆盖的按大类兜底（viaCat 记录，
// 断言要求 viaCat 为空）；话题与大类都不认识进 unknown。
// catOf(name) -> 大类，由调用方提供（seed.TOPICS / DB topics 映射）。
function acceptedForTopics(topicNames, catOf) {
  const out = { domains: new Set(), viaTopic: [], viaCat: [], unknown: [] };
  for (const n of topicNames || []) {
    if (TOPIC_DOMAINS[n]) {
      for (const d of TOPIC_DOMAINS[n]) out.domains.add(d);
      out.viaTopic.push(n);
      continue;
    }
    const cat = catOf ? catOf(n) : null;
    if (cat && DOMAINS_BY_CAT[cat]) {
      for (const d of DOMAINS_BY_CAT[cat]) out.domains.add(d);
      out.viaCat.push(n);
    } else {
      out.unknown.push(n);
    }
  }
  return out;
}

// 该作者写这个大类的问题是否「人设成立」（大类兜底口径）。
function authorFitsCat(nickname, bio, cat) {
  const mine = domainsOf(nickname, bio);
  const ok = acceptedDomains(cat);
  for (const d of mine) if (ok.has(d)) return true;
  return false;
}

// 话题级口径：优先 TOPIC_DOMAINS[topicName]，未覆盖回退 cat。
function authorFitsTopic(nickname, bio, topicName, cat) {
  const mine = domainsOf(nickname, bio);
  const ok = topicName && TOPIC_DOMAINS[topicName]
    ? new Set(TOPIC_DOMAINS[topicName])
    : acceptedDomains(cat);
  for (const d of mine) if (ok.has(d)) return true;
  return false;
}

module.exports = {
  DOMAINS,
  PERSONA_DOMAINS,
  ALIAS_TO_BASE,
  BIO_DOMAIN_RULES,
  TOPIC_DOMAINS,
  DOMAINS_BY_CAT,
  baseNickname,
  personaBaseOf,
  bioDomains,
  domainsOf,
  acceptedDomains,
  topicCovered,
  acceptedForTopics,
  authorFitsCat,
  authorFitsTopic,
};
