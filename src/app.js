import express from "express";
import helmet from "helmet";
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
import { notificationsRouter } from "./routes/notifications.js";
import { sanitizeResponseSecrets } from "./services/responseSecrets.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicRoot = path.resolve(__dirname, "..");

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function configuredCorsOrigins() {
  const fallback = isProduction() ? process.env.APP_BASE_URL || "" : "*";
  return String(process.env.CORS_ORIGINS || fallback)
    .split(",")
    .map((origin) => origin.trim() === "file://" ? "null" : origin.trim())
    .filter(Boolean);
}

function isSameOrigin(req, origin) {
  try {
    const requestOrigin = new URL(`${req.protocol}://${req.get("host")}`).origin;
    return new URL(origin).origin === requestOrigin;
  } catch {
    return false;
  }
}

function isExecutablePackageRoute(req) {
  return req.path.startsWith("/preview/")
    || /^\/api\/(?:runtime\/(?:runtime\/)?|)source(?:\/|$)/.test(req.path);
}

const portalHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'", "https:"],
      fontSrc: ["'self'", "data:"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
      frameSrc: ["'self'", "https://challenges.cloudflare.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      mediaSrc: ["'self'", "blob:", "https:"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'", "https://challenges.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      workerSrc: ["'none'"],
      upgradeInsecureRequests: isProduction() ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  crossOriginResourcePolicy: { policy: "same-origin" },
  referrerPolicy: { policy: "no-referrer" },
  strictTransportSecurity: isProduction() ? { maxAge: 31536000, includeSubDomains: true } : false
});

const executablePackageHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'", "https:"],
      baseUri: ["'none'"],
      connectSrc: ["'self'", "https:"],
      fontSrc: ["'self'", "data:", "https:"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
      frameSrc: ["'self'", "https:"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      mediaSrc: ["'self'", "blob:", "https:"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https:"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https:"],
      workerSrc: ["'none'"],
      upgradeInsecureRequests: isProduction() ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  referrerPolicy: { policy: "no-referrer" },
  strictTransportSecurity: isProduction() ? { maxAge: 31536000, includeSubDomains: true } : false
});

function securityHeaders(req, res, next) {
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  const middleware = isExecutablePackageRoute(req) ? executablePackageHeaders : portalHeaders;
  return middleware(req, res, next);
}

function corsMiddleware(req, res, next) {
  const origins = configuredCorsOrigins();
  const requestOrigin = req.headers.origin;
  const wildcardAllowed = !isProduction() && origins.includes("*");
  const originAllowed = !requestOrigin || wildcardAllowed || origins.includes(requestOrigin) || isSameOrigin(req, requestOrigin);
  const allowOrigin = requestOrigin && originAllowed ? (wildcardAllowed ? "*" : requestOrigin) : "";

  if (allowOrigin) res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Deuce-License, X-Deuce-Relay-Secret, X-Deuce-Client-Host");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Max-Age", "600");

  if (req.method === "OPTIONS") {
    if (!originAllowed) {
      res.status(403).json({ error: "Origin is not allowed" });
      return;
    }
    res.status(204).end();
    return;
  }

  next();
}

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  if (isProduction()) app.set("trust proxy", 1);
  app.use(securityHeaders);
  app.use(corsMiddleware);
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb", parameterLimit: 100 }));
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use((req, res, next) => {
    const sendJson = res.json.bind(res);
    res.json = (body) => sendJson(sanitizeResponseSecrets(body));
    next();
  });

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
  app.use("/api/notifications", notificationsRouter);
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
    const status = Number(error.status) >= 400 && Number(error.status) <= 599 ? Number(error.status) : 500;
    const message = status >= 500 && isProduction() ? "Internal server error" : error.message || "Internal server error";
    res.status(status).json({ error: message });
  });

  return app;
}
