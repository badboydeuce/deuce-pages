import { timingSafeEqual } from "node:crypto";
import { portalBaseUrl, publicBaseUrl } from "./appHosts.js";
import {
  claimTelegramDeliveries,
  completeTelegramDelivery,
  failTelegramDelivery
} from "../repositories/telegramRepository.js";

const telegramApiOrigin = "https://api.telegram.org";
const defaultPollIntervalMs = 2500;
let activeDispatcher = null;

function cleanBotUsername(value = "") {
  return String(value || "").trim().replace(/^@/, "");
}

function escapeHtml(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cleanErrorMessage(value = "") {
  return String(value || "Telegram request failed")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/https?:\/\/\S+/gi, "[remote endpoint]")
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function telegramSecret() {
  return String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
}

export function telegramConfiguration() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const botUsername = cleanBotUsername(process.env.TELEGRAM_BOT_USERNAME);
  const webhookSecret = telegramSecret();
  const backendBaseUrl = publicBaseUrl() || portalBaseUrl();
  return {
    configured: Boolean(token && botUsername && webhookSecret && backendBaseUrl),
    tokenConfigured: Boolean(token),
    botUsername,
    webhookSecretConfigured: Boolean(webhookSecret),
    backendBaseUrl,
    webhookUrl: backendBaseUrl ? `${backendBaseUrl}/api/webhooks/telegram` : ""
  };
}

export function telegramDeepLink(token) {
  const config = telegramConfiguration();
  if (!config.configured) {
    const error = new Error("Telegram notifications are not configured");
    error.status = 503;
    throw error;
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(token || ""))) {
    const error = new Error("Telegram connection token is invalid");
    error.status = 400;
    throw error;
  }
  return `https://t.me/${config.botUsername}?start=${token}`;
}

export function verifyTelegramWebhookSecret(value) {
  const expected = Buffer.from(telegramSecret());
  const received = Buffer.from(String(value || ""));
  if (!expected.length || expected.length !== received.length || !timingSafeEqual(expected, received)) {
    const error = new Error("Telegram webhook rejected");
    error.status = 401;
    throw error;
  }
  return true;
}

class TelegramRequestError extends Error {
  constructor(message, options = {}) {
    super(cleanErrorMessage(message));
    this.name = "TelegramRequestError";
    this.status = Number(options.status || 0);
    this.code = String(options.code || (this.status ? `TELEGRAM_HTTP_${this.status}` : "TELEGRAM_NETWORK_ERROR"));
    this.retryAfterSeconds = Number(options.retryAfterSeconds || 0);
  }
}

