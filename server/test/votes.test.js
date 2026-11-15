const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.JWT_SECRET = "test-secret";
const tmpDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zhihu-votes-")), "test.db");

const { resetForTests } = require("../db");
resetForTests(tmpDb);
const { createApp } = require("../app");

let server;
let base;
let token;
let answerId;
let questionId;

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

  const reg = await api("POST", "/auth/register", {
    email: "voter@a.com",
    password: "secret1",
    nickname: "投票者",
  }, null);
  assert.equal(reg.status, 201);
  token = reg.json.token;

  const q = await api("POST", "/questions", { title: "测试问题", detail_md: "", topic_ids: [] });
  assert.equal(q.status, 201);
  questionId = q.json.question.id;
  const ans = await api("POST", `/questions/${questionId}/answers`, {
    content_md: "测试回答内容",
  });
  assert.equal(ans.status, 201);
  answerId = ans.json.answer.id;
});

after(() => server && server.close());

test("vote up -> count 1, repeat -> still 1, switch to down, cancel -> 0", async () => {
  let r = await api("POST", "/votes", { target_type: "answer", target_id: answerId, value: 1 });
  assert.equal(r.status, 200);
  assert.equal(r.json.vote, 1);
  assert.equal(r.json.voteup_count, 1);
  assert.equal(r.json.votedown_count, 0);

  r = await api("POST", "/votes", { target_type: "answer", target_id: answerId, value: 1 });
  assert.equal(r.status, 200);
  assert.equal(r.json.voteup_count, 1);
  assert.equal(r.json.votedown_count, 0);

  const mine = await api("GET", `/votes/mine?target_type=answer&target_id=${answerId}`);
  assert.equal(mine.json.vote, 1);

  r = await api("POST", "/votes", { target_type: "answer", target_id: answerId, value: -1 });
  assert.equal(r.status, 200);
  assert.equal(r.json.vote, -1);
  assert.equal(r.json.voteup_count, 0);
  assert.equal(r.json.votedown_count, 1);

  r = await api("POST", "/votes", { target_type: "answer", target_id: answerId, value: 0 });
  assert.equal(r.status, 200);
  assert.equal(r.json.vote, 0);
  assert.equal(r.json.voteup_count, 0);
  assert.equal(r.json.votedown_count, 0);

  const mine2 = await api("GET", `/votes/mine?target_type=answer&target_id=${answerId}`);
  assert.equal(mine2.json.vote, 0);
});

test("unauthenticated vote -> 401; anonymous /mine -> 0", async () => {
  const r = await api("POST", "/votes", { target_type: "answer", target_id: answerId, value: 1 }, null);
  assert.equal(r.status, 401);
  const mine = await api("GET", `/votes/mine?target_type=answer&target_id=${answerId}`, null, null);
  assert.equal(mine.status, 200);
  assert.equal(mine.json.vote, 0);
});

test("bad params -> 400; missing target -> 404", async () => {
  let r = await api("POST", "/votes", { target_type: "comment", target_id: answerId, value: 1 });
  assert.equal(r.status, 400);
  r = await api("POST", "/votes", { target_type: "answer", target_id: answerId, value: 5 });
  assert.equal(r.status, 400);
  r = await api("POST", "/votes", { target_type: "answer", target_id: -3, value: 1 });
  assert.equal(r.status, 400);
  r = await api("POST", "/votes", { target_type: "answer", target_id: 99999, value: 1 });
  assert.equal(r.status, 404);
});

test("question vote: up -> 1, repeat -> 1, switch to down, cancel -> 0; /mine reflects value", async () => {
  let r = await api("POST", "/votes", { target_type: "question", target_id: questionId, value: 1 });
  assert.equal(r.status, 200);
  assert.equal(r.json.vote, 1);
  assert.equal(r.json.voteup_count, 1);
  assert.equal(r.json.votedown_count, 0);

  r = await api("POST", "/votes", { target_type: "question", target_id: questionId, value: 1 });
  assert.equal(r.status, 200);
  assert.equal(r.json.voteup_count, 1);
  assert.equal(r.json.votedown_count, 0);

  const mine = await api("GET", `/votes/mine?target_type=question&target_id=${questionId}`);
  assert.equal(mine.json.vote, 1);

  r = await api("POST", "/votes", { target_type: "question", target_id: questionId, value: -1 });
  assert.equal(r.status, 200);
  assert.equal(r.json.vote, -1);
  assert.equal(r.json.voteup_count, 0);
  assert.equal(r.json.votedown_count, 1);

  const mine2 = await api("GET", `/votes/mine?target_type=question&target_id=${questionId}`);
  assert.equal(mine2.json.vote, -1);

  r = await api("POST", "/votes", { target_type: "question", target_id: questionId, value: 0 });
  assert.equal(r.status, 200);
  assert.equal(r.json.vote, 0);
  assert.equal(r.json.voteup_count, 0);
  assert.equal(r.json.votedown_count, 0);

  const mine3 = await api("GET", `/votes/mine?target_type=question&target_id=${questionId}`);
  assert.equal(mine3.json.vote, 0);

  const anon = await api("GET", `/votes/mine?target_type=question&target_id=${questionId}`, null, null);
  assert.equal(anon.status, 200);
  assert.equal(anon.json.vote, 0);

  r = await api("POST", "/votes", { target_type: "question", target_id: 99999, value: 1 });
  assert.equal(r.status, 404);
  assert.equal(r.json.error, "问题不存在");
});
