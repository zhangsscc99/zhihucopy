const express = require("express");
const { getDb } = require("../db");
const { requireAuth } = require("../auth");
const { badRequest } = require("../util");
const { testCommentSql, walkProbeRules } = require("../content-filter");

const router = express.Router();

const TARGET_TYPES = ["question", "answer"];
const MAX_BODY = 500;
const DELETED_PLACEHOLDER = "该评论已删除";

const COMMENT_SELECT = `
  SELECT c.*, u.nickname AS author_nickname, u.avatar_url AS author_avatar
  FROM comments c
  JOIN users u ON u.id = c.author_id`;

const TARGET_TABLES = { question: "questions", answer: "answers" };
const TARGET_LABELS = { question: "问题", answer: "回答" };
// 软删口径：answers 有 is_deleted 列，软删回答视同「不存在」——不能再评论，
// 也不因评论它发通知。questions 无该列（硬删），保持原样。
const TARGET_ALIVE_SQL = { question: "", answer: " AND is_deleted = 0" };

function textLength(s) {
  return [...s].length;
}

function targetExists(db, targetType, targetId) {
  const table = TARGET_TABLES[targetType];
  const row = db
    .prepare(`SELECT id FROM ${table} WHERE id = ?${TARGET_ALIVE_SQL[targetType]}`)
    .get(targetId);
  return Boolean(row);
}

// 软删除的评论保留占位，绝不回传正文与作者信息。
function commentRow(c, replyCount) {
  if (c.is_deleted) {
    return {
      id: c.id,
      parent_id: c.parent_id,
      created_at: c.created_at,
      is_deleted: true,
      is_collapsed: Boolean(c.is_collapsed),
      content: null,
      placeholder: DELETED_PLACEHOLDER,
      // 只回传作者 id（不含昵称/头像）：前端据此把「我自己删的」排除出
      // 「N 条评论已删除」合并行。
      author_id: c.author_id,
      author: null,
      reply_count: replyCount,
    };
  }
  return {
    id: c.id,
    parent_id: c.parent_id,
    created_at: c.created_at,
    is_deleted: false,
    is_collapsed: Boolean(c.is_collapsed),
    content: c.content,
    author_id: c.author_id,
    author: {
      id: c.author_id,
      nickname: c.author_nickname,
      avatar_url: c.author_avatar,
    },
    reply_count: replyCount,
  };
}

// answers.comment_count 是冗余计数列：每次增删后在事务里按真实行重算。
function syncCommentCount(db, targetType, targetId) {
  if (targetType !== "answer") return;
  db.prepare(
    `UPDATE answers SET comment_count =
       (SELECT COUNT(*) FROM comments c
        WHERE c.target_type = 'answer' AND c.target_id = answers.id AND c.is_deleted = 0)
     WHERE id = ?`
  ).run(targetId);
}

function parseTarget(query) {
  const targetType = typeof query.target_type === "string" ? query.target_type : "";
  const rawId = query.target_id;
  if (!TARGET_TYPES.includes(targetType)) return { error: "target_type 必须是 question 或 answer" };
  if (typeof rawId !== "string" || !/^\d+$/.test(rawId) || Number(rawId) < 1) {
    return { error: "target_id 必须是正整数" };
  }
  return { targetType, targetId: Number(rawId) };
}

