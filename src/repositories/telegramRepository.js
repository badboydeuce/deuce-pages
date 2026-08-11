import { createHash, randomBytes, randomUUID } from "node:crypto";
import { query, withTransaction } from "../db/pool.js";
import { readJsonDb, updateJsonDb, useJsonDb } from "../data/jsonStore.js";

const maxDeliveryAttempts = 6;

function createId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
}

function hashToken(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

function cleanText(value, limit = 180) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function statusError(message, status = 400, code = "") {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

function connectionFromRow(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    telegramUserId: row.telegram_user_id,
    chatId: row.chat_id,
    username: row.username || "",
    firstName: row.first_name || "",
    status: row.status,
    linkedAt: row.linked_at,
    disconnectedAt: row.disconnected_at || null,
    lastDeliveryAt: row.last_delivery_at || null,
    lastTestAt: row.last_test_at || null,
    failureCount: Number(row.failure_count || 0),
    lastErrorCode: row.last_error_code || "",
    updatedAt: row.updated_at
  };
}

function deliveryFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    notificationId: row.notification_id,
    userId: row.user_id,
    userPageId: row.user_page_id,
    chatId: row.chat_id,
    pageName: row.page_name || "Subscribed page",
    status: row.status,
    attempts: Number(row.attempts || 0),
    notificationCreatedAt: row.notification_created_at || row.created_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function getTelegramConnection(userId) {
  if (!userId) return null;
  if (useJsonDb()) {
    const db = await readJsonDb();
    return (db.telegramConnections || []).find((item) => item.userId === userId) || null;
  }
  const result = await query("SELECT * FROM telegram_connections WHERE user_id = $1 LIMIT 1", [userId]);
  return connectionFromRow(result.rows[0]);
}

export async function createTelegramLinkToken(userId, { lifetimeMinutes = 15 } = {}) {
  if (!userId) throw statusError("Authentication required", 401);
  const minutes = Math.min(Math.max(Number(lifetimeMinutes) || 15, 5), 30);
  const token = `c_${randomBytes(24).toString("base64url")}`;
  const tokenHash = hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + minutes * 60 * 1000).toISOString();
  const record = {
    id: createId("tglink"),
    userId,
    tokenHash,
    expiresAt,
    usedAt: null,
    revokedAt: null,
    createdAt: now.toISOString()
  };

  if (useJsonDb()) {
    await updateJsonDb((db) => {
      db.telegramLinkTokens ||= [];
      for (const item of db.telegramLinkTokens) {
        if (item.userId === userId && !item.usedAt && !item.revokedAt) item.revokedAt = record.createdAt;
      }
      db.telegramLinkTokens.push(record);
      return record;
    });
    return { token, expiresAt };
  }

  await withTransaction(async (client) => {
    await client.query(
      "UPDATE telegram_link_tokens SET revoked_at = now() WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL",
      [userId]
    );
    await client.query(
      `INSERT INTO telegram_link_tokens (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [record.id, userId, tokenHash, expiresAt]
    );
  });
  return { token, expiresAt };
}

export async function connectTelegramWithToken({
  token,
  updateId,
  telegramUserId,
  chatId,
  username = "",
  firstName = ""
} = {}) {
  const cleanUpdateId = cleanText(updateId, 80);
  const cleanTelegramUserId = cleanText(telegramUserId, 80);
  const cleanChatId = cleanText(chatId, 80);
  const tokenHash = hashToken(token);
  if (!token || !cleanUpdateId || !cleanTelegramUserId || !cleanChatId) {
    throw statusError("Telegram connection data is incomplete", 400);
  }

  if (useJsonDb()) {
    return updateJsonDb((db) => {
      db.telegramWebhookUpdates ||= [];
      if (db.telegramWebhookUpdates.some((item) => String(item.updateId) === cleanUpdateId)) {
        return { duplicate: true, connection: null };
      }
      db.telegramWebhookUpdates.push({ updateId: cleanUpdateId, processedAt: new Date().toISOString() });
      db.telegramLinkTokens ||= [];
      const link = db.telegramLinkTokens.find((item) => (
        item.tokenHash === tokenHash
        && !item.usedAt
        && !item.revokedAt
        && new Date(item.expiresAt).getTime() > Date.now()
      ));
      if (!link) return { invalid: true, duplicate: false, connection: null };
      db.telegramConnections ||= [];
      const conflict = db.telegramConnections.find((item) => (
        item.userId !== link.userId
        && (String(item.chatId) === cleanChatId || String(item.telegramUserId) === cleanTelegramUserId)
      ));
      if (conflict) throw statusError("This Telegram account is already connected to another DEUCE account", 409, "TELEGRAM_ALREADY_LINKED");
      const now = new Date().toISOString();
      const next = {
        userId: link.userId,
        telegramUserId: cleanTelegramUserId,
        chatId: cleanChatId,
        username: cleanText(username, 80),
        firstName: cleanText(firstName, 120),
        status: "active",
        linkedAt: now,
        disconnectedAt: null,
        lastDeliveryAt: null,
        lastTestAt: null,
        failureCount: 0,
        lastErrorCode: "",
        updatedAt: now
      };
      const index = db.telegramConnections.findIndex((item) => item.userId === link.userId);
      if (index === -1) db.telegramConnections.push(next);
      else db.telegramConnections[index] = { ...db.telegramConnections[index], ...next };
      link.usedAt = now;
      return { duplicate: false, invalid: false, connection: next };
    });
  }

  try {
    return await withTransaction(async (client) => {
      const update = await client.query(
        `INSERT INTO telegram_webhook_updates (update_id)
         VALUES ($1)
         ON CONFLICT (update_id) DO NOTHING
         RETURNING update_id`,
        [cleanUpdateId]
      );
      if (!update.rows[0]) return { duplicate: true, connection: null };

      const linkResult = await client.query(
        `SELECT * FROM telegram_link_tokens
         WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
         FOR UPDATE`,
        [tokenHash]
      );
      const link = linkResult.rows[0];
      if (!link) return { invalid: true, duplicate: false, connection: null };

      const conflict = await client.query(
        `SELECT user_id FROM telegram_connections
         WHERE user_id <> $1 AND (chat_id = $2 OR telegram_user_id = $3)
         LIMIT 1`,
        [link.user_id, cleanChatId, cleanTelegramUserId]
      );
      if (conflict.rows[0]) {
        throw statusError("This Telegram account is already connected to another DEUCE account", 409, "TELEGRAM_ALREADY_LINKED");
      }

      const connected = await client.query(
        `INSERT INTO telegram_connections
          (user_id, telegram_user_id, chat_id, username, first_name, status, linked_at, disconnected_at, failure_count, last_error_code, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'active', now(), NULL, 0, NULL, now())
         ON CONFLICT (user_id) DO UPDATE SET
           telegram_user_id = EXCLUDED.telegram_user_id,
           chat_id = EXCLUDED.chat_id,
           username = EXCLUDED.username,
           first_name = EXCLUDED.first_name,
           status = 'active',
           linked_at = now(),
           disconnected_at = NULL,
           failure_count = 0,
           last_error_code = NULL,
           updated_at = now()
         RETURNING *`,
        [link.user_id, cleanTelegramUserId, cleanChatId, cleanText(username, 80), cleanText(firstName, 120)]
      );
      await client.query("UPDATE telegram_link_tokens SET used_at = now() WHERE id = $1", [link.id]);
      return { duplicate: false, invalid: false, connection: connectionFromRow(connected.rows[0]) };
    });
  } catch (error) {
    if (error?.code === "23505") throw statusError("This Telegram account is already connected to another DEUCE account", 409, "TELEGRAM_ALREADY_LINKED");
    throw error;
  }
}

export async function disconnectTelegram(userId) {
  if (!userId) throw statusError("Authentication required", 401);
  if (useJsonDb()) {
    return updateJsonDb((db) => {
      const connection = (db.telegramConnections || []).find((item) => item.userId === userId);
      if (!connection) return null;
      const now = new Date().toISOString();
      connection.status = "disconnected";
      connection.disconnectedAt = now;
      connection.updatedAt = now;
      for (const token of db.telegramLinkTokens || []) {
        if (token.userId === userId && !token.usedAt && !token.revokedAt) token.revokedAt = now;
      }
      for (const delivery of db.telegramNotificationDeliveries || []) {
        if (delivery.userId === userId && ["pending", "retry", "sending"].includes(delivery.status)) {
          delivery.status = "cancelled";
          delivery.errorCode = "TELEGRAM_DISCONNECTED";
          delivery.updatedAt = now;
        }
      }
      return connection;
    });
  }

  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE telegram_connections
       SET status = 'disconnected', disconnected_at = now(), updated_at = now()
       WHERE user_id = $1
       RETURNING *`,
      [userId]
    );
    await client.query(
      "UPDATE telegram_link_tokens SET revoked_at = now() WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL",
      [userId]
    );
    await client.query(
      `UPDATE telegram_notification_deliveries
       SET status = 'cancelled', error_code = 'TELEGRAM_DISCONNECTED', updated_at = now()
       WHERE user_id = $1 AND status IN ('pending', 'retry', 'sending')`,
      [userId]
    );
    return connectionFromRow(result.rows[0]);
  });
}

