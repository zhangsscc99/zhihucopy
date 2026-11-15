const express = require("express");
const { getDb } = require("../db");
const { requireAuth } = require("../auth");
const { badRequest } = require("../util");

// router 由 app.js 自动挂载到 /reports；admin 由 app.js 显式挂到 /admin。
const router = express.Router();
const admin = express.Router();

const TARGET_TYPES = ["question", "answer", "comment"];
const TARGET_TABLES = { question: "questions", answer: "answers", comment: "comments" };
const TARGET_LABELS = { question: "问题", answer: "回答", comment: "评论" };
const REASONS = ["spam", "abuse", "illegal", "other"];
const AUTO_COLLAPSE_THRESHOLD = 3;

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "请先登录" });
  if (!req.user.is_admin) return res.status(403).json({ error: "需要管理员权限" });
  next();
}

function targetExists(db, targetType, targetId) {
  const row = db
    .prepare(`SELECT id FROM ${TARGET_TABLES[targetType]} WHERE id = ?`)
    .get(targetId);
  return Boolean(row);
}

// ≥3 条 pending 举报 → 目标自动折叠（questions/answers/comments 均有 is_collapsed）。
function maybeAutoCollapse(db, targetType, targetId) {
  const { c } = db
    .prepare(
      `SELECT COUNT(*) c FROM reports
       WHERE target_type = ? AND target_id = ? AND status = 'pending'`
    )
    .get(targetType, targetId);
  if (c >= AUTO_COLLAPSE_THRESHOLD) {
    db.prepare(
      `UPDATE ${TARGET_TABLES[targetType]} SET is_collapsed = 1 WHERE id = ?`
    ).run(targetId);
  }
}

const ADMIN_REPORT_SELECT = `
  SELECT r.*, u.nickname AS reporter_nickname,
    CASE r.target_type
      WHEN 'question' THEN (SELECT title FROM questions WHERE id = r.target_id)
      WHEN 'answer'   THEN (SELECT substr(content_md, 1, 80) FROM answers WHERE id = r.target_id)
      WHEN 'comment'  THEN (SELECT substr(content, 1, 80) FROM comments WHERE id = r.target_id)
    END AS target_summary
  FROM reports r
  JOIN users u ON u.id = r.reporter_id`;

function reportRow(r) {
  return {
    id: r.id,
    reporter_id: r.reporter_id,
    reporter_nickname: r.reporter_nickname,
    target_type: r.target_type,
    target_id: r.target_id,
    target_summary: r.target_summary,
    reason: r.reason,
    detail: r.detail,
    status: r.status,
    created_at: r.created_at,
    handled_at: r.handled_at,
    handled_by: r.handled_by,
  };
}

// POST /reports — 提交举报（需登录）。同一举报人对同一目标的 pending 举报幂等：
// 重复提交直接返回已有工单，不重复计数。
router.post("/", requireAuth, (req, res) => {
  const body = req.body || {};
  const { target_type: targetType } = body;
  if (!TARGET_TYPES.includes(targetType)) {
    return badRequest(res, "target_type 必须是 question、answer 或 comment");
  }
  const targetId = Number(body.target_id);
  if (!Number.isInteger(targetId) || targetId < 1) {
    return badRequest(res, "target_id 必须是正整数");
  }
  const reason = typeof body.reason === "string" ? body.reason : "";
  if (!REASONS.includes(reason)) {
    return badRequest(res, `reason 必须是 ${REASONS.join("/")} 之一`);
  }
  const detail = typeof body.detail === "string" ? body.detail.slice(0, 500) : "";

  const db = getDb();
  if (!targetExists(db, targetType, targetId)) {
    return res.status(404).json({ error: `${TARGET_LABELS[targetType]}不存在` });
  }

  const existing = db
    .prepare(
      `SELECT * FROM reports
       WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'pending'`
    )
    .get(req.user.id, targetType, targetId);
  if (existing) {
    return res.json({ report: reportRow(existing), duplicate: true });
  }

  const id = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO reports (reporter_id, target_type, target_id, reason, detail)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(req.user.id, targetType, targetId, reason, detail);
    maybeAutoCollapse(db, targetType, targetId);
    return Number(info.lastInsertRowid);
  })();

  const row = db.prepare("SELECT * FROM reports WHERE id = ?").get(id);
  res.status(201).json({ report: reportRow(row) });
});

