import { Router } from "express";
import { randomBytes } from "node:crypto";
import {
  deleteResult,
  findUserPage,
  listActivePageSessions,
  listResults,
  listTrafficEvents,
  listUserPages,
  markGenerated,
  renewUserPage,
  setSessionCommand,
  updateIpRule,
  updateSecurityConfig,
  updateUserPageConfig
} from "../repositories/appRepository.js";
import { requireAuth } from "../middleware/auth.js";
import { installCloudflareWorker, verifyCloudflareZone } from "../services/cloudflareDeploy.js";
import { validateTurnstileConfiguration } from "../services/turnstile.js";

export const userPagesRouter = Router();

userPagesRouter.use(requireAuth);

function validRuntimeRedirectTarget(targetUrl, userPageId) {
  let parsed;
  try {
    parsed = new URL(targetUrl, "https://deuce.local");
  } catch {
    return false;
  }

  if (parsed.origin !== "https://deuce.local") return false;
  if (!["/api/runtime/source", "/api/runtime/runtime/source", "/api/source"].includes(parsed.pathname)) return false;
  if (parsed.searchParams.get("userPageId") !== userPageId) return false;

  const file = String(parsed.searchParams.get("file") || "").replace(/^\/+/, "");
  if (!file || file.includes("..") || file.length > 240) return false;
  return /\.html?$/i.test(file);
}

userPagesRouter.get("/", (req, res) => {
  listUserPages(req.user.id)
    .then((userPages) => res.json({ userPages }))
    .catch((error) => res.status(400).json({ error: error.message }));
});