export async function claimTelegramTestSlot(userId, cooldownSeconds = 30) {
  const cooldown = Math.min(Math.max(Number(cooldownSeconds) || 30, 10), 300);
  if (useJsonDb()) {
    return updateJsonDb((db) => {
      const connection = (db.telegramConnections || []).find((item) => item.userId === userId && item.status === "active");
      if (!connection) return { connected: false, allowed: false, connection: null };
      const last = new Date(connection.lastTestAt || 0).getTime();
      if (Number.isFinite(last) && Date.now() - last < cooldown * 1000) {
        return { connected: true, allowed: false, connection };
      }
      connection.lastTestAt = new Date().toISOString();
      connection.updatedAt = connection.lastTestAt;
      return { connected: true, allowed: true, connection };
    });
  }

  return withTransaction(async (client) => {
    const existing = await client.query("SELECT * FROM telegram_connections WHERE user_id = $1 FOR UPDATE", [userId]);
    const connection = connectionFromRow(existing.rows[0]);
    if (!connection || connection.status !== "active") return { connected: false, allowed: false, connection: null };
    const last = new Date(connection.lastTestAt || 0).getTime();
    if (Number.isFinite(last) && Date.now() - last < cooldown * 1000) {
      return { connected: true, allowed: false, connection };
    }
    const updated = await client.query(
      "UPDATE telegram_connections SET last_test_at = now(), updated_at = now() WHERE user_id = $1 RETURNING *",
      [userId]
    );
    return { connected: true, allowed: true, connection: connectionFromRow(updated.rows[0]) };
  });
}

