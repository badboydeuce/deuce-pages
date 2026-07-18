import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authRouter } from "./routes/auth.js";
import { adminUsersRouter } from "./routes/adminUsers.js";
import { packagesRouter } from "./routes/packages.js";
import { userPagesRouter } from "./routes/userPages.js";
import { walletRouter } from "./routes/wallet.js";
import { securityRouter } from "./routes/security.js";
import { eventsRouter } from "./routes/events.js";
import { importsRouter } from "./routes/imports.js";
import { previewRouter } from "./routes/preview.js";
import { runtimeRouter } from "./routes/runtime.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicRoot = path.resolve(__dirname, "..");

function corsMiddleware(req, res, next) {
  const configured = process.env.CORS_ORIGINS || "*";
  const origins = configured.split(",").map((origin) => origin.trim()).filter(Boolean);
  const requestOrigin = req.headers.origin;
  const allowOrigin = origins.includes("*") ? "*" : origins.includes(requestOrigin) ? requestOrigin : origins[0];

  if (allowOrigin) res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Deuce-License, X-Deuce-Relay-Secret, X-Deuce-Client-Host");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
}

export function createApp() {
  const app = express();

  app.use(corsMiddleware);
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.get("/api/health", (req, res) => {
    res.json({
      ok: true,
      service: "deuce-pages-api",
      env: process.env.NODE_ENV || "development",
      time: new Date().toISOString()
    });
  });

  app.get("/api/me", (req, res) => {
    res.redirect(307, "/api/auth/me");
  });

  app.use("/api/auth", authRouter);
  app.use("/api/packages", packagesRouter);
  app.use("/api/admin/packages", packagesRouter);
  app.use("/api/admin/import", importsRouter);
  app.use("/api/admin/users", adminUsersRouter);
  app.use("/api/user-pages", userPagesRouter);
  app.use("/api/wallet", walletRouter);
  app.use("/api/page-security", securityRouter);
  app.use("/api/runtime/runtime", runtimeRouter);
  app.use("/api/runtime", runtimeRouter);
  app.use("/api", runtimeRouter);
  app.use("/api", eventsRouter);
  app.use("/preview", previewRouter);

  app.use(express.static(publicRoot));

  app.use((req, res) => {
    if (req.path.startsWith("/api/")) {
      res.status(404).json({ error: "Route not found", path: req.path });
      return;
    }

    res.sendFile(path.join(publicRoot, "index.html"));
  });

  app.use((error, req, res, next) => {
    console.error(error);
    res.status(error.status || 500).json({
      error: error.message || "Internal server error"
    });
  });

  return app;
}
