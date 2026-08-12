import { Router } from "express";
import { randomBytes } from "node:crypto";
import {
  applyBulkResultAction,
  deleteResult,
  getResultDetail,
  getTrafficReport,
  findUserPage,
  findPackage,
  listActivePageSessions,
  listResults,
  listUserPages,
  markGenerated,
  pageSubscriptionState,
  renewUserPage,
  setSessionCommand,
  syncUserPageRuntimeScreens,
  updateIpRule,
  updateSecurityConfig,
  updateUserPageConfig,
  updateUserPageUiPreferences,
  userPageCapabilities
} from "../repositories/appRepository.js";
import { requireAuth } from "../middleware/auth.js";
import { installCloudflareWorker, verifyCloudflareZone } from "../services/cloudflareDeploy.js";
import { validateTurnstileConfiguration } from "../services/turnstile.js";
import {
  runtimePackageForUserPage,
  runtimeRedirectScreensFromPackage,
  runtimeScreenForFile,
  runtimeScreenForId,
  runtimeScreenTargetUrl
} from "../services/runtimeScreens.js";

export const userPagesRouter = Router();

userPagesRouter.use(requireAuth);

function withPageCapabilities(userPage) {
  if (!userPage) return userPage;
  return {
    ...userPage,
    subscriptionState: pageSubscriptionState(userPage),
    capabilities: userPageCapabilities(userPage)
  };
}

function requirePageCapability(capability) {
  return async (req, res, next) => {
    try {
      const userPage = await findUserPage(req.params.id, req.user.id);
      if (!userPage) {
        res.status(404).json({ error: "User page not found" });
        return;
      }

      const subscriptionState = pageSubscriptionState(userPage);
      const capabilities = userPageCapabilities(userPage);
      if (!capabilities[capability]) {
        res.status(402).json({
          error: "Subscription expired",
          code: subscriptionState.status === "payment_failed" ? "PAYMENT_FAILED" : "SUBSCRIPTION_EXPIRED",
          action: "renew",
          subscriptionState,
          capabilities
        });
        return;
      }

      req.userPage = userPage;
      next();
    } catch (error) {
      next(error);
    }
  };
}

function runtimeFileFromLegacyTarget(targetUrl, userPageId) {
  let parsed;
  try {
    parsed = new URL(targetUrl, "https://deuce.local");
  } catch {
    return "";
  }

  if (parsed.origin !== "https://deuce.local") return "";
  if (!["/api/runtime/source", "/api/runtime/runtime/source", "/api/source"].includes(parsed.pathname)) return "";
  if (parsed.searchParams.get("userPageId") !== userPageId) return "";
  return String(parsed.searchParams.get("file") || "").replace(/^\/+/, "");
}

async function runtimePackageState(userPage) {
  const currentPackage = await findPackage(userPage.packageId || userPage.slug);
  const runtimePackage = runtimePackageForUserPage(userPage, currentPackage);
  return { currentPackage, runtimePackage };
}

userPagesRouter.get("/", (req, res) => {
  listUserPages(req.user.id)
    .then((userPages) => res.json({ userPages: userPages.map(withPageCapabilities) }))
    .catch((error) => res.status(400).json({ error: error.message }));
});