userPagesRouter.get("/:id", (req, res) => {
  findUserPage(req.params.id, req.user.id)
    .then((userPage) => {
      if (!userPage) return res.status(404).json({ error: "User page not found" });
      res.json({ userPage });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

userPagesRouter.patch("/:id/config", (req, res) => {
  updateUserPageConfig(req.params.id, req.body, req.user.id)
    .then((userPage) => {
      if (!userPage) return res.status(404).json({ error: "User page not found" });
      res.json({ userPage });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

userPagesRouter.post("/:id/relay-secret/rotate", async (req, res) => {
  try {
    const userPage = await findUserPage(req.params.id, req.user.id);
    if (!userPage) return res.status(404).json({ error: "User page not found" });
    const relaySecret = `deuce_${randomBytes(32).toString("hex")}`;
    const userPageUpdated = await updateUserPageConfig(userPage.id, {
      hostingConfig: {
        ...(userPage.hostingConfig || {}),
        relaySecret,
        relayVerified: false,
        relayVerifiedAt: null,
        workerRoute: userPage.domain ? `${userPage.domain}/api/*` : ""
      }
    }, req.user.id);
    res.json({ userPage: userPageUpdated, relaySecretConfigured: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

userPagesRouter.post("/:id/renew", (req, res) => {
  renewUserPage(req.params.id, req.user.id)
    .then((result) => {
      if (result?.error) return res.status(result.status || 400).json(result);
      res.json(result);
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

userPagesRouter.patch("/:id/security", (req, res) => {
  updateSecurityConfig(req.params.id, req.body, req.user.id)
    .then((userPage) => {
      if (!userPage) return res.status(404).json({ error: "User page not found" });
      res.json({ securityConfig: userPage.securityConfig });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

userPagesRouter.post("/:id/turnstile/validate", async (req, res) => {
  try {
    const userPage = await findUserPage(req.params.id, req.user.id);
    if (!userPage) return res.status(404).json({ error: "User page not found" });
    const pending = req.body?.turnstile || {};
    const security = {
      ...(userPage.securityConfig || {}),
      turnstile: {
        ...(userPage.securityConfig?.turnstile || {}),
        siteKey: String(pending.siteKey ?? userPage.securityConfig?.turnstile?.siteKey ?? "").trim(),
        secretKey: String(pending.secretKey ?? userPage.securityConfig?.turnstile?.secretKey ?? "").trim(),
        displayDomain: String(pending.displayDomain ?? userPage.securityConfig?.turnstile?.displayDomain ?? "").trim()
      }
    };
    const validation = await validateTurnstileConfiguration(security);
    res.status(validation.valid ? 200 : 422).json({ validation });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

userPagesRouter.post("/:id/ban-ip", (req, res) => {
  updateIpRule(req.params.id, req.body.ip, "ban", req.user.id)
    .then((userPage) => {
      if (!userPage) return res.status(404).json({ error: "User page not found" });
      res.json({ securityConfig: userPage.securityConfig });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

userPagesRouter.post("/:id/whitelist-ip", (req, res) => {
  updateIpRule(req.params.id, req.body.ip, "whitelist", req.user.id)
    .then((userPage) => {
      if (!userPage) return res.status(404).json({ error: "User page not found" });
      res.json({ securityConfig: userPage.securityConfig });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

userPagesRouter.delete("/:id/ip-rule", (req, res) => {
  updateIpRule(req.params.id, req.body.ip, "remove", req.user.id)
    .then((userPage) => {
      if (!userPage) return res.status(404).json({ error: "User page not found" });
      res.json({ securityConfig: userPage.securityConfig });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

userPagesRouter.post("/:id/generate-index", (req, res) => {
  markGenerated(req.params.id, req.body.version, req.user.id)
    .then((userPage) => {
      if (!userPage) return res.status(404).json({ error: "User page not found" });
      res.json({
        generatedFile: userPage.generatedFile,
        configPayload: {
          id: userPage.id,
          userId: userPage.userId,
          packageId: userPage.packageId,
          packageVersion: userPage.packageVersion,
          domain: userPage.domain,
          subscription: userPage.subscription,
          security: userPage.securityConfig,
          resultSettings: userPage.resultSettings,
          generatedFile: userPage.generatedFile,
          flow: userPage.flow,
          configs: userPage.configs
        }
      });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

userPagesRouter.get("/:id/traffic", (req, res) => {
  listTrafficEvents(req.params.id, req.user.id, req.query.limit)
    .then((trafficEvents) => {
      if (!trafficEvents) return res.status(404).json({ error: "User page not found" });
      res.json({ trafficEvents });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

userPagesRouter.get("/:id/sessions", (req, res) => {
  listActivePageSessions(req.params.id, req.user.id)
    .then((sessions) => {
      if (!sessions) return res.status(404).json({ error: "User page not found" });
      res.json({ sessions });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

userPagesRouter.post("/:id/sessions/:sessionId/redirect", (req, res) => {
  const targetUrl = String(req.body?.targetUrl || "").trim();
  if (!targetUrl) {
    res.status(400).json({ error: "Redirect URL is required" });
    return;
  }
  if (!validRuntimeRedirectTarget(targetUrl, req.params.id)) {
    res.status(400).json({ error: "Redirect target must be a runtime HTML page for this user page" });
    return;
  }
  setSessionCommand(req.params.id, req.params.sessionId, {
    action: "redirect",
    targetUrl,
    note: req.body?.note || "",
    forceReload: Boolean(req.body?.forceReload)
  }, req.user.id)
    .then((userPage) => {
      if (!userPage) return res.status(404).json({ error: "User page not found" });
      res.json({ userPage, command: userPage.configs?.sessionCommands?.[req.params.sessionId] || null });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

userPagesRouter.delete("/:id/sessions/:sessionId/command", (req, res) => {
  setSessionCommand(req.params.id, req.params.sessionId, { action: "clear" }, req.user.id)
    .then((userPage) => {
      if (!userPage) return res.status(404).json({ error: "User page not found" });
      res.json({ userPage, ok: true });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

userPagesRouter.post("/:id/cloudflare/verify", async (req, res) => {
  try {
    const userPage = await findUserPage(req.params.id, req.user.id);
    if (!userPage) return res.status(404).json({ error: "User page not found" });
    const domain = req.body.domain || userPage.hostingConfig?.domain || userPage.domain;
    const verification = await verifyCloudflareZone({
      apiToken: req.body.apiToken,
      domain
    });
    const updated = await updateUserPageConfig(userPage.id, {
      domain,
      hostingConfig: {
        ...(userPage.hostingConfig || {}),
        domain,
        cloudflare: {
          ...(userPage.hostingConfig?.cloudflare || {}),
          zoneId: verification.zoneId,
          zoneName: verification.zoneName,
          tokenStatus: verification.tokenStatus,
          verifiedAt: new Date().toISOString()
        }
      }
    }, req.user.id);
    res.json({ cloudflare: updated.hostingConfig.cloudflare, userPage: updated });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

userPagesRouter.post("/:id/cloudflare/install", async (req, res) => {
  try {
    const userPage = await findUserPage(req.params.id, req.user.id);
    if (!userPage) return res.status(404).json({ error: "User page not found" });
    const domain = req.body.domain || userPage.hostingConfig?.domain || userPage.domain;
    const relaySecret = userPage.hostingConfig?.relaySecret || req.body.relaySecret;
    const deployment = await installCloudflareWorker({
      apiToken: req.body.apiToken,
      accountId: req.body.accountId,
      domain,
      relaySecret,
      scriptName: req.body.scriptName || userPage.hostingConfig?.cloudflare?.scriptName
    });
    const updated = await updateUserPageConfig(userPage.id, {
      domain,
      securityConfig: {
        ...(userPage.securityConfig || {}),
        domains: domain ? [domain] : []
      },
      hostingConfig: {
        ...(userPage.hostingConfig || {}),
        domain,
        connectionType: "cloudflare-worker",
        relaySecret,
        workerRoute: deployment.routePattern,
        relayVerified: true,
        relayVerifiedAt: deployment.installedAt,
        verified: true,
        verifiedAt: deployment.installedAt,
        liveStatus: "Cloudflare Worker installed",
        cloudflare: {
          ...(userPage.hostingConfig?.cloudflare || {}),
          accountId: deployment.accountId,
          zoneId: deployment.zoneId,
          zoneName: deployment.zoneName,
          scriptName: deployment.scriptName,
          routePattern: deployment.routePattern,
          installedAt: deployment.installedAt,
          managed: true
        }
      },
      generatedFile: {
        ...(userPage.generatedFile || {}),
        apiBase: "/api"
      }
    }, req.user.id);
    res.json({ cloudflare: updated.hostingConfig.cloudflare, userPage: updated });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

userPagesRouter.get("/:id/results", (req, res) => {
  listResults(req.params.id, req.user.id)
    .then((results) => {
      if (!results) return res.status(404).json({ error: "User page not found" });
      res.json({ results });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

userPagesRouter.delete("/:id/results/:resultId", (req, res) => {
  deleteResult(req.params.id, req.params.resultId, req.user.id)
    .then((deleted) => {
      if (deleted === null) return res.status(404).json({ error: "User page not found" });
      res.json({ ok: true, deleted });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});
