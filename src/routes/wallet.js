import { Router } from "express";
import { adjustWallet, getWallet } from "../repositories/appRepository.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";

export const walletRouter = Router();

walletRouter.use(requireAuth);

walletRouter.get("/", (req, res) => {
  getWallet(req.user.id)
    .then((wallet) => res.json(wallet))
    .catch((error) => res.status(400).json({ error: error.message }));
});

walletRouter.post("/deposit", (req, res) => {
  adjustWallet({
      userId: req.user.id,
      amount: req.body.amount,
      type: "deposit",
      description: req.body.description || "Wallet deposit"
    })
    .then((result) => res.status(201).json(result))
    .catch((error) => res.status(400).json({ error: error.message }));
});

walletRouter.get("/transactions", (req, res) => {
  getWallet(req.user.id)
    .then((wallet) => res.json({ transactions: wallet.transactions }))
    .catch((error) => res.status(400).json({ error: error.message }));
});

walletRouter.post("/admin-adjust", requireAdmin, (req, res) => {
  adjustWallet({
    userId: req.body.userId,
    amount: req.body.amount,
    type: "admin_adjustment",
    description: req.body.description || "Admin wallet adjustment"
  })
    .then((result) => {
      if (result.error) return res.status(result.status || 400).json(result);
      res.status(201).json(result);
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});
