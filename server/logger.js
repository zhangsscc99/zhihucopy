const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_LOG_PATH = path.join(__dirname, "..", "logs", "app.log");
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE_KEY = /pass(word)?|secret|token|jwt|authorization|cookie|salt/i;

let stream = null;
let openPath = null;
let curSize = 0;
let streamErrWarned = false;

function logPath() {
  return process.env.LOG_PATH || DEFAULT_LOG_PATH;
}

function maxBytes() {
  return Number(process.env.LOG_MAX_BYTES) || DEFAULT_MAX_BYTES;
}

function slowMs() {
  const v = Number(process.env.SLOW_MS);
  return v > 0 ? v : 800;
}

function minLevel() {
  return LEVELS[(process.env.LOG_LEVEL || "info").toLowerCase()] || LEVELS.info;
}

function ensureStream() {
  const p = logPath();
  if (stream && openPath !== p) {
    const old = stream;
    stream = null;
    old.end();
  }
  if (!stream) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    stream = fs.createWriteStream(p, { flags: "a" });
    openPath = p;
    try {
      curSize = fs.statSync(p).size;
    } catch {
      curSize = 0;
    }
    stream.on("error", (e) => {
      if (!streamErrWarned) {
        streamErrWarned = true;
        console.error("[zhihucopy] log stream error:", e.message);
      }
    });
  }
  return stream;
}

// Simple size-based rotation: app.log -> app.log.1 (overwrites), then a fresh
// stream is opened lazily on the next write.
function rotate() {
  const old = stream;
  stream = null;
  curSize = 0;
  if (!old) return;
  old.end(() => {
    try {
      fs.renameSync(logPath(), logPath() + ".1");
    } catch {
      // Best effort — never let logging break the app.
    }
    // Any stream opened in the gap was appending to the file we just renamed;
    // close it so the next write starts a fresh app.log.
    const s = stream;
    stream = null;
    curSize = 0;
    if (s) s.end();
  });
}

function sanitize(v, depth) {
  if (v == null || depth > 3) return v;
  if (v instanceof Error) {
    return { name: v.name, message: v.message, stack: v.stack, code: v.code };
  }
  if (Array.isArray(v)) return v.map((x) => sanitize(x, depth + 1));
  if (typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : sanitize(val, depth + 1);
    }
    return out;
  }
  return v;
}

function emit(level, msg, fields) {
  if (LEVELS[level] < minLevel()) return;
  let rec;
  try {
    rec = { ts: new Date().toISOString(), level, msg, ...(fields ? sanitize(fields, 0) : {}) };
  } catch {
    rec = { ts: new Date().toISOString(), level, msg };
  }
  const line = JSON.stringify(rec) + "\n";
  const len = Buffer.byteLength(line);
  ensureStream();
  if (curSize > 0 && curSize + len > maxBytes()) rotate();
  ensureStream().write(line);
  curSize += len;
}

const logger = {
  debug: (msg, fields) => emit("debug", msg, fields),
  info: (msg, fields) => emit("info", msg, fields),
  warn: (msg, fields) => emit("warn", msg, fields),
  error: (msg, fields) => emit("error", msg, fields),
};

// Health probes and static/SPA requests are noise at info level.
function isQuietPath(p) {
  if (p === "/zhihucopy/api/health" || p === "/zhihucopy") return true;
  return p.startsWith("/zhihucopy/") && !p.startsWith("/zhihucopy/api");
}

function elapsedMs(startNs) {
  return Math.round((Number(process.hrtime.bigint() - startNs) / 1e6) * 10) / 10;
}

function requestLogger() {
  return (req, res, next) => {
    const incoming = req.get("x-request-id");
    req.id =
      typeof incoming === "string" && incoming.trim()
        ? incoming.slice(0, 128)
        : crypto.randomUUID();
    res.setHeader("X-Request-Id", req.id);
    // Capture the path up front: mounted routers rewrite req.url, so reading
    // req.path inside the "finish" handler yields the router-relative path.
    const urlPath = String(req.originalUrl || req.url || "").split("?")[0];
    const quiet = isQuietPath(urlPath);
    const start = process.hrtime.bigint();
    req._logStartNs = start;
    res.on("finish", () => {
      const ms = elapsedMs(start);
      const status = res.statusCode;
      const slow = ms >= slowMs();
      let level = "info";
      if (status >= 500) level = "error";
      else if (status >= 400 || slow) level = "warn";
      else if (quiet) level = "debug";
      const fields = {
        req_id: req.id,
        method: req.method,
        path: req.originalUrl,
        status,
        ms,
        uid: req.user ? req.user.id : null,
        ip: req.ip,
        ua: String(req.get("user-agent") || "").slice(0, 200),
      };
      if (slow) fields.slow = true;
      emit(level, "http", fields);
    });
    next();
  };
}

// Error-handling middleware: logs the unhandled error with request context,
// then delegates to the app's final error handler via next(err).
function httpErrorLogger() {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    const status = res.statusCode >= 400 ? res.statusCode : 500;
    emit("error", "unhandled_error", {
      req_id: req.id,
      method: req.method,
      path: req.originalUrl,
      status,
      ms: req._logStartNs != null ? elapsedMs(req._logStartNs) : undefined,
      err,
    });
    next(err);
  };
}

// Flush and close the log stream; a new one is opened lazily on the next write.
function closeLog() {
  return new Promise((resolve) => {
    const s = stream;
    stream = null;
    openPath = null;
    curSize = 0;
    if (s) s.end(resolve);
    else resolve();
  });
}

module.exports = { logger, requestLogger, httpErrorLogger, closeLog };
