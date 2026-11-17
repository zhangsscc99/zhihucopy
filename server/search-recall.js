// search-recall.js — 搜索召回词组规划（Z1144）。
//
// 背景：旧检索把整串 query 当一个子串 LIKE，中文长查询召回极窄
// （「代码质量」只命中含完整串的 2 题，库内相关题远多于此）。
// 本模块把「有效词条」折算成 OR 召回词组，路由侧按词组拼 LIKE：
//
//   · 查询含空白：按空白分词，每词取有效术语；≥2 字符或单个汉字才算有效词。
//     ≥2 个有效词 → 多词 OR 召回；恰好 1 个 → 该词单条子串匹配；0 个 → too_short。
//   · 不含空白且有效词条含 ≥2 个汉字：切成「连续汉字段 bigram + 非汉字段整词」
//     （代码质量 → 代码/码质/质量）；≥2 个词 → 多词 OR 召回，命中词数越多越前。
//   · 其余（单字、纯英文、单 token）：single —— 保持原子串 LIKE 现行为，
//     绝不放宽成「任意 1 字符 LIKE 全站」。
//
// 词组上限 MAX_RECALL_TERMS（防 SQL 膨胀）；超出时首尾必含、均匀取样，
// 长查询的头尾都保留召回面。

const HAS_HAN = /\p{Script=Han}/u;
const HAN_RUN = /\p{Script=Han}+|[^\p{Script=Han}]+/gu;
const HAN_ANY = /\p{Script=Han}/gu;

const MAX_RECALL_TERMS = 6;

// 与 routes/search.js 的 effectiveTerm 同口径：剔除标点/空白/符号后的有效词条。
function effectiveTerm(q) {
  return String(q || "").replace(/[^\p{L}\p{N}]+/gu, "");
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const t of list) {
    const k = t.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}

// 词组数超上限时均匀取 MAX_RECALL_TERMS 个（首/尾必含）。
function capTerms(list) {
  if (list.length <= MAX_RECALL_TERMS) return list;
  const out = [];
  for (let i = 0; i < MAX_RECALL_TERMS; i++) {
    out.push(list[Math.round((i * (list.length - 1)) / (MAX_RECALL_TERMS - 1))]);
  }
  return dedupe(out);
}

// 有效词条 → bigram/整词词组：汉字连续段长 ≥2 逐位出 bigram、单字汉字单独成词；
// 非汉字段（拉丁/数字）≥2 字符才算整词，1 字符拉丁段命中面太大，丢弃。
function bigramTerms(term) {
  const parts = [];
  for (const m of term.matchAll(HAN_RUN)) {
    const s = m[0];
    if (HAS_HAN.test(s[0])) {
      const chars = Array.from(s);
      if (chars.length === 1) parts.push(s);
      else
        for (let i = 0; i + 1 < chars.length; i++)
          parts.push(chars[i] + chars[i + 1]);
    } else if (s.length >= 2) {
      parts.push(s);
    }
  }
  return parts;
}

// 空格分词：每词取有效术语，≥2 字符或单个汉字保留。
function spacedTerms(q) {
  return dedupe(
    String(q)
      .split(/\s+/)
      .map((t) => effectiveTerm(t))
      .filter((t) => t.length >= 2 || (t.length === 1 && HAS_HAN.test(t)))
  );
}

// 入口：q 为已 trim 的原始 query，term = effectiveTerm(q)（调用方已判非空）。
// 返回 { kind: "none" }                —— 有效词全被过滤，按 too_short 处理；
//      { kind: "single", word }        —— 单子串 LIKE（word 为待匹配文本）；
//      { kind: "terms", terms: [...] } —— 多词 OR 召回（≤ MAX_RECALL_TERMS）。
function recallPlan(q, term) {
  if (/\s/.test(q)) {
    const toks = spacedTerms(q);
    if (toks.length >= 2) return { kind: "terms", terms: capTerms(toks) };
    if (toks.length === 1) return { kind: "single", word: toks[0] };
    return { kind: "none" };
  }
  const hanCount = (term.match(HAN_ANY) || []).length;
  if (hanCount >= 2) {
    const terms = dedupe(bigramTerms(term));
    if (terms.length >= 2) return { kind: "terms", terms: capTerms(terms) };
  }
  return { kind: "single", word: q };
}

module.exports = { recallPlan, effectiveTerm, MAX_RECALL_TERMS };
