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

test("POST /comments 模板正文 -> 403 且不入库、回传命中规则名", async () => {
  const before = commentCount();
  const r = await api(
    "POST",
    "/comments",
    { target_type: "answer", target_id: answerId, body: "第1条走查感想：测试" },
    token
  );
  assert.equal(r.status, 403);
  assert.equal(commentCount(), before);
  assert.ok(r.json.rule, `403 缺 rule 字段：${JSON.stringify(r.json)}`);
  assert.ok(
    String(r.json.error).includes(r.json.rule),
    `error 未带规则名：${JSON.stringify(r.json)}`
  );
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

// Z1226：写侧守卫不再按账号昵称拒写 —— 走查流水号发自然语言评论正常入库
// （走查号 ≠ 违规内容）；该账号发模板正文仍被拦。
test("POST /comments is_test=1 + 走查流水号昵称（沈舟拾1234）+ 正常正文 -> 201", async () => {
  const before = commentCount();
  const r = await api(
    "POST",
    "/comments",
    { target_type: "answer", target_id: answerId, body: "这条回答讲得挺清楚，收藏了" },
    walkToken
  );
  assert.equal(r.status, 201);
  assert.ok(r.json.comment && r.json.comment.id);
  assert.equal(commentCount(), before + 1);
});

test("POST /comments 走查流水号昵称 + 模板正文 -> 仍 403", async () => {
  const before = commentCount();
  const r = await api(
    "POST",
    "/comments",
    { target_type: "answer", target_id: answerId, body: "走查：测试提交路径" },
    walkToken
  );
  assert.equal(r.status, 403);
  assert.ok(r.json.rule);
  assert.equal(commentCount(), before);
});

test("POST /comments 正文链接 ≥3 -> 400 too_many_links；=2 放行", async () => {
  const before = commentCount();
  const r3 = await api(
    "POST",
    "/comments",
    {
      target_type: "answer",
      target_id: answerId,
      body: "看 http://a.example/1 与 http://b.example/2 加 http://c.example/3",
    },
    token
  );
  assert.equal(r3.status, 400);
  assert.equal(r3.json.rule, "too_many_links");
  assert.ok(String(r3.json.error).includes("链接"));
  const r2 = await api(
    "POST",
    "/comments",
    {
      target_type: "answer",
      target_id: answerId,
      body: "两个链接可以 http://a.example/1 http://b.example/2",
    },
    token
  );
  assert.equal(r2.status, 201);
  assert.equal(commentCount(), before + 1);
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

// Z1226 读侧本人豁免：is_test=1 账号的评论对自己可见（viewer === author），
// 匿名与他人视角仍按公共口径过滤（total/items 都不含）。
test("GET /comments 测试账号评论本人可见、他人与匿名不可见", async () => {
  const posted = await api(
    "POST",
    "/comments",
    { target_type: "answer", target_id: answerId, body: "走查号的自然评论，本人应可见" },
    walkToken
  );
  assert.equal(posted.status, 201);
  const cid = posted.json.comment.id;

  const self = await api("GET", `/comments?target_type=answer&target_id=${answerId}`, null, walkToken);
  assert.equal(self.status, 200);
  assert.ok(
    self.json.items.some((c) => c.id === cid),
    "本人视角应能看到自己的评论"
  );

  const anon = await api("GET", `/comments?target_type=answer&target_id=${answerId}`);
  assert.equal(anon.status, 200);
  assert.ok(
    !anon.json.items.some((c) => c.id === cid),
    "匿名视角不应看到测试账号评论"
  );
  assert.ok(
    anon.json.total < self.json.total,
    `匿名 total ${anon.json.total} 应小于本人 total ${self.json.total}`
  );

  const other = await api("GET", `/comments?target_type=answer&target_id=${answerId}`, null, token);
  assert.equal(other.status, 200);
  assert.ok(
    !other.json.items.some((c) => c.id === cid),
    "他人登录视角不应看到测试账号评论"
  );
});