export function queueTelegramDeliveryInJson(db, notification, userPage) {
  if (!notification || userPage?.resultSettings?.telegramNotifyOnResult !== true) return null;
  db.telegramConnections ||= [];
  db.telegramNotificationDeliveries ||= [];
  const connection = db.telegramConnections.find((item) => item.userId === notification.userId && item.status === "active");
  if (!connection) return null;
  const duplicate = db.telegramNotificationDeliveries.find((item) => item.notificationId === notification.id && item.channel === "telegram");
  if (duplicate) return duplicate;
  const now = new Date().toISOString();
  const delivery = {
    id: createId("tgdelivery"),
    notificationId: notification.id,
    userId: notification.userId,
    userPageId: notification.userPageId,
    channel: "telegram",
    status: "pending",
    attempts: 0,
    nextAttemptAt: now,
    sentAt: null,
    errorCode: "",
    lastError: "",
    createdAt: now,
    updatedAt: now
  };
  db.telegramNotificationDeliveries.push(delivery);
  return delivery;
}

export async function queueTelegramDeliveryWithClient(client, { resultId, eventType = "result.created", userId, userPageId } = {}) {
  if (!client || !resultId || !userId || !userPageId) return null;
  const deliveryId = createId("tgdelivery");
  const result = await client.query(
    `INSERT INTO telegram_notification_deliveries
      (id, notification_id, user_id, user_page_id, channel, status, next_attempt_at)
     SELECT $1, notification.id, $2, $3, 'telegram', 'pending', now()
     FROM notification_outbox notification
     JOIN telegram_connections connection ON connection.user_id = $2 AND connection.status = 'active'
     WHERE notification.result_id = $4 AND notification.event_type = $5
     ON CONFLICT (notification_id, channel) DO NOTHING
     RETURNING *`,
    [deliveryId, userId, userPageId, resultId, eventType]
  );
  return result.rows[0] || null;
}

