const path = require("path");
const fs = require("fs");
const express = require("express");
const { optionalAuth } = require("./auth");
const { requestLogger, httpErrorLogger } = require("./logger");
const { getDb } = require("./db");

const CLIENT_DIST = path.join(__dirname, "..", "client", "dist");

// SPA 单段路由白名单（与 client/src/App.tsx 的 <Route> 表同步维护）：
// 命中 → 200 + index.html；未命中 → 404 + index.html（前端自渲染统一 404 页）。
const SPA_SINGLE_PAGES = new Set([
  "search",
  "topics",
  "unanswered",
  "ask",
  "login",
  "register",
  "me",
  "notifications",
  "collections",
  "admin",
]);

// 内容路由的目标存在性判定，口径与对应 API 路由一致（routes/questions.js、
// users.js 的 WHERE id = ?，topics.js 的 findTopic：key 可为 id 或 slug/name）。
function spaContentExists(head, param) {
  const db = getDb();
  if (head === "question") {
    return !!db.prepare("SELECT 1 AS x FROM questions WHERE id = ?").get(param);
  }
  if (head === "u") {
    return !!db.prepare("SELECT 1 AS x FROM users WHERE id = ?").get(param);
  }
  if (/^\d+$/.test(param)) {
    return !!db.prepare("SELECT 1 AS x FROM topics WHERE id = ?").get(Number(param));
  }
  return !!db.prepare("SELECT 1 AS x FROM topics WHERE slug = ? OR name = ?").get(param, param);
}

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
    if (!fs.existsSync(index)) {
      return res
        .status(503)
        .send("Client not built yet — run `npm --prefix client run build`.");
    }

    const segments = req.path
      .slice("/zhihucopy".length)
      .split("/")
      .filter(Boolean);
    const [head, param] = segments;

    // 内容路由（/question/:id、/u/:id、/topic/:key）：先查库——存在 200、缺失 404，
    // 两种都回 index.html 由前端渲染。查库异常按存在处理：不把服务故障误标成 404，
    // 留给前端 API 错误归因（服务暂时不可用）。
    if (
      segments.length === 2 &&
      (head === "question" || head === "u" || head === "topic")
    ) {
      let exists = true;
      try {
        exists = spaContentExists(head, decodeURIComponent(param));
      } catch {
        exists = true;
      }
      return res.status(exists ? 200 : 404).sendFile(index);
    }

    // 静态资源缺失（末段含扩展名）：404，不回 HTML。
    if (path.extname(segments[segments.length - 1] || "")) {
      return res.status(404).end();
    }

    // 其余无扩展名路径：命中 SPA 路由表 → 200；未命中 → 404 + index.html。
    const known =
      segments.length === 0 ||
      (segments.length === 1 && SPA_SINGLE_PAGES.has(head)) ||
      (segments.length === 2 && head === "collections");
    return res.status(known ? 200 : 404).sendFile(index);
  });

  app.use(httpErrorLogger());
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: "服务器内部错误" });
  });

  return app;
}

module.exports = { createApp };
