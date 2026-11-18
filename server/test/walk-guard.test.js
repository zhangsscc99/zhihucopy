const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.JWT_SECRET = "test-secret";
const tmpDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zhihu-walk-guard-")), "test.db");

const { resetForTests, getDb } = require("../db");
resetForTests(tmpDb);
const { isWalkProbeContent } = require("../content-filter");
const { createApp } = require("../app");

let server;
let base;
let token;
let walkToken;
let e2eToken;
let answerId;

async function api(method, p, body, tok) {
  const res = await fetch(`${base}/zhihucopy/api${p}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(tok ? { authorization: `Bearer ${tok}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const HIT = [
  "第3960条走查感想：这段关于依赖数组的解释我终于看懂了。",
  "走查：useEffect 清理这块写得不错",
  "走查42 路过，这个功能能用",
  "[e2e] c-abc123 赞同楼上",
  "走查第42轮：评论功能验证",
];

const MISS = [
  "代码走查时要注意边界",
  "走查表里第三项",
  "我把 B2B 这个缩写念成 B 二 B",
  "正常评论：谢谢，学到了",
];

test("isWalkProbeContent 命中模板形态", () => {
  for (const s of HIT) {
    assert.ok(isWalkProbeContent(s), `应命中：${s}`);
  }
});

test("isWalkProbeContent 不误伤正常评论", () => {
  for (const s of MISS) {
    assert.ok(!isWalkProbeContent(s), `不应命中：${s}`);
  }
});

before(async () => {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;

  const reg = await api("POST", "/auth/register", {
    email: "walker@zhihucopy.dev",
    password: "secret1",
    nickname: "普通用户甲",
  });
  assert.equal(reg.status, 201);
  token = reg.json.token;

  // Z1173：is_test=1 的两种账号 —— 走查流水号昵称（应仍被拦）与普通 e2e
  // 昵称（应放行）。@test.dev 注册域自动落 is_test=1。
  const wreg = await api("POST", "/auth/register", {
    email: "walk-probe@test.dev",
    password: "secret1",
    nickname: "沈舟拾1234",
  });
  assert.equal(wreg.status, 201);
  walkToken = wreg.json.token;
  const ereg = await api("POST", "/auth/register", {
    email: "e2e-u2965@test.dev",
    password: "secret1",
    nickname: "u2965",
  });
  assert.equal(ereg.status, 201);
  e2eToken = ereg.json.token;

  const q = await api("POST", "/questions", { title: "守卫测试问题" }, token);
  assert.equal(q.status, 201);
  const a = await api("POST", `/questions/${q.json.question.id}/answers`, { content_md: "回答正文" }, token);
  assert.equal(a.status, 201);
  answerId = a.json.answer.id;
});

after(() => {
  server.close();
});

function commentCount() {
  return getDb()
    .prepare(
      "SELECT COUNT(*) c FROM comments WHERE target_type = 'answer' AND target_id = ? AND is_deleted = 0"
    )
    .get(answerId).c;
}

test("POST /comments 模板正文 -> 403 且不入库", async () => {
  const before = commentCount();
  const r = await api(
    "POST",
    "/comments",
    { target_type: "answer", target_id: answerId, body: "第1条走查感想：测试" },
    token
  );
  assert.equal(r.status, 403);
  assert.equal(commentCount(), before);
});

test("POST /comments 正常正文 -> 201 入库", async () => {
  const before = commentCount();
  const r = await api(
    "POST",
    "/comments",
    { target_type: "answer", target_id: answerId, body: "这条回答讲得挺清楚，收藏了" },
    token
  );
  assert.equal(r.status, 201);
  assert.ok(r.json.comment && r.json.comment.id);
  assert.equal(commentCount(), before + 1);
});

test("POST /comments is_test=1 + 走查流水号昵称（沈舟拾1234）+ 正常正文 -> 403", async () => {
  const before = commentCount();
  const r = await api(
    "POST",
    "/comments",
    { target_type: "answer", target_id: answerId, body: "这条回答讲得挺清楚，收藏了" },
    walkToken
  );
  assert.equal(r.status, 403);
  assert.equal(commentCount(), before);
});

test("POST /comments is_test=1 + 普通 e2e 昵称（u2965）+ 正常正文 -> 201", async () => {
  const before = commentCount();
  const r = await api(
    "POST",
    "/comments",
    { target_type: "answer", target_id: answerId, body: "这条回答讲得挺清楚，收藏了" },
    e2eToken
  );
  assert.equal(r.status, 201);
  assert.ok(r.json.comment && r.json.comment.id);
  assert.equal(commentCount(), before + 1);
});
