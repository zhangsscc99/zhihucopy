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
 *                     昵称后的数字序号是 clone 后缀，查表前剥掉）
 *   BIO_DOMAIN_RULES  bio 关键词 -> 领域，给非种子用户兜底
 *   DOMAINS_BY_CAT    问题大类 -> 可接受的作者领域（同域 + 相邻域）
 *
 * 判定一律用「领域集合」：一个人可以跨界（白露 = 妈妈 + 设计师），
 * 命中条件是「作者领域集合 ∩ 该大类可接受域」非空。
 */
"use strict";

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

// 问题大类 -> 可接受的作者领域。同域在前，相邻域在后；
// 相邻关系取「真实社区里会出现的跨界」（HR 谈心理、会计算账式答生活、
// 统计背景答学习方法），但不放到「健身教练答 React」那种程度。
const DOMAINS_BY_CAT = {
  code: ["frontend", "backend", "data"],
  work: ["work", "money", "data", "backend"],
  life: ["life", "work", "money", "psy"],
  sci: ["sci", "data", "health", "psy"],
  psy: ["psy", "edu", "life", "work", "health"],
  edu: ["edu", "psy", "life", "work", "sci", "data"],
  health: ["health", "sci", "life", "psy"],
  money: ["money", "work", "data", "backend"],
};

// seed 里给 clone 昵称追加 `${i+1}` 数字后缀；剥掉后再查人设表。
function baseNickname(nickname) {
  return String(nickname || "").replace(/\d+$/, "");
}

function bioDomains(bio) {
  const out = new Set();
  const text = String(bio || "");
  for (const [re, domain] of BIO_DOMAIN_RULES) {
    if (re.test(text)) out.add(domain);
  }
  return out;
}

// 作者领域集合 = 人设表（昵称命中）∪ bio 关键词。都不命中返回空集合。
function domainsOf(nickname, bio) {
  const out = bioDomains(bio);
  const persona = PERSONA_DOMAINS[baseNickname(nickname)];
  if (persona) for (const d of persona) out.add(d);
  return out;
}

function acceptedDomains(cat) {
  return new Set(DOMAINS_BY_CAT[cat] || DOMAINS);
}

// 该作者写这个大类的问题是否「人设成立」。
function authorFitsCat(nickname, bio, cat) {
  const mine = domainsOf(nickname, bio);
  const ok = acceptedDomains(cat);
  for (const d of mine) if (ok.has(d)) return true;
  return false;
}

module.exports = {
  DOMAINS,
  PERSONA_DOMAINS,
  BIO_DOMAIN_RULES,
  DOMAINS_BY_CAT,
  baseNickname,
  bioDomains,
  domainsOf,
  acceptedDomains,
  authorFitsCat,
};
