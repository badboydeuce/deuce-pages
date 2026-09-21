import { Router } from "express";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import {
  claimTelegramTestSlot,
  createTelegramLinkToken,
  disconnectTelegram,
  getTelegramConnection,
  setTelegramBroadcastPreference
} from "../repositories/telegramRepository.js";
import {
  countTelegramBroadcastRecipients,
  createTelegramBroadcast,
  getTelegramBroadcast,
  listTelegramBroadcasts,
  queueTelegramBroadcast
} from "../repositories/telegramBroadcastRepository.js";
import {
  configureTelegramWebhook,
  sendTelegramBroadcastMessage,
  sendTelegramTestMessage,
  telegramConfiguration,
  telegramDeepLink
} from "../services/telegram.js";
import { wakeTelegramDispatcher } from "../services/telegram.js";

export const telegramRouter = Router();

function publicConnection(connection) {
  if (!connection || connection.status !== "active") return null;
  return {
    connected: true,
    username: connection.username || "",
    firstName: connection.firstName || "",
    linkedAt: connection.linkedAt || null,
    lastDeliveryAt: connection.lastDeliveryAt || null,
    lastErrorCode: connection.lastErrorCode || "",
    broadcastOptIn: connection.broadcastOptIn === true
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

telegramRouter.get("/admin/broadcasts", requireAdmin, async (req, res) => {
  try {
    const [broadcasts, recipientCount] = await Promise.all([listTelegramBroadcasts(), countTelegramBroadcastRecipients()]);
    res.json({ broadcasts, recipientCount });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

telegramRouter.post("/admin/broadcasts", requireAdmin, async (req, res) => {
  try {
    const broadcast = await createTelegramBroadcast(req.user.id, req.body || {});
    res.status(201).json({ broadcast });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

telegramRouter.post("/admin/broadcasts/:id/test", requireAdmin, async (req, res) => {
  try {
    const connection = await getTelegramConnection(req.user.id);
    if (!connection || connection.status !== "active") return res.status(409).json({ error: "Connect your Telegram account before sending a test" });
    const broadcast = await getTelegramBroadcast(req.params.id);
    if (!broadcast) return res.status(404).json({ error: "Broadcast not found" });
    await sendTelegramBroadcastMessage(connection.chatId, broadcast);
    res.json({ sent: true });
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message });
  }
});

telegramRouter.post("/admin/broadcasts/:id/send", requireAdmin, async (req, res) => {
  try {
    const broadcast = await queueTelegramBroadcast(req.params.id);
    wakeTelegramDispatcher();
    res.json({ broadcast });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
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

telegramRouter.patch("/broadcast-preference", async (req, res) => {
  try {
    const connection = await setTelegramBroadcastPreference(req.user.id, req.body?.enabled === true);
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
