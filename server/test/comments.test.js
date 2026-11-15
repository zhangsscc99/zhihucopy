const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.JWT_SECRET = "test-secret";
const tmpDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zhihu-comments-")), "test.db");

const { resetForTests } = require("../db");
resetForTests(tmpDb);
const { createApp } = require("../app");

let server;
let base;
let aliceToken;
let bobToken;
let aliceId;
let bobId;
let questionId;
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

async function register(email, nickname) {
  const r = await api("POST", "/auth/register", { email, password: "secret1", nickname });
  assert.equal(r.status, 201);
  return r.json;
}

before(async () => {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;

  const alice = await register("alice@test.com", "爱丽丝");
  const bob = await register("bob@test.com", "鲍勃");
  aliceToken = alice.token;
  bobToken = bob.token;
  aliceId = alice.user.id;
  bobId = bob.user.id;

  const q = await api("POST", "/questions", { title: "评论测试问题" }, aliceToken);
  assert.equal(q.status, 201);
  questionId = q.json.question.id;

  const a = await api("POST", `/questions/${questionId}/answers`, { content_md: "一个回答" }, bobToken);
  assert.equal(a.status, 201);
  answerId = a.json.answer.id;
});

after(() => server && server.close());

test("未登录发评论返回 401", async () => {
  const r = await api("POST", "/comments", {
    target_type: "answer",
    target_id: answerId,
    body: "匿名评论",
  });
  assert.equal(r.status, 401);
  assert.ok(r.json.error);
});

test("参数校验返回 400", async () => {
  const badType = await api(
    "POST",
    "/comments",
    { target_type: "user", target_id: answerId, body: "x" },
    aliceToken
  );
  assert.equal(badType.status, 400);

  const badTarget = await api(
    "POST",
    "/comments",
    { target_type: "answer", target_id: "abc", body: "x" },
    aliceToken
  );
  assert.equal(badTarget.status, 400);

  const empty = await api(
    "POST",
    "/comments",
    { target_type: "answer", target_id: answerId, body: "   " },
    aliceToken
  );
  assert.equal(empty.status, 400);

  const tooLong = await api(
    "POST",
    "/comments",
    { target_type: "answer", target_id: answerId, body: "字".repeat(501) },
    aliceToken
  );
  assert.equal(tooLong.status, 400);
});

test("目标不存在返回 404", async () => {
  const r = await api("POST", "/comments", {
    target_type: "answer",
    target_id: 999999,
    body: "不存在",
  }, aliceToken);
  assert.equal(r.status, 404);

  const list = await api("GET", "/comments?target_type=answer&target_id=999999");
  assert.equal(list.status, 404);

  const badQuery = await api("GET", "/comments?target_type=answer&target_id=x");
  assert.equal(badQuery.status, 400);
});

let topId;

test("发顶层评论并出现在列表中", async () => {
  const r = await api(
    "POST",
    "/comments",
    { target_type: "answer", target_id: answerId, body: "  第一条评论  " },
    aliceToken
  );
  assert.equal(r.status, 201);
  assert.equal(r.json.comment.content, "第一条评论");
  assert.equal(r.json.comment.author.nickname, "爱丽丝");
  assert.equal(r.json.comment.author.id, aliceId);
  assert.equal(r.json.comment.parent_id, null);
  topId = r.json.comment.id;

  const list = await api("GET", `/comments?target_type=answer&target_id=${answerId}`);
  assert.equal(list.status, 200);
  assert.equal(list.json.total, 1);
  assert.equal(list.json.items.length, 1);
  assert.equal(list.json.items[0].id, topId);
  assert.deepEqual(list.json.items[0].children, []);
});

let replyId;

