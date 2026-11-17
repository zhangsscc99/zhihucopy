#!/usr/bin/env node
/**
 * scripts/fix-nicknames.js — 存量「机器生成感」昵称批量改名（Z1115）
 *
 * 背景：seed.js 旧版给 clone 用户追加 `${i+1}` 数字后缀，生产库 215 个昵称是
 * 「汉语名 + 1–3 位数字」（陈默31/林间有风32/半山腰64/沈青224），另有拉丁后缀
 * 残留（沈知微gbw）与断言脚本留下的 `真人nmw…`/`z985user…` 等随机尾账号。
 *
 * 改名规则：
 *   - 只动「形态可疑」的昵称：以 1–4 位数字结尾，或以 2–4 位小写拉丁字母结尾
 *     （与 scripts/nickname-pool.js 的 isSuspiciousNickname 同口径）；
 *   - 种子 clone（`原型<序号>`，序号满足 (n-1)%30 == 原型下标）按 nickname-pool
 *     的 CLONE_ALIASES 映射，与新 seed 产物一致 —— 人设领域绑定不漂移
 *     （persona-domains 按别名还原原型）；
 *   - 其余可疑昵称从 GENERIC_POOL 按确定性下标挑选（跳过已占用名）；
 *   - 不动：admin、content-filter 判定的测试账号（is_test/测试昵称形态/测试
 *     邮箱域——改名会让它们逃出残留治理口径）、purge-residue 白名单
 *     （z1044user*，改了反而清不掉）、已是真实形态的名字；
 *   - 只改 users.nickname：回答/通知/投票均按 user_id 关联，无需联动。
 *
 * 幂等：改完的名字不再是可疑形态，第二次跑计划为 0。
 *
 * 用法：
 *   DB_PATH=/path/zhihu.db node scripts/fix-nicknames.js            # dry-run（默认）
 *   DB_PATH=/path/zhihu.db node scripts/fix-nicknames.js --apply    # 写非生产库
 *   node scripts/fix-nicknames.js --apply --prod --backup <path>    # 生产库
 *     （另需 ZH_ALLOW_PROD_WRITE=1，详见 scripts/prod-write-gate.js；
 *       FIX_ALLOW_PROD=1 只解锁非生产库）
 * 写库前自动 .backup() 到 data/backups/。
 */
"use strict";

const fs = require("fs");
const path = require("path");

function requireFromServer(name) {
  try {
    return require(name);
  } catch (e) {
    return require(require.resolve(name, { paths: [path.join(__dirname, "..", "server")] }));
  }
}
const Database = requireFromServer("better-sqlite3");
const { USERS } = require("./seed");
const {
  CLONE_ALIASES,
  GENERIC_POOL,
  genericNickname,
  isSuspiciousNickname,
} = require("./nickname-pool");
const { isTestNickname, isTestEmail } = require("../server/content-filter");
const { resolveWriteMode } = require("./prod-write-gate");

const DB_PATH = path.resolve(
  process.env.DB_PATH || path.join(__dirname, "..", "data", "zhihu.db")
);
const APPLY =
  resolveWriteMode({
    argv: process.argv,
    env: process.env,
    dbPath: DB_PATH,
    scriptName: "fix-nicknames",
    Database,
  }) === "apply";

// purge-residue 白名单（server/routes/test-support.js）：这批账号是「可搜到的
// 断言残留」，改名会让白名单正则失配、反而删不掉，故整组跳过。
const PURGE_WHITELIST = [/^z1044user[a-z0-9]+$/];

// 原型昵称 -> USERS 下标（0..29）。种子 clone 序号 n 与用户下标 i 的关系：
// i = n - 1，原型 = USERS[i % 30]，轮数 round = floor(i / 30) ∈ 1..7。
const PERSONA_INDEX = new Map(USERS.map((u, i) => [u[0], i]));

// 昵称若是合法的种子 clone 形态（原型 + 自洽序号），返回应改成的别名；否则 null。
function seedCloneTarget(nickname) {
  const m = /^([^0-9]+?)([0-9]{1,4})$/.exec(String(nickname || ""));
  if (!m) return null;
  const [, base, tail] = m;
  const i = Number(tail) - 1;
  if (i < USERS.length) return null; // i<30 的原型没有数字后缀
  const personaIdx = i % USERS.length;
  if (USERS[personaIdx][0] !== base) return null;
  const round = Math.floor(i / USERS.length);
  const alias = CLONE_ALIASES[base] && CLONE_ALIASES[base][round - 1];
  return alias || null;
}

