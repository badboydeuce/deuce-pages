import { Router } from "express";
import {
  adjustWallet,
  extendUserPageSubscription,
  findUserPage,
  listAdminUsers,
  updateAdminUser
} from "../repositories/appRepository.js";
import { requireAdmin, requireAnyCapability, requireCapability } from "../middleware/auth.js";

export const adminUsersRouter = Router();

adminUsersRouter.get("/", requireAnyCapability("supportAccess", "pageEditor", "walletReview"), (req, res) => {
  listAdminUsers()
    .then((users) => res.json({ users }))
    .catch((error) => res.status(400).json({ error: error.message }));
});

adminUsersRouter.patch("/:id", requireAdmin, (req, res) => {
  updateAdminUser(req.params.id, req.body, req.user.id)
    .then((result) => {
      if (result?.error) return res.status(result.status || 400).json(result);
      res.json(result);
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

adminUsersRouter.post("/:id/wallet", requireAdmin, (req, res) => {
  adjustWallet({
    userId: req.params.id,
    amount: req.body.amount,
    type: req.body.type || "admin_adjustment",
    description: req.body.description || "Admin wallet adjustment"
  })
    .then((result) => {
      if (result?.error) return res.status(result.status || 400).json(result);
      res.status(201).json(result);
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

adminUsersRouter.post("/:id/pages/:pageId/extend", requireCapability("pageEditor"), async (req, res) => {
  try {
    const page = await findUserPage(req.params.pageId, req.params.id);
    if (!page) return res.status(404).json({ error: "User page not found" });
    const result = await extendUserPageSubscription(page.id, {
      days: req.body.days,
      adminFreeSubscription: req.body.adminFreeSubscription,
      autoRenew: req.body.autoRenew,
      status: req.body.status || "active"
    });
      if (result?.error) return res.status(result.status || 400).json(result);
      res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
