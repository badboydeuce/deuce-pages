import { Router } from "express";
import {
  createPackagePreviewTicket,
  createPackage,
  deletePackage,
  findPackage,
  listPackages,
  packageSubscriberCount,
  publishPackage,
  subscribeToPackage,
  updatePackage
} from "../repositories/appRepository.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import {
  contentTypeFor,
  fetchPackageFile,
  previewSourceForPackage,
  withPreviewAvailability
} from "../services/packagePreview.js";
import { validatePackageData } from "../services/packageValidation.js";
import { deleteObjectPrefix } from "../services/objectStorage.js";
import { previewLaunchUrl } from "../services/appHosts.js";
import { classifyFile } from "../services/githubImport.js";
import {
  checkGitHubLivePackage,
  publicGitHubLiveStatus,
  reconcileGitHubScreenManifest
} from "../services/githubLiveSync.js";

export const packagesRouter = Router();

function isAdminMount(req) {
  return String(req.baseUrl || "").includes("/admin/");
}

function adminOnlyOnAdminMount(req, res, next) {
  if (isAdminMount(req)) return requireAdmin(req, res, next);
  return requireAuth(req, res, next);
}

function canAccessPackage(req, pagePackage) {
  return pagePackage?.status === "published" || String(req.user?.role || "").toLowerCase() === "admin";
}

packagesRouter.get("/", adminOnlyOnAdminMount, (req, res) => {
  listPackages()
    .then((packages) => res.json({
      packages: (isAdminMount(req) ? packages : packages.filter((item) => item.status === "published")).map(withPreviewAvailability)
    }))
    .catch((error) => res.status(400).json({ error: error.message }));
});

packagesRouter.post("/", requireAdmin, (req, res) => {
  const validation = validatePackageData(req.body, { publishing: String(req.body?.status || "").toLowerCase() === "published" });
  if (!validation.valid) return res.status(422).json({ error: "Package validation failed", issues: validation.issues });
  createPackage(validation.value)
    .then((pagePackage) => res.status(201).json({ package: withPreviewAvailability(pagePackage) }))
    .catch((error) => res.status(400).json({ error: error.message }));
});

packagesRouter.get("/:id/asset", requireAuth, async (req, res) => {
  try {
    const pagePackage = await findPackage(req.params.id);
    if (!pagePackage || !canAccessPackage(req, pagePackage)) {
      res.status(404).json({ error: "Package not found" });
      return;
    }
    const file = String(req.query.file || "");
    if (!file || classifyFile(file) !== "asset") {
      res.status(400).json({ error: "A package image file is required" });
      return;
    }
    const source = previewSourceForPackage(pagePackage, file);
    const response = await fetchPackageFile(source);
    const buffer = Buffer.from(await response.arrayBuffer());
    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("Content-Type", contentTypeFor(file));
    res.send(buffer);
  } catch {
    res.status(404).json({ error: "Package asset not found" });
  }
});

