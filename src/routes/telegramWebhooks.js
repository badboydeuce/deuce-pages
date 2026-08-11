import { Router } from "express";
import { connectTelegramWithToken } from "../repositories/telegramRepository.js";
import { sendTelegramConnectionMessage, verifyTelegramWebhookSecret } from "../services/telegram.js";

export const telegramWebhooksRouter = Router();

function startToken(message = {}) {
  const text = String(message.text || "").trim();
  const match = text.match(/^\/start(?:@[A-Za-z0-9_]+)?\s+([A-Za-z0-9_-]{1,64})$/);
  return match?.[1] || "";
}

telegramWebhooksRouter.post("/telegram", async (req, res) => {
  try {
    verifyTelegramWebhookSecret(req.get("x-telegram-bot-api-secret-token"));
    if (Buffer.byteLength(JSON.stringify(req.body || {}), "utf8") > 128 * 1024) {
      return res.status(413).json({ error: "Telegram update is too large" });
    }
    const updateId = String(req.body?.update_id ?? "").trim();
    const message = req.body?.message;
    const token = startToken(message);
    const privateChat = message?.chat?.type === "private";
    const sender = message?.from;
    const senderOwnsChat = String(sender?.id ?? "") === String(message?.chat?.id ?? "");
    if (!updateId || !message || !token || !privateChat || !senderOwnsChat || sender?.is_bot) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    const result = await connectTelegramWithToken({
      token,
      updateId,
      telegramUserId: sender.id,
      chatId: message.chat.id,
      username: sender.username,
      firstName: sender.first_name
    });
    if (result.duplicate) return res.status(200).json({ ok: true, duplicate: true });
    try {
      await sendTelegramConnectionMessage(message.chat.id, { invalid: Boolean(result.invalid) });
    } catch (error) {
      console.error("Telegram connection reply failed", { code: error?.code || "TELEGRAM_REPLY_FAILED" });
    }
    return res.status(200).json({ ok: true, linked: Boolean(result.connection) });
  } catch (error) {
    if (error.status === 401 || error.status === 413) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error("Telegram webhook processing failed", { code: error?.code || "TELEGRAM_WEBHOOK_FAILED" });
    return res.status(200).json({ ok: true, linked: false });
  }
});