export async function claimTelegramDeliveries(limit = 10) {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
  if (useJsonDb()) {
    return updateJsonDb((db) => {
      const now = Date.now();
      const connections = new Map((db.telegramConnections || []).map((item) => [item.userId, item]));
      const notifications = new Map((db.notificationOutbox || []).map((item) => [item.id, item]));
      const pages = new Map((db.userPages || []).map((item) => [item.id, item]));
      const claimed = (db.telegramNotificationDeliveries || [])
        .filter((item) => {
          const connection = connections.get(item.userId);
          if (!connection || connection.status !== "active") return false;
          if (["pending", "retry"].includes(item.status)) return new Date(item.nextAttemptAt || 0).getTime() <= now;
          return item.status === "sending" && new Date(item.updatedAt || 0).getTime() <= now - 5 * 60 * 1000;
        })
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
        .slice(0, safeLimit);
      const updatedAt = new Date().toISOString();
      return claimed.map((item) => {
        item.status = "sending";
        item.attempts = Number(item.attempts || 0) + 1;
        item.updatedAt = updatedAt;
        const notice = notifications.get(item.notificationId);
        const page = pages.get(item.userPageId);
        const connection = connections.get(item.userId);
        return {
          ...item,
          chatId: connection.chatId,
          pageName: page?.name || "Subscribed page",
          notificationCreatedAt: notice?.createdAt || item.createdAt
        };
      });
    });
  }

  const result = await query(
    `WITH candidates AS (
       SELECT delivery.id
       FROM telegram_notification_deliveries delivery
       JOIN telegram_connections connection ON connection.user_id = delivery.user_id AND connection.status = 'active'
       WHERE (
         delivery.status IN ('pending', 'retry') AND delivery.next_attempt_at <= now()
       ) OR (
         delivery.status = 'sending' AND delivery.updated_at < now() - interval '5 minutes'
       )
       ORDER BY delivery.created_at ASC
       FOR UPDATE OF delivery SKIP LOCKED
       LIMIT $1
     ), claimed AS (
       UPDATE telegram_notification_deliveries delivery
       SET status = 'sending', attempts = delivery.attempts + 1, updated_at = now()
       FROM candidates
       WHERE delivery.id = candidates.id
       RETURNING delivery.*
     )
     SELECT claimed.*, notification.created_at AS notification_created_at,
            page.name AS page_name, connection.chat_id
     FROM claimed
     JOIN notification_outbox notification ON notification.id = claimed.notification_id
     JOIN user_pages page ON page.id = claimed.user_page_id
     JOIN telegram_connections connection ON connection.user_id = claimed.user_id AND connection.status = 'active'
     ORDER BY claimed.created_at ASC`,
    [safeLimit]
  );
  return result.rows.map(deliveryFromRow);
}

