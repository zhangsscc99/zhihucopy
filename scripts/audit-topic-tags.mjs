#!/usr/bin/env node
// scripts/audit-topic-tags.mjs — Z1140 话题归属审计与错标修正。
//
// 背景（第三十四轮走查）：种子数据给每题挂了 2–3 个话题标签，通常只有一个
// 是准的。例如 topic 2「JavaScript」里混着 Python 工程化（q9）、接私活（q20）、
// Python 爬虫（q21）、Python GIL（q23）、Redis 选型（q27）；topic 5「数据库」里
// 混着 event loop（q4）、Code Review 冲突（q17）、pandas 性能（q24）。
//
// 判据（刻意不做「未命中就全删」）：
//   - 每题至少应保留一个最贴近的话题；
//   - 标签在「题目标题 + detail_md」里未命中该话题任何关键词 → 记为「可疑」；
//   - --apply 只删「可疑且同题另有命中标签」的行；某题所有标签都未命中时一行
//     不删，单独列入「无替代，需人工判断」报告（多半是关键词表还不够全，先收集，
//     不造成「题没有话题」）。
//
// 关键词表（TOPIC_KEYWORDS）：每话题 ≥6 词；英文别名小写归一、按词边界匹配
// （避免 robots.txt 误中 "ts" 这类短词）；中文按子串匹配。允许按生产库真实题目
// 补词，但不许加成万能词（例如不给 JavaScript 加「项目」「性能」）。
//
// 用法：
//   node scripts/audit-topic-tags.mjs [--db <path>]   # dry-run 完整报告，恒退出 0
//   node scripts/audit-topic-tags.mjs --check          # CI：全站可疑率 >10% → 退出 1
//   node scripts/audit-topic-tags.mjs --apply [--prod] # 真删错标（先备份、单事务、幂等）
//
// 安全：默认只读；--apply 前 db.backup() 到 <db目录>/backups/zhihu-<YYYYMMDD-HHmm>-topic-tags.db；
// 写生产库（/www/zhihucopy/data/zhihu.db）走 prod-write-gate：须 --apply --prod
// ZH_ALLOW_PROD_WRITE=1 且当日备份有效。只动 question_topics，不改表结构、
// 不改题目正文、不动回答/评论/关注。
//
// 供 scripts/assert/topic-attribution.mjs 复用：export TOPIC_KEYWORDS / auditDb。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(SCRIPT_DIR, "..");
const requireFromServer = createRequire(new URL("../server/package.json", import.meta.url));
const Database = requireFromServer("better-sqlite3");
const { resolveWriteMode } = createRequire(import.meta.url)(
  path.join(SCRIPT_DIR, "prod-write-gate.js")
);

