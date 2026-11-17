// server/feed-diversity.js — 推荐流话题多样性重排（Z1114）
//
// 背景：/feed/recommended 原来纯按 created_at 倒序，最新一批题全是技术话题，
// 首屏 20 条里 14 条技术向 —— 首页像掘金不像知乎。本模块在内存里做一次
// 轻量配额重排（RSS/MMR 风格），不加依赖、不改表结构：
//
//   1) 大类配额：任一 category 在 limit 滑窗内占比 ≤ 50%
//      （frontend/backend/data/language 域合并记为 tech）；
//   2) 保底：非技术大类（life/psy/work/edu/health/money/sci）库存有货的，
//      首窗（前 limit 条）各至少 1 条，槽位均匀撒开；库存为 0 的进
//      guaranteed_missing，不许为此少返回条目；
//   3) 同题降权：话题已出现在前 5 条的题让位（软降权，无替代才破例），
//      且任何位置不允许同一 topic_id 三连（同样无替代才破例）。
//
// 可复现口径：候选全集按原序（created_at DESC, id DESC 全序）读入后整体
// 重排成同一序列，再按 offset/limit 切片 —— 重排是候选集的纯函数，同一
// page 多次请求结果一致。全量候选百题级，一次 SQL + 内存排序，无 N+1。
//
// 话题 -> 大类映射：复用 scripts/persona-domains.js 的 TOPIC_DOMAINS
// （话题 -> 可接受作者领域，域序即「主场在前」，Z1106 语义）。取话题域表
// 里第一个非技术域作为其展示大类，全技术域 = tech —— 对现有 20 个种子
// 话题逐一核对，与 seed.js TOPICS.cat 完全一致（code 并入 tech）。
//
// 注意：本文件位于 server/ 根目录（与 content-filter.js 同一约定），
// 不能放进 routes/ —— 该目录所有 .js 都会被 app.js 自动挂载成 router。

"use strict";

const { TOPIC_DOMAINS, bioDomains } = require("../scripts/persona-domains.js");

// 技术域合并为 tech；其余域名本身即大类名（与响应 categories 键一致）。
const TECH_DOMAINS = new Set(["frontend", "backend", "data", "language"]);
const NON_TECH_CATS = ["life", "psy", "work", "edu", "health", "money", "sci"];
const CATEGORIES = ["tech", ...NON_TECH_CATS];

// 话题名 -> 展示大类；话题未在 TOPIC_DOMAINS 覆盖（用户自建话题）返回 null。
function topicCategory(name) {
  const doms = TOPIC_DOMAINS[name];
  if (!doms) return null;
  for (const d of doms) if (!TECH_DOMAINS.has(d)) return d;
  return "tech";
}

// 问题 -> 大类：话题映射里第一个非 tech 类胜出（混挂时按非技术主场归位，
// 保证「Python+职业规划」计入 work 而不是被 tech 吸走）；全是 tech = tech；
// 话题全不识别/无话题时用作者 bio 域兜底（同一套领域口径）；仍不识别
// 归入 'other' —— 不参与保底、不进 categories 键，但仍受大类配额约束。
function questionCategory(topicNames, authorBio) {
  const cats = (topicNames || []).map(topicCategory).filter(Boolean);
  const nonTech = cats.find((c) => c !== "tech");
  if (nonTech) return nonTech;
  if (cats.length) return "tech";
  const doms = bioDomains(authorBio);
  for (const d of doms) {
    if (!TECH_DOMAINS.has(d)) return d;
  }
  return doms.size ? "tech" : "other";
}

function sharesTopic(a, b) {
  for (const t of a.topicIds) if (b.topicIds.has(t)) return true;
  return false;
}

// 放上它会形成同一 topic_id 三连（连续重复 > 2 次违反断言）。
function wouldTriple(out, item) {
  const n = out.length;
  return n >= 2 && sharesTopic(out[n - 1], item) && sharesTopic(out[n - 2], item);
}

