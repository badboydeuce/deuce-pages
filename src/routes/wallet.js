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

const minimumFundingUsd = 30;
const stablecoinAssets = new Set(["USDT", "USDC"]);
const quoteCache = new Map();

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

function fundingOptionByAssetNetwork(asset, network) {
  const cleanAsset = String(asset || "").trim().toUpperCase();
  const cleanNetwork = String(network || "").trim().toUpperCase();
  return cryptoFundingOptions.find((option) => (
    option.asset === cleanAsset && option.network === cleanNetwork
  )) || null;
}

function coingeckoIdForAsset(asset) {
  return {
    BTC: "bitcoin",
    ETH: "ethereum",
    BNB: "binancecoin"
  }[String(asset || "").trim().toUpperCase()] || "";
}

function formatCryptoAmount(value, asset) {
  const decimals = stablecoinAssets.has(String(asset || "").toUpperCase()) ? 2 : 8;
  return Number(value).toFixed(decimals).replace(/\.?0+$/, "");
}

async function cryptoUsdRate(asset) {
  const cleanAsset = String(asset || "").trim().toUpperCase();
  if (stablecoinAssets.has(cleanAsset)) {
    return { rate: 1, source: "stablecoin" };
  }

  const coinId = coingeckoIdForAsset(cleanAsset);
  if (!coinId) throw new Error("Crypto rate is not supported");

  const cached = quoteCache.get(cleanAsset);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coinId)}&vs_currencies=usd`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "deuce-pages-wallet"
    }
  });
  if (!response.ok) throw new Error(`Rate provider unavailable (${response.status})`);
  const data = await response.json().catch(() => ({}));
  const rate = Number(data?.[coinId]?.usd || 0);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Crypto rate unavailable");

  const quote = { rate, source: "coingecko", expiresAt: Date.now() + 60_000 };
  quoteCache.set(cleanAsset, quote);
  return quote;
}

async function buildWalletQuote({ amount, cryptoType, network }) {
  const usdAmount = Number(amount || 0);
  if (!Number.isFinite(usdAmount) || usdAmount < minimumFundingUsd) {
    return {
      error: `Minimum funding is $${minimumFundingUsd}`,
      status: 400,
      minimumFundingUsd
    };
  }

  const selected = fundingOptionByAssetNetwork(cryptoType, network);
  if (!selected) return { error: "Funding option is not supported", status: 400 };

  const rate = await cryptoUsdRate(selected.asset);
  const cryptoAmount = usdAmount / rate.rate;
  return {
    usdAmount: Number(usdAmount.toFixed(2)),
    cryptoAmount: formatCryptoAmount(cryptoAmount, selected.asset),
    cryptoType: selected.asset,
    network: selected.network,
    label: selected.label,
    rate: rate.rate,
    source: rate.source,
    expiresIn: Math.max(0, Math.round((rate.expiresAt || Date.now()) - Date.now()) / 1000),
    minimumFundingUsd
  };
}

walletRouter.get("/", (req, res) => {
  getWallet(req.user.id)
    .then((wallet) => res.json(wallet))
    .catch((error) => res.status(400).json({ error: error.message }));
});

walletRouter.get("/funding-options", (req, res) => {
  res.json({ options: fundingOptionsFromEnv() });
});

walletRouter.get("/quote", (req, res) => {
  buildWalletQuote({
    amount: req.query.amount,
    cryptoType: req.query.cryptoType || req.query.crypto,
    network: req.query.network
  })
    .then((quote) => {
      if (quote.error) return res.status(quote.status || 400).json(quote);
      res.json({ quote });
    })
    .catch((error) => res.status(400).json({ error: error.message, minimumFundingUsd }));
});

function submitDepositRequest(req, res) {
  buildWalletQuote({
    amount: req.body.amount,
    cryptoType: req.body.cryptoType,
    network: req.body.network
  })
    .then((quote) => {
      if (quote.error) return quote;
      return createWalletDepositRequest({
        userId: req.user.id,
        amount: req.body.amount,
        cryptoType: req.body.cryptoType,
        network: req.body.network,
        txHash: req.body.txHash,
        quote
      });
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