// ---- 话题关键词表（按 topics.name 索引；英文小写、词边界匹配） ---------------
// 选词原则：只收「看到这个词基本能断定属于该话题」的词；不收「项目/性能/问题」
// 这类什么话题都能沾边的词。命不命中都会写进报告，便于复核判据。
export const TOPIC_KEYWORDS = {
  编程: [
    "编程", "写代码", "代码", "程序员", "单元测试", "重构", "技术方案",
    "基础架构", "后端", "code review", "review", "git", "rebase",
    "开源", "工程化", "脚本", "文档", "架构",
  ],
  JavaScript: [
    "javascript", "js", "react", "vue", "typescript", "node", "event loop",
    "promise", "this", "useeffect", "hooks", "redux", "async", "settimeout",
    "箭头函数",
  ],
  Python: [
    "python", "pandas", "gil", "flask", "django", "fastapi", "scrapy",
    "爬虫", "pip", "conda", "poetry", "虚拟环境", "脚本", "数据处理",
    "asyncio",
  ],
  前端开发: [
    "前端", "浏览器", "渲染", "css", "html", "组件", "react", "hooks",
    "h5", "移动端", "设计稿", "响应式", "redux", "seo", "ssr", "客户端",
    "useffect", "页面", "懒加载", "布局", "样式", "白屏",
  ],
  数据库: [
    "数据库", "索引", "事务", "慢查询", "sql", "mysql", "sqlite", "redis",
    "缓存", "持久化", "分库分表", "全文检索", "查询", "fts5", "mongodb",
    "回表", "explain", "aof",
  ],
  职场: [
    "职场", "同事", "领导", "晋升", "汇报", "向上管理", "团队", "公司",
    "工作", "大厂", "螺丝钉", "薪资", "跳槽", "功劳", "加班", "实习生",
    "离职", "辞职", "老板", "绩效", "裁员",
  ],
  职业规划: [
    "职业规划", "转行", "转型", "职业", "读研", "深造", "公务员", "国企",
    "产品经理", "五年", "发展方向", "副业", "路径", "职业生涯", "规划",
  ],
  面试: [
    "面试", "简历", "offer", "招聘", "面试官", "笔试", "求职", "技术面",
  ],
  生活: [
    "生活", "通勤", "租房", "独居", "合租", "室友", "居住", "开销",
    "日子", "有条理", "下班", "家务", "一个人", "做饭", "外卖",
  ],
  家居收纳: [
    "收纳", "整理", "收拾", "家居", "户型", "台面", "厨房", "空间",
    "动线", "物品", "收纳盒", "房间", "衣柜", "杂物",
  ],
  科学: [
    "科学", "科普", "研究", "证据", "可信", "结论", "实验", "可复现",
    "复现", "信度", "效度", "机制", "原理", "论文", "文献", "因果",
    "伪科学",
  ],
  统计学: [
    "统计", "p 值", "p值", "样本", "平均数", "平均", "相关性", "因果",
    "显著", "数据", "估算", "概率", "分布", "回归", "置信", "t 检验",
  ],
  心理学: [
    "心理", "拖延", "认知", "情绪", "动机", "机制", "内耗", "焦虑",
    "敏感", "人格", "疗法", "压力", "情商", "自尊", "讨好", "后悔",
    "反刍", "自律", "矫情",
  ],
  情绪管理: [
    "情绪", "焦虑", "内耗", "精神内耗", "脾气", "发火", "暴躁", "失眠",
    "压力", "失控", "后悔", "想太多", "反刍", "低落", "烦躁", "emo",
  ],
  人际关系: [
    "人际", "关系", "朋友", "社交", "沟通", "相处", "边界", "表达",
    "不满", "讨好", "友谊", "家人", "亲近", "情商", "礼貌", "室友",
  ],
  教育: [
    "教育", "孩子", "家长", "应试", "素质", "学校", "作业", "作文",
    "兴趣班", "老师", "成绩", "考试", "教学", "报班", "内卷", "小学",
    "中学", "辅导",
  ],
  学习方法: [
    "学习", "记忆", "复习", "阅读", "自学", "背单词", "间隔重复",
    "练习", "技能", "作文", "记住", "背书", "作业", "拖拉", "笔记",
  ],
  健康: [
    "健康", "身体", "体检", "运动", "久坐", "熬夜", "作息", "体重",
    "指标", "结节", "膝盖", "颈椎", "脂肪肝", "锻炼", "腰酸",
  ],
  睡眠: [
    "睡眠", "失眠", "入睡", "熬夜", "午睡", "早醒", "睡姿", "睡不着",
    "睡醒", "睡够", "褪黑素", "补觉", "小睡", "生物钟",
  ],
  理财: [
    "理财", "工资", "月薪", "记账", "基金", "股票", "定投", "通胀",
    "信用卡", "副业", "攒钱", "投资", "存款", "国债", "债务", "活期",
    "房贷",
  ],
};

