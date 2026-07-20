import { Router } from "express";
import {
  createPackage,
  findPackage,
  listPackages,
  publishPackage,
  subscribeToPackage,
  updatePackage
} from "../repositories/appRepository.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { withPreviewToken } from "../services/packagePreview.js";
import { validatePackageData } from "../services/packageValidation.js";

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
      const merged = { ...current, ...req.body, billingPeriods: { ...(current.billingPeriods || {}), ...(req.body.billingPeriods || {}) } };
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
      const validation = validatePackageData({ ...current, status: "published" }, { publishing: true });
      if (!validation.valid) return { validation };
      return { pagePackage: await publishPackage(req.params.id) };
    })
    .then((result) => {
      if (!result) return res.status(404).json({ error: "Package not found" });
      if (result.validation) return res.status(422).json({ error: "Package is not ready to publish", issues: result.validation.issues });
      res.json({ package: withPreviewToken(result.pagePackage) });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

packagesRouter.post("/:id/subscribe", requireAuth, (req, res) => {
  subscribeToPackage(req.params.id, { ...req.body, userId: req.user.id, userRole: req.user.role })
    .then((result) => {
      if (result.error) return res.status(result.status || 400).json(result);
      res.status(201).json(result);
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});