export async function completeTelegramDelivery(deliveryId, userId) {
  if (useJsonDb()) {
    return updateJsonDb((db) => {
      const delivery = (db.telegramNotificationDeliveries || []).find((item) => item.id === deliveryId);
      if (!delivery) return null;
      const now = new Date().toISOString();
      delivery.status = "sent";
      delivery.sentAt = now;
      delivery.errorCode = "";
      delivery.lastError = "";
      delivery.updatedAt = now;
      const connection = (db.telegramConnections || []).find((item) => item.userId === (userId || delivery.userId));
      if (connection) {
        connection.lastDeliveryAt = now;
        connection.failureCount = 0;
        connection.lastErrorCode = "";
        connection.updatedAt = now;
      }
      return delivery;
    });
  }

  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE telegram_notification_deliveries
       SET status = 'sent', sent_at = now(), error_code = NULL, last_error = NULL, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [deliveryId]
    );
    if (userId) {
      await client.query(
        `UPDATE telegram_connections
         SET last_delivery_at = now(), failure_count = 0, last_error_code = NULL, updated_at = now()
         WHERE user_id = $1`,
        [userId]
      );
    }
    return result.rows[0] || null;
  });
}

function retryDelaySeconds(attempts, requested = 0) {
  const exponential = Math.min(15 * 60, Math.max(5, 5 * (2 ** Math.max(Number(attempts || 1) - 1, 0))));
  return Math.min(60 * 60, Math.max(exponential, Number(requested) || 0));
}

export async function failTelegramDelivery(delivery, { retryable = false, blocked = false, errorCode = "TELEGRAM_SEND_FAILED", message = "", retryAfterSeconds = 0 } = {}) {
  if (!delivery?.id) return null;
  const attempts = Number(delivery.attempts || 1);
  const shouldRetry = Boolean(retryable && !blocked && attempts < maxDeliveryAttempts);
  const nextAttemptAt = new Date(Date.now() + retryDelaySeconds(attempts, retryAfterSeconds) * 1000).toISOString();
  const cleanCode = cleanText(errorCode, 80) || "TELEGRAM_SEND_FAILED";
  const cleanMessage = cleanText(message, 300);

  if (useJsonDb()) {
    return updateJsonDb((db) => {
      const stored = (db.telegramNotificationDeliveries || []).find((item) => item.id === delivery.id);
      if (!stored) return null;
      const now = new Date().toISOString();
      stored.status = shouldRetry ? "retry" : "failed";
      stored.nextAttemptAt = shouldRetry ? nextAttemptAt : stored.nextAttemptAt;
      stored.errorCode = cleanCode;
      stored.lastError = cleanMessage;
      stored.updatedAt = now;
      const connection = (db.telegramConnections || []).find((item) => item.userId === delivery.userId);
      if (connection) {
        connection.failureCount = Number(connection.failureCount || 0) + 1;
        connection.lastErrorCode = cleanCode;
        connection.updatedAt = now;
        if (blocked) {
          connection.status = "blocked";
          connection.disconnectedAt = now;
          for (const item of db.telegramNotificationDeliveries || []) {
            if (item.userId === delivery.userId && ["pending", "retry"].includes(item.status)) {
              item.status = "cancelled";
              item.errorCode = "TELEGRAM_BLOCKED";
              item.updatedAt = now;
            }
          }
        }
      }
      return stored;
    });
  }

  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE telegram_notification_deliveries
       SET status = $2,
           next_attempt_at = CASE WHEN $2 = 'retry' THEN $3::timestamptz ELSE next_attempt_at END,
           error_code = $4, last_error = $5, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [delivery.id, shouldRetry ? "retry" : "failed", nextAttemptAt, cleanCode, cleanMessage]
    );
    await client.query(
      `UPDATE telegram_connections
       SET failure_count = failure_count + 1, last_error_code = $2,
           status = CASE WHEN $3::boolean THEN 'blocked' ELSE status END,
           disconnected_at = CASE WHEN $3::boolean THEN now() ELSE disconnected_at END,
           updated_at = now()
       WHERE user_id = $1`,
      [delivery.userId, cleanCode, blocked]
    );
    if (blocked) {
      await client.query(
        `UPDATE telegram_notification_deliveries
         SET status = 'cancelled', error_code = 'TELEGRAM_BLOCKED', updated_at = now()
         WHERE user_id = $1 AND id <> $2 AND status IN ('pending', 'retry')`,
        [delivery.userId, delivery.id]
      );
    }
    return result.rows[0] || null;
  });
}