// 纯拉丁词用词边界匹配（避免 "robots.txt" 误中 "ts"、"aof" 误中子串）；
// 含 CJK 的词走普通子串。
const LATIN_ONLY = /^[\x20-\x7e]+$/;
function keywordRegex(kw) {
  const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return LATIN_ONLY.test(kw)
    ? new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`, "i")
    : new RegExp(esc, "i");
}
const TOPIC_REGEX = Object.fromEntries(
  Object.entries(TOPIC_KEYWORDS).map(([name, kws]) => [
    name,
    kws.map((kw) => ({ kw, re: keywordRegex(kw.toLowerCase()) })),
  ])
);

// 返回该文本命中的关键词列表（原样大小写，保持报告可读）。
export function matchKeywords(text, topicName) {
  const kws = TOPIC_REGEX[topicName] || [];
  return kws.filter(({ re }) => re.test(text)).map(({ kw }) => kw);
}

/**
 * 审计一个打开的 Database：逐条 question_topics 行判定命中/可疑。
 * @returns {{
 *   rows: Array<{question_id:number, topic_id:number, topic:string, title:string,
 *                hits:string[], suspicious:boolean, deletable:boolean}>,
 *   deletions: Array<{question_id:number, topic_id:number, topic:string}>,
 *   unreplaceable: Array<{question_id:number, title:string, tags:string[]}>,
 *   byTopic: Record<string, {total:number, suspicious:number}>,
 *   site: {total:number, suspicious:number, rate:number}
 * }}
 */
export function auditDb(db) {
  const rows = db
    .prepare(
      `SELECT qt.question_id, qt.topic_id, t.name AS topic, q.title,
              (q.title || char(10) || q.detail_md) AS text
       FROM question_topics qt
       JOIN questions q ON q.id = qt.question_id
       JOIN topics t ON t.id = qt.topic_id
       ORDER BY qt.question_id, qt.topic_id`
    )
    .all()
    .map((r) => ({
      question_id: r.question_id,
      topic_id: r.topic_id,
      topic: r.topic,
      title: r.title,
      hits: matchKeywords(r.text, r.topic),
      suspicious: false,
      deletable: false,
    }));

  // 每题聚合：该题是否有「命中」的标签（= 更好替代）。
  const hasHit = new Map();
  for (const r of rows) {
    if (r.hits.length) hasHit.set(r.question_id, true);
    else if (!hasHit.has(r.question_id)) hasHit.set(r.question_id, false);
  }

  const unreplaceableMap = new Map();
  for (const r of rows) {
    r.suspicious = r.hits.length === 0;
    if (!r.suspicious) continue;
    if (hasHit.get(r.question_id)) {
      r.deletable = true;
    } else {
      if (!unreplaceableMap.has(r.question_id)) {
        unreplaceableMap.set(r.question_id, {
          question_id: r.question_id,
          title: r.title,
          tags: [],
        });
      }
      unreplaceableMap.get(r.question_id).tags.push(r.topic);
    }
  }

  const byTopic = {};
  for (const r of rows) {
    const b = (byTopic[r.topic] ||= { total: 0, suspicious: 0 });
    b.total += 1;
    if (r.suspicious) b.suspicious += 1;
  }
  const total = rows.length;
  const suspicious = rows.filter((r) => r.suspicious).length;

  return {
    rows,
    deletions: rows
      .filter((r) => r.deletable)
      .map(({ question_id, topic_id, topic }) => ({ question_id, topic_id, topic })),
    unreplaceable: [...unreplaceableMap.values()],
    byTopic,
    site: { total, suspicious, rate: total ? suspicious / total : 0 },
  };
}

// ---- CLI ----
function usage(rc = 0) {
  console.log(`用法: node scripts/audit-topic-tags.mjs [--db <path>|--db=<path>]
       [--check] [--apply] [--prod] [--dry-run] [--backup <path>]
  默认 dry-run：逐行打印 题号/标签/命中词/可疑原因，按话题汇总可疑率。
  --check：全站可疑率 >10% 时退出码 1（给 CI）。
  --apply：删除「可疑且有更好替代」的 question_topics 行；先备份、单事务、幂等。
  --prod ：目标是生产库时必须加，并配 ZH_ALLOW_PROD_WRITE=1。`);
  process.exit(rc);
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const argv = process.argv.slice(2);
  let dbArg = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (["--apply", "--prod", "--check", "--dry-run"].includes(a)) continue;
    if (a === "-h" || a === "--help") usage(0);
    if (a === "--db") dbArg = argv[++i];
    else if (a.startsWith("--db=")) dbArg = a.slice("--db=".length);
    else if (a === "--backup") i++; // 透传给 prod-write-gate
    else if (a.startsWith("--backup=")) { /* 同上 */ }
    else {
      console.error(`未知参数: ${a}`);
      usage(2);
    }
  }

  const DB_PATH = path.resolve(dbArg || process.env.DB_PATH || path.join(REPO, "data", "zhihu.db"));
  const APPLY = argv.includes("--apply") || process.env.FIX_ALLOW_PROD === "1";
  const CHECK = argv.includes("--check");

  if (!fs.existsSync(DB_PATH)) {
    console.error(`[abort] DB 不存在: ${DB_PATH}`);
    process.exit(2);
  }

  const pad = (n) => String(n).padStart(2, "0");
  const stamp = (d = new Date()) =>
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;

  const db = new Database(DB_PATH, APPLY ? {} : { readonly: true });
  const report = auditDb(db);
  const { site, byTopic } = report;

  // —— 明细：每题每标签一行 ——
  for (const r of report.rows) {
    const hit = r.hits.length ? `命中=${r.hits.join(",")}` : "未命中";
    const mark = r.suspicious ? (r.deletable ? "可疑→将删" : "可疑→无替代保留") : "正常";
    console.log(`q${r.question_id}\t${r.topic}\t${hit}\t${mark}`);
  }

  // —— 按话题汇总 ——
  console.log("\n按话题汇总（可疑/总数/可疑率）：");
  for (const [name, b] of Object.entries(byTopic).sort((a, b) => b[1].suspicious - a[1].suspicious)) {
    const rate = b.total ? ((b.suspicious / b.total) * 100).toFixed(1) : "0.0";
    console.log(`  ${name}: ${b.suspicious}/${b.total} = ${rate}%`);
  }
  console.log(
    `全站合计: ${site.suspicious}/${site.total} = ${(site.rate * 100).toFixed(1)}% 可疑`
  );

  if (report.unreplaceable.length) {
    console.log("\n无替代，需人工判断（一行不删）：");
    for (const u of report.unreplaceable) {
      console.log(`  q${u.question_id}「${u.title}」当前标签: ${u.tags.join(" / ")}`);
    }
  }

  if (!APPLY) {
    db.close();
    if (CHECK && site.rate > 0.1) {
      console.error(`[check] 全站可疑率 ${(site.rate * 100).toFixed(1)}% > 10%`);
      process.exit(1);
    }
    process.exit(0);
  }

  // —— apply：写前备份（先于 prod-write-gate，备份本身即满足「当日备份」闸项）——
  const backupDir = path.join(path.dirname(DB_PATH), "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `zhihu-${stamp()}-topic-tags.db`);
  await db.backup(backupPath);
  console.log(`[apply] 备份 -> ${backupPath}`);

  resolveWriteMode({ argv, env: process.env, dbPath: DB_PATH, scriptName: "audit-topic-tags", Database });

  const del = db.prepare("DELETE FROM question_topics WHERE question_id = ? AND topic_id = ?");
  let deleted = 0;
  const byTopicDel = {};
  db.transaction(() => {
    for (const d of report.deletions) {
      deleted += del.run(d.question_id, d.topic_id).changes;
      byTopicDel[d.topic] = (byTopicDel[d.topic] || 0) + 1;
    }
  })();

  console.log(`[apply] 删除 question_topics ${deleted} 行`);
  if (deleted) {
    console.log("[apply] 受影响话题:");
    for (const [name, n] of Object.entries(byTopicDel).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${name}: -${n}`);
    }
  }
  const left = db.prepare("SELECT COUNT(*) c FROM question_topics").get().c;
  console.log(`[apply] question_topics 剩余 ${left} 行；无替代保留 ${report.unreplaceable.length} 题`);
  db.close();
}
