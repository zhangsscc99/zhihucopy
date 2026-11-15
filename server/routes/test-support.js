const express = require("express");
const { getDb } = require("../db");
const { requireAuth } = require("../auth");
const {
  initDelTables,
  addOwnedTargetsGuarded,
  deleteMarked,
  recomputeDerived,
  delCounts,
} = require("../artifact-cleanup");

const router = express.Router();

// POST /test-support/cleanup — 自动化产物 API 清理（Z983/Z986）。
// 供没有 DB 权限的断言机（cron 下的 assert/e2e 退出自清理）删除本 run 产物：
// 凭 Bearer token + 显式 id 清单，逐 id 校验 —— 调用者是对象作者/属主，或管理员，
// 或 is_test 账号且目标是测试产物；u: 目标必须是测试账号形态且非管理员。
// Body: { "u": [id…], "q": […], "a": […], "c": […], "col": […] }
router.post("/cleanup", requireAuth, (req, res) => {
  const body = req.body || {};
  const owned = {};
  for (const k of ["u", "q", "a", "c", "col"]) {
    owned[k] = (Array.isArray(body[k]) ? body[k] : []).filter(
      (n) => Number.isInteger(n) && n > 0
    );
  }
  const db = getDb();
  const hasIsTest = db
    .prepare("PRAGMA table_info(users)")
    .all()
    .some((c) => c.name === "is_test");
  let payload;
  db.transaction(() => {
    initDelTables(db);
    const { skipped, skippedUsers } = addOwnedTargetsGuarded(db, owned, {
      caller: req.user,
      hasIsTest,
    });
    deleteMarked(db);
    recomputeDerived(db);
    payload = {
      ok: true,
      deleted: delCounts(db),
      skipped,
      skipped_users: skippedUsers,
    };
  })();
  res.json(payload);
});

module.exports = router;
