#!/usr/bin/env node
/**
 * scripts/fix-user-identity.js — 用户身份唯一性修复（Z1158）
 *
 * 背景：seed.js 给 clone 用户复用了原型 bio，生产库有 30 组「8 个不同昵称共用
 *   同一条简介」的集群（8 个「阿罗…」全是「运维，负责不被叫醒。」），邀请弹窗
 *   与用户搜索里无法分辨；另有若干机械后缀昵称（在线/守夜/值班/君/测测）。
 *
 * 行为（默认 dry-run，打印计划；--apply 才写库）：
 *   1. 撞车简介：对 bio 非空且同 bio 人数 >= 3 的组，**保留组内最小 id 的成员
 *      原 bio**（原型本人），其余成员按「人设领域池」重新分配互不相同的简介
 *      （scripts/seed-data/user-bios.js，确定性取自 user id 的哈希序），且不与
 *      库内任何现有 bio 重复；池子不够时按确定性顺序继续取，仍保证唯一。
 *   2. 机械昵称：MECHANICAL_RENAMES 白名单里的昵称改成真实感昵称（新名不得与
 *      库内任何昵称重复，重名则跳过并打印）。
 *   3. 只 UPDATE users.bio / users.nickname（有 updated_at 列时同步），绝不改
 *      id / email / password_hash / 发帖关系；空 bio 用户、e2e 测试号不动。
 *   4. 幂等：二跑命中 0 组、改写 0 行。
 *
 * 用法：
 *   DB_PATH=/path/zhihu.db node scripts/fix-user-identity.js            # dry-run
 *   DB_PATH=/path/zhihu.db node scripts/fix-user-identity.js --apply
 *   生产库：--apply --prod 且 ZH_ALLOW_PROD_WRITE=1（prod-write-gate 口径）
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
const { cloneBio, DOMAINS } = require("./seed-data/user-bios");
const { domainsOf } = require("./persona-domains");
const { genericNickname } = require("./nickname-pool");

const DB_PATH = path.resolve(
  process.env.DB_PATH || path.join(__dirname, "..", "data", "zhihu.db")
);
const APPLY = process.argv.includes("--apply");
const MIN_GROUP = 3;

// 机械后缀昵称 → 真实感昵称（只改这些白名单项，其余一律不动）。
const MECHANICAL_RENAMES = {
  阿罗在线: "阿罗在途",
  阿罗守夜: "阿罗夜读",
  阿罗值班: "阿罗换班",
  阿罗君: "罗君",
  木子李测测: "木子李的书桌",
  木子李呀: "木子李在写",
  夏至末: "夏至末班车",
  季节第五个: "第五季的风",
};

function pad2(n) {
  return String(n).padStart(2, "0");
}

function hashNum(s, mod) {
  const h = crypto.createHash("sha1").update(String(s)).digest();
  return h.readUInt32BE(0) % mod;
}

function main() {
  const db = new Database(DB_PATH);
  const cols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  const hasUpdatedAt = cols.includes("updated_at");

  const users = db
    .prepare("SELECT id, nickname, bio FROM users ORDER BY id ASC")
    .all();

  const usedBios = new Set(users.map((u) => (u.bio || "").trim()).filter(Boolean));
  const usedNicks = new Set(users.map((u) => u.nickname));

  // ---------- 1. 撞车简介分组 ----------
  const byBio = new Map();
  for (const u of users) {
    const bio = (u.bio || "").trim();
    if (!bio) continue;
    if (!byBio.has(bio)) byBio.set(bio, []);
    byBio.get(bio).push(u);
  }
  const groups = [...byBio.entries()]
    .filter(([, list]) => list.length >= MIN_GROUP)
    .sort((a, b) => b[1].length - a[1].length);

  const bioPlan = [];
  for (const [bio, list] of groups) {
    // 组内最小 id 保原 bio；其余按 id 升序依次分配新 bio。
    const rest = list.slice().sort((a, b) => a.id - b.id).slice(1);
    for (const u of rest) {
      const raw = domainsOf(u.nickname, bio);
      const domains = Array.isArray(raw) ? raw : [...(raw || [])];
      const domain = domains.length ? domains[0] : DOMAINS[hashNum(u.id, DOMAINS.length)];
      let candidate = null;
      // 先只在领域池内（12 条）找，池子耗尽再用「池 + 补语」组合（最多 156 种），
      // 这样多数人拿到的是干净的单句简介。
      for (let i = 0; i < 12 && !candidate; i++) {
        const round = 1 + ((hashNum(`${u.id}-${domain}-p`, 12) + i) % 12);
        const c = cloneBio([domain], round);
        if (!usedBios.has(c)) candidate = c;
      }
      for (let i = 0; i < 156 && !candidate; i++) {
        const round = 13 + ((hashNum(`${u.id}-${domain}-f`, 144) + i) % 144);
        const c = cloneBio([domain], round);
        if (!usedBios.has(c)) candidate = c;
      }
      if (!candidate) {
        // 极端兜底：领域名 + 序数，仍保证唯一（生产上不该发生）。
        let k = 1;
        while (usedBios.has(`${bio}（${k}）`)) k++;
        candidate = `${bio}（${k}）`;
      }
      usedBios.add(candidate);
      bioPlan.push({ id: u.id, nickname: u.nickname, from: bio, to: candidate });
    }
  }

  const nickPlan = [];

  // ---------- 1b. 重名去重 ----------
  // 同一昵称 >1 人的组：保留最小 id，其余换成通用池里未被占用的真实感昵称
  // （含 e2e/探针残留号，它们混在搜索结果里同样让用户无法分辨）。
  const byNick = new Map();
  for (const u of users) {
    if (!byNick.has(u.nickname)) byNick.set(u.nickname, []);
    byNick.get(u.nickname).push(u);
  }
  const dupGroups = [...byNick.entries()].filter(([, l]) => l.length > 1);
  for (const [, list] of dupGroups) {
    const rest = list.slice(1);
    for (const u of rest) {
      const next = genericNickname(hashNum(`${u.id}-nick`, 997) % 1000, usedNicks);
      usedNicks.delete(u.nickname);
      usedNicks.add(next);
      nickPlan.push({ id: u.id, from: u.nickname, to: next, reason: "重名" });
    }
  }

  // ---------- 2. 机械昵称 ----------
  for (const [from, to] of Object.entries(MECHANICAL_RENAMES)) {
    const u = users.find((x) => x.nickname === from);
    if (!u) continue;
    if (u.nickname === to) continue;
    if (usedNicks.has(to)) {
      console.log(`[fix-identity] 跳过昵称 ${from} → ${to}：目标昵称已被占用`);
      continue;
    }
    usedNicks.delete(from);
    usedNicks.add(to);
    nickPlan.push({ id: u.id, from, to });
  }

  // ---------- 报告 ----------
  console.log(
    `[fix-identity] 库：${DB_PATH}｜用户 ${users.length}｜撞车 bio 组 ${groups.length}（>=${MIN_GROUP} 人）`
  );
  for (const g of groups.slice(0, 8)) {
    console.log(`  组 "${g[0].slice(0, 16)}…" × ${g[1].length} 人`);
  }
  if (groups.length > 8) console.log(`  …共 ${groups.length} 组`);
  console.log(`[fix-identity] 计划改写 bio ${bioPlan.length} 行、昵称 ${nickPlan.length} 行`);
  for (const p of bioPlan.slice(0, 12)) {
    console.log(`  bio  #${p.id} ${p.nickname}: 「${p.from}」→「${p.to}」`);
  }
  if (bioPlan.length > 12) console.log(`  …共 ${bioPlan.length} 行 bio`);
  for (const p of nickPlan) console.log(`  nick #${p.id} ${p.from} → ${p.to}`);

  if (!bioPlan.length && !nickPlan.length) {
    console.log("[fix-identity] 无命中，库已满足唯一性（幂等）");
    db.close();
    return Promise.resolve();
  }
  if (!APPLY) {
    console.log("[fix-identity] dry-run：加 --apply 才写库");
    db.close();
    return Promise.resolve();
  }

  // ---------- 3. 备份 + 写库 ----------
  const bdir = path.join(path.dirname(DB_PATH), "backups");
  fs.mkdirSync(bdir, { recursive: true });
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(
    now.getHours()
  )}${pad2(now.getMinutes())}`;
  const backup = path.join(bdir, `zhihu-${stamp}-user-identity.db`);

  return db
    .backup(backup)
    .then(() => {
      console.log(`[fix-identity] 备份已落盘：${backup}`);
      const mode = resolveWriteMode({
        argv: process.argv.concat(["--backup", backup]),
        env: process.env,
        dbPath: DB_PATH,
        scriptName: "fix-identity",
        Database,
      });
      if (mode !== "apply") {
        db.close();
        return;
      }
      const updBio = db.prepare(
        hasUpdatedAt
          ? "UPDATE users SET bio = ?, updated_at = datetime('now') WHERE id = ?"
          : "UPDATE users SET bio = ? WHERE id = ?"
      );
      const updNick = db.prepare(
        hasUpdatedAt
          ? "UPDATE users SET nickname = ?, updated_at = datetime('now') WHERE id = ?"
          : "UPDATE users SET nickname = ? WHERE id = ?"
      );
      const tx = db.transaction(() => {
        for (const p of bioPlan) updBio.run(p.to, p.id);
        for (const p of nickPlan) updNick.run(p.to, p.id);
      });
      tx();
      db.close();
      console.log(
        `[fix-identity] apply 完成：bio ${bioPlan.length} 行、昵称 ${nickPlan.length} 行`
      );
    })
    .catch((e) => {
      db.close();
      throw e;
    });
}

if (require.main === module) {
  Promise.resolve()
    .then(main)
    .catch((e) => {
      console.error(`[fix-identity] 执行失败: ${e.message || e}`);
      process.exit(1);
    });
}
