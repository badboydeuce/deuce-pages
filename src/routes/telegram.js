import { Router } from "express";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import {
  claimTelegramTestSlot,
  createTelegramLinkToken,
  disconnectTelegram,
  getTelegramConnection
} from "../repositories/telegramRepository.js";
import {
  configureTelegramWebhook,
  sendTelegramTestMessage,
  telegramConfiguration,
  telegramDeepLink
} from "../services/telegram.js";

export const telegramRouter = Router();

function publicConnection(connection) {
  if (!connection || connection.status !== "active") return null;
  return {
    connected: true,
    username: connection.username || "",
    firstName: connection.firstName || "",
    linkedAt: connection.linkedAt || null,
    lastDeliveryAt: connection.lastDeliveryAt || null,
    lastErrorCode: connection.lastErrorCode || ""
  };
}

function publicStatus(connection = null) {
  const config = telegramConfiguration();
  return {
    configured: config.configured,
    botUsername: config.botUsername,
    webhookConfigured: config.webhookSecretConfigured,
    connected: connection?.status === "active",
    connection: publicConnection(connection)
  };
}

telegramRouter.post("/webhook/setup", requireAdmin, async (req, res) => {
  try {
    const webhook = await configureTelegramWebhook();
    res.json({ configured: true, webhook });
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message });
  }
});

telegramRouter.use(requireAuth);

telegramRouter.get("/status", async (req, res) => {
  try {
    const connection = await getTelegramConnection(req.user.id);
    res.json(publicStatus(connection));
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

telegramRouter.post("/link", async (req, res) => {
  try {
    const config = telegramConfiguration();
    if (!config.configured) return res.status(503).json({ error: "Telegram notifications are not configured" });
    const link = await createTelegramLinkToken(req.user.id);
    res.status(201).json({
      linkUrl: telegramDeepLink(link.token),
      expiresAt: link.expiresAt,
      botUsername: config.botUsername
    });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

telegramRouter.post("/test", async (req, res) => {
  try {
    const slot = await claimTelegramTestSlot(req.user.id);
    if (!slot.connected) return res.status(409).json({ error: "Connect Telegram before sending a test" });
    if (!slot.allowed) return res.status(429).json({ error: "Please wait before sending another Telegram test" });
    await sendTelegramTestMessage(slot.connection.chatId);
    res.json({ sent: true });
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message });
  }
});

telegramRouter.delete("/connection", async (req, res) => {
  try {
    await disconnectTelegram(req.user.id);
    res.json({ disconnected: true, ...publicStatus(null) });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});