// 从 pool 里挑下一条（pool 保持原始全序，首个合格者胜出 = 尽量保原序）。
// 逐级放宽：0 = 配额+防三连+前5话题降权；1 = 放开降权；2 = 再放防三连；
// 3 = 无规则兜底（库存只剩受配额约束的类时直接取最早项，不许少返回）。
function chooseNext(pool, out, limit) {
  const win = out.slice(Math.max(0, out.length - limit + 1));
  const counts = new Map();
  for (const x of win) counts.set(x.cat, (counts.get(x.cat) || 0) + 1);
  const first5Topics = new Set();
  for (const x of out.slice(0, 5)) for (const t of x.topicIds) first5Topics.add(t);
  const pos = out.length;

  for (let relax = 0; relax <= 3; relax++) {
    for (let i = 0; i < pool.length; i++) {
      const it = pool[i];
      if (relax < 3 && (counts.get(it.cat) || 0) + 1 > Math.ceil((win.length + 1) / 2)) {
        continue; // 大类配额：滑窗内单类占比封顶 50%
      }
      if (relax < 2 && wouldTriple(out, it)) continue;
      if (relax < 1 && pos < limit) {
        let seen = false;
        for (const t of it.topicIds) if (first5Topics.has(t)) { seen = true; break; }
        if (seen) continue; // 前 5 条已露过面的话题后移
      }
      return i;
    }
  }
  return 0; // 不可达（relax=3 无条件返回），防御兜底
}

// candidates：按原始全序排列的 [{ cat, topicIds:Set, ... }]。
// 返回 { items, missing }：items 是全量重排序列（调用方切片分页），
// missing 是库存里一条都没有的非技术大类（保底缺口，供 diversity 字段）。
function rerankRecommended(candidates, limit) {
  const pool = candidates.slice();
  const out = [];
  const placedCats = new Set();
  const present = new Set(pool.map((x) => x.cat));
  const needed = NON_TECH_CATS.filter((c) => present.has(c));
  const missing = NON_TECH_CATS.filter((c) => !present.has(c));

  // 保底槽位均匀撒进首窗（[0, limit) 内 (k+0.5)*limit/G 取整）；G>limit 或
  // 取整撞位时由下方「剩余槽位 ≤ 未保底类数」守卫兜底，不会丢保底。
  const slotOf = new Map();
  needed.forEach((c, k) => {
    const p = Math.min(limit - 1, Math.floor(((k + 0.5) * limit) / Math.max(needed.length, 1)));
    slotOf.set(p, c);
  });

  while (pool.length) {
    const pos = out.length;
    let pick = -1;
    if (pos < limit) {
      const unplaced = needed.filter((c) => !placedCats.has(c));
      const target = slotOf.get(pos);
      const cat =
        target && unplaced.includes(target)
          ? target
          : unplaced.length >= limit - pos
            ? unplaced[0]
            : null;
      if (cat) {
        // 保底挑选也避开三连；实在避不开才硬上（保底 > 降权）。
        pick = pool.findIndex((x) => x.cat === cat && !wouldTriple(out, x));
        if (pick < 0) pick = pool.findIndex((x) => x.cat === cat);
      }
    }
    if (pick < 0) pick = chooseNext(pool, out, limit);
    const it = pool.splice(pick, 1)[0];
    placedCats.add(it.cat);
    out.push(it);
  }
  return { items: out, missing };
}

// diversity 字段：对本页实际返回的 items 统计。categories 固定 8 键
// （'other' 计入 tech_ratio 分母但不进键）；guaranteed_missing 见上。
function summarizeDiversity(items, missing) {
  const categories = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  for (const it of items) {
    if (Object.prototype.hasOwnProperty.call(categories, it.cat)) categories[it.cat]++;
  }
  return {
    tech_ratio: items.length
      ? Number((categories.tech / items.length).toFixed(3))
      : 0,
    categories,
    guaranteed_missing: missing.slice(),
  };
}

module.exports = {
  CATEGORIES,
  NON_TECH_CATS,
  topicCategory,
  questionCategory,
  rerankRecommended,
  summarizeDiversity,
};
