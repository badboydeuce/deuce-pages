import { Router } from "express";
import {
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
import { withPreviewToken } from "../services/packagePreview.js";
import { validatePackageData } from "../services/packageValidation.js";
import { deleteObjectPrefix } from "../services/objectStorage.js";

export const packagesRouter = Router();

function isAdminMount(req) {
  return String(req.baseUrl || "").includes("/admin/");
}

function adminOnlyOnAdminMount(req, res, next) {
  if (!isAdminMount(req)) return next();
  return requireAdmin(req, res, next);
}

packagesRouter.get("/", adminOnlyOnAdminMount, (req, res) => {
  listPackages()
    .then((packages) => res.json({
      packages: (isAdminMount(req) ? packages : packages.filter((item) => item.status === "published")).map(withPreviewToken)
    }))
    .catch((error) => res.status(400).json({ error: error.message }));
});

packagesRouter.post("/", requireAdmin, (req, res) => {
  const validation = validatePackageData(req.body, { publishing: String(req.body?.status || "").toLowerCase() === "published" });
  if (!validation.valid) return res.status(422).json({ error: "Package validation failed", issues: validation.issues });
  createPackage(validation.value)
    .then((pagePackage) => res.status(201).json({ package: withPreviewToken(pagePackage) }))
    .catch((error) => res.status(400).json({ error: error.message }));
});

packagesRouter.get("/:id", adminOnlyOnAdminMount, (req, res) => {
  findPackage(req.params.id)
    .then((pagePackage) => {
      if (!pagePackage || (!isAdminMount(req) && pagePackage.status !== "published")) return res.status(404).json({ error: "Package not found" });
      res.json({ package: withPreviewToken(pagePackage) });
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
      res.json({ package: withPreviewToken(result.pagePackage) });
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
      return { pagePackage: await publishPackage(req.params.id) };
    })
    .then((result) => {
      if (!result) return res.status(404).json({ error: "Package not found" });
      if (result.archived) return res.status(409).json({ error: "Restore the archived package before publishing it" });
      if (result.validation) return res.status(422).json({ error: "Package is not ready to publish", issues: result.validation.issues });
      res.json({ package: withPreviewToken(result.pagePackage) });
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
