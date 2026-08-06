import express from "express";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authRouter } from "./routes/auth.js";
import { adminUsersRouter } from "./routes/adminUsers.js";
import { adminInvitesRouter } from "./routes/adminInvites.js";
import { packagesRouter } from "./routes/packages.js";
import { userPagesRouter } from "./routes/userPages.js";
import { walletRouter } from "./routes/wallet.js";
import { securityRouter } from "./routes/security.js";
import { eventsRouter } from "./routes/events.js";
import { importsRouter } from "./routes/imports.js";
import { previewRouter } from "./routes/preview.js";
import { runtimeRouter } from "./routes/runtime.js";
import { notificationsRouter } from "./routes/notifications.js";
import { githubWebhooksRouter } from "./routes/githubWebhooks.js";
import { sanitizeResponseSecrets } from "./services/responseSecrets.js";
import { publicErrorMessage, sanitizeErrorResponse } from "./services/publicErrors.js";
import { configureClientIpTrust } from "./services/clientIp.js";
import { getUserBySessionToken } from "./repositories/appRepository.js";
import { readSessionToken } from "./services/sessionCookie.js";
import { isPreviewHost, portalBaseUrl } from "./services/appHosts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicRoot = path.resolve(__dirname, "..");
const blogRoot = path.join(publicRoot, "blog");
const noIndexValue = "noindex, nofollow, noarchive, nosnippet";

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
  return isPreviewHost(req)
    || req.path.startsWith("/preview/")
    || /^\/api\/admin\/import\/github\/(?:preview|asset)$/.test(req.path)
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

const previewFrameAncestors = ["'self'", portalBaseUrl()].filter(Boolean);
const isolatedPreviewHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      baseUri: ["'none'"],
      connectSrc: ["'self'", "https://challenges.cloudflare.com"],
      fontSrc: ["'self'", "data:"],
      formAction: ["'self'"],
      frameAncestors: previewFrameAncestors,
      frameSrc: ["https://challenges.cloudflare.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:"],
      objectSrc: ["'none'"],
      sandbox: ["allow-scripts", "allow-forms", "allow-modals", "allow-same-origin"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://challenges.cloudflare.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      workerSrc: ["'none'"],
      upgradeInsecureRequests: isProduction() ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  referrerPolicy: { policy: "no-referrer" },
  xFrameOptions: false,
  strictTransportSecurity: isProduction() ? { maxAge: 31536000, includeSubDomains: true } : false
});

function securityHeaders(req, res, next) {
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  const middleware = isPreviewHost(req) || req.path.startsWith("/preview/")
    ? isolatedPreviewHeaders
    : isExecutablePackageRoute(req) ? executablePackageHeaders : portalHeaders;
  return middleware(req, res, next);
}

