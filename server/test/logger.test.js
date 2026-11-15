const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.JWT_SECRET = "test-secret";
process.env.DB_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "zh-log-db-")),
  "test.db"
);
const LOG = path.join(os.tmpdir(), `zh-log-test-${process.pid}.log`);
const ROT_LOG = path.join(os.tmpdir(), `zh-log-test-${process.pid}-rot.log`);
process.env.LOG_PATH = LOG;

const express = require("express");
const { logger, requestLogger, httpErrorLogger, closeLog } = require("../logger");
const { createApp } = require("../app");

let server;
let base;
let mini;
let miniBase;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function lines(p = LOG) {
  try {
    return fs
      .readFileSync(p, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

before(async () => {
  for (const f of [LOG, ROT_LOG, LOG + ".1", ROT_LOG + ".1"]) {
    try {
      fs.unlinkSync(f);
    } catch {}
  }
  server = createApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;

  const app = express();
  app.use(requestLogger());
  app.get("/ok", (_req, res) => res.json({ ok: true }));
  app.get("/missing", (_req, res) => res.status(404).json({}));
  app.get("/bad-status", (_req, res) => res.status(503).json({}));
  app.get("/slow", async (_req, res) => {
    await sleep(30);
    res.json({});
  });
  app.get("/throw", () => {
    throw new Error("kapow");
  });
  app.use(httpErrorLogger());
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: "服务器内部错误" });
  });
  mini = app.listen(0, "127.0.0.1");
  await new Promise((r) => mini.once("listening", r));
  miniBase = `http://127.0.0.1:${mini.address().port}`;
});

after(async () => {
  if (server) server.close();
  if (mini) mini.close();
  await closeLog();
});

test("level mapping: 2xx info, 4xx warn, 5xx error", async () => {
  const before0 = lines().length;
  await fetch(`${miniBase}/ok`);
  await fetch(`${miniBase}/missing`);
  await fetch(`${miniBase}/bad-status`);
  await closeLog();
  const got = lines().slice(before0);
  assert.equal(got.length, 3);
  assert.equal(got[0].level, "info");
  assert.equal(got[0].status, 200);
  assert.equal(got[1].level, "warn");
  assert.equal(got[1].status, 404);
  assert.equal(got[2].level, "error");
  assert.equal(got[2].status, 503);
  for (const l of got) {
    assert.ok(l.ts && l.req_id && l.method && l.path);
    assert.equal(typeof l.ms, "number");
  }
});

test("slow request flagged with slow:true at warn", async () => {
  process.env.SLOW_MS = "5";
  try {
    const before0 = lines().length;
    await fetch(`${miniBase}/slow`);
    await closeLog();
    const got = lines().slice(before0).find((l) => l.path === "/slow");
    assert.equal(got.level, "warn");
    assert.equal(got.slow, true);
    assert.ok(got.ms >= 5);
  } finally {
    delete process.env.SLOW_MS;
  }
});

test("health is debug — suppressed at info, emitted at debug", async () => {
  const before0 = lines().length;
  const r = await fetch(`${base}/zhihucopy/api/health`);
  assert.equal(r.status, 200);
  await closeLog();
  assert.equal(lines().slice(before0).filter((l) => l.path === "/zhihucopy/api/health").length, 0);

  process.env.LOG_LEVEL = "debug";
  try {
    await fetch(`${base}/zhihucopy/api/health`);
    await closeLog();
    const got = lines().slice(before0).find((l) => l.path === "/zhihucopy/api/health");
    assert.equal(got.level, "debug");
  } finally {
    delete process.env.LOG_LEVEL;
  }
});

test("x-request-id reused and echoed; ua truncated to 200", async () => {
  const before0 = lines().length;
  const res = await fetch(`${base}/zhihucopy/api/nope`, {
    headers: { "x-request-id": "rid-123", "user-agent": "u".repeat(300) },
  });
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "接口不存在" });
  assert.equal(res.headers.get("x-request-id"), "rid-123");
  await closeLog();
  const got = lines().slice(before0).find((l) => l.req_id === "rid-123");
  assert.equal(got.level, "warn");
  assert.equal(got.ua.length, 200);
});

test("unhandled error logged with stack; response contract kept", async () => {
  const before0 = lines().length;
  const res = await fetch(`${miniBase}/throw`);
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "服务器内部错误" });
  await closeLog();
  const got = lines().slice(before0);
  const errLine = got.find((l) => l.msg === "unhandled_error");
  assert.equal(errLine.level, "error");
  assert.ok(errLine.err.stack.includes("kapow"));
  assert.ok(errLine.req_id && typeof errLine.ms === "number");
  // requestLogger also records the 500 as error
  assert.ok(got.find((l) => l.msg === "http" && l.status === 500 && l.level === "error"));
});

test("sensitive fields are redacted", async () => {
  const before0 = lines().length;
  logger.info("redact-check", {
    password: "PW-TOPSECRET",
    jwt: "JWT-TOPSECRET",
    nested: { authorization: "Bearer TOK-TOPSECRET" },
    keep: "visible",
  });
  await closeLog();
  const raw = fs.readFileSync(LOG, "utf8");
  assert.ok(!raw.includes("TOPSECRET"));
  const got = lines().slice(before0).find((l) => l.msg === "redact-check");
  assert.equal(got.password, "[redacted]");
  assert.equal(got.jwt, "[redacted]");
  assert.equal(got.nested.authorization, "[redacted]");
  assert.equal(got.keep, "visible");
});

test("size-based rotation to <log>.1", async () => {
  const prevPath = process.env.LOG_PATH;
  process.env.LOG_PATH = ROT_LOG;
  process.env.LOG_MAX_BYTES = "300";
  try {
    for (let i = 0; i < 10; i++) {
      logger.info(`rotation-line-${i}`, { pad: "x".repeat(50) });
    }
    await sleep(100); // let the async rename settle
    logger.info("post-rotate");
    await closeLog();
    assert.ok(fs.existsSync(ROT_LOG + ".1"), "rotated file should exist");
    assert.ok(fs.statSync(ROT_LOG + ".1").size > 0);
    const fresh = lines(ROT_LOG);
    assert.ok(fs.statSync(ROT_LOG).size <= 300);
    assert.deepEqual(fresh.map((l) => l.msg), ["post-rotate"]);
  } finally {
    delete process.env.LOG_MAX_BYTES;
    process.env.LOG_PATH = prevPath;
  }
});