async function main() {
  const db = new Database(DB_PATH, APPLY ? {} : { readonly: true });
  const hasIsTest = db
    .prepare("PRAGMA table_info(users)")
    .all()
    .some((c) => c.name === "is_test");
  const users = db
    .prepare("SELECT id, nickname, email, is_admin FROM users ORDER BY id")
    .all();
  const testFlag = hasIsTest
    ? new Set(db.prepare("SELECT id FROM users WHERE is_test = 1").all().map((r) => r.id))
    : new Set();

  const taken = new Set(users.map((u) => u.nickname));
  const plans = [];
  let skippedTest = 0;
  let skippedWhitelist = 0;
  let skippedAdmin = 0;
  let nSeedClone = 0;
  for (const u of users) {
    if (!isSuspiciousNickname(u.nickname)) continue;
    if (u.is_admin) {
      skippedAdmin++;
      continue;
    }
    if (testFlag.has(u.id) || isTestNickname(u.nickname) || isTestEmail(u.email)) {
      skippedTest++;
      continue;
    }
    if (PURGE_WHITELIST.some((re) => re.test(u.nickname))) {
      skippedWhitelist++;
      continue;
    }
    let target = seedCloneTarget(u.nickname);
    if (target && !taken.has(target)) {
      nSeedClone++;
    } else {
      // 非种子 clone 形态，或别名已被现名占用：退到通用池，确定性下标起步。
      target = genericNickname((u.id * 13) % GENERIC_POOL.length, taken);
      if (taken.has(target)) {
        // 不会到这里——genericNickname 已保证唯一；防御性断言。
        throw new Error(`fix-nicknames: 通用池选名冲突 ${target}`);
      }
    }
    taken.add(target);
    plans.push({ id: u.id, from: u.nickname, to: target });
  }

  const mode = APPLY ? "apply" : "dry-run";
  console.log(`[fix-nicknames] mode=${mode} db=${DB_PATH}`);
  console.log(
    `[fix-nicknames] 用户=${users.length} 待改名=${plans.length}` +
      `（种子 clone ${nSeedClone} / 通用池 ${plans.length - nSeedClone}）` +
      ` 跳过: 测试账号 ${skippedTest} 白名单 ${skippedWhitelist} admin ${skippedAdmin}`
  );
  for (const p of plans.slice(0, 20)) {
    console.log(`  u:${p.id} ${p.from} -> ${p.to}`);
  }
  if (plans.length > 20) console.log(`  … 其余 ${plans.length - 20} 条略`);

  if (!APPLY) {
    console.log(`[fix-nicknames] dry-run：将改写 ${plans.length} 个昵称（加 --apply 生效）`);
    db.close();
    return;
  }
  if (!plans.length) {
    console.log(`[fix-nicknames] 无需改动，跳过备份与写库`);
    db.close();
    return;
  }

  // 写库前备份到 data/backups/（与 fix-answer-authors-by-domain 同口径）
  const backupDir = path.join(__dirname, "..", "data", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[-:T]/g, "").replace(/\..*$/, "");
  const backupPath = path.join(backupDir, `zhihu-${ts}-nicknames.db`);
  await db.backup(backupPath);
  console.log(`[fix-nicknames] 已备份: ${backupPath}`);

  const upd = db.prepare("UPDATE users SET nickname = ? WHERE id = ?");
  let changed = 0;
  db.transaction(() => {
    for (const p of plans) changed += upd.run(p.to, p.id).changes;
  })();
  console.log(`[fix-nicknames] apply 完成：改写 ${changed} 个昵称`);

  // 收尾自检：非测试账号里不得再有可疑形态（幂等口径与断言一致）
  const left = users.filter(
    (u) =>
      !u.is_admin &&
      !testFlag.has(u.id) &&
      !isTestNickname(u.nickname) &&
      !isTestEmail(u.email)
  );
  const byId = new Map(plans.map((p) => [p.id, p.to]));
  const stillSuspicious = left
    .map((u) => byId.get(u.id) || u.nickname)
    .filter((n) => isSuspiciousNickname(n));
  if (stillSuspicious.length) {
    console.error(
      `[fix-nicknames] 写后仍有 ${stillSuspicious.length} 个可疑昵称: ${stillSuspicious.slice(0, 10).join(" ")}`
    );
    db.close();
    process.exit(1);
  }
  db.close();
}

main().catch((e) => {
  console.error(`[fix-nicknames] 失败: ${e.message || e}`);
  process.exit(1);
});
