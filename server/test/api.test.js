const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.JWT_SECRET = "test-secret";
const tmpDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zhihu-")), "test.db");

const { resetForTests } = require("../db");
resetForTests(tmpDb);
const { createApp } = require("../app");

let server;
let base;
let token;

async function api(method, p, body, tok = token) {
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

before(async () => {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server && server.close());

test("health", async () => {
  const r = await api("GET", "/health");
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
});

test("register + login + me", async () => {
  const bad = await api("POST", "/auth/register", {
    email: "not-an-email",
    password: "secret1",
    nickname: "x",
  });
  assert.equal(bad.status, 400);

  const reg = await api("POST", "/auth/register", {
    email: "a@b.com",
    password: "secret1",
    nickname: "阿明",
  });
  assert.equal(reg.status, 201);
  assert.ok(reg.json.token);
  token = reg.json.token;

  const dup = await api("POST", "/auth/register", {
    email: "a@b.com",
    password: "secret1",
    nickname: "别人",
  });
  assert.equal(dup.status, 409);

  const login = await api("POST", "/auth/login", {
    email: "a@b.com",
    password: "secret1",
  });
  assert.equal(login.status, 200);

  const wrong = await api("POST", "/auth/login", {
    email: "a@b.com",
    password: "nope",
  });
  assert.equal(wrong.status, 401);

  const me = await api("GET", "/auth/me");
  assert.equal(me.json.user.nickname, "阿明");

  const anon = await api("GET", "/auth/me", null, null);
  assert.equal(anon.status, 401);
});

test("questions + answers flow with pagination shape", async () => {
  const noauth = await api("POST", "/questions", { title: "标题" }, null);
  assert.equal(noauth.status, 401);

  const created = await api("POST", "/questions", {
    title: "为什么天空是蓝色的？",
    detail_md: "请从物理角度解释。",
    topic_ids: [],
  });
  assert.equal(created.status, 201);
  const qid = created.json.question.id;

  const badTitle = await api("POST", "/questions", { title: "" });
  assert.equal(badTitle.status, 400);

  const list = await api("GET", "/questions?tab=new&page=1&limit=10", null, null);
  assert.equal(list.status, 200);
  assert.equal(list.json.total, 1);
  assert.equal(list.json.has_more, false);
  assert.equal(list.json.items[0].id, qid);

  const detail = await api("GET", `/questions/${qid}`, null, null);
  assert.equal(detail.status, 200);
  assert.equal(detail.json.question.title, "为什么天空是蓝色的？");
  assert.equal(detail.json.answers.length, 0);

  const ans = await api("POST", `/questions/${qid}/answers`, {
    content_md: "因为瑞利散射，短波长光散射更强。",
  });
  assert.equal(ans.status, 201);

  const answers = await api("GET", `/questions/${qid}/answers?page=1`, null, null);
  assert.equal(answers.json.total, 1);
  assert.equal(answers.json.items[0].question_title, "为什么天空是蓝色的？");

  const one = await api("GET", `/answers/${ans.json.answer.id}`, null, null);
  assert.equal(one.status, 200);

  const missing = await api("GET", "/questions/99999", null, null);
  assert.equal(missing.status, 404);
});