function corsMiddleware(req, res, next) {
  const origins = configuredCorsOrigins();
  const requestOrigin = req.headers.origin;
  const wildcardAllowed = !isProduction() && origins.includes("*");
  const sameOrigin = requestOrigin ? isSameOrigin(req, requestOrigin) : true;
  const originAllowed = !requestOrigin || (isPreviewHost(req) ? sameOrigin : wildcardAllowed || origins.includes(requestOrigin) || sameOrigin);
  const allowOrigin = requestOrigin && originAllowed ? (wildcardAllowed ? "*" : requestOrigin) : "";

  if (requestOrigin && !originAllowed) {
    res.status(403).json({ error: "Origin is not allowed" });
    return;
  }
  if (allowOrigin) res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  if (allowOrigin && allowOrigin !== "*") {
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
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

async function requirePortalSession(req, res, next) {
  try {
    const user = await getUserBySessionToken(readSessionToken(req));
    if (!user) {
      res.redirect(303, "/login");
      return;
    }
    req.user = user;
    res.setHeader("Cache-Control", "no-store, private");
    next();
  } catch (error) {
    next(error);
  }
}

function sendNoStoreFile(res, file) {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(publicRoot, file));
}
export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  configureClientIpTrust(app);
  app.use((req, res, next) => {
    res.setHeader("X-Robots-Tag", noIndexValue);
    next();
  });
  app.use(securityHeaders);
  app.use(corsMiddleware);
  app.use(express.json({
    limit: "1mb",
    verify: (req, res, buffer) => {
      if (String(req.originalUrl || "").split("?")[0] === "/api/webhooks/github") {
        req.rawBody = Buffer.from(buffer);
      }
    }
  }));
  app.use(express.urlencoded({ extended: true, limit: "1mb", parameterLimit: 100 }));
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use((req, res, next) => {
    const sendJson = res.json.bind(res);
    res.json = (body) => {
      const safeBody = sanitizeResponseSecrets(body);
      return sendJson(res.statusCode >= 400 ? sanitizeErrorResponse(safeBody, res.statusCode) : safeBody);
    };
    next();
  });

  app.use((req, res, next) => {
    if (!isPreviewHost(req)) return next();
    previewRouter(req, res, (error) => {
      if (error) return next(error);
      res.status(404).type("text/plain").send("Preview route not found");
    });
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

  app.use("/api/webhooks", githubWebhooksRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/packages", packagesRouter);
  app.use("/api/admin/packages", packagesRouter);
  app.use("/api/admin/import", importsRouter);
  app.use("/api/admin/users", adminUsersRouter);
  app.use("/api/admin/invites", adminInvitesRouter);
  app.use("/api/user-pages", userPagesRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/wallet", walletRouter);
  app.use("/api/page-security", securityRouter);
  app.use("/api/runtime/runtime", runtimeRouter);
  app.use("/api/runtime", runtimeRouter);
  app.use("/api", runtimeRouter);
  app.use("/api", eventsRouter);
  if (!isProduction()) app.use("/preview", previewRouter);

  app.get("/", (req, res) => res.redirect(302, "/blog/"));
  app.get("/robots.txt", (req, res) => {
    res.type("text/plain").send([
      "User-agent: *",
      "Disallow: /api/",
      "Disallow: /invite",
      "Disallow: /login",
      "Disallow: /portal",
      "Disallow: /preview/",
      "Allow: /blog/",
      ""
    ].join("\n"));
  });

  app.get("/favicon.svg", (req, res) => res.sendFile(path.join(publicRoot, "favicon.svg")));
  app.get("/theme-tokens.css", (req, res) => res.sendFile(path.join(publicRoot, "theme-tokens.css")));
  app.get("/access.css", (req, res) => res.sendFile(path.join(publicRoot, "access.css")));
  app.get("/access.js", (req, res) => sendNoStoreFile(res, "access.js"));
  app.get("/invite.js", (req, res) => sendNoStoreFile(res, "invite.js"));
  app.get("/login.js", (req, res) => sendNoStoreFile(res, "login.js"));
  app.get("/public-errors.js", (req, res) => sendNoStoreFile(res, "public-errors.js"));
  app.get("/deuce-runtime-client.js", (req, res) => res.sendFile(path.join(publicRoot, "deuce-runtime-client.js")));

  app.get(["/login", "/login/"], (req, res) => sendNoStoreFile(res, "login.html"));
  app.get(["/invite", "/invite/"], (req, res) => sendNoStoreFile(res, "invite.html"));
  app.use("/blog", express.static(blogRoot, {
    dotfiles: "deny",
    index: "index.html",
    redirect: false
  }));

  app.get("/portal/assets/styles.css", requirePortalSession, (req, res) => sendNoStoreFile(res, "styles.css"));
  app.get("/portal/assets/script.js", requirePortalSession, (req, res) => sendNoStoreFile(res, "script.js"));
  app.get(["/portal", "/portal/", "/portal/*"], requirePortalSession, (req, res) => {
    sendNoStoreFile(res, "index.html");
  });

  app.use((req, res) => {
    if (req.path.startsWith("/api/")) {
      res.status(404).json({ error: "Route not found", path: req.path });
      return;
    }

    res.status(404).type("text/plain").send("Not found");
  });

  app.use((error, req, res, next) => {
    console.error(error);
    const status = Number(error.status) >= 400 && Number(error.status) <= 599 ? Number(error.status) : 500;
    const message = publicErrorMessage(error, { status });
    res.status(status).json({ error: message });
  });

  return app;
}
