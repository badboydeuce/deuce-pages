import { Router } from "express";
import {
  deleteResult,
  findUserPage,
  listResults,
  listUserPages,
  markGenerated,
  updateIpRule,
  updateSecurityConfig,
  updateUserPageConfig
} from "../repositories/appRepository.js";
import { requireAuth } from "../middleware/auth.js";

export const userPagesRouter = Router();

userPagesRouter.use(requireAuth);

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

userPagesRouter.patch("/:id/security", (req, res) => {
  updateSecurityConfig(req.params.id, req.body, req.user.id)
    .then((userPage) => {
      if (!userPage) return res.status(404).json({ error: "User page not found" });
      res.json({ securityConfig: userPage.securityConfig });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
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
