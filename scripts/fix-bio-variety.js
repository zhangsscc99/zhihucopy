#!/usr/bin/env node
/**
 * scripts/fix-bio-variety.js — 用户简介「句首」去重 + 空 bio 补齐（Z1161）
 *
 * 背景：Z1158 只保证整句唯一，主句池仅 30 句，生产库出现 12 组「bio 首句相同
 *   4–7 人」的集群（「做业务系统，最怕接手没人敢改的祖传代码。」×7），邀请弹窗
 *   与用户搜索里连读三行像同一个人；另有 167 个空 bio。本轮池子扩到 200 句
 *   （10 领域 × 20），本脚本负责把存量数据迁到新口径。
 *
 * 行为（默认 dry-run，打印计划；--apply 才写库）：
 *   1. 首句撞车：bio 非空且「首句（到第一个 。）」同句人数 >= 3 的组，保留组内
 *      最小 id 原 bio，其余按人设领域从池中取**全库首句未被占用**的新句；
 *   2. 空 bio：排除测试号（@test.dev 邮箱、e2e 或巡检开头的昵称、is_test）后，
 *      按昵称领域补一句首句未占用的简介；
 *   3. 只 UPDATE users.bio（有 updated_at 列时同步），绝不改 id / email /
 *      password_hash / 昵称 / 发帖关系 / 计数；
 *   4. 幂等：二跑命中 0 组、改写 0 行。
 *
 * 用法：
 *   DB_PATH=/path/zhihu.db node scripts/fix-bio-variety.js            # dry-run
 *   DB_PATH=/path/zhihu.db node scripts/fix-bio-variety.js --apply
 *   生产库：--apply --prod 且 ZH_ALLOW_PROD_WRITE=1（scripts/prod-write-gate.js）
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function requireFromServer(name) {
  try {
    return require(name);
  } catch {
    return require(require.resolve(name, { paths: [path.join(__dirname, "..", "server")] }));
  }
}
const Database = requireFromServer("better-sqlite3");
const { resolveWriteMode } = require("./prod-write-gate");
const { DOMAIN_BIOS, DOMAINS, FILLERS, withFiller } = require("./seed-data/user-bios");
const { domainsOf } = require("./persona-domains");

const DB_PATH = path.resolve(
  process.env.DB_PATH || path.join(__dirname, "..", "data", "zhihu.db")
);
const APPLY = process.argv.includes("--apply");
const MIN_GROUP = 3;

const headOf = (bio) => String(bio || "").trim().split("。")[0];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function hashNum(s, mod) {
  const h = crypto.createHash("sha1").update(String(s)).digest();
  return h.readUInt32BE(0) % mod;
}

function isTestUser(u) {
  const email = String(u.email || "");
  const nick = String(u.nickname || "");
  return (
    /@test\.dev$/i.test(email) ||
    /^(e2e|probe|巡检|真人|走查)/i.test(nick) ||
    Boolean(u.is_test)
  );
}

// 从领域池里按确定性起点找一条可用简介：首句全库出现 <2 次（保证「同首句 ≤2 人」），
// 整句未被占用（必要时接补语做差异化，保证 349 个非测试号也能人人不同）。
function pickFresh(domain, seedKey, headCount, usedBios) {
  const pools = [];
  if (DOMAIN_BIOS[domain]) pools.push(domain);
  for (const d of DOMAINS) if (d !== domain) pools.push(d);
  for (const d of pools) {
    const pool = DOMAIN_BIOS[d];
    const start = hashNum(`${seedKey}-${d}`, pool.length);
    for (let i = 0; i < pool.length; i++) {
      const base = pool[(start + i) % pool.length];
      if ((headCount.get(headOf(base)) || 0) >= 2) continue;
      if (!usedBios.has(base)) return base;
      for (const filler of FILLERS) {
        const cand = withFiller(base, filler);
        if (!usedBios.has(cand)) return cand;
      }
    }
  }
  return null;
}

function main() {
  const db = new Database(DB_PATH);
  const cols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  const hasUpdatedAt = cols.includes("updated_at");
  const users = db
    .prepare("SELECT id, nickname, email, bio FROM users ORDER BY id ASC")
    .all();

  const headCount = new Map();
  const usedBios = new Set();
  for (const u of users) {
    const bio = String(u.bio || "").trim();
    if (!bio) continue;
    usedBios.add(bio);
    const h = headOf(bio);
    headCount.set(h, (headCount.get(h) || 0) + 1);
  }
  const bump = (bio) => {
    usedBios.add(bio);
    const h = headOf(bio);
    headCount.set(h, (headCount.get(h) || 0) + 1);
  };

  // ---------- 1. 首句撞车分组 ----------
  const byHead = new Map();
  for (const u of users) {
    const h = headOf(u.bio);
    if (!h) continue;
    if (!byHead.has(h)) byHead.set(h, []);
    byHead.get(h).push(u);
  }
  const groups = [...byHead.entries()]
    .filter(([, list]) => list.length >= MIN_GROUP)
    .sort((a, b) => b[1].length - a[1].length);

  const plan = [];
  for (const [head, list] of groups) {
    const rest = list.slice().sort((a, b) => a.id - b.id).slice(1);
    for (const u of rest) {
      const raw = domainsOf(u.nickname, u.bio);
      const domains = Array.isArray(raw) ? raw : [...(raw || [])];
      const domain = domains.length ? domains[0] : DOMAINS[hashNum(u.id, DOMAINS.length)];
      const cand = pickFresh(domain, `bio-${u.id}`, headCount, usedBios);
      if (!cand) {
        console.log(`[fix-bio] #${u.id} ${u.nickname}：池内已无未占用首句，跳过`);
        continue;
      }
      bump(cand);
      plan.push({ id: u.id, nickname: u.nickname, from: u.bio, to: cand, reason: "首句重复" });
    }
  }

  // ---------- 2. 空 bio 补齐 ----------
  const empties = users.filter((u) => !String(u.bio || "").trim() && !isTestUser(u));
  for (const u of empties) {
    const raw = domainsOf(u.nickname, "");
    const domains = Array.isArray(raw) ? raw : [...(raw || [])];
    const domain = domains.length ? domains[0] : DOMAINS[hashNum(u.id, DOMAINS.length)];
    const cand = pickFresh(domain, `empty-${u.id}`, headCount, usedBios);
    if (!cand) continue;
    bump(cand);
    plan.push({ id: u.id, nickname: u.nickname, from: "", to: cand, reason: "空简介" });
  }

  // ---------- 2b. 过短 bio（< 10 字）重写 ----------
  const planned = new Set(plan.map((p) => p.id));
  const shorts = users.filter(
    (u) =>
      !isTestUser(u) &&
      !planned.has(u.id) &&
      String(u.bio || "").trim() &&
      Array.from(String(u.bio).trim()).length < 10
  );
  for (const u of shorts) {
    const raw = domainsOf(u.nickname, u.bio);
    const domains = Array.isArray(raw) ? raw : [...(raw || [])];
    const domain = domains.length ? domains[0] : DOMAINS[hashNum(u.id, DOMAINS.length)];
    const cand = pickFresh(domain, `short-${u.id}`, headCount, usedBios);
    if (!cand) continue;
    bump(cand);
    plan.push({ id: u.id, nickname: u.nickname, from: u.bio, to: cand, reason: "简介过短" });
  }

  // ---------- 报告 ----------
  console.log(
    `[fix-bio] 库：${DB_PATH}｜用户 ${users.length}｜首句重复 >=${MIN_GROUP} 人组 ${groups.length}｜空 bio（非测试号）${empties.length}`
  );
  for (const g of groups.slice(0, 6)) {
    console.log(`  组「${g[0].slice(0, 20)}」× ${g[1].length} 人`);
  }
  if (groups.length > 6) console.log(`  …共 ${groups.length} 组`);
  console.log(`[fix-bio] 计划改写 ${plan.length} 行`);
  for (const p of plan.slice(0, 12)) {
    console.log(`  #${p.id} ${p.nickname}（${p.reason}）：「${p.from || "（空）"}」→「${p.to}」`);
  }
  if (plan.length > 12) console.log(`  …共 ${plan.length} 行`);

  if (!plan.length) {
    console.log("[fix-bio] 无命中，简介已满足「首句 ≤2 人、无空简介」（幂等）");
    db.close();
    return Promise.resolve(0);
  }
  if (!APPLY) {
    console.log("[fix-bio] dry-run：加 --apply 才写库");
    db.close();
    return Promise.resolve(0);
  }

  // ---------- 3. 备份 + 写库 ----------
  const bdir = path.join(path.dirname(DB_PATH), "backups");
  fs.mkdirSync(bdir, { recursive: true });
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(
    now.getHours()
  )}${pad2(now.getMinutes())}`;
  const backup = path.join(bdir, `zhihu-${stamp}-bio-variety.db`);

  return db.backup(backup).then(() => {
    console.log(`[fix-bio] 备份已落盘：${backup}`);
    const mode = resolveWriteMode({
      argv: process.argv.concat(["--backup", backup]),
      env: process.env,
      dbPath: DB_PATH,
      scriptName: "fix-bio",
      Database,
    });
    if (mode !== "apply" && mode !== "apply-prod") {
      console.log(`[fix-bio] 写库模式 ${mode}：未写库`);
      db.close();
      return 0;
    }
    const upd = db.prepare(
      hasUpdatedAt
        ? "UPDATE users SET bio = ?, updated_at = datetime('now') WHERE id = ?"
        : "UPDATE users SET bio = ? WHERE id = ?"
    );
    let rows = 0;
    const tx = db.transaction(() => {
      for (const p of plan) rows += upd.run(p.to, p.id).changes;
    });
    tx();
    console.log(`[fix-bio] 已改写 ${rows} 行 bio`);
    db.close();
    return 0;
  });
}

Promise.resolve(main()).then((code) => {
  if (code) process.exitCode = code;
}).catch((e) => {
  console.error(`[fix-bio] 失败：${e && e.stack ? e.stack : e}`);
  process.exitCode = 1;
});
