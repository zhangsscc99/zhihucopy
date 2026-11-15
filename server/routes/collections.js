const express = require("express");
const { getDb } = require("../db");
const { requireAuth } = require("../auth");
const { badRequest } = require("../util");

const router = express.Router();

function getCollection(db, id) {
  return db.prepare("SELECT * FROM collections WHERE id = ?").get(id);
}

function canView(col, user) {
  return col.is_public || (user && user.id === col.owner_id);
}

// GET /mine — current user's collections with item counts.
router.get("/mine", requireAuth, (req, res) => {
  const db = getDb();
  const collections = db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.id) AS item_count
       FROM collections c WHERE c.owner_id = ? ORDER BY c.id DESC`
    )
    .all(req.user.id);
  res.json({ collections });
});

// POST / — create a collection. Body: { name, is_public? }
router.post("/", requireAuth, (req, res) => {
  const { name, is_public } = req.body || {};
  if (typeof name !== "string" || !name.trim() || name.trim().length > 50) {
    return badRequest(res, "收藏夹名称需要 1–50 个字符");
  }
  const isPublic = is_public === undefined ? 1 : is_public ? 1 : 0;
  const db = getDb();
  const info = db
    .prepare("INSERT INTO collections (owner_id, name, is_public) VALUES (?, ?, ?)")
    .run(req.user.id, name.trim(), isPublic);
  const collection = getCollection(db, info.lastInsertRowid);
  res.status(201).json({ collection });
});

// GET /:id — a single collection. Public: anyone; private: owner only.
router.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return badRequest(res, "id 必须是正整数");
  const db = getDb();
  const col = getCollection(db, id);
  if (!col) return res.status(404).json({ error: "收藏夹不存在" });
  if (!canView(col, req.user)) return res.status(404).json({ error: "收藏夹不存在" });
  const item_count = db
    .prepare("SELECT COUNT(*) AS n FROM collection_items WHERE collection_id = ?")
    .get(id).n;
  res.json({ collection: { ...col, item_count } });
});

// GET /:id/items — answers in the collection.
router.get("/:id/items", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return badRequest(res, "id 必须是正整数");
  const db = getDb();
  const col = getCollection(db, id);
  if (!col) return res.status(404).json({ error: "收藏夹不存在" });
  if (!canView(col, req.user)) return res.status(404).json({ error: "收藏夹不存在" });
  const items = db
    .prepare(
      `SELECT a.*, q.title AS question_title, u.nickname AS author_nickname, u.avatar_url AS author_avatar,
              ci.created_at AS collected_at
       FROM collection_items ci
       JOIN answers a ON a.id = ci.answer_id AND a.is_deleted = 0
       JOIN questions q ON q.id = a.question_id
       JOIN users u ON u.id = a.author_id
       WHERE ci.collection_id = ?
       ORDER BY ci.created_at DESC`
    )
    .all(id)
    .map((a) => ({
      id: a.id,
      answer_id: a.id,
      question_id: a.question_id,
      question_title: a.question_title,
      content_md: a.content_md,
      vote_up: a.vote_up,
      vote_down: a.vote_down,
      comment_count: a.comment_count,
      is_collapsed: a.is_collapsed,
      created_at: a.created_at,
      updated_at: a.updated_at,
      collected_at: a.collected_at,
      author: { id: a.author_id, nickname: a.author_nickname, avatar_url: a.author_avatar },
    }));
  res.json({ items });
});

// POST /:id/items — add an answer to the collection. Body: { answer_id } (or { question_id } to collect a question? not supported by schema).
router.post("/:id/items", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return badRequest(res, "id 必须是正整数");
  const { answer_id, question_id } = req.body || {};
  const answerId = Number(answer_id);
  if (!Number.isInteger(answerId) || answerId <= 0) {
    if (question_id !== undefined) return badRequest(res, "schema 仅支持收藏回答（answer_id）");
    return badRequest(res, "answer_id 必须是正整数");
  }
  const db = getDb();
  const col = getCollection(db, id);
  if (!col) return res.status(404).json({ error: "收藏夹不存在" });
  if (col.owner_id !== req.user.id) return res.status(403).json({ error: "只能修改自己的收藏夹" });
  const answer = db.prepare("SELECT id FROM answers WHERE id = ? AND is_deleted = 0").get(answerId);
  if (!answer) return res.status(404).json({ error: "回答不存在" });
  const info = db
    .prepare("INSERT OR IGNORE INTO collection_items (collection_id, answer_id) VALUES (?, ?)")
    .run(id, answerId);
  res.status(info.changes ? 201 : 200).json({ ok: true });
});

// DELETE /:id/items/:answerId — remove an answer from the collection.
router.delete("/:id/items/:answerId", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const answerId = Number(req.params.answerId);
  if (!Number.isInteger(id) || id <= 0) return badRequest(res, "id 必须是正整数");
  if (!Number.isInteger(answerId) || answerId <= 0) return badRequest(res, "answerId 必须是正整数");
  const db = getDb();
  const col = getCollection(db, id);
  if (!col) return res.status(404).json({ error: "收藏夹不存在" });
  if (col.owner_id !== req.user.id) return res.status(403).json({ error: "只能修改自己的收藏夹" });
  db.prepare("DELETE FROM collection_items WHERE collection_id = ? AND answer_id = ?").run(id, answerId);
  res.status(204).end();
});

// DELETE /:id — delete own collection.
router.delete("/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return badRequest(res, "id 必须是正整数");
  const db = getDb();
  const col = getCollection(db, id);
  if (!col) return res.status(404).json({ error: "收藏夹不存在" });
  if (col.owner_id !== req.user.id) return res.status(403).json({ error: "只能删除自己的收藏夹" });
  db.prepare("DELETE FROM collection_items WHERE collection_id = ?").run(id);
  db.prepare("DELETE FROM collections WHERE id = ?").run(id);
  res.status(204).end();
});

module.exports = router;
