const express = require("express");
const { getDb } = require("../db");
const { parsePage, pageResult } = require("../util");
const { questionRow, SPAM_TITLE_RE } = require("./questions");

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

// GET /search?q=&page=&limit=&type=question — 按关键词搜问题（标题/详情子串匹配）。
// 说明：库内 FTS5 仅有 answer_fts（索引回答，缺答案的问题无法命中），且不得改表结构，
// 故问题检索用 LIKE。TODO: type=answer|user|topic 分类检索。
router.get("/", (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 100);
  const { page, limit, offset } = parsePage(req);
  const type = String(req.query.type || "question");
  if (!q || type !== "question") {
    return res.json(pageResult([], 0, page, limit));
  }
  const pat = likePattern(q);
  const db = getDb();
  const where = `NOT ${SPAM_TITLE_RE} AND (q.title LIKE ? ESCAPE '\\' OR q.detail_md LIKE ? ESCAPE '\\')`;
  const items = db
    .prepare(
      `SELECT q.*, ${AUTHOR_COLS} FROM questions q
       JOIN users u ON u.id = q.author_id
       WHERE ${where}
       ORDER BY (q.title LIKE ? ESCAPE '\\') DESC, q.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(pat, pat, pat, limit, offset)
    .map((row) => ({ ...questionRow(row), snippet: snippet(row.detail_md, q) }));
  const total = db.prepare(`SELECT COUNT(*) c FROM questions q WHERE ${where}`).get(pat, pat).c;
  res.json(pageResult(items, total, page, limit));
});

module.exports = router;
