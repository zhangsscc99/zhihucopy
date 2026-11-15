const path = require("path");
const fs = require("fs");
const express = require("express");
const { optionalAuth } = require("./auth");

const CLIENT_DIST = path.join(__dirname, "..", "client", "dist");
const LOG_DIR = path.join(__dirname, "..", "logs");

function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(optionalAuth);

  // Lightweight structured request log.
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logStream = fs.createWriteStream(path.join(LOG_DIR, "app.log"), { flags: "a" });
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      logStream.write(
        JSON.stringify({
          ts: new Date().toISOString(),
          method: req.method,
          url: req.originalUrl,
          status: res.statusCode,
          ms: Math.round(ms * 10) / 10,
          uid: req.user ? req.user.id : null,
        }) + "\n"
      );
    });
    next();
  });

  const api = express.Router();
  api.get("/health", (_req, res) => res.json({ ok: true, service: "zhihucopy" }));
  api.use("/auth", require("./routes/auth"));
  api.use("/users", require("./routes/users"));
  api.use("/questions", require("./routes/questions"));
  api.use("/answers", require("./routes/answers"));
  api.use((_req, res) => res.status(404).json({ error: "接口不存在" }));
  app.use("/zhihucopy/api", api);

  // Static client + SPA fallback under the /zhihucopy base path.
  app.use("/zhihucopy", express.static(CLIENT_DIST, { redirect: false }));
  app.get(["/zhihucopy", "/zhihucopy/*"], (req, res, next) => {
    if (req.method !== "GET") return next();
    const index = path.join(CLIENT_DIST, "index.html");
    if (fs.existsSync(index)) return res.sendFile(index);
    res.status(503).send("Client not built yet — run `npm --prefix client run build`.");
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error("[zhihucopy] unhandled error:", err);
    res.status(500).json({ error: "服务器内部错误" });
  });

  return app;
}

module.exports = { createApp };