export async function telegramRequest(method, payload = {}, { fetchImpl = globalThis.fetch } = {}) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) throw new TelegramRequestError("Telegram bot token is not configured", { code: "TELEGRAM_NOT_CONFIGURED" });
  if (typeof fetchImpl !== "function") throw new TelegramRequestError("Telegram transport is unavailable", { code: "TELEGRAM_TRANSPORT_UNAVAILABLE" });
  let response;
  try {
    response = await fetchImpl(`${telegramApiOrigin}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000)
    });
  } catch (error) {
    throw new TelegramRequestError(error?.name === "TimeoutError" ? "Telegram request timed out" : "Telegram network request failed", {
      code: error?.name === "TimeoutError" ? "TELEGRAM_TIMEOUT" : "TELEGRAM_NETWORK_ERROR"
    });
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new TelegramRequestError(body.description || `Telegram returned ${response.status}`, {
      status: response.status,
      code: body.error_code ? `TELEGRAM_${body.error_code}` : `TELEGRAM_HTTP_${response.status}`,
      retryAfterSeconds: body.parameters?.retry_after
    });
  }
  return body.result;
}

function portalUrl(path = "/portal") {
  const base = portalBaseUrl() || publicBaseUrl();
  return base ? `${base}${path}` : "";
}

export async function sendTelegramConnectionMessage(chatId, { fetchImpl = globalThis.fetch, invalid = false } = {}) {
  const openUrl = portalUrl("/portal#notifications");
  const text = invalid
    ? "This DEUCE connection link is invalid or expired. Return to DEUCE and request a new link."
    : "DEUCE Results notifications are connected. You can now enable Telegram alerts for each subscribed page.";
  return telegramRequest("sendMessage", {
    chat_id: String(chatId),
    text,
    disable_web_page_preview: true,
    ...(openUrl ? { reply_markup: { inline_keyboard: [[{ text: "Open DEUCE", url: openUrl }]] } } : {})
  }, { fetchImpl });
}

export async function sendTelegramTestMessage(chatId, { fetchImpl = globalThis.fetch } = {}) {
  const openUrl = portalUrl("/portal#notifications");
  return telegramRequest("sendMessage", {
    chat_id: String(chatId),
    text: "🔔 <b>Telegram Connected</b>\n\n✅ DEUCE Telegram notifications are working.",
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(openUrl ? { reply_markup: { inline_keyboard: [[{ text: "Open DEUCE", url: openUrl }]] } } : {})
  }, { fetchImpl });
}

export function telegramResultMessage(delivery) {
  const received = new Date(delivery?.notificationCreatedAt || delivery?.createdAt || Date.now());
  const receivedLabel = Number.isNaN(received.getTime()) ? "Just now" : received.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
  const pageName = String(delivery?.pageName || "Subscribed page").replace(/\s+/g, " ").trim().slice(0, 120) || "Subscribed page";
  const safePage = escapeHtml(pageName);
  const safeReceived = escapeHtml(receivedLabel);
  return [
    "🔔 <b>New Result Received</b>",
    "",
    `├─ 📄 <b>Page:</b> ${safePage}`,
    `└─ 🕒 <b>Received:</b> <code>${safeReceived}</code>`,
    "",
    "👀 View it in your portal results."
  ].join("\n");
}

export async function sendTelegramResultDelivery(delivery, { fetchImpl = globalThis.fetch } = {}) {
  const resultsUrl = portalUrl(`/portal#results-${encodeURIComponent(delivery.userPageId)}`);
  return telegramRequest("sendMessage", {
    chat_id: String(delivery.chatId),
    text: telegramResultMessage(delivery),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(resultsUrl ? { reply_markup: { inline_keyboard: [[{ text: "Open results in DEUCE", url: resultsUrl }]] } } : {})
  }, { fetchImpl });
}

function deliveryFailure(error) {
  const status = Number(error?.status || 0);
  return {
    retryable: status === 429 || status >= 500 || ["TELEGRAM_NETWORK_ERROR", "TELEGRAM_TIMEOUT"].includes(error?.code),
    blocked: status === 403,
    errorCode: error?.code || "TELEGRAM_SEND_FAILED",
    message: cleanErrorMessage(error?.message),
    retryAfterSeconds: Number(error?.retryAfterSeconds || 0)
  };
}

export async function dispatchTelegramDeliveriesOnce({ limit = 10, fetchImpl = globalThis.fetch } = {}) {
  if (!telegramConfiguration().configured) return { claimed: 0, sent: 0, failed: 0 };
  const deliveries = await claimTelegramDeliveries(limit);
  let sent = 0;
  let failed = 0;
  for (const delivery of deliveries) {
    try {
      await sendTelegramResultDelivery(delivery, { fetchImpl });
      await completeTelegramDelivery(delivery.id, delivery.userId);
      sent += 1;
    } catch (error) {
      await failTelegramDelivery(delivery, deliveryFailure(error));
      failed += 1;
      console.error("Telegram delivery failed", {
        deliveryId: delivery.id,
        code: error?.code || "TELEGRAM_SEND_FAILED",
        status: Number(error?.status || 0)
      });
    }
  }
  return { claimed: deliveries.length, sent, failed };
}

export function startTelegramDispatcher({ intervalMs = defaultPollIntervalMs } = {}) {
  if (activeDispatcher) return activeDispatcher;
  let timer = null;
  let draining = false;
  let stopped = false;

  const schedule = (delay = intervalMs) => {
    if (stopped || timer) return;
    timer = setTimeout(async () => {
      timer = null;
      if (draining || stopped) return schedule();
      draining = true;
      try {
        let result;
        do {
          result = await dispatchTelegramDeliveriesOnce();
        } while (!stopped && result.claimed >= 10);
      } catch (error) {
        console.error("Telegram dispatcher cycle failed", { code: error?.code || "TELEGRAM_DISPATCH_FAILED" });
      } finally {
        draining = false;
        schedule();
      }
    }, Math.max(Number(delay) || 0, 0));
    timer.unref?.();
  };

  activeDispatcher = {
    wake() { schedule(0); },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      activeDispatcher = null;
    }
  };
  schedule(0);
  return activeDispatcher;
}

export function wakeTelegramDispatcher() {
  activeDispatcher?.wake();
}

export async function configureTelegramWebhook({ fetchImpl = globalThis.fetch } = {}) {
  const config = telegramConfiguration();
  if (!config.configured) {
    const error = new Error("Telegram webhook configuration is incomplete");
    error.status = 503;
    throw error;
  }
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(telegramSecret())) {
    const error = new Error("Telegram webhook secret must contain 16-256 letters, numbers, underscores, or hyphens");
    error.status = 400;
    throw error;
  }
  await telegramRequest("setWebhook", {
    url: config.webhookUrl,
    secret_token: telegramSecret(),
    allowed_updates: ["message"],
    drop_pending_updates: false
  }, { fetchImpl });
  const info = await telegramRequest("getWebhookInfo", {}, { fetchImpl });
  return {
    url: info?.url || config.webhookUrl,
    pendingUpdateCount: Number(info?.pending_update_count || 0),
    lastErrorDate: info?.last_error_date || null,
    hasCustomCertificate: Boolean(info?.has_custom_certificate)
  };
}
