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
 *   questions.answer_count / follower_count
 *   answers.vote_up / vote_down / comment_count
 *   topics.follower_count
 *   users.salt_value / level
 *   （view_count 例外：按分层画像直接写入目标值，见 TIER_PLAN）
 *
 * ---------------------------------------------------------------------------
 * 冷热分层（Z064）：层级由 story 在列表中的序号决定（确定性，不掷骰子），
 * 题目 i 的层级 = i < HOT ? hot : i < HOT+WARM ? warm : i < HOT+WARM+COOL ? cool : cold。
 * scale=1 时（Z982：N_QUESTIONS = STORIES.length，随语料扩充）：
 * hot 12 / warm 20 / cool 40 / cold 为剩余（当前语料 111 题 -> cold 39），
 * 回答数：cold 题只插 story 第 1 条；其余层取 story 全部回答（上限 5 条）。
 *
 * 调参入口（各区间均为闭区间，单位见注释）：
 *   TIER_PLAN.<tier>.n        该层题数（按 SEED_SCALE 线性缩放，cold 吃剩余）
 *   TIER_PLAN.<tier>.answers  每题回答数上限（cold=1，其余取 story 全部回答）
 *   TIER_PLAN.<tier>.age      created_at 距 NOW 的天数区间 [min,max]
 *   TIER_PLAN.<tier>.views    view_count 目标区间
 *   TIER_PLAN.<tier>.topUp    每题「最高赞回答」的 up 票数区间（受 N_USERS-1 上限截断）
 *   TIER_PLAN.<tier>.restUp   其余回答的 up 票数区间
 *   TIER_PLAN.<tier>.comments 每题评论数区间（跨该题各回答按票数加权分配）
 *
 * 回答作者人设（Z1097+Z1103）：作者只在「作者领域 ∩ 问题大类可接受域」
 * 里挑（见 scripts/persona-domains.js）。语料显式指定的 author 走同一套
 * 校验：不符即改派给同域作者（打印改派记录），确实没有同域作者可派时
 * 抛错并打印 detail。领域表缺人设定义会在加载期直接抛错。
 * ---------------------------------------------------------------------------
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
const { BADGES } = require("../server/badges");
// Z1097：种子用户人设领域（昵称->领域集合、大类->可接受域），
// 回答作者只在「作者领域 ∩ 问题大类可接受域」里挑，杜绝健身教练答 React。
const {
  PERSONA_DOMAINS,
  DOMAINS_BY_CAT,
  domainsOf,
} = require("./persona-domains");

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
const SPAN = 180 * DAY; // 整体时间跨度约 6 个月，cold 题落在 2-6 个月前
const T_START = NOW - SPAN;
const at = (frac) => {
  const f = Math.max(0, Math.min(0.9995, frac));
  return T_START + f * SPAN;
};
// 分层画像（见文件头注释）。数值为 scale=1 时的参数；age 单位为天。
const TIER_PLAN = {
  hot:  { n: 12, answers: 5, age: [0.04, 3],    views: [3000, 9000], topUp: [120, 235], restUp: [30, 110], comments: [15, 25] },
  warm: { n: 20, answers: 5, age: [14, 28],     views: [300, 900],   topUp: [20, 80],    restUp: [3, 18],   comments: [4, 8] },
  cool: { n: 40, answers: 5, age: [30, 90],     views: [60, 250],    topUp: [1, 15],     restUp: [0, 5],    comments: [1, 4] },
  cold: { n: 14, answers: 1, age: [60, 179],    views: [3, 40],      topUp: [0, 0],      restUp: [0, 0],    comments: [0, 1] },
};
// 题目序号 -> 层级（确定性）。cold 吃掉所有剩余题目，保证总数 = N_QUESTIONS。
function tierOf(i, nQuestions, s) {
  const hotN = Math.round(TIER_PLAN.hot.n * s);
  const warmN = Math.round(TIER_PLAN.warm.n * s);
  const coolN = Math.round(TIER_PLAN.cool.n * s);
  if (i < hotN) return "hot";
  if (i < hotN + warmN) return "warm";
  if (i < hotN + warmN + coolN) return "cool";
  return "cold";
}
const rr = ([lo, hi]) => lo + ri(Math.max(1, hi - lo + 1));

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
// Z1097：每个种子人设必须在领域表里有定义，否则派作者时退回随机。
for (const [nick] of USERS) {
  if (!PERSONA_DOMAINS[nick]) {
    throw new Error(`persona-domains: 种子用户「${nick}」缺领域定义`);
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

// ---------------------------------------------------------------------------
// 回答收尾补记池（Z1091）：每第 6 条回答追加一句「作者本人口吻」的补充，
// 模拟真实编辑痕迹。按问题大类分池（工程边界/职场条件/心理个体差异/生活自我
// 限定/科研证据强度/教育场景适配/健康谨慎/理财风险），每条 40-90 字。
// 规则：不与正文抢话的独立一句；禁止虚构评论区或读者互动；同一批生成内
// 按 cat 游标轮转，同一池内不重复。
// ---------------------------------------------------------------------------
const ANSWER_TAILS = {
  code: [
    "补一句边界：这套做法默认你能控制发布节奏，要是发版不归你管，先把灰度和回滚谈下来再谈优化。",
    "有个前提我忘了写：这些结论都是在业务量没翻倍的场景里跑出来的，真上了大流量还得重新压测。",
    "别照抄文里的参数和阈值，那些数字是我这台机器、这份数据上跑出来的，换环境先小流量验证。",
    "再啰嗦一句：监控还没配齐之前别上线新方案，真出了问题你连比旧方案好还是差都说不清。",
    "我漏说了一个前提：团队里得有人愿意接手维护这套东西，没人接的方案写得再漂亮也是负债。",
    "这套结构在单仓库里顺，拆成多仓库之后边界就得重新画，直接照搬会多出不少胶水代码。",
    "压测数据是我自己机器上跑出来的，你们环境不一样的话，先在预发环境复现一遍再上生产。",
    "最后一点，别把临时绕路的写法带进核心链路，我踩过两次，半年后没人记得它本来是临时的。",
    "上面说的复杂度评估只算了开发期的成本，运维期的账另算，别漏了半夜被叫醒的那部分。",
    "顺手补一个常见的坑：依赖升级之前先翻更新日志里的不兼容段，文档不会替你兜这个底。",
    "我这边的结论依赖一个隐藏条件：接口负责人就坐我旁边，沟通成本低，远程协作要另算。",
    "别误会我的意思，我不是说旧方案一无是处，是它在你们这个量级的收益已经盖不住维护成本了。",
    "还有一点别忘了：写代码的时间只占三成，剩下七成是说服别人，方案里把这部分预算留出来。",
    "补个实操细节：回滚脚本要先于功能上线准备好并且演练过，等出事再写就真的来不及了。",
    "我上面这个判断只适用于带强类型系统的项目，纯动态语言那边的坑是另一套分布，别混着用。",
    "忘了说一句，我列的工具链里有两项许可证限制，商用项目先让法务过一眼再引入比较稳。",
    "再强调一下顺序：先拆依赖再动结构，反过来做的话连编译这一关都过不去，更别提交评审了。",
    "以上数字都是中位数不是上限，你们的数据分布如果偏斜的话，先跑自己的样本再定阈值。",
  ],
  work: [
    "这套沟通方式在我现在的团队跑得很顺，换一个汇报链更长的组织，话术和节奏都得重新调。",
    "有一条我没展开写：直属上级不支持的话，下面所有动作都会变形，先确认这一层再谈执行。",
    "我的教训是方法再好也扛不住方向错，动手之前花半天跟相关的人对齐目标，比什么都值。",
    "补一个边界：我写的这些默认你所在的环境还是讲道理的，真遇上纯政治局先保自己再谈方法。",
    "以上都是顺利情况下的剧本，万一第一次就谈崩，别恋战，回去把筹码攒够了再来第二轮。",
    "忘了说时机这件事：绩效季和组织调整期说同一句话效果完全不同，动笔之前先看看日历。",
    "这套话术对平级沟通有用，对上汇报要砍掉一半细节，只留结论和风险，没人有耐心看过程。",
    "我自己的局限也交代一下：我一直在两百人以下的公司，更大组织的生存法则我没真练过。",
    "还有一句实话讲：方法能覆盖八成场景，剩下两成靠你对上级的了解，这个没人能替你想。",
    "别忘了留痕这个动作：口头谈完的东西回去发消息确认一遍，三个月后你会感谢今天的自己。",
    "这套打法见效是比较慢的，我前后用了快一年才扭转印象，指望一两次沟通翻盘不太现实。",
    "最后提醒一句：换工作解决不了所有问题，我自己带过来的毛病在新公司三个月就原形毕露。",
    "有一点因公司而异：有的上级只吃数据，有的上级只看态度，先摸清你对面那个人是哪种。",
  ],
  psy: [
    "个体差异比想象中大：同样一句话，对安全感足的人是安抚，对敏感的人可能就是压力，先看人再说。",
    "我写的只是我自己这类人的反应路径，你要是天生不太内耗，前半段的纠结可能根本不会发生。",
    "这类方法起效很慢，我自己两个多月才感到变化，一周没动静别急着否定，先检查是不是真在做。",
    "补个边界：如果是持续好几个月的严重状态，自助方法收益有限，找专业人士比硬扛划算。",
    "我的经验样本里不包含确诊的情况，已经影响到睡眠和工作的，先就医再回来谈自助方法。",
    "还有一点容易让人误会：觉察情绪不等于要消灭情绪，目标是反应慢一点，不是没有反应。",
    "情绪这东西没法打卡量化，我后来改成记反应速度而不是记心情好坏，这个口径可参考下。",
  ],
  life: [
    "我家是小户型加两个孩子，空间宽裕的话有些取舍根本不用做，按自家的底子挑着用就好。",
    "这些习惯我坚持了小半年才稳定，前期会觉得麻烦，别一上来全套照搬，先留两三样顺手的。",
    "成本我粗算过，月均多花两三百块，对价格敏感的话从最便宜的替换开始做，效果差得不多。",
    "补充下适用场景：我一个人做饭的时候这套流程很顺，家里有人搭手的版本我后来也调过。",
    "别忽略体力成本这件事：收纳做得再细，每天弯腰二十次取东西的话，两周就想拆了重来。",
    "我家老人的习惯和我差很多，同住的要把别人不按你的规则来这件事算进设计里，不然白搭。",
    "时间上我其实没省下多少，只是把零碎时间攒起来用了，本来就没这些碎片时间的别硬学。",
  ],
  sci: [
    "上面引的几项研究样本量都不算大，我更愿意把它们当成现有证据下的最优猜，而不是结论。",
    "有个混淆变量始终排不掉：愿意试这类方法的人本身就更自律，效果里有多少归方法不好说。",
    "想继续深挖的话，建议顺着综述的引用往下追原始数据，二手转述普遍会把效应量说得偏大一些。",
    "补一句谨慎的话：相关不等于因果听着像句套话，但这个领域里真栽在它上面的研究不少。",
    "我引用的文献只截止到去年为止，这个方向更新很快，更新的元分析出来之前别当定论用。",
    "对不同人群的外推要谨慎：多数研究样本是欧美大学生，搬到东亚场景效应量普遍会缩水。",
    "还有一点要说清：没有负面结果不代表不存在，可能只是没人发，发表偏倚在这行很严重。",
  ],
  edu: [
    "这套节奏是按低年级孩子的情况设计的，高年级或自学能力强的，可以把陪跑那段直接砍掉。",
    "我在家和在学校各试了一遍，差别主要在同伴环境，家里没有比较压力，进度可以放得更缓。",
    "别指望一套方法通吃所有科目，文科那套搬到数学上得重调，先在一门课上跑通了再扩展。",
    "每个孩子的耐受度差很多，我家这个能安静坐四十分钟，坐不住的先从十分钟起步，别硬来。",
    "老师那边最好提前打个招呼，家里这套和学校进度不一致的时候，孩子容易两头都顾不好。",
  ],
  health: [
    "我不是医生，这些只是我自己调作息的记录，已经有明确症状的先去挂号，别拿经验帖当诊断。",
    "每个人的底子差很多，我两周见效不代表你也行，先把咖啡因和睡前屏幕排掉再谈其他手段。",
    "运动那段我写得偏保守，有旧伤的朋友先做评估再加量，宁可慢一个月也别把旧伤练复发。",
    "补个提醒：这些改变是一起做的，单独拆出某一项有没有用我说不准，别当单变量实验看。",
    "体检报告里已经有异常指标的朋友，先拿给医生看一眼再执行，我这套东西是按健康人群写的。",
  ],
  money: [
    "我的本金和现金流跟大多数人不一样，比例别照抄，先按自己的情况把应急金留够再谈配置。",
    "上面没算税费和手续费，实操里这两块能吃掉一两个点的收益，下单之前先算清楚这笔账。",
    "这套策略在横盘和慢牛行情里好用，真遇到急跌拿不拿得住，取决于你之前有没有真亏过钱。",
    "别忽视流动性的约束：我敢长期拿是因为三年内用不到这笔钱，要用的钱放进来是另一回事。",
  ],
};

// 每大类一个确定性游标：起点取自 ri()（沿用全局种子流），之后轮转，
// 保证同批生成里同一大类不重复用同一句。
const tailCursor = new Map();
function pickTail(cat) {
  const pool = ANSWER_TAILS[cat] || ANSWER_TAILS.life;
  if (!tailCursor.has(cat)) tailCursor.set(cat, ri(pool.length));
  const i = tailCursor.get(cat);
  tailCursor.set(cat, (i + 1) % pool.length);
  return pool[i];
}

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
  // Z1013 后 badges 是定义表（catalog），授予记录在 user_badges；
  // badge_grants_legacy 是旧授予表的归档，三者都要清。
  "user_badges",
  "badge_grants_legacy",
  "question_votes",
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
  const existing = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name)
  );
  // 评论有自引用外键：先删子级
  if (existing.has("comments")) {
    db.prepare("DELETE FROM comments WHERE parent_id IS NOT NULL").run();
    db.prepare("DELETE FROM comments").run();
  }
  for (const table of CLEAR_ORDER) {
    if (existing.has(table)) db.prepare(`DELETE FROM ${table}`).run();
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

  // 用户规模要撑得起 hot 层单答 120-235 条真实 votes 行（votes 主键 user_id+answer_id，
  // 单答最多 N_USERS-1 票），scale=1 时取 240。
  const N_USERS = Math.max(6, Math.round(240 * S));
  const N_TOPICS = Math.max(4, Math.min(TOPICS.length, Math.round(20 * S)));
  // Z982：问题数跟随语料规模（seed-data 扩充后 scale=1 即全量 story），
  // 不再硬编码 60；SEED_SCALE<1 时按比例取语料前缀，依然确定性。
  const N_QUESTIONS = Math.max(6, Math.round(STORIES.length * S));
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
    // Z1097：用户领域 = PERSONA_DOMAINS(昵称) ∪ bio 关键词（见 persona-domains.js）。
    // clone 用户继承原型的领域，回答作者只在其中与问题大类相交的人里挑。
    const domainSetOf = (uIdx) => {
      const [nick, bio] = USERS[uIdx % USERS.length];
      return domainsOf(nick, bio);
    };
    const fitsCat = (uIdx, cat) => {
      const ok = DOMAINS_BY_CAT[cat];
      if (!ok) return true;
      for (const d of domainSetOf(uIdx)) if (ok.includes(d)) return true;
      return false;
    };

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
      const tier = tierOf(i, questionPlan.length, S);
      const tp = TIER_PLAN[tier];
      const authorIdx = ri(N_USERS);
      const detail = story.detail;
      // created_at 落在该层时间窗内（age 为距 NOW 的天数区间）
      const createdMs = NOW - (tp.age[0] + g() * (tp.age[1] - tp.age[0])) * DAY;
      const createdAt = fmtTs(Math.min(createdMs, NOW - 3600000));
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
      // 附加话题只取同大类，避免跨类误标（Z982 修复）
      const candidates = shuffle(topicIds.filter((t) => t.cat === cat && t.id !== topic.id));
      let picked = 0;
      for (const t of candidates) {
        if (picked >= extra) break;
        insQT.run(qid, t.id);
        picked++;
        bump("question_topics");
      }
      bump("question_topics");
      questionPlan[i] = {
        qid, cat, authorIdx, topicId: topic.id, story, tier,
        createdMs, viewTarget: rr(tp.views),
      };
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
    // 每题回答数按层级：cold 只取 story 第 1 条，其余层取 story 全部回答（cap=5）。
    for (let qi = 0; qi < questionPlan.length; qi++) {
      const q = questionPlan[qi];
      const cat = q.cat;
      const nAns = Math.min(q.story.answers.length, TIER_PLAN[q.tier].answers);
      // 作者不重复且不是提问者；story 显式指定作者（昵称）时优先用指定者，
      // 但显式作者同样要过领域校验（Z1103）：不符则改派给 preferred 池里
      // 的同域作者，没有同域作者可派时抛错。
      // 随机部分只在该问题大类可接受的领域里挑（Z1097），不够才退回全体。
      const preferred = userIds
        .map((id, idx) => ({ id, idx }))
        .filter((u) => fitsCat(u.idx, cat) && u.idx !== q.authorIdx);
      const fallback = userIds.map((id, idx) => ({ id, idx })).filter((u) => u.idx !== q.authorIdx);
      const pool = shuffle(preferred.length >= nAns ? preferred : fallback);
      const authors = [];
      let poolPos = 0;
      // 显式 author 错位时的同域改派：与随机派单同一套做法——
      // shuffle 后的 preferred 池顺序取用（不静默接受错位作者）。
      const reassignPool = shuffle(preferred);
      let reassignPos = 0;
      const pickSameDomain = () => {
        while (reassignPos < reassignPool.length) {
          const u = reassignPool[reassignPos++];
          if (!authors.includes(u.id)) return u.id;
        }
        return null;
      };
      for (let k = 0; k < nAns; k++) {
        let uid = null;
        const want = q.story.answers[k].author;
        if (want) {
          const wi = NICK_INDEX.get(want);
          if (wi !== undefined && wi < N_USERS && wi !== q.authorIdx && !authors.includes(userIds[wi])) {
            if (fitsCat(wi, cat)) {
              uid = userIds[wi];
            } else {
              uid = pickSameDomain();
              if (uid === null) {
                throw new Error(
                  `seed-data/${cat}.js: 「${q.story.title.slice(0, 24)}…」第 ${k + 1} 条回答 ` +
                    `显式作者「${want}」领域不符（${[...domainSetOf(wi)].join("+") || "∅"} ∩ ${cat} 可接受域 = ∅）` +
                    `且没有可改派的同域作者`
                );
              }
              console.log(
                `[seed] 「${q.story.title.slice(0, 24)}…」第 ${k + 1} 条回答：` +
                  `显式作者「${want}」领域不符 ${cat}，改派同域作者`
              );
              bump("answers_reassigned");
            }
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
        // 回答时间必须晚于提问时间：在问题创建后数小时~数天内落点，仍留在该层时间窗附近
        const createdMs = Math.min(
          NOW - 3600000,
          q.createdMs + (k + 1) * 4 * 3600000 + Math.floor(g() * 3 * DAY)
        );
        const createdAt = fmtTs(createdMs);
        const info = insAnswer.run(q.qid, authors[k], content, createdAt, createdAt);
        const aid = Number(info.lastInsertRowid);
        bump("answers");
        let finalCreated = createdAt;

        // 约 1/6 的回答有编辑记录：追加一句按大类挑的作者口吻补记（Z1091）
        if (answerSeq % 6 === 0) {
          const extra = `\n\n> ${pickTail(cat)}`;
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
    // 冷热分布：每题一个「高赞」回答取该层 topUp 区间，其余取 restUp 长尾。
    // 所有票数都是真实 votes 行；单答上限 = N_USERS - 1。
    const byQuestion = new Map();
    for (const a of answerPlan) {
      if (!byQuestion.has(a.qid)) byQuestion.set(a.qid, []);
      byQuestion.get(a.qid).push(a);
    }
    const tierByQid = new Map(questionPlan.map((q) => [q.qid, q.tier]));
    const votePlan = [];
    for (const [qid, list] of byQuestion) {
      const tp = TIER_PLAN[tierByQid.get(qid)];
      const maxV = N_USERS - 1;
      const hotIdx = ri(list.length);
      list.forEach((a, idx) => {
        const range = idx === hotIdx ? tp.topUp : tp.restUp;
        const up = Math.min(maxV, rr(range));
        const down = up > 0 && g() < 0.25 ? 1 + ri(Math.min(3, Math.floor(up / 10) + 1)) : 0;
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
      "INSERT INTO comments (target_type, target_id, author_id, parent_id, content, is_deleted, created_at) VALUES ('answer', ?, ?, ?, ?, 0, ?)"
    );
    // 按分层分配评论：每题预算取该层 comments 区间，再按回答票数加权摊到各回答。
    // scale=1 时预算合计约 9*20 + 15*6 + 22*2.5 + 14*0.5 ≈ 330。
    const commentTimes = new Map();
    const commentQueue = [];
    for (const q of questionPlan) {
      const list = byQuestion.get(q.qid) || [];
      if (!list.length) continue;
      const budget = Math.round(rr(TIER_PLAN[q.tier].comments) * S);
      const w = list.map((a) => 1 + (a.targetUp || 0) * 1.5 + (a.targetDown || 0));
      const wSum = w.reduce((x, y) => x + y, 0);
      for (let i = 0; i < budget; i++) {
        let r = g() * wSum;
        let pickIdx = 0;
        for (let j = 0; j < w.length; j++) {
          r -= w[j];
          if (r <= 0) {
            pickIdx = j;
            break;
          }
        }
        commentQueue.push(list[pickIdx]);
      }
    }
    for (const a of commentQueue) {
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
      const c = db.prepare("SELECT id FROM comments ORDER BY id LIMIT 1 OFFSET ?").get(ri(Math.max(1, commentQueue.length)));
      if (c) del.run(c.id);
    }

    // ---------------- reports / mod_logs（会改 is_collapsed / is_deleted） ----------------
    const insReport = db.prepare(
      `INSERT INTO reports (reporter_id, target_type, target_id, reason, detail, status, handled_by, handled_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insModLog = db.prepare(
      "INSERT INTO mod_logs (admin_id, action, target_type, target_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    );
    // reports 表约束：reason ∈ (spam|abuse|illegal|other)，status ∈ (pending|handled|rejected)。
    // handled 时随机选「折叠」或「删除」处置（对应 mod_log 动作不同）。
    const reasons = ["spam", "abuse", "illegal", "other"];
    const statuses = ["pending", "rejected", "handled", "handled"];
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
        status === "handled" ? t : null,
        t
      );
      bump("reports");
      if (status === "handled") {
        if (g() < 0.5) {
          db.prepare("UPDATE answers SET is_collapsed = 1 WHERE id = ?").run(target.aid);
          insModLog.run(adminId, "collapse_answer", "answer", target.aid, "多名用户举报，标记为争议内容", t);
        } else {
          db.prepare("UPDATE answers SET is_deleted = 1 WHERE id = ?").run(target.aid);
          insModLog.run(adminId, "remove_answer", "answer", target.aid, "确认为垃圾内容，已删除", t);
        }
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
         comment_count = (SELECT COUNT(*) FROM comments c WHERE c.target_type = 'answer' AND c.target_id = answers.id AND c.is_deleted = 0)`
    ).run();

    db.prepare(
      `UPDATE questions SET
         answer_count = (SELECT COUNT(*) FROM answers a WHERE a.question_id = questions.id AND a.is_deleted = 0),
         follower_count = (SELECT COUNT(*) FROM follows f WHERE f.target_type = 'question' AND f.target_id = questions.id)`
    ).run();

    // view_count 按分层画像直接写目标值（见 TIER_PLAN.views），制造真实冷热差
    const updView = db.prepare("UPDATE questions SET view_count = ? WHERE id = ?");
    for (const q of questionPlan) updView.run(q.viewTarget, q.qid);

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
    // Z1013 起 badges 是定义表、user_badges 存授予记录。定义直接复用
    // server/badges.js 的 BADGES（含 icon_svg/rule），授予也只写这些 code，
    // 保证 catalog 与运行时一致、icon_svg 非空。
    const insBadgeDef = db.prepare(
      "INSERT OR IGNORE INTO badges (code, name, description, icon_svg, rule) VALUES (?, ?, ?, ?, ?)"
    );
    for (const b of BADGES) insBadgeDef.run(b.code, b.name, b.description, b.icon_svg, b.event);
    const insBadge = db.prepare(
      "INSERT OR IGNORE INTO user_badges (user_id, badge_code, granted_at) VALUES (?, ?, ?)"
    );
    const perUserAnswers = db
      .prepare(
        `SELECT author_id, COUNT(*) c, SUM(vote_up) up
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
      if (row.c >= 5) grant("answer_5");
      if ((row.up || 0) >= 10) grant("upvote_10");
    }
    const qAuthors = db.prepare("SELECT author_id, COUNT(*) c FROM questions GROUP BY author_id").all();
    for (const row of qAuthors) {
      insBadge.run(row.author_id, "first_question", fmtTs(at(0.5)));
      bump("badges");
    }
    const followed = db
      .prepare("SELECT DISTINCT target_id uid FROM follows WHERE target_type = 'user'")
      .all();
    for (const row of followed) {
      insBadge.run(row.uid, "first_follower", fmtTs(at(0.7)));
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

module.exports = { TOPICS, USERS, COMMENTS, REPLIES, STORIES, ANSWER_TAILS, clearAll };
