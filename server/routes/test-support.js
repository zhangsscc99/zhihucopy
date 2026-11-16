const express = require("express");
const { getDb } = require("../db");
const { requireAuth } = require("../auth");
const {
  initDelTables,
  addOwnedTargetsGuarded,
  cascadeFromDelUsers,
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

// POST /test-support/purge-residue — Z1050 残留断言账号硬删（仅管理员）。
// scripts/assert/search-scope.mjs 每 run 注册 z1044user<stamp> /
// z1044.<stamp>@example.com —— 刻意不被 testUserSql 过滤（否则搜索断言无意义），
// /cleanup 的 u: 口径也因此跳过它们 → 需要一条管理员白名单通道。
// 安全：LIKE 只做候选粗筛（SQLite 无 REGEXP），昵称/邮箱/is_admin 三个条件
// 在 JS 侧逐 id 复核，任一不满足进 skipped；绝不按模糊 LIKE 直接批量删。
const RESIDUE_WHITELIST = {
  z1044user: {
    nickLike: "z1044user%",
    emailLike: "z1044.%@example.com",
    nickRe: /^z1044user[a-z0-9]+$/,
    emailRe: /^z1044\.[a-z0-9]+@example\.com$/,
  },
};

router.post("/purge-residue", requireAuth, (req, res) => {
  try {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: "需要管理员权限" });
    }
    const pattern = (req.body && req.body.pattern) || "z1044user";
    const rule = RESIDUE_WHITELIST[pattern];
    if (!rule) {
      return res.status(400).json({
        error: "pattern 不在白名单",
        allowed: Object.keys(RESIDUE_WHITELIST),
      });
    }

    // only_nicknames（可选）：只删这些昵称，仍逐个命中白名单正则才受理，
    // 供并行断言只清本 run 账号，避免全量 purge 误删别的 lane 的在途账号。
    const only = req.body && req.body.only_nicknames;
    if (
      only !== undefined &&
      (!Array.isArray(only) ||
        !only.every((n) => typeof n === "string" && rule.nickRe.test(n)))
    ) {
      return res.status(400).json({
        error: "only_nicknames 须为命中白名单正则的昵称数组",
      });
    }

    const db = getDb();
    let payload;
    // 候选 SELECT + JS 复核放进同一事务，避免 SELECT 与 DELETE 间的 TOCTOU。
    db.transaction(() => {
      const candidates = db
        .prepare(
          `SELECT id, nickname, email, is_admin FROM users
           WHERE nickname LIKE ? OR email LIKE ?`
        )
        .all(rule.nickLike, rule.emailLike);

      const ids = [];
      const skipped = [];
      for (const u of candidates) {
        if (only && !only.includes(u.nickname)) continue;
        const reasons = [];
        if (!rule.nickRe.test(u.nickname)) reasons.push("nickname");
        if (!rule.emailRe.test(u.email)) reasons.push("email");
        if (u.is_admin) reasons.push("is_admin");
        if (reasons.length) {
          skipped.push({ id: u.id, nickname: u.nickname, email: u.email, reasons });
        } else {
          ids.push(u.id);
        }
      }

      initDelTables(db);
      const ins = db.prepare("INSERT OR IGNORE INTO _del_u (id) VALUES (?)");
      for (const id of ids) ins.run(id);
      cascadeFromDelUsers(db);
      const detail = deleteMarked(db);
      recomputeDerived(db);
      payload = {
        ok: true,
        pattern,
        deleted: delCounts(db),
        detail,
        purged_nicknames: candidates
          .filter((u) => ids.includes(u.id))
          .map((u) => u.nickname),
        skipped,
      };
    })();
    res.json(payload);
  } catch (e) {
    res
      .status(500)
      .json({ error: `purge-residue 失败: ${e.message || e}` });
  }
});

module.exports = router;
