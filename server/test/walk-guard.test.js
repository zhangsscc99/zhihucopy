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
