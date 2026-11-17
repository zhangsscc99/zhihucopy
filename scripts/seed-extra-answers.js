#!/usr/bin/env node
/**
 * scripts/seed-extra-answers.js — 热榜题回答存量增补（Z1153）
 *
 * 背景：线上热榜首屏题只有 3 条回答，全站最大 answer_count=4，小于
 * 详情页分页阈值（首屏 5 条 + 页大小 10），「查看全部 N 个回答 /
 * 加载更多回答」在真实数据下永不可达，分页路径零覆盖（Z1055 记的盲区）。
 * 本脚本把 scripts/seed-data/extra-answers.js 的原创回答按「title 精确
 * 匹配」增量补进既有库，不清表、不重建、不动其它题。
 *
 * 行为：
 *   1. 默认 dry-run：打印每题计划（找到/跳过、拟派作者、created_at、票数），
 *      不写库。--apply 才写；写前 db.backup() 到 <db目录>/backups/。
 *   2. 幂等：按 question 内「content_md 前 40 字已存在」跳过（主判据，可
 *      反复执行）；再按「同一 question_id + author_id 已有回答」兜底跳过；
 *      title 找不到的问题整条跳过并打印警告（不模糊匹配、不猜 id）。
 *   3. 作者：users 表 is_test=0、非提问者、非本题已有回答作者；有 authorHint
 *      时优先该原型（personaBaseOf 还原，含真实感别名）下的候选，否则退回
 *      「作者领域 ∩ 问题话题可接受域」全池（与 seed.js/seed-persona-domain
 *      同一套 TOPIC_DOMAINS 口径）。同题内作者互不相同。
 *   4. created_at：落在「问题 created_at 之后、NOW-10min 之前」，按序号在
 *      窗口内均匀布点 + 确定性抖动；同题内两两 ≥20 分钟，窗口过窄时改为
 *      自 NOW-10min 向前等距倒推。
 *   5. vote_up/vote_down：取该题既有回答中位数 ±15% 确定性抖动，且写入真实
 *      votes 行（投票人 is_test=0、非作者本人）；comment_count 插完按真实
 *      comments 行数重算。
 *   6. 尾部重算：受影响 questions.answer_count（is_deleted=0 实数）与受影响
 *      作者的 salt_value/level（与 seed.js 同一段 UPDATE 口径，仅按 id 收敛）。
 *
 * 用法：
 *   node scripts/seed-extra-answers.js                        # dry-run
 *   DB_PATH=/tmp/zhihu.db node scripts/seed-extra-answers.js --apply
 *   生产库：--apply --prod 且 ZH_ALLOW_PROD_WRITE=1（prod-write-gate 口径）。
 */
"use strict";

const fs = require("fs");
const path = require("path");

function requireFromServer(name) {
  try {
    return require(name);
  } catch (e) {
    return require(
      require.resolve(name, { paths: [path.join(__dirname, "..", "server")] })
    );
  }
}
const Database = requireFromServer("better-sqlite3");
const { resolveWriteMode } = require("./prod-write-gate");
const { EXTRA_ANSWERS } = require("./seed-data/extra-answers");
const {
  PERSONA_DOMAINS,
  personaBaseOf,
  domainsOf,
  acceptedForTopics,
} = require("./persona-domains");
const { TOPICS } = require("./seed");

const DB_PATH = path.resolve(
  process.env.DB_PATH || path.join(__dirname, "..", "data", "zhihu.db")
);
const APPLY = process.argv.includes("--apply");