// GET /comments?target_type=question|answer&target_id=N — 两级评论树。
// limit（1–100，作用于顶层条数，children 一并带出）/ offset 分页；total 恒为
// 全量可见行数（is_deleted=0，含各级回复），与 limit 无关。
router.get("/", (req, res) => {
  const target = parseTarget(req.query);
  if (target.error) return badRequest(res, target.error);

  let limit = null;
  let offset = 0;
  if (req.query.limit !== undefined) {
    if (typeof req.query.limit !== "string" || !/^\d+$/.test(req.query.limit)) {
      return badRequest(res, "limit 必须是 1–100 的正整数");
    }
    limit = Number(req.query.limit);
    if (limit < 1 || limit > 100) {
      return badRequest(res, "limit 必须是 1–100 的正整数");
    }
  }
  if (req.query.offset !== undefined) {
    if (typeof req.query.offset !== "string" || !/^\d+$/.test(req.query.offset)) {
      return badRequest(res, "offset 必须是非负整数");
    }
    offset = Number(req.query.offset);
  }

  const db = getDb();
  if (!targetExists(db, target.targetType, target.targetId)) {
    return res.status(404).json({ error: `${TARGET_LABELS[target.targetType]}不存在` });
  }

  // 公共列表与计数同一份过滤片段：正文命中产物标记、或作者是测试账号的
  // 评论不返回（Z1045 —— 「评论回写验证 rv6-*」等残留对公开访客不可见）。
  // Z1226 本人豁免：带登录态时 viewer === author 的评论放行（同 Z1085
  // 「看自己的主页能看到自己写的内容」），否则走查/巡检号发的评论对自己
  // 也不可见 —— 发布 201 但列表/计数不变，线上走查误判「评论发布无效」。
  // 匿名与他人视角口径不变。
  const filter = testCommentSql("c", "u");
  const params = [target.targetType, target.targetId];
  let cond = `c.target_type = ? AND c.target_id = ? AND ${filter}`;
  if (req.user) {
    cond = `c.target_type = ? AND c.target_id = ? AND (${filter} OR c.author_id = ?)`;
    params.push(req.user.id);
  }
  const rows = db
    .prepare(
      `${COMMENT_SELECT}
       WHERE ${cond}
       ORDER BY c.created_at ASC, c.id ASC`
    )
    .all(...params);

  const byId = new Map();
  const tops = [];
  for (const r of rows) {
    const node = commentRow(r, 0);
    node.children = [];
    byId.set(node.id, node);
    if (node.parent_id == null) tops.push(node);
  }
  // 仅两级：父级不存在的（理论上不会有）也降级为顶层，避免丢失。
  for (const r of rows) {
    if (r.parent_id == null) continue;
    const node = byId.get(r.id);
    const parent = byId.get(r.parent_id);
    if (parent && parent.parent_id == null && parent !== node) {
      parent.children.push(node);
    } else {
      tops.push(node);
    }
  }
  for (const top of tops) top.reply_count = top.children.length;

  // total = 用户真正能看到的评论条数：通过可见过滤且 is_deleted=0 的全部行
  // （含各级回复），不含「该评论已删除」占位行；与分页无关。
  const total = rows.reduce((n, r) => n + (r.is_deleted ? 0 : 1), 0);
  const items = limit === null ? tops.slice(offset) : tops.slice(offset, offset + limit);
  res.json({
    target_type: target.targetType,
    target_id: target.targetId,
    total,
    page: limit === null ? 1 : Math.floor(offset / limit) + 1,
    page_size: limit === null ? items.length : limit,
    has_more: limit === null ? false : offset + items.length < tops.length,
    items,
  });
});