// GET /admin/reports?status=pending — 举报队列（仅管理员），带举报人昵称与目标摘要。
admin.get("/reports", requireAdmin, (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const db = getDb();
  if (status && !["pending", "handled", "rejected"].includes(status)) {
    return badRequest(res, "status 必须是 pending/handled/rejected");
  }
  const rows = status
    ? db.prepare(`${ADMIN_REPORT_SELECT} WHERE r.status = ? ORDER BY r.id DESC LIMIT 200`).all(status)
    : db.prepare(`${ADMIN_REPORT_SELECT} ORDER BY r.id DESC LIMIT 200`).all();
  res.json({ items: rows.map(reportRow) });
});

// PATCH /admin/reports/:id — 处理举报。action=remove 时软删目标
// （问题无 is_deleted 列，降级为折叠）；collapse 折叠；none 只改工单状态。
admin.patch("/reports/:id", requireAdmin, (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return badRequest(res, "举报 id 无效");
  const id = Number(req.params.id);
  const body = req.body || {};
  if (!["handled", "rejected"].includes(body.status)) {
    return badRequest(res, "status 必须是 handled 或 rejected");
  }
  const action = body.action === undefined ? "none" : body.action;
  if (!["remove", "collapse", "none"].includes(action)) {
    return badRequest(res, "action 必须是 remove/collapse/none");
  }

  const db = getDb();
  const report = db.prepare("SELECT * FROM reports WHERE id = ?").get(id);
  if (!report) return res.status(404).json({ error: "举报不存在" });

  const table = TARGET_TABLES[report.target_type];
  db.transaction(() => {
    db.prepare(
      "UPDATE reports SET status = ?, handled_at = datetime('now'), handled_by = ? WHERE id = ?"
    ).run(body.status, req.user.id, id);
    if (action === "collapse" || (action === "remove" && report.target_type === "question")) {
      db.prepare(`UPDATE ${table} SET is_collapsed = 1 WHERE id = ?`).run(report.target_id);
    } else if (action === "remove") {
      db.prepare(`UPDATE ${table} SET is_deleted = 1 WHERE id = ?`).run(report.target_id);
    }
  })();

  const row = db.prepare("SELECT * FROM reports WHERE id = ?").get(id);
  res.json({ report: reportRow(row) });
});

// GET /admin/stats — 后台概览计数。
admin.get("/stats", requireAdmin, (_req, res) => {
  const db = getDb();
  res.json({
    users: db.prepare("SELECT COUNT(*) c FROM users").get().c,
    questions: db.prepare("SELECT COUNT(*) c FROM questions").get().c,
    answers: db.prepare("SELECT COUNT(*) c FROM answers WHERE is_deleted = 0").get().c,
    comments: db.prepare("SELECT COUNT(*) c FROM comments WHERE is_deleted = 0").get().c,
    reports_pending: db.prepare("SELECT COUNT(*) c FROM reports WHERE status = 'pending'").get().c,
  });
});

// GET /admin/users?q= — 用户检索（昵称/邮箱 LIKE），带 muted_until/banned。
admin.get("/users", requireAdmin, (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const db = getDb();
  const select = `
    SELECT id, nickname, email, muted_until, is_admin, created_at,
           CASE WHEN muted_until IS NOT NULL AND muted_until > datetime('now')
                THEN 1 ELSE 0 END AS banned
    FROM users`;
  const rows = q
    ? db.prepare(`${select} WHERE nickname LIKE ? OR email LIKE ? ORDER BY id DESC LIMIT 100`)
        .all(`%${q}%`, `%${q}%`)
    : db.prepare(`${select} ORDER BY id DESC LIMIT 100`).all();
  res.json({ items: rows });
});

// POST /admin/users/:id/mute — 禁言 N 小时（hours=0 解除）。
admin.post("/users/:id/mute", requireAdmin, (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return badRequest(res, "用户 id 无效");
  const id = Number(req.params.id);
  const hours = Number((req.body || {}).hours);
  if (!Number.isFinite(hours) || hours < 0) {
    return badRequest(res, "hours 必须是非负数字");
  }

  const db = getDb();
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
  if (!user) return res.status(404).json({ error: "用户不存在" });

  if (hours === 0) {
    db.prepare("UPDATE users SET muted_until = NULL WHERE id = ?").run(id);
  } else {
    db.prepare(
      "UPDATE users SET muted_until = datetime('now', '+' || ? || ' hours') WHERE id = ?"
    ).run(hours, id);
  }
  const row = db.prepare("SELECT id, nickname, muted_until FROM users WHERE id = ?").get(id);
  res.json({ user: row });
});

module.exports = router;
module.exports.admin = admin;