packagesRouter.post("/:id/preview-session", requireAuth, async (req, res) => {
  try {
    const pagePackage = await findPackage(req.params.id);
    if (!pagePackage || !canAccessPackage(req, pagePackage)) {
      res.status(404).json({ error: "Package not found" });
      return;
    }
    if (!withPreviewAvailability(pagePackage).previewAvailable) {
      res.status(409).json({ error: "Package preview is unavailable" });
      return;
    }
    const session = await createPackagePreviewTicket({
      userId: req.user.id,
      userSessionId: req.authSession.id,
      packageId: pagePackage.id,
      packageVersion: pagePackage.version
    });
    res.status(201).json({
      previewUrl: previewLaunchUrl(req, session.ticket),
      expiresAt: session.expiresAt
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

packagesRouter.get("/:id/github/status", requireAdmin, async (req, res) => {
  try {
    const pagePackage = await findPackage(req.params.id);
    if (!pagePackage) return res.status(404).json({ error: "Package not found" });
    const status = await checkGitHubLivePackage(pagePackage);
    res.setHeader("Cache-Control", "no-store, private");
    res.json({ status: publicGitHubLiveStatus(status) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

packagesRouter.post("/:id/github/sync", requireAdmin, async (req, res) => {
  try {
    const pagePackage = await findPackage(req.params.id);
    if (!pagePackage) return res.status(404).json({ error: "Package not found" });
    const status = await checkGitHubLivePackage(pagePackage);
    const reconciled = reconcileGitHubScreenManifest(pagePackage, status.scan, status.fileDiff);
    const syncedAt = new Date().toISOString();
    const nextStatus = pagePackage.status === "published" && reconciled.drift.hasStructuralChanges
      ? "review"
      : pagePackage.status;
    const packageManifest = {
      ...(pagePackage.packageManifest || {}),
      ...reconciled.manifest,
      files: status.scan.files,
      scripts: status.scan.scripts,
      review: status.scan.review,
      github: {
        ...(pagePackage.packageManifest?.github || {}),
        owner: status.scan.owner,
        repo: status.scan.repo,
        branch: status.scan.branch,
        folder: status.scan.folder,
        mode: "live",
        lastSyncedCommitSha: status.scan.commitSha,
        lastSyncedTreeSha: status.scan.treeSha,
        lastSyncedAt: syncedAt,
        committedAt: status.scan.committedAt,
        commitUrl: status.scan.commitUrl
      }
    };
    const updated = await updatePackage(pagePackage.id, {
      status: nextStatus,
      screens: reconciled.manifest.screens.map((screen) => screen.buttonLabel),
      assets: status.scan.assets,
      cssFiles: status.scan.cssFiles,
      packageManifest
    });
    const responseStatus = publicGitHubLiveStatus({
      ...status,
      storedCommitSha: status.scan.commitSha,
      currentCommitSha: status.scan.commitSha,
      lastSyncedAt: syncedAt,
      commitChanged: false,
      fileDiff: {
        added: [],
        removed: [],
        modified: [],
        renamed: [],
        unchanged: status.scan.files,
        changed: false
      },
      screenDrift: reconciled.drift,
      applied: true,
      packageMovedToReview: nextStatus === "review" && pagePackage.status === "published"
    });
    res.setHeader("Cache-Control", "no-store, private");
    res.json({ package: withPreviewAvailability(updated), status: responseStatus });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

packagesRouter.get("/:id", adminOnlyOnAdminMount, (req, res) => {
  findPackage(req.params.id)
    .then((pagePackage) => {
      if (!pagePackage || (!isAdminMount(req) && pagePackage.status !== "published")) return res.status(404).json({ error: "Package not found" });
      res.json({ package: withPreviewAvailability(pagePackage) });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

packagesRouter.patch("/:id", requireAdmin, (req, res) => {
  findPackage(req.params.id)
    .then(async (current) => {
      if (!current) return null;
      const requestedStatus = String(req.body?.status || current.status).toLowerCase();
      const lifecycle = { ...(current.packageManifest?.lifecycle || {}) };
      if (requestedStatus === "archived" && current.status !== "archived") {
        lifecycle.archivedAt = new Date().toISOString();
        lifecycle.archivedBy = req.user.id;
        lifecycle.previousStatus = current.status;
      } else if (current.status === "archived" && requestedStatus !== "archived") {
        lifecycle.restoredAt = new Date().toISOString();
        lifecycle.restoredBy = req.user.id;
      }
      const merged = {
        ...current,
        ...req.body,
        billingPeriods: { ...(current.billingPeriods || {}), ...(req.body.billingPeriods || {}) },
        packageManifest: {
          ...(current.packageManifest || {}),
          ...(req.body.packageManifest || {}),
          lifecycle
        }
      };
      const validation = validatePackageData(merged, { publishing: String(merged.status).toLowerCase() === "published" });
      if (!validation.valid) return { validation };
      return { pagePackage: await updatePackage(req.params.id, validation.value) };
    })
    .then((result) => {
      if (!result) return res.status(404).json({ error: "Package not found" });
      if (result.validation) return res.status(422).json({ error: "Package validation failed", issues: result.validation.issues });
      res.json({ package: withPreviewAvailability(result.pagePackage) });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

packagesRouter.post("/:id/publish", requireAdmin, (req, res) => {
  findPackage(req.params.id)
    .then(async (current) => {
      if (!current) return null;
      if (current.status === "archived") return { archived: true };
      const validation = validatePackageData({ ...current, status: "published" }, { publishing: true });
      if (!validation.valid) return { validation };
      const normalized = await updatePackage(req.params.id, validation.value);
      return { pagePackage: await publishPackage(normalized.id) };
    })
    .then((result) => {
      if (!result) return res.status(404).json({ error: "Package not found" });
      if (result.archived) return res.status(409).json({ error: "Restore the archived package before publishing it" });
      if (result.validation) return res.status(422).json({ error: "Package is not ready to publish", issues: result.validation.issues });
      res.json({ package: withPreviewAvailability(result.pagePackage) });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

packagesRouter.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const pagePackage = await findPackage(req.params.id);
    if (!pagePackage) return res.status(404).json({ error: "Package not found" });
    if (pagePackage.status !== "archived") return res.status(409).json({ error: "Archive the package before permanently deleting it" });
    const subscribers = await packageSubscriberCount(pagePackage.id);
    if (subscribers > 0) return res.status(409).json({ error: `Package has ${subscribers} subscriber page${subscribers === 1 ? "" : "s"}. Archive preserves those pages; permanent deletion is blocked.` });
    const prefix = pagePackage.packageManifest?.r2?.prefix;
    const objectsDeleted = prefix ? await deleteObjectPrefix(prefix) : 0;
    const deleted = await deletePackage(pagePackage.id);
    res.json({ deleted: Boolean(deleted), packageId: pagePackage.id, objectsDeleted });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

packagesRouter.post("/:id/subscribe", requireAuth, async (req, res) => {
  const pagePackage = await findPackage(req.params.id);
  if (!pagePackage || pagePackage.status !== "published") return res.status(404).json({ error: "Published package not found" });
  subscribeToPackage(pagePackage.id, { ...req.body, userId: req.user.id, userRole: req.user.role })
    .then((result) => {
      if (result.error) return res.status(result.status || 400).json(result);
      res.status(201).json(result);
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});