test("二级回复挂到顶层评论下", async () => {
  const r = await api(
    "POST",
    "/comments",
    { target_type: "answer", target_id: answerId, parent_id: topId, body: "回复一下" },
    bobToken
  );
  assert.equal(r.status, 201);
  assert.equal(r.json.comment.parent_id, topId);
  replyId = r.json.comment.id;

  const list = await api("GET", `/comments?target_type=answer&target_id=${answerId}`);
  assert.equal(list.status, 200);
  assert.equal(list.json.items.length, 1, "只有一条顶层评论");
  assert.equal(list.json.items[0].children.length, 1);
  assert.equal(list.json.items[0].children[0].id, replyId);
  assert.equal(list.json.items[0].children[0].author.nickname, "鲍勃");
  assert.equal(list.json.items[0].reply_count, 1);
});

test("禁止三级回复返回 400", async () => {
  const r = await api(
    "POST",
    "/comments",
    { target_type: "answer", target_id: answerId, parent_id: replyId, body: "三级回复" },
    aliceToken
  );
  assert.equal(r.status, 400);
  assert.match(r.json.error, /两级/);
});

test("父评论不属于同一目标返回 400", async () => {
  const q = await api("GET", `/comments?target_type=question&target_id=${questionId}`);
  assert.equal(q.status, 200);
  const r = await api(
    "POST",
    "/comments",
    { target_type: "question", target_id: questionId, parent_id: topId, body: "串目标" },
    aliceToken
  );
  assert.equal(r.status, 400);
});

test("删除他人评论返回 403", async () => {
  const r = await api("DELETE", `/comments/${topId}`, null, bobToken);
  assert.equal(r.status, 403);
  assert.match(r.json.error, /只能删除自己的评论/);

  const list = await api("GET", `/comments?target_type=answer&target_id=${answerId}`);
  assert.equal(list.json.items[0].content, "第一条评论", "403 后正文仍在");
});

test("删除自己的评论后正文不再返回，且重复删除幂等", async () => {
  const del = await api("DELETE", `/comments/${topId}`, null, aliceToken);
  assert.equal(del.status, 200);
  assert.equal(del.json.deleted, true);

  const list = await api("GET", `/comments?target_type=answer&target_id=${answerId}`);
  assert.equal(list.status, 200);
  const top = list.json.items[0];
  assert.equal(top.is_deleted, true);
  assert.equal(top.content, null);
  assert.equal(top.placeholder, "该评论已删除");
  assert.equal(top.author, null);
  assert.equal(list.json.items[0].children.length, 1, "删除后回复仍保留");

  const again = await api("DELETE", `/comments/${topId}`, null, aliceToken);
  assert.equal(again.status, 200);
  assert.equal(again.json.already_deleted, true);

  const missing = await api("DELETE", "/comments/999999", null, aliceToken);
  assert.equal(missing.status, 404);
});

test("答案评论计数随增删维护", async () => {
  const before = await api("GET", `/answers/${answerId}`);
  // topId 已删、replyId 仍在 ⇒ 1
  assert.equal(before.json.answer.comment_count, 1);

  const extra = await api(
    "POST",
    "/comments",
    { target_type: "answer", target_id: answerId, body: "再加一条" },
    aliceToken
  );
  assert.equal(extra.status, 201);
  const mid = await api("GET", `/answers/${answerId}`);
  assert.equal(mid.json.answer.comment_count, 2);

  const del = await api("DELETE", `/comments/${extra.json.comment.id}`, null, aliceToken);
  assert.equal(del.status, 200);
  const after = await api("GET", `/answers/${answerId}`);
  assert.equal(after.json.answer.comment_count, 1);
});

test("题目评论可用（target_type=question）", async () => {
  const r = await api(
    "POST",
    "/comments",
    { target_type: "question", target_id: questionId, body: "题目下的评论" },
    bobToken
  );
  assert.equal(r.status, 201);

  const list = await api("GET", `/comments?target_type=question&target_id=${questionId}`);
  assert.equal(list.status, 200);
  assert.equal(list.json.total, 1);
  assert.equal(list.json.items[0].content, "题目下的评论");
});