// POST /comments — 发表评论或二级回复。
router.post("/", requireAuth, (req, res) => {
  const body = req.body || {};
  const { target_type: targetType, target_id: rawTargetId, parent_id: rawParentId } = body;

  if (!TARGET_TYPES.includes(targetType)) {
    return badRequest(res, "target_type 必须是 question 或 answer");
  }
  const targetId = Number(rawTargetId);
  if (!Number.isInteger(targetId) || targetId < 1) {
    return badRequest(res, "target_id 必须是正整数");
  }
  if (typeof body.body !== "string") return badRequest(res, "评论内容不能为空");
  const content = body.body.trim();
  const len = textLength(content);
  if (len < 1 || len > MAX_BODY) {
    return badRequest(res, `评论内容需要 1–${MAX_BODY} 个字符`);
  }

  let parentId = null;
  if (rawParentId !== undefined && rawParentId !== null) {
    parentId = Number(rawParentId);
    if (!Number.isInteger(parentId) || parentId < 1) return badRequest(res, "parent_id 无效");
  }

  const db = getDb();
  if (!targetExists(db, targetType, targetId)) {
    return res.status(404).json({ error: `${TARGET_LABELS[targetType]}不存在` });
  }

  let parentRow = null;
  if (parentId !== null) {
    parentRow = db
      .prepare("SELECT id, parent_id, target_type, target_id, author_id FROM comments WHERE id = ? AND is_deleted = 0")
      .get(parentId);
    if (!parentRow || parentRow.target_type !== targetType || parentRow.target_id !== targetId) {
      return badRequest(res, "父评论不存在或不属于该目标");
    }
    if (parentRow.parent_id != null) return badRequest(res, "只支持两级评论，不能回复二级回复");
  }

  // Z1169 写入守卫：走查/e2e 探针模板正文一律拒写 —— 不入库、不重算
  // comment_count、不发通知（不依赖前端/脚本自觉）。命中即回传规则名，
  // 前端把错误内联到输入框，便于走查定位是哪条规则拦的。
  // Z1226 删掉「按账号昵称一刀切」分支（req.user.is_test && isWalkAccount）：
  // 走查号 ≠ 违规内容，写侧守卫不能按身份拒写 —— 走查/巡检脚本注册的
  // 账号（走查NNNNNN 等，is_test=1）发自然语言评论应当正常入库，否则每轮
  // 线上走查都误判「评论功能全站不可用」。isWalkAccount 导出保留（
  // auth.js 注册打标 / 清理脚本仍在用），本路由不再用它拒写。
  const hits = walkProbeRules(content);
  if (hits.length) {
    return res
      .status(403)
      .json({ error: `评论未通过内容校验：命中规则 ${hits[0]}`, rule: hits[0] });
  }
  // 链接数上限：正文里 http(s):// 出现 ≥3 次一律拒写（与正文规则同层，
  // 任何账号生效；不依赖前端自觉）。
  if ((content.match(/https?:\/\//g) || []).length >= 3) {
    return res
      .status(400)
      .json({ error: "评论中链接过多（最多 2 个）", rule: "too_many_links" });
  }

  const id = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO comments (target_type, target_id, author_id, parent_id, content)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(targetType, targetId, req.user.id, parentId, content);
    syncCommentCount(db, targetType, targetId);
    // Z1038: 评论/回复他人回答 → 通知回答作者；二级回复且被回复的评论作者
    // 不是回答作者时也通知对方（同一事务内落库）。评论自己的内容不通知。
    if (targetType === "answer") {
      const answer = db.prepare("SELECT author_id FROM answers WHERE id = ?").get(targetId);
      const recipients = new Set();
      if (answer && answer.author_id !== req.user.id) recipients.add(answer.author_id);
      if (
        parentRow &&
        parentRow.author_id !== req.user.id &&
        (!answer || parentRow.author_id !== answer.author_id)
      ) {
        recipients.add(parentRow.author_id);
      }
      if (recipients.size) {
        const ins = db.prepare(
          `INSERT INTO notifications (user_id, type, actor_id, target_type, target_id)
           VALUES (?, 'comment', ?, 'answer', ?)`
        );
        for (const uid of recipients) ins.run(uid, req.user.id, targetId);
      }
    }
    return Number(info.lastInsertRowid);
  })();

  const row = db.prepare(`${COMMENT_SELECT} WHERE c.id = ?`).get(id);
  res.status(201).json({ comment: commentRow(row, 0) });
});

// DELETE /comments/:id — 只能删除自己的评论（管理员可删任意），软删除且幂等。
router.delete("/:id", requireAuth, (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return badRequest(res, "评论 id 无效");
  const id = Number(req.params.id);

  const db = getDb();
  const c = db.prepare("SELECT * FROM comments WHERE id = ?").get(id);
  if (!c) return res.status(404).json({ error: "评论不存在" });

  const isOwner = c.author_id === req.user.id;
  if (!isOwner && !req.user.is_admin) {
    return res.status(403).json({ error: "只能删除自己的评论" });
  }

  if (c.is_deleted) {
    return res.json({ ok: true, id, already_deleted: true });
  }

  db.transaction(() => {
    db.prepare("UPDATE comments SET is_deleted = 1 WHERE id = ? AND is_deleted = 0").run(id);
    syncCommentCount(db, c.target_type, c.target_id);
  })();

  res.json({ ok: true, id, deleted: true });
});

module.exports = router;