// ---- 语料校验（加载期失败直接抛，不进 main） -------------------------------
const cnLen = (s) => [...s].length;
const BANNED = [/首先[^\n]{0,60}其次[^\n]{0,60}最后/, /希望对你有帮助/, /综上所述/, /以上[，,。．]?$|（以上）/];
const TEST_MARKERS = ["[e2e]", "[assert]", "巡检", "assert-"];
{
  const seenTitle = new Set();
  const seenPrefix = new Set();
  for (const s of EXTRA_ANSWERS) {
    const where = `seed-data/extra-answers.js: 「${String(s.title).slice(0, 24)}…」`;
    if (typeof s.title !== "string" || !s.title.trim() || s.title.length > 100) {
      throw new Error(`${where} 标题缺失或超过 100 字符`);
    }
    if (seenTitle.has(s.title)) throw new Error(`${where} 标题重复`);
    seenTitle.add(s.title);
    if (!Array.isArray(s.answers) || s.answers.length < 5 || s.answers.length > 9) {
      throw new Error(`${where} answers 需 5–9 条（实际 ${s.answers && s.answers.length}）`);
    }
    for (const [k, a] of s.answers.entries()) {
      const at = `${where} 第 ${k + 1} 条`;
      const len = cnLen(String(a.content || "").trim());
      if (len < 150 || len > 400) {
        throw new Error(`${at} 正文 ${len} 字（需 150–400）`);
      }
      for (const re of BANNED) {
        if (re.test(a.content)) throw new Error(`${at} 命中模板句 ${re}`);
      }
      for (const m of TEST_MARKERS) {
        if (s.title.includes(m) || a.content.includes(m)) {
          throw new Error(`${at} 含测试标记「${m}」`);
        }
      }
      const prefix = a.content.trim().slice(0, 40);
      if (seenPrefix.has(prefix)) throw new Error(`${at} 前 40 字与其它语料重复`);
      seenPrefix.add(prefix);
      if (a.authorHint !== undefined && !PERSONA_DOMAINS[a.authorHint]) {
        throw new Error(`${at} authorHint「${a.authorHint}」不在 PERSONA_DOMAINS`);
      }
    }
  }
}

// ---- 确定性随机：每个回答一颗种子（标题+序号+前 40 字），与执行次序无关 -----
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function strHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const pad2 = (n) => String(n).padStart(2, "0");
const fmtTs = (ms) => {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
  );
};
const parseTs = (s) => Date.parse(String(s).replace(" ", "T") + "Z");

const MIN_GAP = 20 * 60 * 1000;
const TOPIC_CAT = new Map(TOPICS.map((t) => [t.name, t.cat]));

