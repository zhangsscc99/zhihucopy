const path = require("path");
const fs = require("fs");
const express = require("express");
const { optionalAuth } = require("./auth");
const { requestLogger, httpErrorLogger } = require("./logger");

const CLIENT_DIST = path.join(__dirname, "..", "client", "dist");

function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(requestLogger());
  app.use(express.json({ limit: "1mb" }));
  app.use(optionalAuth);

  const api = express.Router();
  api.get("/health", (_req, res) => res.json({ ok: true, service: "zhihucopy" }));
  const routesDir = path.join(__dirname, "routes");
  for (const file of fs.readdirSync(routesDir).filter((f) => f.endsWith(".js") && !f.startsWith("_") && !f.startsWith(".")).sort()) {
    const name = file.slice(0, -".js".length);
    api.use("/" + name, require(path.join(routesDir, file)));
  }
  api.use("/admin", require(path.join(routesDir, "reports.js")).admin);
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

  app.use(httpErrorLogger());
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: "服务器内部错误" });
  });

  return app;
}

module.exports = { createApp };
