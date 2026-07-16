import { Router } from "express";
import {
  adjustWallet,
  approveWalletDepositRequest,
  createWalletDepositRequest,
  getWallet,
  listWalletDepositRequests,
  updateWalletDepositRequestStatus
} from "../repositories/appRepository.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";

export const walletRouter = Router();

walletRouter.use(requireAuth);

const cryptoFundingOptions = [
  { value: "USDT_TRC20", asset: "USDT", network: "TRC20", label: "USDT - TRC20", envKey: "WALLET_USDT_TRC20" },
  { value: "USDT_ERC20", asset: "USDT", network: "ERC20", label: "USDT - ERC20", envKey: "WALLET_USDT_ERC20" },
  { value: "BTC_BTC", asset: "BTC", network: "BTC", label: "Bitcoin - BTC", envKey: "WALLET_BTC" },
  { value: "ETH_ERC20", asset: "ETH", network: "ERC20", label: "Ethereum - ERC20", envKey: "WALLET_ETH" },
  { value: "BNB_BEP20", asset: "BNB", network: "BEP20", label: "BNB - BEP20", envKey: "WALLET_BNB_BEP20" }
];

function fundingOptionsFromEnv() {
  return cryptoFundingOptions.map((option) => {
    const address = String(process.env[option.envKey] || "").trim();
    return {
      value: option.value,
      asset: option.asset,
      network: option.network,
      label: option.label,
      address,
      configured: Boolean(address)
    };
  });
}

walletRouter.get("/", (req, res) => {
  getWallet(req.user.id)
    .then((wallet) => res.json(wallet))
    .catch((error) => res.status(400).json({ error: error.message }));
});

walletRouter.get("/funding-options", (req, res) => {
  res.json({ options: fundingOptionsFromEnv() });
});

function submitDepositRequest(req, res) {
  createWalletDepositRequest({
    userId: req.user.id,
    amount: req.body.amount,
    cryptoType: req.body.cryptoType,
    network: req.body.network,
    txHash: req.body.txHash
  })
    .then((result) => {
      if (result.error) return res.status(result.status || 400).json(result);
      res.status(201).json(result);
    })
    .catch((error) => res.status(400).json({ error: error.message }));
}

walletRouter.post("/deposit", submitDepositRequest);

walletRouter.post("/fund-request", submitDepositRequest);

walletRouter.get("/fund-requests", (req, res) => {
  listWalletDepositRequests({ userId: req.user.id })
    .then((requests) => res.json({ requests }))
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

walletRouter.get("/admin/fund-requests", requireAdmin, (req, res) => {
  listWalletDepositRequests({ status: req.query.status || null })
    .then((requests) => res.json({ requests }))
    .catch((error) => res.status(400).json({ error: error.message }));
});

walletRouter.post("/admin/fund-requests/:id/approve", requireAdmin, (req, res) => {
  approveWalletDepositRequest({
    requestId: req.params.id,
    adminUserId: req.user.id,
    amount: req.body.amount,
    adminNote: req.body.adminNote
  })
    .then((result) => {
      if (result.error) return res.status(result.status || 400).json(result);
      res.status(201).json(result);
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

walletRouter.post("/admin/fund-requests/:id/reviewing", requireAdmin, (req, res) => {
  updateWalletDepositRequestStatus({
    requestId: req.params.id,
    adminUserId: req.user.id,
    status: "reviewing",
    adminNote: req.body.adminNote
  })
    .then((result) => {
      if (result.error) return res.status(result.status || 400).json(result);
      res.status(200).json(result);
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

walletRouter.post("/admin/fund-requests/:id/reject", requireAdmin, (req, res) => {
  updateWalletDepositRequestStatus({
    requestId: req.params.id,
    adminUserId: req.user.id,
    status: "rejected",
    adminNote: req.body.adminNote
  })
    .then((result) => {
      if (result.error) return res.status(result.status || 400).json(result);
      res.status(200).json(result);
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});