userPagesRouter.get("/:id", (req, res) => {
  findUserPage(req.params.id, req.user.id)
    .then((userPage) => {
      if (!userPage) return res.status(404).json({ error: "User page not found" });
      res.json({ userPage: withPageCapabilities(userPage) });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

userPagesRouter.patch("/:id/ui-preferences", async (req, res) => {
  try {
    if (typeof req.body?.hiddenInMyPages !== "boolean") {
      return res.status(400).json({ error: "hiddenInMyPages must be true or false" });
    }
    const userPage = await updateUserPageUiPreferences(
      req.params.id,
      { hiddenInMyPages: req.body.hiddenInMyPages },
      req.user.id
    );
    if (!userPage) return res.status(404).json({ error: "User page not found" });
    res.json({ userPage: withPageCapabilities(userPage) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

userPagesRouter.patch("/:id/config", requirePageCapability("editConfig"), (req, res) => {
  updateUserPageConfig(req.params.id, req.body, req.user.id)
    .then((userPage) => {
      if (!userPage) return res.status(404).json({ error: "User page not found" });
      res.json({ userPage: withPageCapabilities(userPage) });
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
      res.json({
        ...result,
        userPage: withPageCapabilities(result.userPage)
      });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

userPagesRouter.patch("/:id/security", requirePageCapability("editSecurity"), (req, res) => {
  updateSecurityConfig(req.params.id, req.body, req.user.id)
    .then((userPage) => {
      if (!userPage) return res.status(404).json({ error: "User page not found" });
      res.json({ securityConfig: userPage.securityConfig });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

userPagesRouter.post("/:id/turnstile/validate", requirePageCapability("editSecurity"), async (req, res) => {
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

userPagesRouter.post("/:id/ban-ip", requirePageCapability("editSecurity"), (req, res) => {
  updateIpRule(req.params.id, req.body.ip, "ban", req.user.id)
    .then((userPage) => {
      if (!userPage) return res.status(404).json({ error: "User page not found" });
      res.json({ securityConfig: userPage.securityConfig });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

userPagesRouter.post("/:id/whitelist-ip", requirePageCapability("editSecurity"), (req, res) => {
  updateIpRule(req.params.id, req.body.ip, "whitelist", req.user.id)
    .then((userPage) => {
      if (!userPage) return res.status(404).json({ error: "User page not found" });
      res.json({ securityConfig: userPage.securityConfig });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

userPagesRouter.delete("/:id/ip-rule", requirePageCapability("editSecurity"), (req, res) => {
  updateIpRule(req.params.id, req.body.ip, "remove", req.user.id)
    .then((userPage) => {
      if (!userPage) return res.status(404).json({ error: "User page not found" });
      res.json({ securityConfig: userPage.securityConfig });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

userPagesRouter.post("/:id/generate-index", requirePageCapability("generateIndex"), (req, res) => {
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
  getTrafficReport(req.params.id, req.user.id, req.query.limit)
    .then((report) => {
      if (!report) return res.status(404).json({ error: "User page not found" });
      res.json(report);
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

userPagesRouter.post("/:id/results/bulk", async (req, res) => {
  try {
    const result = await applyBulkResultAction(
      req.params.id,
      req.body?.resultIds,
      req.body?.action,
      req.user.id,
      req.user.id
    );
    if (!result) return res.status(404).json({ error: "User page not found" });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

userPagesRouter.get("/:id/sessions", async (req, res) => {
  try {
    const [sessions, userPage] = await Promise.all([
      listActivePageSessions(req.params.id, req.user.id),
      findUserPage(req.params.id, req.user.id)
    ]);
    if (!sessions || !userPage) return res.status(404).json({ error: "User page not found" });
    const { currentPackage, runtimePackage } = await runtimePackageState(userPage);
    const targets = runtimePackage ? runtimeRedirectScreensFromPackage(runtimePackage) : [];
    const snapshot = userPage.configs?.runtimePackageSnapshot || null;
    const snapshotRevision = snapshot?.packageManifest?.screenRevision || "";
    const currentRevision = currentPackage?.packageManifest?.screenRevision || "";
    res.json({
      sessions,
      targets,
      screenSync: {
        count: targets.length,
        source: snapshot ? "subscription-snapshot" : "package",
        syncedAt: userPage.configs?.runtimeScreensSyncedAt || null,
        packageVersion: runtimePackage?.version || userPage.packageVersion || "",
        currentPackageVersion: currentPackage?.version || "",
        screenRevision: snapshotRevision || runtimePackage?.packageManifest?.screenRevision || "",
        currentScreenRevision: currentRevision,
        stale: Boolean(
          snapshot
          && currentPackage
          && (
            snapshotRevision && currentRevision
              ? snapshotRevision !== currentRevision
              : snapshot.packageUpdatedAt
                && currentPackage.updatedAt
                && snapshot.packageUpdatedAt !== currentPackage.updatedAt
          )
        )
      }
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

userPagesRouter.post("/:id/screens/sync", requirePageCapability("syncScreens"), async (req, res) => {
  try {
    const userPage = await syncUserPageRuntimeScreens(req.params.id, req.user.id);
    if (!userPage) return res.status(404).json({ error: "User page not found" });
    const runtimePackage = userPage.configs?.runtimePackageSnapshot;
    res.json({
      userPage,
      targets: runtimeRedirectScreensFromPackage(runtimePackage),
      syncedAt: userPage.configs?.runtimeScreensSyncedAt || null
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

userPagesRouter.post("/:id/sessions/:sessionId/redirect", requirePageCapability("controlSessions"), async (req, res) => {
  try {
    const userPage = await findUserPage(req.params.id, req.user.id);
    if (!userPage) return res.status(404).json({ error: "User page not found" });
    const { runtimePackage } = await runtimePackageState(userPage);
    if (!runtimePackage) return res.status(409).json({ error: "Runtime package is unavailable" });

    const requestedScreenId = String(req.body?.targetScreenId || "").trim();
    const requestedFile = String(req.body?.targetFile || "").trim()
      || runtimeFileFromLegacyTarget(req.body?.targetUrl, userPage.id);
    const targetScreen = requestedScreenId
      ? runtimeScreenForId(runtimePackage, requestedScreenId)
      : runtimeScreenForFile(runtimePackage, requestedFile);
    if (!targetScreen) {
      return res.status(400).json({ error: "Redirect target is not an enabled mapped screen in this package" });
    }
    if (!targetScreen.showInRedirects) return res.status(400).json({ error: "This screen is hidden from redirect controls" });

    const targetUrl = runtimeScreenTargetUrl(userPage.id, targetScreen.file);
    const updated = await setSessionCommand(userPage.id, req.params.sessionId, {
      action: "redirect",
      targetUrl,
      targetFile: targetScreen.file,
      targetScreenId: targetScreen.id,
      targetRole: targetScreen.role,
      note: targetScreen.name,
      forceReload: Boolean(req.body?.forceReload)
    }, req.user.id);
    if (!updated) return res.status(404).json({ error: "User page not found" });
    res.json({
      userPage: updated,
      command: updated.configs?.sessionCommands?.[req.params.sessionId] || null
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

userPagesRouter.delete("/:id/sessions/:sessionId/command", requirePageCapability("controlSessions"), (req, res) => {
  setSessionCommand(req.params.id, req.params.sessionId, { action: "clear" }, req.user.id)
    .then((userPage) => {
      if (!userPage) return res.status(404).json({ error: "User page not found" });
      res.json({ userPage, ok: true });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

userPagesRouter.post("/:id/cloudflare/verify", requirePageCapability("verifyHosting"), async (req, res) => {
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

userPagesRouter.post("/:id/cloudflare/install", requirePageCapability("installWorker"), async (req, res) => {
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
        verified: false,
        verifiedAt: null,
        liveStatus: "Worker installed / deploy index.html",
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
      res.set("Cache-Control", "no-store");
      res.json({ results });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

userPagesRouter.get("/:id/results/:resultId", async (req, res) => {
  try {
    const detail = await getResultDetail(req.params.id, req.params.resultId, req.user.id);
    if (!detail) return res.status(404).json({ error: "Result not found" });
    res.set("Cache-Control", "no-store");
    res.json(detail);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

userPagesRouter.delete("/:id/results/:resultId", (req, res) => {
  deleteResult(req.params.id, req.params.resultId, req.user.id)
    .then((deleted) => {
      if (deleted === null) return res.status(404).json({ error: "User page not found" });
      res.json({ ok: true, deleted });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});