function median(nums) {
  if (!nums.length) return 0;
  const a = nums.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// 同题新回答的落点：窗口 (q.created_at, NOW-10min] 内均匀布点 + 有界抖动；
// 窗口过窄（放不下 ≥20min 间隔）时改自 NOW-10min 等距倒推，仍放不下返回 null。
function planTimes(qCreatedMs, n, rng, capMs) {
  const W = capMs - qCreatedMs;
  if (W <= 0) return null;
  const slot = W / (n + 1);
  if (slot >= MIN_GAP) {
    // 抖动上界 (slot-MIN_GAP)/2：相邻两点最近也保持 MIN_GAP；再压到 0.4*slot
    // 保证首点 > q.created、末点 < capMs，无需再裁剪。
    const jitterMax = Math.min(slot * 0.4, Math.max(0, (slot - MIN_GAP) / 2));
    return Array.from({ length: n }, (_, k) =>
      qCreatedMs + slot * (k + 1) + (rng() - 0.5) * 2 * jitterMax
    );
  }
  // 窄窗口：最新一条贴 NOW-10min，向前等距（20–30min）倒推。
  const ts = new Array(n);
  let t = capMs;
  for (let k = n - 1; k >= 0; k--) {
    ts[k] = t;
    t -= MIN_GAP + Math.floor(rng() * 10 * 60 * 1000);
  }
  if (ts[0] <= qCreatedMs) {
    const shift = qCreatedMs + 5 * 60 * 1000 - ts[0];
    for (let k = 0; k < n; k++) ts[k] += shift;
    if (ts[n - 1] > capMs) return null; // 窗口连最小间隔都放不下
  }
  return ts;
}

async function main() {
  console.log(`[seed-extra-answers] db=${DB_PATH} mode=${APPLY ? "APPLY" : "dry-run"}`);
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[seed-extra-answers] 目标库不存在：${DB_PATH}（本脚本只做增量，不建库）`);
    process.exit(1);
  }
  const db = new Database(DB_PATH, APPLY ? undefined : { readonly: true });

  const users = db
    .prepare("SELECT id, nickname, bio FROM users WHERE is_test = 0 ORDER BY id")
    .all();
  const capMs = Date.now() - 10 * 60 * 1000;

  const getQ = db.prepare(
    "SELECT id, title, author_id, created_at, answer_count FROM questions WHERE title = ? ORDER BY id"
  );
  const topicNamesOf = db.prepare(
    `SELECT t.name FROM question_topics qt JOIN topics t ON t.id = qt.topic_id
     WHERE qt.question_id = ? ORDER BY t.name`
  );
  const existingAnswers = db.prepare(
    `SELECT id, author_id, vote_up, vote_down, substr(content_md, 1, 40) AS prefix
     FROM answers WHERE question_id = ? AND is_deleted = 0`
  );
  const authorHasAnswer = db.prepare(
    "SELECT COUNT(*) c FROM answers WHERE question_id = ? AND author_id = ?"
  );

  const plans = [];
  for (const s of EXTRA_ANSWERS) {
    const rows = getQ.all(s.title);
    if (!rows.length) {
      console.log(`  ! 「${s.title.slice(0, 30)}…」 title 精确匹配不到问题，跳过`);
      continue;
    }
    if (rows.length > 1) {
      console.log(`  ! 「${s.title.slice(0, 30)}…」 匹配到 ${rows.length} 行，取最小 id=${rows[0].id}`);
    }
    const q = rows[0];
    const topics = topicNamesOf.all(q.id).map((r) => r.name);
    const acc = acceptedForTopics(topics, (n) => TOPIC_CAT.get(n));
    const existing = existingAnswers.all(q.id);
    const existAuthors = new Set(existing.map((a) => a.author_id));
    const existPrefix = new Set(existing.map((a) => a.prefix));
    const medUp = median(existing.map((a) => a.vote_up));
    const medDown = median(existing.map((a) => a.vote_down));
    plans.push({
      q, topics, acc, existing, existAuthors, existPrefix, medUp, medDown,
      corpus: s.answers,
    });
  }

  // ---- 逐题构建插入计划 --------------------------------------------------
  const insPlan = []; // {qid, authorId, content, createdMs, up, down, rng}
  const touchedQids = new Set();
  const touchedAuthors = new Set();
  for (const p of plans) {
    const qid = p.q.id;
    // 本题新回答的 created_at 布点（先定时间槽，再按序分给未跳过的语料）。
    const pending = p.corpus.filter((a) => !p.existPrefix.has(a.content.trim().slice(0, 40)));
    const skippedDup = p.corpus.length - pending.length;
    if (skippedDup) {
      console.log(`  = q#${qid} 「${p.q.title.slice(0, 24)}…」 ${skippedDup} 条内容已存在（前 40 字命中），跳过`);
    }
    if (!pending.length) {
      console.log(`  = q#${qid} 「${p.q.title.slice(0, 24)}…」 无需新增（${p.q.answer_count} 条）`);
      continue;
    }
    const timeRng = mulberry32(strHash(`time:${qid}`));
    const slots = planTimes(parseTs(p.q.created_at), pending.length, timeRng, capMs);
    if (!slots) {
      console.log(`  ! q#${qid} 时间窗 (${p.q.created_at} ~ NOW-10min) 放不下 ${pending.length} 条 ≥20min 间隔，跳过本题`);
      continue;
    }
    const usedAuthors = new Set(p.existAuthors);
    let picked = 0;
    for (const [k, a] of pending.entries()) {
      const rng = mulberry32(strHash(`${qid}:${k}:${a.content.trim().slice(0, 40)}`));
      const fits = (u) => {
        const mine = domainsOf(u.nickname, u.bio);
        for (const d of mine) if (p.acc.domains.has(d)) return true;
        return false;
      };
      let pool = users.filter(
        (u) =>
          u.id !== p.q.author_id && !usedAuthors.has(u.id) && fits(u)
      );
      if (a.authorHint) {
        const hinted = pool.filter((u) => personaBaseOf(u.nickname) === a.authorHint);
        if (hinted.length) pool = hinted;
        else console.log(`    · q#${qid} 第 ${k + 1} 条 authorHint「${a.authorHint}」无可用候选，退回同域池`);
      }
      if (!pool.length) {
        console.log(`    ! q#${qid} 第 ${k + 1} 条无可用作者（领域池耗尽），跳过本条`);
        continue;
      }
      const author = pool[Math.floor(rng() * pool.length)];
      usedAuthors.add(author.id);
      const up = Math.max(0, Math.round(p.medUp * (0.85 + rng() * 0.3)));
      const down = p.medDown > 0
        ? Math.max(0, Math.round(p.medDown * (0.8 + rng() * 0.4)))
        : rng() < 0.15
          ? 1 + Math.floor(rng() * 2)
          : 0;
      insPlan.push({
        qid,
        title: p.q.title,
        authorId: author.id,
        nick: author.nickname,
        content: a.content.trim(),
        createdMs: slots[k],
        up,
        down,
        rng,
      });
      picked++;
      touchedQids.add(qid);
      touchedAuthors.add(author.id);
    }
    console.log(
      `  + q#${qid} 「${p.q.title.slice(0, 24)}…」 ${p.existing.length} -> ${p.existing.length + picked} 条` +
        `（中位赞 ${p.medUp}/${p.medDown}）`
    );
  }

  for (const a of insPlan) {
    console.log(
      `    -> q#${a.qid} 作者=${a.nick}#${a.authorId} ${fmtTs(a.createdMs)} ` +
        `赞 ${a.up}/踩 ${a.down} 「${a.content.slice(0, 26)}…」`
    );
  }
  console.log(`[seed-extra-answers] 计划新增 ${insPlan.length} 条回答，涉及 ${touchedQids.size} 题`);

  if (!APPLY || !insPlan.length) {
    if (!APPLY) console.log("[seed-extra-answers] dry-run 未写库；--apply 才真正写入");
    db.close();
    return;
  }

  // 写库前先备份到 <db目录>/backups/，文件名与 prod-write-gate「当日备份」口径一致。
  const bdir = path.join(path.dirname(DB_PATH), "backups");
  fs.mkdirSync(bdir, { recursive: true });
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  const backup = path.join(bdir, `zhihu-${stamp}-extra-answers.db`);
  await db.backup(backup);
  console.log(`[seed-extra-answers] 备份已落盘：${backup}`);

  const mode = resolveWriteMode({
    argv: process.argv.concat(["--backup", backup]),
    env: process.env,
    dbPath: DB_PATH,
    scriptName: "seed-extra-answers",
    Database,
  });
  if (mode !== "apply") {
    db.close();
    return;
  }

  const insAnswer = db.prepare(
    `INSERT INTO answers (question_id, author_id, content_md, vote_up, vote_down, comment_count, is_collapsed, is_deleted, created_at, updated_at)
     VALUES (?, ?, ?, 0, 0, 0, 0, 0, ?, ?)`
  );
  const insVote = db.prepare(
    "INSERT OR IGNORE INTO votes (user_id, answer_id, value, created_at) VALUES (?, ?, ?, ?)"
  );
  const tx = db.transaction(() => {
    for (const a of insPlan) {
      if (authorHasAnswer.get(a.qid, a.authorId).c) {
        console.log(`    = q#${a.qid} 作者#${a.authorId} 已有回答，事务内跳过（幂等兜底）`);
        continue;
      }
      const created = fmtTs(a.createdMs);
      const aid = Number(insAnswer.run(a.qid, a.authorId, a.content, created, created).lastInsertRowid);
      // 真实 votes 行：确定性洗牌，前 up 个投 +1，随后 down 个投 -1。
      const voters = users
        .filter((u) => u.id !== a.authorId)
        .map((u) => u.id)
        .sort(() => a.rng() - 0.5);
      const n = Math.min(a.up + a.down, voters.length);
      for (let i = 0; i < n; i++) {
        const value = i < a.up ? 1 : -1;
        const t = Math.min(Date.now() - 60000, a.createdMs + 3600000 + Math.floor(a.rng() * 3 * 86400000));
        insVote.run(voters[i], aid, value, fmtTs(t));
      }
      a.aid = aid;
    }
    // 计数回填：只动本脚本插入的回答与受影响的问题/作者。
    const ids = insPlan.filter((a) => a.aid).map((a) => a.aid);
    if (ids.length) {
      db.prepare(
        `UPDATE answers SET
           vote_up = (SELECT COUNT(*) FROM votes v WHERE v.answer_id = answers.id AND v.value = 1),
           vote_down = (SELECT COUNT(*) FROM votes v WHERE v.answer_id = answers.id AND v.value = -1),
           comment_count = (SELECT COUNT(*) FROM comments c WHERE c.target_type = 'answer' AND c.target_id = answers.id AND c.is_deleted = 0)
         WHERE answers.id IN (${ids.join(",")})`
      ).run();
    }
    for (const qid of touchedQids) {
      db.prepare(
        `UPDATE questions SET answer_count =
           (SELECT COUNT(*) FROM answers a WHERE a.question_id = questions.id AND a.is_deleted = 0)
         WHERE id = ?`
      ).run(qid);
    }
    const aids = [...touchedAuthors];
    if (aids.length) {
      const inClause = aids.join(",");
      db.prepare(
        `UPDATE users SET
           salt_value = MAX(0,
             2 * (SELECT COALESCE(SUM(a.vote_up), 0) FROM answers a WHERE a.author_id = users.id AND a.is_deleted = 0)
             + 5 * (SELECT COUNT(*) FROM answers a
                    WHERE a.author_id = users.id AND a.is_deleted = 0
                      AND a.vote_up = (SELECT MAX(b.vote_up) FROM answers b
                                       WHERE b.question_id = a.question_id AND b.is_deleted = 0)
                      AND a.vote_up > 0)
             - 10 * (SELECT COUNT(*) FROM answers a WHERE a.author_id = users.id AND a.is_collapsed = 1)
           )
         WHERE users.id IN (${inClause})`
      ).run();
      db.prepare(
        `UPDATE users SET level = CASE
           WHEN salt_value >= 300 THEN 7
           WHEN salt_value >= 200 THEN 6
           WHEN salt_value >= 130 THEN 5
           WHEN salt_value >= 80  THEN 4
           WHEN salt_value >= 40  THEN 3
           WHEN salt_value >= 15  THEN 2
           ELSE 1 END
         WHERE users.id IN (${inClause})`
      ).run();
    }
  });
  tx();

  const written = insPlan.filter((a) => a.aid).length;
  console.log(`[seed-extra-answers] 实写 ${written} 条回答 + votes 行，受影响题 ${touchedQids.size}、作者 ${touchedAuthors.size}`);
  for (const qid of touchedQids) {
    const c = db.prepare("SELECT answer_count FROM questions WHERE id = ?").get(qid).answer_count;
    console.log(`    q#${qid} answer_count -> ${c}`);
  }
  db.close();
}

main().catch((e) => {
  console.error(`[seed-extra-answers] FAIL: ${e.message || e}`);
  process.exit(1);
});
