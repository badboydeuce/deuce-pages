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

export const packagesRouter = Router();

packagesRouter.get("/", (req, res) => {
  listPackages()
    .then((packages) => res.json({ packages: packages.map(withPreviewToken) }))
    .catch((error) => res.status(400).json({ error: error.message }));
});

packagesRouter.post("/", requireAdmin, (req, res) => {
  createPackage(req.body)
    .then((pagePackage) => res.status(201).json({ package: withPreviewToken(pagePackage) }))
    .catch((error) => res.status(400).json({ error: error.message }));
});

packagesRouter.get("/:id", (req, res) => {
  findPackage(req.params.id)
    .then((pagePackage) => {
      if (!pagePackage) return res.status(404).json({ error: "Package not found" });
      res.json({ package: withPreviewToken(pagePackage) });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

packagesRouter.patch("/:id", requireAdmin, (req, res) => {
  updatePackage(req.params.id, req.body)
    .then((pagePackage) => {
      if (!pagePackage) return res.status(404).json({ error: "Package not found" });
      res.json({ package: withPreviewToken(pagePackage) });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

packagesRouter.post("/:id/publish", requireAdmin, (req, res) => {
  publishPackage(req.params.id)
    .then((pagePackage) => {
      if (!pagePackage) return res.status(404).json({ error: "Package not found" });
      res.json({ package: withPreviewToken(pagePackage) });
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
