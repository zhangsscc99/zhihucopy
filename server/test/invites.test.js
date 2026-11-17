const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.JWT_SECRET = "test-secret";
const tmpDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zhihu-invites-")), "test.db");

const { resetForTests } = require("../db");
resetForTests(tmpDb);
const { createApp } = require("../app");

let server;
let base;
let tokenA;
let userA;
let userB;
let questionId;

async function api(method, p, body, tok = tokenA) {
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

  const regA = await api("POST", "/auth/register", {
    email: "inv-a@test.dev",
    password: "secret1",
    nickname: "邀请者甲",
  }, null);
  tokenA = regA.json.token;
  userA = regA.json.user;
  const regB = await api("POST", "/auth/register", {
    email: "inv-b@test.dev",
    password: "secret1",
    nickname: "受邀者乙",
  }, null);
  userB = regB.json.user;

  const q = await api("POST", "/questions", {
    title: "如何评价手写测试的行为？",
    detail_md: "想听听大家的做法。",
  });
  questionId = q.json.question.id;
});

after(() => server && server.close());

test("POST /invites 需要登录", async () => {
  const r = await api("POST", "/invites", { question_id: questionId, invitee_id: userB.id }, null);
  assert.equal(r.status, 401);
  const g = await api("GET", `/invites?question_id=${questionId}`, null, null);
  assert.equal(g.status, 401);
});

test("POST /invites 参数校验", async () => {
  for (const body of [
    {},
    { question_id: "abc", invitee_id: userB.id },
    { question_id: questionId, invitee_id: -1 },
    { question_id: 999999, invitee_id: userB.id },
    { question_id: questionId, invitee_id: 999999 },
  ]) {
    const r = await api("POST", "/invites", body);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  const self = await api("POST", "/invites", { question_id: questionId, invitee_id: userA.id });
  assert.equal(self.status, 400);
});

test("POST /invites 幂等 + GET 回读", async () => {
  const first = await api("POST", "/invites", { question_id: questionId, invitee_id: userB.id });
  assert.equal(first.status, 200);
  assert.equal(first.json.ok, true);
  assert.equal(first.json.already, false);
  assert.equal(first.json.invited_count, 1);

  const dup = await api("POST", "/invites", { question_id: questionId, invitee_id: userB.id });
  assert.equal(dup.json.already, true);
  assert.equal(dup.json.invited_count, 1);

  const list = await api("GET", `/invites?question_id=${questionId}`);
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.invitee_ids, [userB.id]);

  const otherQ = await api("GET", "/invites?question_id=999999");
  assert.deepEqual(otherQ.json.invitee_ids, []);

  const badQ = await api("GET", "/invites?question_id=abc");
  assert.equal(badQ.status, 400);
});
