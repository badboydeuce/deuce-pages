import { createHash, pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { query, withTransaction } from "../db/pool.js";
import { readJsonDb, updateJsonDb, useJsonDb } from "../data/jsonStore.js";
import { createRuntimePackageSnapshot } from "../services/runtimeScreens.js";
import {
  trustedResultManifestFromPersistent
} from "../services/resultCapture.js";
import { summarizeTrafficEvents } from "../services/trafficAnalytics.js";
import {
  deleteObject,
  getObjectBuffer,
  headObject,
  objectStorageConfigured,
  signedUploadUrl
} from "../services/objectStorage.js";
import {
  queueTelegramDeliveryInJson,
  queueTelegramDeliveryWithClient
} from "./telegramRepository.js";

function createId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
}

const resultAttachmentMimeTypes = new Map([
  ["image/jpeg", { extension: "jpg", signature: (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff }],
  ["image/png", { extension: "png", signature: (buffer) => buffer.length >= 8 && buffer.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" }],
  ["image/webp", { extension: "webp", signature: (buffer) => buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP" }]
]);
const resultAttachmentMaxBytes = Math.min(Math.max(Number(process.env.RESULT_ATTACHMENT_MAX_MB) || 10, 1), 25) * 1024 * 1024;
const resultAttachmentUploadSeconds = Math.min(Math.max(Number(process.env.RESULT_ATTACHMENT_UPLOAD_SECONDS) || 300, 60), 900);
const maxPendingResultAttachmentsPerSession = 12;

function compactAttachmentText(value = "", limit = 160) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function normalizeAttachmentIds(value = []) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || "").trim()).filter((item) => /^attachment_[a-z0-9]{18}$/i.test(item)))].slice(0, 4)
    : [];
}

function attachmentSide(label = "", fieldId = "") {
  const value = `${label} ${fieldId}`.toLowerCase();
  if (/\bfront\b/.test(value)) return "front";
  if (/\bback\b|\brear\b/.test(value)) return "back";
  return "document";
}

function publicResultAttachment(attachment = {}) {
  if (!attachment) return null;
  return {
    id: attachment.id,
    resultId: attachment.resultId || attachment.result_id || null,
    fieldId: attachment.fieldId || attachment.field_id || "",
    label: attachment.fieldLabel || attachment.field_label || "Uploaded image",
    side: attachment.side || "document",
    mimeType: attachment.mimeType || attachment.mime_type || "application/octet-stream",
    sizeBytes: Number(attachment.sizeBytes ?? attachment.size_bytes ?? attachment.expectedSize ?? attachment.expected_size ?? 0),
    createdAt: attachment.createdAt || attachment.created_at || null
  };
}

function jsonAttachmentKeys(db, userPageId, resultIds) {
  const selected = new Set(resultIds);
  return (db.resultAttachments || [])
    .filter((item) => item.userPageId === userPageId && selected.has(item.resultId))
    .map((item) => item.objectKey)
    .filter(Boolean);
}

async function deleteStoredObjects(keys = []) {
  for (const key of [...new Set(keys.filter(Boolean))]) {
    await deleteObject(key);
  }
}

function hashPassword(password) {
  if (!password || password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, 120000, 64, "sha512").toString("hex");
  return `pbkdf2_sha512$120000$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!password || !storedHash) return false;
  const [algorithm, iterations, salt, hash] = storedHash.split("$");
  if (algorithm !== "pbkdf2_sha512" || !iterations || !salt || !hash) return false;
  const calculated = pbkdf2Sync(password, salt, Number(iterations), 64, "sha512");
  const expected = Buffer.from(hash, "hex");
  return expected.length === calculated.length && timingSafeEqual(expected, calculated);
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function toPackage(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    version: row.version,
    status: row.status,
    sourceType: row.source_type,
    repoUrl: row.repo_url,
    billingPeriods: row.billing_periods,
    screens: row.screens,
    assets: row.assets,
    cssFiles: row.css_files,
    designTokens: row.design_tokens,
    packageManifest: row.package_manifest,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toGitHubChangeEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    packageId: row.package_id,
    deliveryId: row.delivery_id,
    repository: row.repository,
    branch: row.branch,
    beforeSha: row.before_sha || "",
    afterSha: row.after_sha || "",
    compareUrl: row.compare_url || "",
    author: row.author || "GitHub",
    eventType: row.event_type || "push",
    status: row.status || "received",
    changedFiles: row.changed_files || [],
    summary: row.summary || {},
    error: row.error || "",
    processedAt: row.processed_at || null,
    resolvedAt: row.resolved_at || null,
    createdAt: row.created_at
  };
}

function cleanGitHubChangedFiles(files = []) {
  return [...new Set((Array.isArray(files) ? files : [])
    .map((file) => String(file || "").replace(/\\/g, "/").replace(/^\/+/, "").trim())
    .filter((file) => file && file.length <= 240 && !file.split("/").some((part) => part === "..")))]
    .slice(0, 500);
}

function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    walletBalance: Number(row.wallet_balance || 0),
    collaboration: row.collaboration || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function invitationStatus(invitation) {
  if (invitation.revokedAt) return "revoked";
  if (invitation.usedAt) return "used";
  if (new Date(invitation.expiresAt).getTime() <= Date.now()) return "expired";
  return "pending";
}

function publicInvitation(invitation) {
  if (!invitation) return null;
  const clean = {
    id: invitation.id,
    email: invitation.email,
    createdBy: invitation.createdBy || null,
    usedBy: invitation.usedBy || null,
    expiresAt: invitation.expiresAt,
    usedAt: invitation.usedAt || null,
    revokedAt: invitation.revokedAt || null,
    createdAt: invitation.createdAt
  };
  return { ...clean, status: invitationStatus(clean) };
}

function toInvitation(row) {
  if (!row) return null;
  return publicInvitation({
    id: row.id,
    email: row.email,
    createdBy: row.created_by,
    usedBy: row.used_by,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at
  });
}

function invitationError(status = 400) {
  const error = new Error("Invitation is invalid, expired, or already used");
  error.status = status;
  return error;
}

function assertUsableInvitation(invitation) {
  if (!invitation || invitation.revokedAt || invitation.usedAt) throw invitationError(410);
  if (new Date(invitation.expiresAt).getTime() <= Date.now()) throw invitationError(410);
}

function normalizeInviteEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    const error = new Error("A valid invitation email is required");
    error.status = 400;
    throw error;
  }
  return normalized;
}

function toUserPage(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    packageId: row.package_id,
    packageVersion: row.package_version,
    name: row.name,
    slug: row.slug,
    domain: row.domain,
    status: row.status,
    subscription: row.subscription,
    flow: row.flow,
    configs: row.configs,
    securityConfig: row.security_config,
    hostingConfig: row.hosting_config,
    resultSettings: row.result_settings,
    generatedFile: row.generated_file,
    uiPreferences: row.ui_preferences || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toTransaction(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    amount: Number(row.amount || 0),
    description: row.description,
    metadata: row.metadata,
    createdAt: row.created_at
  };
}

function toDepositRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email || row.email || "",
    userName: row.user_name || row.name || "",
    amount: Number(row.amount || 0),
    cryptoType: row.crypto_type,
    network: row.network,
    quote: row.quote || {},
    txHash: row.tx_hash,
    status: row.status,
    adminNote: row.admin_note || "",
    reviewedBy: row.reviewed_by || "",
    reviewedAt: row.reviewed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function publicResult(result) {
  if (!result) return null;
  const safeResult = { ...result };
  delete safeResult.userId;
  delete safeResult.licenseKey;
  safeResult.payload = result.payload || {};
  return safeResult;
}

function toResult(row) {
  if (!row) return null;
  return publicResult({
    id: row.id,
    userPageId: row.user_page_id,
    userId: row.user_id,
    packageId: row.package_id,
    packageVersion: row.package_version,
    pageId: row.page_id,
    pageName: row.page_name,
    licenseKey: row.license_key,
    sessionId: row.session_id,
    screen: row.screen,
    flow: row.flow,
    payload: row.payload,
    hostname: row.hostname,
    path: row.path,
    ip: row.ip,
    userAgent: row.user_agent,
    status: row.status || "new",
    reviewedAt: row.reviewed_at || null,
    reviewedBy: row.reviewed_by || "",
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    createdAt: row.created_at
  });
}

function toTrafficEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    userPageId: row.user_page_id,
    pageId: row.page_id,
    sessionId: row.session_id,
    event: row.event,
    screen: row.screen,
    hostname: row.hostname,
    path: row.path,
    ip: row.ip,
    result: row.result,
    reason: row.reason,
    userAgent: row.user_agent,
    metadata: row.metadata,
    createdAt: row.created_at
  };
}

function publicJsonUser(user) {
  if (!user) return null;
  const { passwordHash, ...safeUser } = user;
  return safeUser;
}

function configuredAdminEmails() {
  return [process.env.ADMIN_EMAIL, process.env.ADMIN_EMAILS]
    .filter(Boolean)
    .flatMap((value) => String(value).split(","))
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function roleForEmail(email, fallbackRole = "subscriber") {
  return configuredAdminEmails().includes(String(email || "").toLowerCase()) ? "admin" : fallbackRole;
}

export async function createUser(data) {
  if (!data.email) throw new Error("Email is required");
  const passwordHash = hashPassword(data.password);
  const email = data.email.toLowerCase();
  const role = roleForEmail(email);

  if (useJsonDb()) {
    return updateJsonDb((db) => {
      if (db.users.some((user) => user.email === email)) {
        throw new Error("Email already exists");
      }
      const user = {
        id: createId("user"),
        name: data.name || "New User",
        email,
        passwordHash,
        role,
        status: "active",
        walletBalance: 0,
        collaboration: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      db.users.push(user);
      return publicJsonUser(user);
    });
  }

  const result = await query(
    `INSERT INTO users (id, name, email, password_hash, role, status, wallet_balance, collaboration)
     VALUES ($1, $2, $3, $4, $5, 'active', 0, '{}'::jsonb)
     RETURNING *`,
    [createId("user"), data.name || "New User", email, passwordHash, role]
  );
  return toUser(result.rows[0]);
}

export async function createRegistrationInvitation({ email, expiresInHours = 48, createdBy = null } = {}) {
  const normalizedEmail = normalizeInviteEmail(email);
  const lifetimeHours = Number(expiresInHours);
  if (!Number.isInteger(lifetimeHours) || lifetimeHours < 1 || lifetimeHours > 168) {
    const error = new Error("Invitation lifetime must be between 1 and 168 hours");
    error.status = 400;
    throw error;
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);

  if (useJsonDb()) {
    return updateJsonDb((db) => {
      db.registrationInvitations ||= [];
      if (db.users.some((user) => user.email === normalizedEmail)) {
        const error = new Error("An account already exists for this email");
        error.status = 409;
        throw error;
      }

      const now = new Date().toISOString();
      db.registrationInvitations.forEach((invitation) => {
        if (invitation.email === normalizedEmail && !invitation.usedAt && !invitation.revokedAt) {
          invitation.revokedAt = now;
        }
      });
      const invitation = {
        id: createId("invite"),
        email: normalizedEmail,
        tokenHash,
        createdBy,
        usedBy: null,
        expiresAt: new Date(Date.now() + lifetimeHours * 60 * 60 * 1000).toISOString(),
        usedAt: null,
        revokedAt: null,
        createdAt: now
      };
      db.registrationInvitations.push(invitation);
      return { invitation: publicInvitation(invitation), token };
    });
  }

  return withTransaction(async (client) => {
    const existing = await client.query("SELECT 1 FROM users WHERE lower(email) = $1 LIMIT 1", [normalizedEmail]);
    if (existing.rows[0]) {
      const error = new Error("An account already exists for this email");
      error.status = 409;
      throw error;
    }
    await client.query(
      `UPDATE registration_invitations
       SET revoked_at = now()
       WHERE lower(email) = $1 AND used_at IS NULL AND revoked_at IS NULL`,
      [normalizedEmail]
    );
    const result = await client.query(
      `INSERT INTO registration_invitations (id, email, token_hash, created_by, expires_at)
       VALUES ($1, $2, $3, $4, now() + ($5::int * interval '1 hour'))
       RETURNING *`,
      [createId("invite"), normalizedEmail, tokenHash, createdBy, lifetimeHours]
    );
    return { invitation: toInvitation(result.rows[0]), token };
  });
}

export async function inspectRegistrationInvitation(token) {
  const tokenValue = String(token || "").trim();
  if (!tokenValue) throw invitationError();

  if (useJsonDb()) {
    const db = await readJsonDb();
    const invitation = (db.registrationInvitations || []).find((item) => item.tokenHash === hashToken(tokenValue));
    assertUsableInvitation(invitation);
    return { email: invitation.email, expiresAt: invitation.expiresAt };
  }

  const result = await query(
    "SELECT * FROM registration_invitations WHERE token_hash = $1 LIMIT 1",
    [hashToken(tokenValue)]
  );
  const invitation = toInvitation(result.rows[0]);
  assertUsableInvitation(invitation);
  return { email: invitation.email, expiresAt: invitation.expiresAt };
}

export async function registerInvitedUser(data = {}) {
  const token = String(data.inviteToken || "").trim();
  if (!token) throw invitationError();
  const name = String(data.name || "").trim();
  if (!name) {
    const error = new Error("Full name is required");
    error.status = 400;
    throw error;
  }
  const passwordHash = hashPassword(data.password);
  const tokenHash = hashToken(token);

  if (useJsonDb()) {
    return updateJsonDb((db) => {
      db.registrationInvitations ||= [];
      const invitation = db.registrationInvitations.find((item) => item.tokenHash === tokenHash);
      assertUsableInvitation(invitation);
      if (db.users.some((user) => user.email === invitation.email)) {
        const error = new Error("An account already exists for this email");
        error.status = 409;
        throw error;
      }
      const now = new Date().toISOString();
      const user = {
        id: createId("user"),
        name,
        email: invitation.email,
        passwordHash,
        role: roleForEmail(invitation.email),
        status: "active",
        walletBalance: 0,
        collaboration: {},
        createdAt: now,
        updatedAt: now
      };
      db.users.push(user);
      invitation.usedAt = now;
      invitation.usedBy = user.id;
      return publicJsonUser(user);
    });
  }

  return withTransaction(async (client) => {
    const invitationResult = await client.query(
      "SELECT * FROM registration_invitations WHERE token_hash = $1 FOR UPDATE",
      [tokenHash]
    );
    const invitation = toInvitation(invitationResult.rows[0]);
    assertUsableInvitation(invitation);
    const existing = await client.query("SELECT 1 FROM users WHERE lower(email) = $1 LIMIT 1", [invitation.email]);
    if (existing.rows[0]) {
      const error = new Error("An account already exists for this email");
      error.status = 409;
      throw error;
    }
    const userResult = await client.query(
      `INSERT INTO users (id, name, email, password_hash, role, status, wallet_balance, collaboration)
       VALUES ($1, $2, $3, $4, $5, 'active', 0, '{}'::jsonb)
       RETURNING *`,
      [createId("user"), name, invitation.email, passwordHash, roleForEmail(invitation.email)]
    );
    const user = toUser(userResult.rows[0]);
    await client.query(
      "UPDATE registration_invitations SET used_at = now(), used_by = $2 WHERE id = $1",
      [invitation.id, user.id]
    );
    return user;
  });
}

export async function listRegistrationInvitations() {
  if (useJsonDb()) {
    const db = await readJsonDb();
    return (db.registrationInvitations || [])
      .map(publicInvitation)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  const result = await query("SELECT * FROM registration_invitations ORDER BY created_at DESC");
  return result.rows.map(toInvitation);
}

export async function revokeRegistrationInvitation(invitationId) {
  if (!invitationId) throw invitationError();
  if (useJsonDb()) {
    return updateJsonDb((db) => {
      const invitation = (db.registrationInvitations || []).find((item) => item.id === invitationId);
      if (!invitation) return null;
      if (!invitation.usedAt && !invitation.revokedAt) invitation.revokedAt = new Date().toISOString();
      return publicInvitation(invitation);
    });
  }
  const result = await query(
    `UPDATE registration_invitations
     SET revoked_at = COALESCE(revoked_at, CASE WHEN used_at IS NULL THEN now() ELSE NULL END)
     WHERE id = $1
     RETURNING *`,
    [invitationId]
  );
  return toInvitation(result.rows[0]);
}

export async function authenticateUser(email, password) {
  if (!email || !password) throw new Error("Email and password are required");
  if (useJsonDb()) {
    const db = await readJsonDb();
    let user = db.users.find((item) => item.email === email.toLowerCase());
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new Error("Invalid email or password");
    }
    if (user.status !== "active") {
      throw new Error("Account is not active");
    }
    const promotedRole = roleForEmail(user.email, user.role);
    if (promotedRole !== user.role) {
      user = await updateJsonDb((nextDb) => {
        const target = nextDb.users.find((item) => item.id === user.id);
        target.role = promotedRole;
        target.updatedAt = new Date().toISOString();
        return target;
      });
    }
    return publicJsonUser(user);
  }

  const result = await query("SELECT * FROM users WHERE email = $1 LIMIT 1", [email.toLowerCase()]);
  let row = result.rows[0];
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw new Error("Invalid email or password");
  }
  if (row.status !== "active") {
    throw new Error("Account is not active");
  }
  const promotedRole = roleForEmail(row.email, row.role);
  if (promotedRole !== row.role) {
    const promoted = await query("UPDATE users SET role = $2, updated_at = now() WHERE id = $1 RETURNING *", [row.id, promotedRole]);
    row = promoted.rows[0];
  }
  return toUser(row);
}

export async function createSession(userId) {
  const token = randomBytes(32).toString("hex");
  if (useJsonDb()) {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const session = {
      id: createId("session"),
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      createdAt: new Date().toISOString()
    };
    await updateJsonDb((db) => {
      db.sessions.push(session);
      return session;
    });
    return { token, sessionId: session.id, expiresAt };
  }

  const result = await query(
    `INSERT INTO user_sessions (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + interval '30 days')
     RETURNING *`,
    [createId("session"), userId, hashToken(token)]
  );
  return { token, sessionId: result.rows[0].id, expiresAt: result.rows[0].expires_at };
}

export async function getAuthSessionByToken(token) {
  if (!token) return null;
  if (useJsonDb()) {
    const db = await readJsonDb();
    const tokenHash = hashToken(token);
    const session = db.sessions.find((item) => item.tokenHash === tokenHash && new Date(item.expiresAt) > new Date());
    let user = session ? db.users.find((item) => item.id === session.userId && item.status === "active") : null;
    if (!user) return null;
    const promotedRole = roleForEmail(user?.email, user?.role);
    if (user && promotedRole !== user.role) {
      user = await updateJsonDb((nextDb) => {
        const target = nextDb.users.find((item) => item.id === user.id);
        target.role = promotedRole;
        target.updatedAt = new Date().toISOString();
        return target;
      });
    }
    return {
      user: publicJsonUser(user),
      session: {
        id: session.id,
        userId: session.userId,
        expiresAt: session.expiresAt
      }
    };
  }

  const result = await query(
    `SELECT users.*, user_sessions.id AS auth_session_id,
            user_sessions.expires_at AS auth_session_expires_at
     FROM user_sessions
     JOIN users ON users.id = user_sessions.user_id
     WHERE user_sessions.token_hash = $1
       AND user_sessions.expires_at > now()
       AND users.status = 'active'
    LIMIT 1`,
    [hashToken(token)]
  );
  let row = result.rows[0];
  if (!row) return null;
  const authSession = {
    id: row.auth_session_id,
    userId: row.id,
    expiresAt: row.auth_session_expires_at
  };
  const promotedRole = roleForEmail(row?.email, row?.role);
  if (row && promotedRole !== row.role) {
    const promoted = await query("UPDATE users SET role = $2, updated_at = now() WHERE id = $1 RETURNING *", [row.id, promotedRole]);
    row = promoted.rows[0];
  }
  return { user: toUser(row), session: authSession };
}

export async function getUserBySessionToken(token) {
  const auth = await getAuthSessionByToken(token);
  return auth?.user || null;
}

function previewSessionError() {
  const error = new Error("Preview session is invalid or expired");
  error.status = 401;
  return error;
}

export async function createPackagePreviewTicket({ userId, userSessionId, packageId, packageVersion }) {
  const ticket = randomBytes(32).toString("base64url");
  const now = Date.now();
  const ticketExpiresAt = new Date(now + 90 * 1000).toISOString();
  const expiresAt = new Date(now + 15 * 60 * 1000).toISOString();
  const record = {
    id: createId("pkgpreview"),
    userId,
    userSessionId,
    packageId,
    packageVersion,
    exchangeTokenHash: hashToken(ticket),
    previewTokenHash: null,
    ticketExpiresAt,
    claimedAt: null,
    expiresAt,
    createdAt: new Date(now).toISOString()
  };

  if (useJsonDb()) {
    await updateJsonDb((db) => {
      db.packagePreviewSessions = (db.packagePreviewSessions || []).filter((item) => new Date(item.expiresAt).getTime() > now);
      db.packagePreviewSessions.push(record);
      return record;
    });
    return { ticket, expiresAt, ticketExpiresAt };
  }

  await query(
    `INSERT INTO package_preview_sessions
      (id, user_id, user_session_id, package_id, package_version, exchange_token_hash, ticket_expires_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [record.id, userId, userSessionId, packageId, packageVersion, record.exchangeTokenHash, ticketExpiresAt, expiresAt]
  );
  return { ticket, expiresAt, ticketExpiresAt };
}

export async function claimPackagePreviewTicket(ticket) {
  if (!ticket) throw previewSessionError();
  const exchangeTokenHash = hashToken(ticket);
  const previewToken = randomBytes(32).toString("base64url");
  const previewTokenHash = hashToken(previewToken);

  if (useJsonDb()) {
    const access = await updateJsonDb((db) => {
      const now = Date.now();
      const target = (db.packagePreviewSessions || []).find((item) => item.exchangeTokenHash === exchangeTokenHash);
      if (!target || target.claimedAt || new Date(target.ticketExpiresAt).getTime() <= now || new Date(target.expiresAt).getTime() <= now) {
        throw previewSessionError();
      }
      const parentSession = db.sessions.find((item) => item.id === target.userSessionId && new Date(item.expiresAt).getTime() > now);
      const user = parentSession && db.users.find((item) => item.id === target.userId && item.status === "active");
      if (!user) throw previewSessionError();
      target.previewTokenHash = previewTokenHash;
      target.claimedAt = new Date(now).toISOString();
      return {
        userId: target.userId,
        packageId: target.packageId,
        packageVersion: target.packageVersion,
        expiresAt: target.expiresAt
      };
    });
    return { ...access, token: previewToken };
  }

  return withTransaction(async (client) => {
    const found = await client.query(
      `SELECT preview.*, users.status AS user_status,
              user_sessions.expires_at AS user_session_expires_at
       FROM package_preview_sessions preview
       JOIN user_sessions ON user_sessions.id = preview.user_session_id
       JOIN users ON users.id = preview.user_id
       WHERE preview.exchange_token_hash = $1
       FOR UPDATE OF preview`,
      [exchangeTokenHash]
    );
    const row = found.rows[0];
    const now = Date.now();
    if (!row || row.claimed_at || row.user_status !== "active"
      || new Date(row.ticket_expires_at).getTime() <= now
      || new Date(row.expires_at).getTime() <= now
      || new Date(row.user_session_expires_at).getTime() <= now) {
      throw previewSessionError();
    }
    await client.query(
      `UPDATE package_preview_sessions
       SET preview_token_hash = $2, claimed_at = now()
       WHERE id = $1`,
      [row.id, previewTokenHash]
    );
    return {
      token: previewToken,
      userId: row.user_id,
      packageId: row.package_id,
      packageVersion: row.package_version,
      expiresAt: row.expires_at
    };
  });
}

export async function getPackagePreviewAccess(token) {
  if (!token) return null;
  const previewTokenHash = hashToken(token);
  if (useJsonDb()) {
    const db = await readJsonDb();
    const now = Date.now();
    const access = (db.packagePreviewSessions || []).find((item) => item.previewTokenHash === previewTokenHash
      && item.claimedAt && new Date(item.expiresAt).getTime() > now);
    if (!access) return null;
    const parentSession = db.sessions.find((item) => item.id === access.userSessionId && new Date(item.expiresAt).getTime() > now);
    const user = parentSession && db.users.find((item) => item.id === access.userId && item.status === "active");
    if (!user) return null;
    return {
      userId: access.userId,
      packageId: access.packageId,
      packageVersion: access.packageVersion,
      expiresAt: access.expiresAt
    };
  }

  const result = await query(
    `SELECT preview.user_id, preview.package_id, preview.package_version, preview.expires_at
     FROM package_preview_sessions preview
     JOIN user_sessions ON user_sessions.id = preview.user_session_id
     JOIN users ON users.id = preview.user_id
     WHERE preview.preview_token_hash = $1
       AND preview.claimed_at IS NOT NULL
       AND preview.expires_at > now()
       AND user_sessions.expires_at > now()
       AND users.status = 'active'
     LIMIT 1`,
    [previewTokenHash]
  );
  const row = result.rows[0];
  return row ? {
    userId: row.user_id,
    packageId: row.package_id,
    packageVersion: row.package_version,
    expiresAt: row.expires_at
  } : null;
}


export async function revokeSessionToken(token) {
  if (!token) return false;
  const tokenHash = hashToken(token);
  if (useJsonDb()) {
    return updateJsonDb((db) => {
      const before = db.sessions.length;
      db.sessions = db.sessions.filter((session) => session.tokenHash !== tokenHash);
      return db.sessions.length !== before;
    });
  }

  const result = await query("DELETE FROM user_sessions WHERE token_hash = $1", [tokenHash]);
  return result.rowCount > 0;
}

export async function findUserByEmail(email) {
  if (!email) return null;
  if (useJsonDb()) {
    const db = await readJsonDb();
    let user = db.users.find((item) => item.email === email.toLowerCase());
    const promotedRole = roleForEmail(user?.email, user?.role);
    if (user && promotedRole !== user.role) {
      user = await updateJsonDb((nextDb) => {
        const target = nextDb.users.find((item) => item.id === user.id);
        target.role = promotedRole;
        target.updatedAt = new Date().toISOString();
        return target;
      });
    }
    return publicJsonUser(user);
  }

  const result = await query("SELECT * FROM users WHERE email = $1 LIMIT 1", [email.toLowerCase()]);
  let row = result.rows[0];
  const promotedRole = roleForEmail(row?.email, row?.role);
  if (row && promotedRole !== row.role) {
    const promoted = await query("UPDATE users SET role = $2, updated_at = now() WHERE id = $1 RETURNING *", [row.id, promotedRole]);
    row = promoted.rows[0];
  }
  return toUser(row);
}

export async function listPackages() {
  if (useJsonDb()) {
    const db = await readJsonDb();
    return [...db.packages].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  const result = await query("SELECT * FROM page_packages ORDER BY created_at DESC");
  return result.rows.map(toPackage);
}

export async function findPackage(id) {
  if (useJsonDb()) {
    const db = await readJsonDb();
    return db.packages.find((item) => item.id === id || item.slug === id) || null;
  }

  const result = await query("SELECT * FROM page_packages WHERE id = $1 OR slug = $1 LIMIT 1", [id]);
  return toPackage(result.rows[0]);
}

export async function createPackage(data) {
  if (useJsonDb()) {
    return updateJsonDb((db) => {
      if (db.packages.some((item) => item.slug === data.slug)) {
        throw new Error("Package slug already exists");
      }
      const pagePackage = {
        id: createId("pkg"),
        slug: data.slug,
        name: data.name,
        version: data.version || "v0.1",
        status: data.status || "draft",
        sourceType: data.sourceType || "upload",
        repoUrl: data.repoUrl || null,
        billingPeriods: data.billingPeriods || { daily: 25, weekly: 50, biweekly: 100, monthly: 150 },
        screens: data.screens || [],
        assets: data.assets || [],
        cssFiles: data.cssFiles || [],
        designTokens: data.designTokens || {},
        packageManifest: data.packageManifest || {},
        publishedAt: data.status === "published" ? new Date().toISOString() : null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      db.packages.push(pagePackage);
      return pagePackage;
    });
  }

  const result = await query(
    `INSERT INTO page_packages
      (id, slug, name, version, status, source_type, repo_url, billing_periods, screens, assets, css_files, design_tokens, package_manifest)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb)
     RETURNING *`,
    [
      createId("pkg"),
      data.slug,
      data.name,
      data.version || "v0.1",
      data.status || "draft",
      data.sourceType || "upload",
      data.repoUrl || null,
      JSON.stringify(data.billingPeriods || { daily: 25, weekly: 50, biweekly: 100, monthly: 150 }),
      JSON.stringify(data.screens || []),
      JSON.stringify(data.assets || []),
      JSON.stringify(data.cssFiles || []),
      JSON.stringify(data.designTokens || {}),
      JSON.stringify(data.packageManifest || {})
    ]
  );
  return toPackage(result.rows[0]);
}

export async function updatePackage(id, data) {
  const current = await findPackage(id);
  if (!current) return null;
  const next = { ...current, ...data };
  if (useJsonDb()) {
    return updateJsonDb((db) => {
      const index = db.packages.findIndex((item) => item.id === current.id);
      if (index === -1) return null;
      if (db.packages.some((item) => item.id !== current.id && item.slug === next.slug)) throw new Error("Package slug already exists");
      db.packages[index] = {
        ...next,
        updatedAt: new Date().toISOString(),
        publishedAt: next.status === "published" ? next.publishedAt || new Date().toISOString() : next.publishedAt || null
      };
      return db.packages[index];
    });
  }

  const result = await query(
    `UPDATE page_packages
     SET slug = $2, name = $3, version = $4, status = $5, source_type = $6, repo_url = $7,
         billing_periods = $8::jsonb, screens = $9::jsonb, assets = $10::jsonb,
         css_files = $11::jsonb, design_tokens = $12::jsonb, package_manifest = $13::jsonb,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      current.id,
      next.slug,
      next.name,
      next.version,
      next.status,
      next.sourceType,
      next.repoUrl || null,
      JSON.stringify(next.billingPeriods || {}),
      JSON.stringify(next.screens || []),
      JSON.stringify(next.assets || []),
      JSON.stringify(next.cssFiles || []),
      JSON.stringify(next.designTokens || {}),
      JSON.stringify(next.packageManifest || {})
    ]
  );
  return toPackage(result.rows[0]);
}

export async function createGitHubChangeEvent(data = {}) {
  const deliveryId = String(data.deliveryId || "").trim().slice(0, 180);
  const packageId = String(data.packageId || "").trim();
  if (!deliveryId || !packageId) throw new Error("GitHub delivery and package are required");
  const now = new Date().toISOString();
  const event = {
    id: createId("ghchange"),
    packageId,
    deliveryId,
    repository: String(data.repository || "").trim().slice(0, 220),
    branch: String(data.branch || "").trim().slice(0, 255),
    beforeSha: String(data.beforeSha || "").trim().slice(0, 80),
    afterSha: String(data.afterSha || "").trim().slice(0, 80),
    compareUrl: String(data.compareUrl || "").trim().slice(0, 500),
    author: String(data.author || "GitHub").trim().slice(0, 180),
    eventType: String(data.eventType || "push").trim().slice(0, 80),
    status: "received",
    changedFiles: cleanGitHubChangedFiles(data.changedFiles),
    summary: data.summary && typeof data.summary === "object" ? data.summary : {},
    error: "",
    processedAt: null,
    resolvedAt: null,
    createdAt: now
  };
  if (useJsonDb()) {
    return updateJsonDb((db) => {
      db.githubChangeEvents ||= [];
      const existing = db.githubChangeEvents.find((item) => item.packageId === packageId && item.deliveryId === deliveryId);
      if (existing) return { event: existing, created: false };
      db.githubChangeEvents.push(event);
      return { event, created: true };
    });
  }
  const inserted = await query(
    `INSERT INTO github_change_events
      (id, package_id, delivery_id, repository, branch, before_sha, after_sha, compare_url, author, event_type, status, changed_files, summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'received', $11::jsonb, $12::jsonb)
     ON CONFLICT (package_id, delivery_id) DO NOTHING
     RETURNING *`,
    [event.id, event.packageId, event.deliveryId, event.repository, event.branch, event.beforeSha, event.afterSha, event.compareUrl, event.author, event.eventType, JSON.stringify(event.changedFiles), JSON.stringify(event.summary)]
  );
  if (inserted.rows[0]) return { event: toGitHubChangeEvent(inserted.rows[0]), created: true };
  const existing = await query("SELECT * FROM github_change_events WHERE package_id = $1 AND delivery_id = $2 LIMIT 1", [packageId, deliveryId]);
  return { event: toGitHubChangeEvent(existing.rows[0]), created: false };
}

export async function updateGitHubChangeEvent(id, data = {}) {
  const allowedStatuses = new Set(["received", "processing", "live", "healthy", "action_required", "unhealthy", "error", "applied", "dismissed"]);
  const status = data.status && allowedStatuses.has(String(data.status)) ? String(data.status) : null;
  const hasSummary = data.summary && typeof data.summary === "object";
  const hasError = Object.hasOwn(data, "error");
  const error = hasError ? String(data.error || "").slice(0, 1000) : null;
  if (useJsonDb()) {
    return updateJsonDb((db) => {
      const event = (db.githubChangeEvents || []).find((item) => item.id === id);
      if (!event) return null;
      if (status) event.status = status;
      if (hasSummary) event.summary = data.summary;
      if (hasError) event.error = error;
      if (data.processedAt) event.processedAt = data.processedAt;
      if (data.resolvedAt) event.resolvedAt = data.resolvedAt;
      return event;
    });
  }
  const result = await query(
    `UPDATE github_change_events
     SET status = COALESCE($2, status),
         summary = CASE WHEN $3::boolean THEN $4::jsonb ELSE summary END,
         error = CASE WHEN $5::boolean THEN $6 ELSE error END,
         processed_at = COALESCE($7::timestamptz, processed_at),
         resolved_at = COALESCE($8::timestamptz, resolved_at)
     WHERE id = $1
     RETURNING *`,
    [id, status, hasSummary, JSON.stringify(hasSummary ? data.summary : {}), hasError, error, data.processedAt || null, data.resolvedAt || null]
  );
  return toGitHubChangeEvent(result.rows[0]);
}

export async function listGitHubChangeEvents(packageId, limit = 30) {
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
  if (useJsonDb()) {
    const db = await readJsonDb();
    return (db.githubChangeEvents || [])
      .filter((event) => event.packageId === packageId)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .slice(0, safeLimit);
  }
  const result = await query(
    "SELECT * FROM github_change_events WHERE package_id = $1 ORDER BY created_at DESC LIMIT $2",
    [packageId, safeLimit]
  );
  return result.rows.map(toGitHubChangeEvent);
}

export async function countUnresolvedGitHubChangeEvents(packageId) {
  const unresolved = new Set(["received", "processing", "action_required", "unhealthy", "error"]);
  if (useJsonDb()) {
    const db = await readJsonDb();
    return (db.githubChangeEvents || []).filter((event) => event.packageId === packageId && unresolved.has(event.status)).length;
  }
  const result = await query(
    "SELECT count(*)::int AS count FROM github_change_events WHERE package_id = $1 AND status = ANY($2::text[])",
    [packageId, [...unresolved]]
  );
  return Number(result.rows[0]?.count || 0);
}

export async function resolveGitHubChangeEvent(packageId, eventId, resolution = "dismissed") {
  const nextStatus = resolution === "applied" ? "applied" : "dismissed";
  const resolvedAt = new Date().toISOString();
  if (useJsonDb()) {
    return updateJsonDb((db) => {
      const event = (db.githubChangeEvents || []).find((item) => item.id === eventId && item.packageId === packageId);
      if (!event) return null;
      event.status = nextStatus;
      event.resolvedAt = resolvedAt;
      return event;
    });
  }
  const result = await query(
    "UPDATE github_change_events SET status = $3, resolved_at = now() WHERE id = $1 AND package_id = $2 RETURNING *",
    [eventId, packageId, nextStatus]
  );
  return toGitHubChangeEvent(result.rows[0]);
}

export async function resolveGitHubChangeEventsForPackage(packageId, resolution = "applied") {
  const nextStatus = resolution === "dismissed" ? "dismissed" : "applied";
  const unresolved = new Set(["received", "processing", "live", "healthy", "action_required", "unhealthy", "error"]);
  if (useJsonDb()) {
    return updateJsonDb((db) => {
      let updated = 0;
      for (const event of db.githubChangeEvents || []) {
        if (event.packageId === packageId && unresolved.has(event.status)) {
          event.status = nextStatus;
          event.resolvedAt = new Date().toISOString();
          updated += 1;
        }
      }
      return updated;
    });
  }
  const result = await query(
    `UPDATE github_change_events
     SET status = $2, resolved_at = now()
     WHERE package_id = $1 AND status = ANY($3::text[])`,
    [packageId, nextStatus, [...unresolved]]
  );
  return result.rowCount;
}

export async function notifyActiveAdmins({ eventType, title, message, metadata = {} } = {}) {
  const cleanEventType = String(eventType || "admin.notice").slice(0, 100);
  const cleanTitle = String(title || "Admin notification").slice(0, 220);
  const cleanMessage = String(message || "An admin event needs attention.").slice(0, 500);
  const createdAt = new Date().toISOString();
  if (useJsonDb()) {
    return updateJsonDb((db) => {
      db.notificationOutbox ||= [];
      const admins = db.users.filter((user) => user.role === "admin" && user.status === "active");
      for (const admin of admins) {
        db.notificationOutbox.push({
          id: createId("notice"),
          userId: admin.id,
          userPageId: null,
          resultId: null,
          eventType: cleanEventType,
          title: cleanTitle,
          message: cleanMessage,
          metadata,
          readAt: null,
          createdAt
        });
      }
      return admins.length;
    });
  }
  const admins = await query("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
  for (const admin of admins.rows) {
    await query(
      `INSERT INTO notification_outbox
        (id, user_id, user_page_id, result_id, event_type, title, message, metadata)
       VALUES ($1, $2, NULL, NULL, $3, $4, $5, $6::jsonb)`,
      [createId("notice"), admin.id, cleanEventType, cleanTitle, cleanMessage, JSON.stringify(metadata)]
    );
  }
  return admins.rowCount;
}

export async function packageSubscriberCount(id) {
  const current = await findPackage(id);
  if (!current) return 0;
  if (useJsonDb()) {
    const db = await readJsonDb();
    return db.userPages.filter((page) => page.packageId === current.id).length;
  }
  const result = await query("SELECT count(*)::int AS count FROM user_pages WHERE package_id = $1", [current.id]);
  return Number(result.rows[0]?.count || 0);
}

export async function deletePackage(id) {
  const current = await findPackage(id);
  if (!current) return null;
  if (useJsonDb()) {
    return updateJsonDb((db) => {
      if (db.userPages.some((page) => page.packageId === current.id)) throw new Error("Package still has subscriber pages");
      const index = db.packages.findIndex((item) => item.id === current.id);
      if (index === -1) return null;
      const removed = db.packages.splice(index, 1)[0];
      db.githubChangeEvents = (db.githubChangeEvents || []).filter((event) => event.packageId !== current.id);
      return removed;
    });
  }
  const result = await query("DELETE FROM page_packages WHERE id = $1 RETURNING *", [current.id]);
  return toPackage(result.rows[0]);
}

export async function publishPackage(id) {
  if (useJsonDb()) {
    return updateJsonDb((db) => {
      const pagePackage = db.packages.find((item) => item.id === id || item.slug === id);
      if (!pagePackage) return null;
      pagePackage.status = "published";
      pagePackage.publishedAt = new Date().toISOString();
      pagePackage.updatedAt = new Date().toISOString();
      return pagePackage;
    });
  }

  const result = await query(
    "UPDATE page_packages SET status = 'published', published_at = now(), updated_at = now() WHERE id = $1 OR slug = $1 RETURNING *",
    [id]
  );
  return toPackage(result.rows[0]);
}

export async function subscribeToPackage(id, data = {}) {
  const pagePackage = await findPackage(id);
  if (!pagePackage || pagePackage.status !== "published") return { error: "Published package not found", status: 404 };
  if (!data.userId) return { error: "Authentication required", status: 401 };
  const period = data.billingPeriod || "weekly";
  if (!["daily", "weekly", "biweekly", "monthly"].includes(period)) return { error: "Unsupported billing period", status: 400 };
  const price = Number(pagePackage.billingPeriods?.[period] ?? pagePackage.billingPeriods?.weekly ?? 50);
  const duplicateSubscription = (userPage) => {
    if (!userPage) return null;
    const state = pageSubscriptionState(userPage);
    return {
      error: "Already subscribed to this page",
      status: 409,
      userPage,
      subscriptionState: state,
      action: state.blocked ? "renew" : "open"
    };
  };

  if (useJsonDb()) {
    return updateJsonDb((db) => {
      const user = db.users.find((item) => item.id === data.userId);
      const existingPage = db.userPages
        .filter((page) => page.userId === data.userId && page.packageId === pagePackage.id)
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];
      const duplicate = duplicateSubscription(existingPage);
      if (duplicate) return duplicate;
      const jsonRole = roleForEmail(user?.email, user?.role || data.userRole || "subscriber");
      const jsonIsAdminSubscription = String(jsonRole || "").toLowerCase() === "admin";
      const jsonChargePrice = jsonIsAdminSubscription ? 0 : price;
      if (!user || (!jsonIsAdminSubscription && Number(user.walletBalance || 0) < price)) {
        return { error: "Insufficient wallet balance", status: 402, walletBalance: Number(user?.walletBalance || 0), price };
      }
      user.walletBalance = Number(user.walletBalance || 0) - jsonChargePrice;
      user.updatedAt = new Date().toISOString();
      const userPage = buildUserPage(user.id, pagePackage, period, jsonChargePrice, { ...data, adminFreeSubscription: jsonIsAdminSubscription });
      db.userPages.push(userPage);
      db.walletTransactions.push(buildTransaction(
        user.id,
        jsonIsAdminSubscription ? "admin_subscription" : "subscription",
        -jsonChargePrice,
        jsonIsAdminSubscription ? `${pagePackage.name} ${period} admin subscription` : `${pagePackage.name} ${period} subscription`
      ));
      return { userPage, walletBalance: user.walletBalance, adminFreeSubscription: jsonIsAdminSubscription };
    });
  }

  return withTransaction(async (client) => {
    const userResult = await client.query("SELECT * FROM users WHERE id = $1 FOR UPDATE", [data.userId]);
    const user = userResult.rows[0];
    const existingResult = await client.query(
      "SELECT * FROM user_pages WHERE user_id = $1 AND package_id = $2 ORDER BY created_at DESC LIMIT 1",
      [data.userId, pagePackage.id]
    );
    const duplicate = duplicateSubscription(toUserPage(existingResult.rows[0]));
    if (duplicate) return duplicate;
    const dbRole = roleForEmail(user?.email, user?.role || data.userRole || "subscriber");
    const dbIsAdminSubscription = String(dbRole || "").toLowerCase() === "admin";
    const dbChargePrice = dbIsAdminSubscription ? 0 : price;
    if (!user || (!dbIsAdminSubscription && Number(user.wallet_balance) < price)) {
      return { error: "Insufficient wallet balance", status: 402, walletBalance: Number(user?.wallet_balance || 0), price };
    }

    const userPage = buildUserPage(user.id, pagePackage, period, dbChargePrice, { ...data, adminFreeSubscription: dbIsAdminSubscription });
    await client.query("UPDATE users SET wallet_balance = wallet_balance - $1, updated_at = now() WHERE id = $2", [dbChargePrice, user.id]);
    const pageResult = await client.query(
      `INSERT INTO user_pages
        (id, user_id, package_id, package_version, name, slug, domain, status, subscription, flow, configs, security_config, hosting_config, result_settings, generated_file, ui_preferences)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb)
       RETURNING *`,
      [
        userPage.id,
        userPage.userId,
        userPage.packageId,
        userPage.packageVersion,
        userPage.name,
        userPage.slug,
        userPage.domain,
        JSON.stringify(userPage.subscription),
        JSON.stringify(userPage.flow),
        JSON.stringify(userPage.configs),
        JSON.stringify(userPage.securityConfig),
        JSON.stringify(userPage.hostingConfig),
        JSON.stringify(userPage.resultSettings),
        JSON.stringify(userPage.generatedFile),
        JSON.stringify(userPage.uiPreferences)
      ]
    );
    await client.query(
      `INSERT INTO wallet_transactions (id, user_id, type, amount, description)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        createId("txn"),
        user.id,
        dbIsAdminSubscription ? "admin_subscription" : "subscription",
        -dbChargePrice,
        dbIsAdminSubscription ? `${pagePackage.name} ${period} admin subscription` : `${pagePackage.name} ${period} subscription`
      ]
    );
    return { userPage: toUserPage(pageResult.rows[0]), walletBalance: Number(user.wallet_balance) - dbChargePrice, adminFreeSubscription: dbIsAdminSubscription };
  });
}

function buildUserPage(userId, pagePackage, period, price, data) {
  const runtimePackageSnapshot = createRuntimePackageSnapshot(pagePackage);
  return {
    id: createId("user_page"),
    userId,
    packageId: pagePackage.id,
    packageVersion: pagePackage.version,
    name: pagePackage.name,
    slug: pagePackage.slug,
    domain: data.domain || "",
    status: "active",
    subscription: {
      billingPeriod: period,
      renewalPrice: price,
      renewalDate: data.renewalDate || (data.adminFreeSubscription ? null : nextRenewalDate(period)),
      autoRenew: !data.adminFreeSubscription,
      walletSource: data.adminFreeSubscription ? "admin-free" : "main-wallet",
      adminFreeSubscription: Boolean(data.adminFreeSubscription)
    },
    flow: runtimePackageSnapshot.packageManifest.screens,
    configs: {
      runtimePackageSnapshot,
      runtimeScreensSyncedAt: new Date().toISOString(),
      runtimeScreensPackageVersion: pagePackage.version || ""
    },
    securityConfig: {
      domains: data.domain ? [data.domain] : [],
      captcha: false,
      contentDeterrence: false,
      turnstile: { provider: "turnstile", siteKey: "", secretKey: "" },
      bannedIps: [],
      whitelistIps: [],
      blockedDevices: [],
      vpnProxyRules: {
        blockVpnProxies: false,
        blockTor: false,
        blockHostingProviders: false,
        reputationFailureMode: "challenge"
      }
    },
    hostingConfig: {
      domain: data.domain || "",
      serverIp: data.serverIp || "",
      hostingType: data.hostingType || "render-static-site",
      installPath: data.installPath || "root / public directory",
      verified: false,
      verifiedAt: null,
      liveStatus: "Setup required"
    },
    resultSettings: { webhook: "/api/page-results", retentionDays: 30, notifyOnResult: true, telegramNotifyOnResult: false },
    generatedFile: {
      version: "build-001",
      downloadName: "index.html",
      apiBase: process.env.API_BASE_URL || "http://localhost:10000",
      lastGeneratedAt: null
    },
    uiPreferences: { hiddenInMyPages: false, hiddenAt: null }
  };
}

function buildTransaction(userId, type, amount, description, metadata = {}) {
  return { id: createId("txn"), userId, type, amount, description, metadata, createdAt: new Date().toISOString() };
}

const billingPeriodDays = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 30
};

function isoDateOnly(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10);
}

function nextRenewalDate(period = "weekly", fromDate = null) {
  const today = new Date(`${isoDateOnly()}T00:00:00Z`);
  const current = fromDate ? new Date(`${fromDate}T00:00:00Z`) : null;
  const base = current && !Number.isNaN(current.getTime()) && current > today ? current : today;
  const next = new Date(base);
  next.setUTCDate(next.getUTCDate() + (billingPeriodDays[period] || billingPeriodDays.weekly));
  return isoDateOnly(next);
}

export async function listUserPages(userId) {
  if (!userId) throw new Error("Authentication required");
  if (useJsonDb()) {
    const db = await readJsonDb();
    const userPages = db.userPages.filter((page) => page.userId === userId);
    const refreshed = [];
    for (const page of userPages) {
      refreshed.push(await resolveUserPageSubscription(page.id, userId));
    }
    return refreshed.filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  const result = await query("SELECT * FROM user_pages WHERE user_id = $1 ORDER BY created_at DESC", [userId]);
  const refreshed = await Promise.all(result.rows.map((row) => resolveUserPageSubscription(row.id, userId)));
  return refreshed.filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function findUserPage(id, userId = null) {
  if (useJsonDb()) {
    const db = await readJsonDb();
    return db.userPages.find((page) => (page.id === id || page.slug === id) && (!userId || page.userId === userId)) || null;
  }

  const result = userId
    ? await query("SELECT * FROM user_pages WHERE (id = $1 OR slug = $1) AND user_id = $2 LIMIT 1", [id, userId])
    : await query("SELECT * FROM user_pages WHERE id = $1 OR slug = $1 LIMIT 1", [id]);
  return toUserPage(result.rows[0]);
}

function uniqueStringList(list = []) {
  return Array.isArray(list)
    ? [...new Set(list.map((item) => String(item || "").trim()).filter(Boolean))]
    : [];
}

function normalizeSecurityConfig(securityConfig = {}) {
  const whitelistIps = uniqueStringList(securityConfig.whitelistIps);
  const whitelistSet = new Set(whitelistIps);
  const vpnProxyRules = securityConfig.vpnProxyRules || {};
  const validDevices = new Set(["mobile", "desktop", "tablet", "bot", "other"]);
  const blockedDevices = uniqueStringList(securityConfig.blockedDevices)
    .map((device) => device.toLowerCase())
    .filter((device) => validDevices.has(device));
  return {
    ...securityConfig,
    bannedIps: uniqueStringList(securityConfig.bannedIps).filter((ip) => !whitelistSet.has(ip)),
    whitelistIps,
    blockedDevices,
    vpnProxyRules: {
      blockVpnProxies: Boolean(vpnProxyRules.blockVpnProxies),
      blockTor: Boolean(vpnProxyRules.blockTor),
      blockHostingProviders: Boolean(vpnProxyRules.blockHostingProviders),
      reputationFailureMode: ["allow", "challenge", "block"].includes(String(vpnProxyRules.reputationFailureMode || "challenge").toLowerCase())
        ? String(vpnProxyRules.reputationFailureMode || "challenge").toLowerCase()
        : "challenge"
    }
  };
}

function toNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    userPageId: row.user_page_id,
    resultId: row.result_id,
    eventType: row.event_type,
    title: row.title,
    message: row.message,
    metadata: row.metadata || {},
    readAt: row.read_at || null,
    createdAt: row.created_at
  };
}

function normalizeResultSettings(resultSettings = {}) {
  const retentionDays = Number(resultSettings.retentionDays);
  return {
    ...resultSettings,
    retentionDays: Number.isFinite(retentionDays)
      ? Math.min(Math.max(Math.trunc(retentionDays), 1), 3650)
      : 30,
    notifyOnResult: resultSettings.notifyOnResult !== false,
    telegramNotifyOnResult: resultSettings.telegramNotifyOnResult === true
  };
}

function normalizedUserPageUiPreferences(current = {}, input = {}) {
  const hiddenInMyPages = Boolean(input.hiddenInMyPages);
  return {
    ...current,
    hiddenInMyPages,
    hiddenAt: hiddenInMyPages
      ? current.hiddenInMyPages && current.hiddenAt ? current.hiddenAt : new Date().toISOString()
      : null
  };
}

export async function updateUserPageUiPreferences(id, uiPreferences = {}, userId = null) {
  const current = await findUserPage(id, userId);
  if (!current) return null;
  const nextUiPreferences = normalizedUserPageUiPreferences(current.uiPreferences || {}, uiPreferences);

  if (useJsonDb()) {
    return updateJsonDb((db) => {
      const index = db.userPages.findIndex((page) => page.id === current.id && (!userId || page.userId === userId));
      if (index === -1) return null;
      db.userPages[index] = {
        ...db.userPages[index],
        uiPreferences: nextUiPreferences,
        updatedAt: new Date().toISOString()
      };
      return db.userPages[index];
    });
  }

  const result = await query(
    `UPDATE user_pages
     SET ui_preferences = $2::jsonb, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [current.id, JSON.stringify(nextUiPreferences)]
  );
  return toUserPage(result.rows[0]);
}

export async function updateUserPageConfig(id, data, userId = null, options = {}) {
  const current = await findUserPage(id, userId);
  if (!current) return null;
  const incomingSecurity = data.securityConfig || {};
  const incomingTurnstile = incomingSecurity.turnstile || {};
  const mergedTurnstile = {
    ...(current.securityConfig?.turnstile || {}),
    ...incomingTurnstile
  };
  if (!String(incomingTurnstile.secretKey || "").trim()) {
    mergedTurnstile.secretKey = current.securityConfig?.turnstile?.secretKey || "";
  }
  const incomingConfigs = { ...(data.configs || {}) };
  if (!options.allowRuntimeSnapshot) {
    for (const key of ["runtimePackageSnapshot", "runtimeScreensSyncedAt", "runtimeScreensPackageVersion"]) {
      delete incomingConfigs[key];
    }
  }
  const next = {
    ...current,
    status: data.status ?? current.status,
    domain: data.domain ?? current.domain,
    subscription: { ...current.subscription, ...(data.subscription || {}) },
    flow: data.flow || current.flow,
    configs: { ...current.configs, ...incomingConfigs },
    securityConfig: normalizeSecurityConfig({
      ...current.securityConfig,
      ...incomingSecurity,
      turnstile: mergedTurnstile,
      turnstileSecretKey: String(incomingSecurity.turnstileSecretKey || "").trim()
        || current.securityConfig?.turnstileSecretKey
        || ""
    }),
    hostingConfig: { ...current.hostingConfig, ...(data.hostingConfig || {}) },
    resultSettings: normalizeResultSettings({ ...current.resultSettings, ...(data.resultSettings || {}) }),
    generatedFile: { ...current.generatedFile, ...(data.generatedFile || {}) }
  };

  if (useJsonDb()) {
    return updateJsonDb((db) => {
      const index = db.userPages.findIndex((page) => page.id === current.id);
      if (index === -1) return null;
      db.userPages[index] = { ...next, updatedAt: new Date().toISOString() };
      return db.userPages[index];
    });
  }

  const result = await query(
    `UPDATE user_pages
     SET status = $2, domain = $3, subscription = $4::jsonb, flow = $5::jsonb, configs = $6::jsonb,
         security_config = $7::jsonb, hosting_config = $8::jsonb, result_settings = $9::jsonb, generated_file = $10::jsonb,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      current.id,
      next.status,
      next.domain,
      JSON.stringify(next.subscription),
      JSON.stringify(next.flow),
      JSON.stringify(next.configs),
      JSON.stringify(next.securityConfig),
      JSON.stringify(next.hostingConfig || {}),
      JSON.stringify(next.resultSettings),
      JSON.stringify(next.generatedFile)
    ]
  );
  return toUserPage(result.rows[0]);
}

export async function syncUserPageRuntimeScreens(id, userId = null) {
  const userPage = await findUserPage(id, userId);
  if (!userPage) return null;
  const pagePackage = await findPackage(userPage.packageId || userPage.slug);
  if (!pagePackage) throw new Error("Package record not found");
  const runtimePackageSnapshot = createRuntimePackageSnapshot(pagePackage);
  const screens = runtimePackageSnapshot.packageManifest.screens || [];
  if (!screens.length) throw new Error("Package has no mapped HTML screens");
  return updateUserPageConfig(userPage.id, {
    flow: screens,
    configs: {
      runtimePackageSnapshot,
      runtimeScreensSyncedAt: new Date().toISOString(),
      runtimeScreensPackageVersion: pagePackage.version || ""
    }
  }, userId, { allowRuntimeSnapshot: true });
}

export function pageSubscriptionState(page) {
  const subscription = page?.subscription || {};
  if (subscription.adminFreeSubscription) {
    return { status: "active", label: "Admin free", daysLeft: null, blocked: false };
  }

  const renewalDate = subscription.renewalDate || "";
  if (!renewalDate) {
    return { status: "active", label: "Active", daysLeft: null, blocked: false };
  }

  const today = new Date(`${isoDateOnly()}T00:00:00Z`);
  const renewal = new Date(`${renewalDate}T00:00:00Z`);
  if (Number.isNaN(renewal.getTime())) {
    return { status: "active", label: "Active", daysLeft: null, blocked: false };
  }

  const daysLeft = Math.ceil((renewal.getTime() - today.getTime()) / 86400000);
  if (page?.status === "payment_failed" || subscription.renewalStatus === "payment_failed") {
    return { status: "payment_failed", label: "Payment failed", daysLeft, blocked: true };
  }
  if (page?.status === "expired" || subscription.renewalStatus === "expired" || daysLeft < 0) {
    return { status: "expired", label: "Expired", daysLeft, blocked: true };
  }
  if (daysLeft <= 3) {
    return { status: "due_soon", label: "Due soon", daysLeft, blocked: false };
  }
  return { status: "active", label: subscription.autoRenew ? "Auto renew" : "Active", daysLeft, blocked: false };
}

export function userPageCapabilities(page) {
  const subscriptionState = pageSubscriptionState(page);
  const operational = !subscriptionState.blocked;

  return {
    viewResults: true,
    manageResults: true,
    viewTraffic: true,
    viewLogs: true,
    fundWallet: true,
    renew: !page?.subscription?.adminFreeSubscription,
    rotateRelaySecret: true,
    goLive: operational,
    editConfig: operational,
    editSecurity: operational,
    generateIndex: operational,
    verifyHosting: operational,
    installWorker: operational,
    syncScreens: operational,
    controlSessions: operational
  };
}

export async function resolveUserPageSubscription(id, userId = null) {
  const current = await findUserPage(id, userId);
  if (!current) return null;
  const state = pageSubscriptionState(current);
  const subscription = current.subscription || {};

  if (!state.blocked && state.status !== "expired") return current;
  if (subscription.adminFreeSubscription) return current;

  if (subscription.autoRenew) {
    const renewal = await renewUserPage(current.id, current.userId);
    if (!renewal?.error) return renewal.userPage;
    if (renewal.status !== 402) return current;
    return updateUserPageConfig(current.id, {
      status: "payment_failed",
      subscription: {
        ...subscription,
        renewalStatus: "payment_failed",
        paymentFailedAt: new Date().toISOString(),
        lastRenewalError: renewal.error
      }
    }, userId);
  }

  return updateUserPageConfig(current.id, {
    status: "expired",
    subscription: {
      ...subscription,
      renewalStatus: "expired",
      expiredAt: subscription.expiredAt || new Date().toISOString()
    }
  }, userId);
}

export async function renewUserPage(id, userId) {
  if (!userId) return { error: "Authentication required", status: 401 };
  const current = await findUserPage(id, userId);
  if (!current) return { error: "User page not found", status: 404 };

  const period = current.subscription?.billingPeriod || "weekly";
  const price = Number(current.subscription?.renewalPrice || 0);
  const renewalDate = nextRenewalDate(period, current.subscription?.renewalDate);
  const renewedAt = new Date().toISOString();

  if (current.subscription?.adminFreeSubscription || price <= 0) {
    const userPage = await updateUserPageConfig(current.id, {
      subscription: {
        ...(current.subscription || {}),
        renewalDate: current.subscription?.adminFreeSubscription ? null : renewalDate,
        lastRenewedAt: renewedAt,
        renewalStatus: "active",
        autoRenew: false
      }
    }, userId);
    return { userPage, walletBalance: null, adminFreeSubscription: Boolean(current.subscription?.adminFreeSubscription) };
  }

  if (useJsonDb()) {
    return updateJsonDb((db) => {
      const user = db.users.find((item) => item.id === userId);
      const index = db.userPages.findIndex((page) => (page.id === current.id || page.slug === id) && page.userId === userId);
      if (!user || index === -1) return { error: "User page not found", status: 404 };
      if (Number(user.walletBalance || 0) < price) {
        return { error: "Insufficient wallet balance", status: 402, walletBalance: Number(user.walletBalance || 0), price };
      }

      user.walletBalance = Number(user.walletBalance || 0) - price;
      user.updatedAt = renewedAt;
      db.userPages[index] = {
        ...db.userPages[index],
        status: "active",
        subscription: {
          ...(db.userPages[index].subscription || {}),
          billingPeriod: period,
          renewalPrice: price,
          renewalDate,
          lastRenewedAt: renewedAt,
          renewalStatus: "active",
          walletSource: "main-wallet"
        },
        updatedAt: renewedAt
      };
      const transaction = buildTransaction(
        user.id,
        "subscription_renewal",
        -price,
        `${db.userPages[index].name} ${period} renewal`,
        { userPageId: db.userPages[index].id, billingPeriod: period, renewalDate }
      );
      db.walletTransactions.push(transaction);
      return { userPage: db.userPages[index], walletBalance: user.walletBalance, transaction };
    });
  }

  return withTransaction(async (client) => {
    const pageResult = await client.query(
      "SELECT * FROM user_pages WHERE (id = $1 OR slug = $1) AND user_id = $2 FOR UPDATE",
      [id, userId]
    );
    const row = pageResult.rows[0];
    if (!row) return { error: "User page not found", status: 404 };

    const userResult = await client.query("SELECT * FROM users WHERE id = $1 FOR UPDATE", [userId]);
    const user = userResult.rows[0];
    if (!user) return { error: "User not found", status: 404 };
    if (Number(user.wallet_balance || 0) < price) {
      return { error: "Insufficient wallet balance", status: 402, walletBalance: Number(user.wallet_balance || 0), price };
    }

    const nextSubscription = {
      ...(row.subscription || {}),
      billingPeriod: period,
      renewalPrice: price,
      renewalDate,
      lastRenewedAt: renewedAt,
      renewalStatus: "active",
      walletSource: "main-wallet"
    };
    const nextBalance = Number(user.wallet_balance || 0) - price;
    await client.query("UPDATE users SET wallet_balance = wallet_balance - $1, updated_at = now() WHERE id = $2", [price, userId]);
    const updatedPage = await client.query(
      `UPDATE user_pages
       SET status = 'active', subscription = $2::jsonb, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [row.id, JSON.stringify(nextSubscription)]
    );
    const txnResult = await client.query(
      `INSERT INTO wallet_transactions (id, user_id, type, amount, description, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING *`,
      [
        createId("txn"),
        userId,
        "subscription_renewal",
        -price,
        `${row.name} ${period} renewal`,
        JSON.stringify({ userPageId: row.id, billingPeriod: period, renewalDate })
      ]
    );
    return { userPage: toUserPage(updatedPage.rows[0]), walletBalance: nextBalance, transaction: toTransaction(txnResult.rows[0]) };
  });
}

export async function updateSecurityConfig(id, securityConfig, userId = null) {
  const current = await findUserPage(id, userId);
  if (!current) return null;
  return updateUserPageConfig(current.id, { securityConfig: { ...current.securityConfig, ...securityConfig } }, userId);
}

export async function updateIpRule(id, ip, mode, userId = null) {
  const current = await findUserPage(id, userId);
  if (!current) return null;
  const cleanIp = String(ip || "").trim();
  if (!cleanIp) throw new Error("IP address is required");
  const bannedIps = new Set(current.securityConfig?.bannedIps || []);
  const whitelistIps = new Set(current.securityConfig?.whitelistIps || []);
  if (mode === "ban") {
    bannedIps.add(cleanIp);
    whitelistIps.delete(cleanIp);
  } else if (mode === "whitelist") {
    whitelistIps.add(cleanIp);
    bannedIps.delete(cleanIp);
  } else if (mode === "remove") {
    bannedIps.delete(cleanIp);
    whitelistIps.delete(cleanIp);
  } else {
    throw new Error("Invalid IP rule action");
  }
  return updateSecurityConfig(current.id, { bannedIps: [...bannedIps].filter(Boolean), whitelistIps: [...whitelistIps].filter(Boolean) }, userId);
}

export async function markGenerated(id, version, userId = null) {
  const current = await findUserPage(id, userId);
  if (!current) return null;
  return updateUserPageConfig(current.id, {
    generatedFile: {
      ...current.generatedFile,
      version: version || current.generatedFile?.version || "build-001",
      lastGeneratedAt: new Date().toISOString()
    }
  }, userId);
}

export async function getWallet(userId) {
  if (!userId) throw new Error("Authentication required");
  if (useJsonDb()) {
    const db = await readJsonDb();
    const user = publicJsonUser(db.users.find((item) => item.id === userId));
    if (!user) throw new Error("User not found");
    return {
      balance: user.walletBalance,
      currency: "USD",
      transactions: db.walletTransactions.filter((txn) => txn.userId === user.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    };
  }

  const userResult = await query("SELECT * FROM users WHERE id = $1 LIMIT 1", [userId]);
  const user = toUser(userResult.rows[0]);
  if (!user) throw new Error("User not found");
  const txns = await query("SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC", [user.id]);
  return { balance: user.walletBalance, currency: "USD", transactions: txns.rows.map(toTransaction) };
}

function userSpendSummary(transactions = []) {
  return transactions.reduce((summary, transaction) => {
    const amount = Number(transaction.amount || 0);
    const type = String(transaction.type || "");
    if (amount < 0) {
      summary.totalSpent += Math.abs(amount);
      if (type.includes("subscription")) summary.subscriptionSpend += Math.abs(amount);
      if (type.includes("admin")) summary.adminDebits += Math.abs(amount);
    } else if (amount > 0) {
      summary.totalFunded += amount;
      if (type.includes("deposit")) summary.cryptoFunded += amount;
      if (type.includes("admin")) summary.adminCredits += amount;
    }
    return summary;
  }, {
    totalSpent: 0,
    subscriptionSpend: 0,
    totalFunded: 0,
    cryptoFunded: 0,
    adminCredits: 0,
    adminDebits: 0
  });
}

function withAdminUserMetrics(user, pages = [], transactions = []) {
  const cleanTransactions = transactions.map((transaction) => ({
    ...transaction,
    amount: Number(transaction.amount || 0)
  }));
  return {
    ...user,
    collaboration: user.collaboration || {},
    pages,
    spend: userSpendSummary(cleanTransactions),
    recentTransactions: cleanTransactions
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 4)
  };
}

export async function listAdminUsers() {
  if (useJsonDb()) {
    const db = await readJsonDb();
    return db.users
      .map((user) => withAdminUserMetrics(
        publicJsonUser(user),
        db.userPages.filter((page) => page.userId === user.id),
        (db.walletTransactions || []).filter((transaction) => transaction.userId === user.id)
      ))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  const [usersResult, pagesResult, transactionsResult] = await Promise.all([
    query("SELECT * FROM users ORDER BY created_at DESC"),
    query("SELECT * FROM user_pages ORDER BY created_at DESC"),
    query("SELECT * FROM wallet_transactions ORDER BY created_at DESC")
  ]);
  const pagesByUser = new Map();
  pagesResult.rows.map(toUserPage).forEach((page) => {
    pagesByUser.set(page.userId, [...(pagesByUser.get(page.userId) || []), page]);
  });
  const transactionsByUser = new Map();
  transactionsResult.rows.map(toTransaction).forEach((transaction) => {
    transactionsByUser.set(transaction.userId, [...(transactionsByUser.get(transaction.userId) || []), transaction]);
  });
  return usersResult.rows.map(toUser).map((user) => withAdminUserMetrics(
    user,
    pagesByUser.get(user.id) || [],
    transactionsByUser.get(user.id) || []
  ));
}

export async function updateAdminUser(userId, data = {}, actorUserId = "") {
  const allowedRoles = new Set(["subscriber", "support", "admin"]);
  const allowedStatuses = new Set(["active", "review", "suspended"]);
  const role = data.role ? String(data.role).toLowerCase() : null;
  const status = data.status ? String(data.status).toLowerCase() : null;
  const collaboration = data.collaboration && typeof data.collaboration === "object" ? {
    enabled: Boolean(data.collaboration.enabled),
    pageEditor: Boolean(data.collaboration.pageEditor),
    supportAccess: Boolean(data.collaboration.supportAccess),
    walletReview: Boolean(data.collaboration.walletReview),
    note: String(data.collaboration.note || "").trim()
  } : null;
  if (role && !allowedRoles.has(role)) throw new Error("Unsupported user role");
  if (status && !allowedStatuses.has(status)) throw new Error("Unsupported user status");
  if (actorUserId && actorUserId === userId && ((role && role !== "admin") || (status && status !== "active"))) {
    throw new Error("Administrators cannot demote or suspend their own active account");
  }

  if (useJsonDb()) {
    return updateJsonDb((db) => {
      const user = db.users.find((item) => item.id === userId);
      if (!user) return { error: "User not found", status: 404 };
      const removesActiveAdmin = user.role === "admin" && user.status === "active" && ((role && role !== "admin") || (status && status !== "active"));
      if (removesActiveAdmin && db.users.filter((item) => item.role === "admin" && item.status === "active").length <= 1) {
        throw new Error("The final active administrator cannot be removed or suspended");
      }
      if (role) user.role = role;
      if (status) user.status = status;
      if (collaboration) user.collaboration = { ...(user.collaboration || {}), ...collaboration };
      user.updatedAt = new Date().toISOString();
      return { user: publicJsonUser(user), pages: db.userPages.filter((page) => page.userId === user.id) };
    });
  }

  const current = await query("SELECT * FROM users WHERE id = $1 LIMIT 1", [userId]);
  if (!current.rows[0]) return { error: "User not found", status: 404 };
  const currentUser = current.rows[0];
  const removesActiveAdmin = currentUser.role === "admin" && currentUser.status === "active" && ((role && role !== "admin") || (status && status !== "active"));
  if (removesActiveAdmin) {
    const activeAdmins = await query("SELECT count(*)::int AS count FROM users WHERE role = 'admin' AND status = 'active'");
    if (Number(activeAdmins.rows[0]?.count || 0) <= 1) throw new Error("The final active administrator cannot be removed or suspended");
  }
  const result = await query(
    `UPDATE users
     SET role = COALESCE($2, role),
         status = COALESCE($3, status),
         collaboration = CASE WHEN $4::jsonb IS NULL THEN collaboration ELSE collaboration || $4::jsonb END,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [userId, role, status, collaboration ? JSON.stringify(collaboration) : null]
  );
  const pages = await query("SELECT * FROM user_pages WHERE user_id = $1 ORDER BY created_at DESC", [userId]);
  return { user: toUser(result.rows[0]), pages: pages.rows.map(toUserPage) };
}

export async function extendUserPageSubscription(pageId, { days = 7, adminFreeSubscription = null, autoRenew = null, status = "active" } = {}) {
  const current = await findUserPage(pageId);
  if (!current) return { error: "User page not found", status: 404 };
  const extensionDays = Math.max(1, Math.min(Number(days || 0), 365));
  const today = new Date(`${isoDateOnly()}T00:00:00Z`);
  const currentRenewal = current.subscription?.renewalDate ? new Date(`${current.subscription.renewalDate}T00:00:00Z`) : null;
  const base = currentRenewal && !Number.isNaN(currentRenewal.getTime()) && currentRenewal > today ? currentRenewal : today;
  const next = new Date(base);
  next.setUTCDate(next.getUTCDate() + extensionDays);
  const updated = await updateUserPageConfig(current.id, {
    status,
    subscription: {
      ...(current.subscription || {}),
      renewalDate: isoDateOnly(next),
      renewalStatus: "active",
      lastAdminExtendedAt: new Date().toISOString(),
      lastAdminExtensionDays: extensionDays,
      ...(adminFreeSubscription === null ? {} : {
        adminFreeSubscription: Boolean(adminFreeSubscription),
        walletSource: adminFreeSubscription ? "admin-free" : current.subscription?.walletSource || "main-wallet"
      }),
      ...(autoRenew === null ? {} : { autoRenew: Boolean(autoRenew) })
    }
  });
  return { userPage: updated };
}

export async function adjustWallet({ userId, amount, type = "deposit", description = "Wallet update" }) {
  const value = Number(amount || 0);
  if (!Number.isFinite(value) || value === 0) throw new Error("Wallet adjustment amount is required");

  if (useJsonDb()) {
    return updateJsonDb((db) => {
      const user = db.users.find((item) => item.id === userId);
      if (!user) return { error: "User not found", status: 404 };
      if (Number(user.walletBalance || 0) + value < 0) return { error: "Wallet adjustment would create a negative balance", status: 409 };
      user.walletBalance = Number(user.walletBalance || 0) + value;
      user.updatedAt = new Date().toISOString();
      const transaction = buildTransaction(user.id, type, value, description);
      db.walletTransactions.push(transaction);
      return { balance: user.walletBalance, transaction };
    });
  }

  return withTransaction(async (client) => {
    const userResult = await client.query("UPDATE users SET wallet_balance = wallet_balance + $1, updated_at = now() WHERE id = $2 AND wallet_balance + $1 >= 0 RETURNING *", [value, userId]);
    const user = userResult.rows[0];
    if (!user) {
      const exists = await client.query("SELECT 1 FROM users WHERE id = $1", [userId]);
      return exists.rows[0] ? { error: "Wallet adjustment would create a negative balance", status: 409 } : { error: "User not found", status: 404 };
    }
    const txnResult = await client.query(
      `INSERT INTO wallet_transactions (id, user_id, type, amount, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [createId("txn"), user.id, type, value, description]
    );
    return { balance: Number(user.wallet_balance), transaction: toTransaction(txnResult.rows[0]) };
  });
}

function buildDepositRequest(userId, amount, cryptoType, network, txHash, quote = {}) {
  const now = new Date().toISOString();
  return {
    id: createId("dep"),
    userId,
    amount,
    cryptoType,
    network,
    quote,
    txHash,
    status: "pending",
    adminNote: "",
    reviewedBy: "",
    reviewedAt: null,
    createdAt: now,
    updatedAt: now
  };
}

function validateDepositPayload({ userId, amount, cryptoType, network, txHash, quote = {} }) {
  const value = Number(amount || 0);
  if (!userId) throw new Error("Authentication required");
  if (!Number.isFinite(value) || value < 30) throw new Error("Minimum funding is $30");
  if (!cryptoType) throw new Error("Crypto type is required");
  if (!network) throw new Error("Crypto network is required");
  if (!txHash || String(txHash).trim().length < 8) throw new Error("Transaction hash is required");
  return {
    amount: value,
    cryptoType: String(cryptoType).trim(),
    network: String(network).trim(),
    txHash: String(txHash).trim(),
    quote: quote && typeof quote === "object" ? quote : {}
  };
}

function jsonDepositToApi(request, user = null) {
  return {
    ...request,
    userEmail: user?.email || request.userEmail || "",
    userName: user?.name || request.userName || ""
  };
}

export async function createWalletDepositRequest(data) {
  const clean = validateDepositPayload(data);
  const normalizedTxHash = clean.txHash.toLowerCase();

  if (useJsonDb()) {
    return updateJsonDb((db) => {
      db.walletDepositRequests ||= [];
      const user = db.users.find((item) => item.id === data.userId);
      if (!user) return { error: "User not found", status: 404 };
      const duplicate = db.walletDepositRequests.find((item) => String(item.txHash || "").toLowerCase() === normalizedTxHash);
      if (duplicate) return { error: "Transaction hash already submitted", status: 409 };
      const request = buildDepositRequest(user.id, clean.amount, clean.cryptoType, clean.network, clean.txHash, clean.quote);
      db.walletDepositRequests.push(request);
      return { request: jsonDepositToApi(request, user) };
    });
  }

  try {
    const result = await query(
      `INSERT INTO wallet_deposit_requests (id, user_id, amount, crypto_type, network, tx_hash, quote)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [createId("dep"), data.userId, clean.amount, clean.cryptoType, clean.network, clean.txHash, JSON.stringify(clean.quote)]
    );
    return { request: toDepositRequest(result.rows[0]) };
  } catch (error) {
    if (error.code === "23505") return { error: "Transaction hash already submitted", status: 409 };
    throw error;
  }
}

export async function listWalletDepositRequests({ userId = null, status = null } = {}) {
  if (useJsonDb()) {
    const db = await readJsonDb();
    const requests = (db.walletDepositRequests || [])
      .filter((request) => (!userId || request.userId === userId) && (!status || request.status === status))
      .map((request) => jsonDepositToApi(request, db.users.find((user) => user.id === request.userId)))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return requests;
  }

  const clauses = [];
  const values = [];
  if (userId) {
    values.push(userId);
    clauses.push(`wdr.user_id = $${values.length}`);
  }
  if (status) {
    values.push(status);
    clauses.push(`wdr.status = $${values.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await query(
    `SELECT wdr.*, users.email AS user_email, users.name AS user_name
     FROM wallet_deposit_requests wdr
     JOIN users ON users.id = wdr.user_id
     ${where}
     ORDER BY wdr.created_at DESC`,
    values
  );
  return result.rows.map(toDepositRequest);
}

export async function approveWalletDepositRequest({ requestId, adminUserId, amount = null, adminNote = "" }) {
  if (!requestId) throw new Error("Deposit request is required");
  const overrideAmount = amount === null || amount === undefined || amount === "" ? null : Number(amount);
  if (overrideAmount !== null && (!Number.isFinite(overrideAmount) || overrideAmount <= 0)) {
    throw new Error("Credit amount must be greater than zero");
  }

  if (useJsonDb()) {
    return updateJsonDb((db) => {
      db.walletDepositRequests ||= [];
      const request = db.walletDepositRequests.find((item) => item.id === requestId);
      if (!request) return { error: "Deposit request not found", status: 404 };
      if (!["pending", "reviewing"].includes(request.status)) return { error: "Deposit request already reviewed", status: 400 };
      const user = db.users.find((item) => item.id === request.userId);
      if (!user) return { error: "User not found", status: 404 };
      const creditAmount = overrideAmount || Number(request.amount || 0);
      user.walletBalance = Number(user.walletBalance || 0) + creditAmount;
      user.updatedAt = new Date().toISOString();
      request.status = "approved";
      request.adminNote = adminNote || "";
      request.reviewedBy = adminUserId;
      request.reviewedAt = new Date().toISOString();
      request.updatedAt = request.reviewedAt;
      const transaction = buildTransaction(
        user.id,
        "crypto_deposit",
        creditAmount,
        `Crypto deposit approved (${request.cryptoType} ${request.network})`,
        { depositRequestId: request.id, txHash: request.txHash, cryptoType: request.cryptoType, network: request.network, quote: request.quote || {} }
      );
      db.walletTransactions.push(transaction);
      return { request: jsonDepositToApi(request, user), balance: user.walletBalance, transaction };
    });
  }

  return withTransaction(async (client) => {
    const requestResult = await client.query("SELECT * FROM wallet_deposit_requests WHERE id = $1 FOR UPDATE", [requestId]);
    const request = requestResult.rows[0];
    if (!request) return { error: "Deposit request not found", status: 404 };
    if (!["pending", "reviewing"].includes(request.status)) return { error: "Deposit request already reviewed", status: 400 };
    const creditAmount = overrideAmount || Number(request.amount || 0);
    const userResult = await client.query(
      "UPDATE users SET wallet_balance = wallet_balance + $1, updated_at = now() WHERE id = $2 RETURNING *",
      [creditAmount, request.user_id]
    );
    const user = userResult.rows[0];
    if (!user) return { error: "User not found", status: 404 };
    const updatedRequestResult = await client.query(
      `UPDATE wallet_deposit_requests
       SET status = 'approved', admin_note = $1, reviewed_by = $2, reviewed_at = now(), updated_at = now()
       WHERE id = $3
       RETURNING *`,
      [adminNote || "", adminUserId, requestId]
    );
    const txnResult = await client.query(
      `INSERT INTO wallet_transactions (id, user_id, type, amount, description, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        createId("txn"),
        request.user_id,
        "crypto_deposit",
        creditAmount,
        `Crypto deposit approved (${request.crypto_type} ${request.network})`,
        { depositRequestId: request.id, txHash: request.tx_hash, cryptoType: request.crypto_type, network: request.network, quote: request.quote || {} }
      ]
    );
    return {
      request: toDepositRequest({ ...updatedRequestResult.rows[0], user_email: user.email, user_name: user.name }),
      balance: Number(user.wallet_balance),
      transaction: toTransaction(txnResult.rows[0])
    };
  });
}

export async function updateWalletDepositRequestStatus({ requestId, adminUserId, status, adminNote = "" }) {
  if (!requestId) throw new Error("Deposit request is required");
  const nextStatus = String(status || "").toLowerCase();
  if (!["reviewing", "rejected"].includes(nextStatus)) throw new Error("Unsupported funding status");

  if (useJsonDb()) {
    return updateJsonDb((db) => {
      db.walletDepositRequests ||= [];
      const request = db.walletDepositRequests.find((item) => item.id === requestId);
      if (!request) return { error: "Deposit request not found", status: 404 };
      if (["approved", "rejected"].includes(request.status)) return { error: "Deposit request already reviewed", status: 400 };
      request.status = nextStatus;
      request.adminNote = adminNote || request.adminNote || "";
      request.reviewedBy = nextStatus === "rejected" ? adminUserId : request.reviewedBy || "";
      request.reviewedAt = nextStatus === "rejected" ? new Date().toISOString() : request.reviewedAt || null;
      request.updatedAt = new Date().toISOString();
      const user = db.users.find((item) => item.id === request.userId);
      return { request: jsonDepositToApi(request, user) };
    });
  }

  const reviewedBySql = nextStatus === "rejected" ? ", reviewed_by = $3, reviewed_at = now()" : "";
  const values = nextStatus === "rejected"
    ? [nextStatus, adminNote || "", adminUserId, requestId]
    : [nextStatus, adminNote || "", requestId];
  const idParam = nextStatus === "rejected" ? "$4" : "$3";
  const result = await query(
    `UPDATE wallet_deposit_requests
     SET status = $1, admin_note = COALESCE(NULLIF($2, ''), admin_note), updated_at = now()${reviewedBySql}
     WHERE id = ${idParam} AND status NOT IN ('approved', 'rejected')
     RETURNING *`,
    values
  );
  if (!result.rows[0]) return { error: "Deposit request not found or already reviewed", status: 404 };
  return { request: toDepositRequest(result.rows[0]) };
}

async function purgeExpiredPendingResultAttachments(userPageId) {
  const now = Date.now();
  if (useJsonDb()) {
    const db = await readJsonDb();
    const expired = (db.resultAttachments || []).filter((item) => (
      item.userPageId === userPageId
      && !item.resultId
      && new Date(item.expiresAt || 0).getTime() <= now
    ));
    await deleteStoredObjects(expired.map((item) => item.objectKey));
    if (expired.length) {
      const expiredIds = new Set(expired.map((item) => item.id));
      await updateJsonDb((nextDb) => {
        nextDb.resultAttachments = (nextDb.resultAttachments || []).filter((item) => !expiredIds.has(item.id));
      });
    }
    return expired.length;
  }
  const expired = await query(
    "SELECT id, object_key FROM result_attachments WHERE user_page_id = $1 AND result_id IS NULL AND expires_at <= now()",
    [userPageId]
  );
  await deleteStoredObjects(expired.rows.map((row) => row.object_key));
  if (expired.rows.length) {
    await query("DELETE FROM result_attachments WHERE id = ANY($1::text[])", [expired.rows.map((row) => row.id)]);
  }
  return expired.rows.length;
}

export async function createResultAttachmentUpload({ userPageId, sessionId, screenFile = "", fieldId, fieldLabel, mimeType, sizeBytes }) {
  const userPage = await findUserPage(userPageId);
  if (!userPage) throw new Error("Runtime page not found");
  if (!objectStorageConfigured()) throw new Error("Private upload storage is unavailable");
  const cleanSessionId = compactAttachmentText(sessionId, 96);
  const cleanFieldId = compactAttachmentText(fieldId, 96);
  const cleanFieldLabel = compactAttachmentText(fieldLabel || "Uploaded image", 160) || "Uploaded image";
  const cleanMimeType = String(mimeType || "").toLowerCase().trim();
  const bytes = Number(sizeBytes || 0);
  const mimeConfig = resultAttachmentMimeTypes.get(cleanMimeType);
  if (!cleanSessionId || !cleanFieldId) throw new Error("Upload session and field are required");
  if (!mimeConfig) throw new Error("Only JPEG, PNG, and WebP ID images are supported");
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > resultAttachmentMaxBytes) {
    throw new Error(`Each ID image must be ${Math.floor(resultAttachmentMaxBytes / (1024 * 1024))} MB or smaller`);
  }
  await purgeExpiredPendingResultAttachments(userPage.id);
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  let recentCount = 0;
  if (useJsonDb()) {
    const db = await readJsonDb();
    recentCount = (db.resultAttachments || []).filter((item) => (
      item.userPageId === userPage.id
      && item.sessionId === cleanSessionId
      && !item.resultId
      && new Date(item.createdAt || 0).getTime() >= oneHourAgo
    )).length;
  } else {
    const count = await query(
      "SELECT count(*)::int AS count FROM result_attachments WHERE user_page_id = $1 AND session_id = $2 AND result_id IS NULL AND created_at >= now() - interval '1 hour'",
      [userPage.id, cleanSessionId]
    );
    recentCount = Number(count.rows[0]?.count || 0);
  }
  if (recentCount >= maxPendingResultAttachmentsPerSession) throw new Error("Too many upload attempts for this session");

  const id = createId("attachment");
  const objectKey = `results/${userPage.id}/${cleanSessionId}/${id}.${mimeConfig.extension}`;
  const expiresAt = new Date(Date.now() + resultAttachmentUploadSeconds * 1000).toISOString();
  const uploadUrl = await signedUploadUrl(objectKey, cleanMimeType, resultAttachmentUploadSeconds);
  const attachment = {
    id,
    userPageId: userPage.id,
    resultId: null,
    sessionId: cleanSessionId,
    screenFile: compactAttachmentText(screenFile, 240),
    fieldId: cleanFieldId,
    fieldLabel: cleanFieldLabel,
    side: attachmentSide(cleanFieldLabel, cleanFieldId),
    objectKey,
    mimeType: cleanMimeType,
    expectedSize: bytes,
    sizeBytes: null,
    status: "pending",
    expiresAt,
    completedAt: null,
    createdAt: new Date().toISOString()
  };
  if (useJsonDb()) {
    await updateJsonDb((db) => {
      db.resultAttachments ||= [];
      db.resultAttachments.push(attachment);
    });
  } else {
    await query(
      `INSERT INTO result_attachments
        (id, user_page_id, session_id, screen_file, field_id, field_label, side, object_key, mime_type, expected_size, status, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11)`,
      [id, userPage.id, cleanSessionId, attachment.screenFile, cleanFieldId, cleanFieldLabel, attachment.side, objectKey, cleanMimeType, bytes, expiresAt]
    );
  }
  return {
    attachment: publicResultAttachment(attachment),
    uploadUrl,
    uploadHeaders: { "Content-Type": cleanMimeType },
    expiresAt
  };
}

export async function completeResultAttachmentUpload({ userPageId, sessionId, attachmentId }) {
  const cleanAttachmentId = String(attachmentId || "").trim();
  const cleanSessionId = compactAttachmentText(sessionId, 96);
  let attachment;
  if (useJsonDb()) {
    const db = await readJsonDb();
    attachment = (db.resultAttachments || []).find((item) => (
      item.id === cleanAttachmentId && item.userPageId === userPageId && item.sessionId === cleanSessionId && !item.resultId
    ));
  } else {
    const result = await query(
      "SELECT * FROM result_attachments WHERE id = $1 AND user_page_id = $2 AND session_id = $3 AND result_id IS NULL LIMIT 1",
      [cleanAttachmentId, userPageId, cleanSessionId]
    );
    attachment = result.rows[0];
  }
  if (!attachment) throw new Error("Upload record not found");
  if (attachment.status === "ready") return publicResultAttachment(attachment);
  if (attachment.status !== "pending") throw new Error("Upload is not available");
  const expiresAt = new Date(attachment.expiresAt || attachment.expires_at || 0).getTime();
  const objectKey = attachment.objectKey || attachment.object_key;
  if (!expiresAt || expiresAt <= Date.now()) {
    await deleteObject(objectKey).catch(() => {});
    throw new Error("Upload link expired. Select the images again");
  }
  const expectedSize = Number(attachment.expectedSize ?? attachment.expected_size ?? 0);
  const expectedMime = attachment.mimeType || attachment.mime_type;
  let stored;
  try {
    stored = await headObject(objectKey);
  } catch {
    throw new Error("Uploaded image was not found");
  }
  const storedSize = Number(stored.ContentLength || 0);
  const storedMime = String(stored.ContentType || "").toLowerCase();
  const mimeConfig = resultAttachmentMimeTypes.get(expectedMime);
  let valid = Boolean(mimeConfig && storedSize === expectedSize && storedSize > 0 && storedSize <= resultAttachmentMaxBytes && storedMime === expectedMime);
  if (valid) {
    const body = await getObjectBuffer(objectKey);
    valid = body.length === storedSize && mimeConfig.signature(body);
  }
  if (!valid) {
    await deleteObject(objectKey).catch(() => {});
    if (useJsonDb()) {
      await updateJsonDb((db) => {
        const item = (db.resultAttachments || []).find((entry) => entry.id === cleanAttachmentId);
        if (item) item.status = "rejected";
      });
    } else {
      await query("UPDATE result_attachments SET status = 'rejected' WHERE id = $1", [cleanAttachmentId]);
    }
    throw new Error("Uploaded image failed validation");
  }
  const completedAt = new Date().toISOString();
  if (useJsonDb()) {
    await updateJsonDb((db) => {
      const item = (db.resultAttachments || []).find((entry) => entry.id === cleanAttachmentId);
      if (item) {
        item.status = "ready";
        item.sizeBytes = storedSize;
        item.completedAt = completedAt;
      }
    });
    attachment = { ...attachment, status: "ready", sizeBytes: storedSize, completedAt };
  } else {
    const updated = await query(
      "UPDATE result_attachments SET status = 'ready', size_bytes = $2, completed_at = now() WHERE id = $1 RETURNING *",
      [cleanAttachmentId, storedSize]
    );
    attachment = updated.rows[0];
  }
  return publicResultAttachment(attachment);
}

export async function getResultAttachmentContent(userPageId, resultId, attachmentId, userId = null) {
  const userPage = await findUserPage(userPageId, userId);
  if (!userPage) return null;
  let attachment;
  if (useJsonDb()) {
    const db = await readJsonDb();
    attachment = (db.resultAttachments || []).find((item) => (
      item.id === attachmentId
      && item.resultId === resultId
      && item.userPageId === userPage.id
      && item.status === "attached"
    ));
  } else {
    const result = await query(
      `SELECT * FROM result_attachments
       WHERE id = $1 AND result_id = $2 AND user_page_id = $3 AND status = 'attached'
       LIMIT 1`,
      [attachmentId, resultId, userPage.id]
    );
    attachment = result.rows[0];
  }
  if (!attachment) return null;
  const objectKey = attachment.objectKey || attachment.object_key;
  return {
    attachment: publicResultAttachment(attachment),
    buffer: await getObjectBuffer(objectKey)
  };
}

export async function listResults(userPageId, userId = null) {
  const userPage = await findUserPage(userPageId, userId);
  if (!userPage) return null;
  await purgeExpiredPageResults(userPage);
  if (useJsonDb()) {
    const db = await readJsonDb();
    return db.pageResults
      .filter((result) => result.userPageId === userPage.id)
      .map(publicResult)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  const result = await query("SELECT * FROM page_results WHERE user_page_id = $1 ORDER BY created_at DESC", [userPage.id]);
  return result.rows.map(toResult);
}

export async function getResultDetail(userPageId, resultId, userId = null) {
  const userPage = await findUserPage(userPageId, userId);
  if (!userPage) return null;
  await purgeExpiredPageResults(userPage);

  if (useJsonDb()) {
    const db = await readJsonDb();
    const result = db.pageResults.find((item) => item.id === resultId && item.userPageId === userPage.id);
    if (!result) return null;
    const sessionResults = db.pageResults
      .filter((item) => item.userPageId === userPage.id && (result.sessionId ? item.sessionId === result.sessionId : item.id === result.id))
      .map((item) => publicResult({
        ...item,
        attachments: (db.resultAttachments || [])
          .filter((attachment) => attachment.resultId === item.id && attachment.status === "attached")
          .map(publicResultAttachment)
      }))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    return {
      result: sessionResults.find((item) => item.id === result.id) || publicResult(result),
      sessionResults
    };
  }

  const selected = await query(
    "SELECT * FROM page_results WHERE id = $1 AND user_page_id = $2 LIMIT 1",
    [resultId, userPage.id]
  );
  if (!selected.rows[0]) return null;

  const sessionResults = selected.rows[0].session_id
    ? await query(
      "SELECT * FROM page_results WHERE user_page_id = $1 AND session_id = $2 ORDER BY created_at ASC",
      [userPage.id, selected.rows[0].session_id]
    )
    : selected;

  const resultIds = sessionResults.rows.map((row) => row.id);
  const attachmentRows = resultIds.length
    ? await query(
      "SELECT * FROM result_attachments WHERE result_id = ANY($1::text[]) AND status = 'attached' ORDER BY created_at ASC",
      [resultIds]
    )
    : { rows: [] };
  const attachmentsByResult = new Map();
  for (const attachment of attachmentRows.rows) {
    if (!attachmentsByResult.has(attachment.result_id)) attachmentsByResult.set(attachment.result_id, []);
    attachmentsByResult.get(attachment.result_id).push(publicResultAttachment(attachment));
  }
  const publicSessionResults = sessionResults.rows.map((row) => toResult({ ...row, attachments: attachmentsByResult.get(row.id) || [] }));

  return {
    result: publicSessionResults.find((item) => item.id === selected.rows[0].id) || toResult(selected.rows[0]),
    sessionResults: publicSessionResults
  };
}

async function deleteResultAttachmentObjects(userPageId, resultIds = []) {
  const cleanIds = [...new Set(resultIds.filter(Boolean))];
  if (!cleanIds.length) return 0;
  if (useJsonDb()) {
    const db = await readJsonDb();
    const keys = jsonAttachmentKeys(db, userPageId, cleanIds);
    await deleteStoredObjects(keys);
    const selected = new Set(cleanIds);
    return updateJsonDb((nextDb) => {
      const before = (nextDb.resultAttachments || []).length;
      nextDb.resultAttachments = (nextDb.resultAttachments || []).filter((item) => (
        item.userPageId !== userPageId || !selected.has(item.resultId)
      ));
      return before - nextDb.resultAttachments.length;
    });
  }
  const attachments = await query(
    "SELECT id, object_key FROM result_attachments WHERE user_page_id = $1 AND result_id = ANY($2::text[])",
    [userPageId, cleanIds]
  );
  await deleteStoredObjects(attachments.rows.map((row) => row.object_key));
  if (attachments.rows.length) {
    await query("DELETE FROM result_attachments WHERE id = ANY($1::text[])", [attachments.rows.map((row) => row.id)]);
  }
  return attachments.rows.length;
}

async function purgeExpiredPageResults(userPage) {
  if (!userPage?.id) return 0;
  const retentionDays = normalizeResultSettings(userPage.resultSettings).retentionDays;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  if (useJsonDb()) {
    const db = await readJsonDb();
    const expiredIds = db.pageResults
      .filter((result) => result.userPageId === userPage.id && new Date(result.createdAt).getTime() < cutoff)
      .map((result) => result.id);
    await deleteResultAttachmentObjects(userPage.id, expiredIds);
    return updateJsonDb((db) => {
      const before = db.pageResults.length;
      db.pageResults = db.pageResults.filter((result) => (
        result.userPageId !== userPage.id
        || new Date(result.createdAt).getTime() >= cutoff
      ));
      return before - db.pageResults.length;
    });
  }

  const expired = await query(
    "SELECT id FROM page_results WHERE user_page_id = $1 AND created_at < now() - ($2::int * interval '1 day')",
    [userPage.id, retentionDays]
  );
  await deleteResultAttachmentObjects(userPage.id, expired.rows.map((row) => row.id));
  const result = await query(
    "DELETE FROM page_results WHERE user_page_id = $1 AND created_at < now() - ($2::int * interval '1 day')",
    [userPage.id, retentionDays]
  );
  return result.rowCount;
}

export async function deleteResult(userPageId, resultId, userId = null) {
  const userPage = await findUserPage(userPageId, userId);
  if (!userPage) return null;
  await deleteResultAttachmentObjects(userPage.id, [resultId]);
  if (useJsonDb()) {
    return updateJsonDb((db) => {
      const before = db.pageResults.length;
      db.pageResults = db.pageResults.filter((result) => result.id !== resultId || result.userPageId !== userPage.id);
      return before - db.pageResults.length;
    });
  }

  const result = await query("DELETE FROM page_results WHERE id = $1 AND user_page_id = $2", [resultId, userPage.id]);
  return result.rowCount;
}

const bulkResultActions = new Set(["review", "flag", "resolve", "ban", "whitelist", "delete"]);

function normalizeBulkResultIds(resultIds = []) {
  if (!Array.isArray(resultIds)) return [];
  return [...new Set(resultIds.map((id) => String(id || "").trim()).filter(Boolean))];
}

function workflowStatusForBulkAction(action) {
  if (action === "review") return "reviewed";
  if (action === "flag") return "flagged";
  if (action === "resolve") return "resolved";
  return "";
}

export async function applyBulkResultAction(userPageId, resultIds, action, userId = null, actorId = "") {
  const userPage = await findUserPage(userPageId, userId);
  if (!userPage) return null;
  const cleanAction = String(action || "").trim().toLowerCase();
  const cleanIds = normalizeBulkResultIds(resultIds);
  if (!bulkResultActions.has(cleanAction)) throw new Error("Unsupported bulk result action");
  if (!cleanIds.length) throw new Error("Select at least one result");
  if (cleanIds.length > 500) throw new Error("Bulk actions support up to 500 results at a time");

  if (cleanAction === "ban" || cleanAction === "whitelist") {
    let ips = [];
    if (useJsonDb()) {
      const db = await readJsonDb();
      const selectedIds = new Set(cleanIds);
      ips = db.pageResults
        .filter((result) => result.userPageId === userPage.id && selectedIds.has(result.id))
        .map((result) => String(result.ip || "").trim())
        .filter(Boolean);
    } else {
      const result = await query(
        "SELECT DISTINCT ip FROM page_results WHERE user_page_id = $1 AND id = ANY($2::text[]) AND NULLIF(ip, '') IS NOT NULL",
        [userPage.id, cleanIds]
      );
      ips = result.rows.map((row) => String(row.ip || "").trim()).filter(Boolean);
    }
    ips = [...new Set(ips)];

    const bannedIps = new Set(userPage.securityConfig?.bannedIps || []);
    const whitelistIps = new Set(userPage.securityConfig?.whitelistIps || []);
    for (const ip of ips) {
      if (cleanAction === "ban") {
        bannedIps.add(ip);
        whitelistIps.delete(ip);
      } else {
        whitelistIps.add(ip);
        bannedIps.delete(ip);
      }
    }
    const updatedPage = await updateSecurityConfig(userPage.id, {
      bannedIps: [...bannedIps].filter(Boolean),
      whitelistIps: [...whitelistIps].filter(Boolean)
    }, userId);
    return { action: cleanAction, affected: ips.length, userPage: updatedPage };
  }

  if (cleanAction === "delete") {
    await deleteResultAttachmentObjects(userPage.id, cleanIds);
    if (useJsonDb()) {
      const affected = await updateJsonDb((db) => {
        const selectedIds = new Set(cleanIds);
        const before = db.pageResults.length;
        db.pageResults = db.pageResults.filter((result) => result.userPageId !== userPage.id || !selectedIds.has(result.id));
        return before - db.pageResults.length;
      });
      return { action: cleanAction, affected };
    }
    const result = await query(
      "DELETE FROM page_results WHERE user_page_id = $1 AND id = ANY($2::text[])",
      [userPage.id, cleanIds]
    );
    return { action: cleanAction, affected: result.rowCount };
  }

  const nextStatus = workflowStatusForBulkAction(cleanAction);
  const reviewedAt = new Date().toISOString();
  if (useJsonDb()) {
    const updatedResults = await updateJsonDb((db) => {
      const selectedIds = new Set(cleanIds);
      return db.pageResults
        .filter((result) => result.userPageId === userPage.id && selectedIds.has(result.id))
        .map((result) => {
          result.status = nextStatus;
          result.reviewedAt = reviewedAt;
          result.reviewedBy = actorId || userId || "";
          return result;
        });
    });
    return { action: cleanAction, affected: updatedResults.length, results: updatedResults.map(publicResult) };
  }
  const result = await query(
    `UPDATE page_results
     SET status = $3, reviewed_at = now(), reviewed_by = $4
     WHERE user_page_id = $1 AND id = ANY($2::text[])
     RETURNING *`,
    [userPage.id, cleanIds, nextStatus, actorId || userId || ""]
  );
  return { action: cleanAction, affected: result.rowCount, results: result.rows.map(toResult) };
}

export async function listTrafficEvents(userPageId, userId = null, limit = 100) {
  const userPage = await findUserPage(userPageId, userId);
  if (!userPage) return null;
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 250);

  if (useJsonDb()) {
    const db = await readJsonDb();
    return db.trafficEvents
      .filter((event) => event.userPageId === userPage.id)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, safeLimit);
  }

  const result = await query(
    "SELECT * FROM traffic_events WHERE user_page_id = $1 ORDER BY created_at DESC LIMIT $2",
    [userPage.id, safeLimit]
  );
  return result.rows.map(toTrafficEvent);
}

export async function getTrafficReport(userPageId, userId = null, limit = 100) {
  const userPage = await findUserPage(userPageId, userId);
  if (!userPage) return null;
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 250);

  if (useJsonDb()) {
    const db = await readJsonDb();
    const allEvents = db.trafficEvents
      .filter((event) => event.userPageId === userPage.id)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return {
      trafficEvents: allEvents.slice(0, safeLimit),
      trafficSummary: summarizeTrafficEvents(allEvents)
    };
  }

  const deviceTypeSql = `CASE
    WHEN metadata->>'deviceType' IN ('mobile', 'desktop', 'tablet', 'bot', 'other')
      THEN metadata->>'deviceType'
    WHEN lower(COALESCE(user_agent, '')) ~ 'bot|crawler|spider|slurp|headless|preview|scanner|curl|wget|python-requests|httpclient'
      THEN 'bot'
    WHEN lower(COALESCE(user_agent, '')) ~ 'ipad|tablet|kindle|silk|playbook'
      THEN 'tablet'
    WHEN lower(COALESCE(user_agent, '')) ~ 'mobi|android|iphone|ipod|phone|blackberry|opera mini|windows phone'
      THEN 'mobile'
    WHEN lower(COALESCE(user_agent, '')) ~ 'windows nt|macintosh|linux x86_64|x11|cros'
      THEN 'desktop'
    ELSE 'other'
  END`;

  const [eventsResult, summaryResult] = await Promise.all([
    query(
      "SELECT * FROM traffic_events WHERE user_page_id = $1 ORDER BY created_at DESC LIMIT $2",
      [userPage.id, safeLimit]
    ),
    query(
      `WITH scoped AS (
         SELECT
           COALESCE(NULLIF(session_id, ''), id) AS visit_key,
           created_at,
           lower(COALESCE(result, '')) = 'blocked' AS is_blocked,
           ${deviceTypeSql} AS device_type
         FROM traffic_events
         WHERE user_page_id = $1
       ),
       visits AS (
         SELECT
           visit_key,
           MIN(created_at) AS first_seen_at,
           BOOL_OR(is_blocked) AS was_blocked,
           (ARRAY_AGG(device_type ORDER BY CASE WHEN device_type = 'other' THEN 1 ELSE 0 END, created_at ASC))[1] AS device_type
         FROM scoped
         GROUP BY visit_key
       ),
       device_counts AS (
         SELECT device_type, COUNT(*)::int AS visit_count
         FROM visits
         GROUP BY device_type
       ),
       timeline_counts AS (
         SELECT
           date_trunc('hour', first_seen_at) AS bucket,
           COUNT(*)::int AS visit_count,
           COUNT(*) FILTER (WHERE was_blocked)::int AS blocked_count
         FROM visits
         WHERE first_seen_at >= now() - interval '24 hours'
         GROUP BY date_trunc('hour', first_seen_at)
       )
       SELECT json_build_object(
         'uniqueVisits', (SELECT COUNT(*)::int FROM visits),
         'cleanVisits', (SELECT COUNT(*) FILTER (WHERE NOT was_blocked)::int FROM visits),
         'blockedVisits', (SELECT COUNT(*) FILTER (WHERE was_blocked)::int FROM visits),
         'blockEvents', (SELECT COUNT(*) FILTER (WHERE is_blocked)::int FROM scoped),
         'totalEvents', (SELECT COUNT(*)::int FROM scoped),
         'devices', COALESCE((SELECT json_object_agg(device_type, visit_count) FROM device_counts), '{}'::json),
         'timeline', COALESCE((
           SELECT json_agg(
             json_build_object('at', bucket, 'visits', visit_count, 'blockedVisits', blocked_count)
             ORDER BY bucket
           )
           FROM timeline_counts
         ), '[]'::json),
         'windowHours', 24
       ) AS summary`,
      [userPage.id]
    )
  ]);

  return {
    trafficEvents: eventsResult.rows.map(toTrafficEvent),
    trafficSummary: summaryResult.rows[0]?.summary || summarizeTrafficEvents([])
  };
}

export async function listActivePageSessions(userPageId, userId = null) {
  const trafficEvents = await listTrafficEvents(userPageId, userId, 250);
  if (!trafficEvents) return null;

  const cutoff = Date.now() - 35 * 1000;
  const sessions = new Map();
  for (const event of trafficEvents) {
    if (!event.sessionId) continue;
    if (event.event !== "heartbeat") continue;
    const eventTime = new Date(event.createdAt).getTime();
    if (!Number.isFinite(eventTime) || eventTime < cutoff) continue;
    const current = sessions.get(event.sessionId);
    if (current && new Date(current.lastSeenAt).getTime() >= eventTime) continue;
    sessions.set(event.sessionId, {
      sessionId: event.sessionId,
      ip: event.ip || "unknown",
      screen: event.screen || event.pageId || "page",
      screenFile: event.metadata?.screenFile || "",
      event: event.event,
      result: event.result,
      reason: event.reason,
      hostname: event.hostname,
      path: event.path,
      userAgent: event.userAgent,
      lastSeenAt: event.createdAt
    });
  }

  return [...sessions.values()].sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
}

export async function setSessionCommand(userPageId, sessionId, command, userId = null) {
  const userPage = await findUserPage(userPageId, userId);
  if (!userPage) return null;
  const cleanSessionId = String(sessionId || "").trim();
  if (!cleanSessionId) throw new Error("Session id is required");

  const currentConfigs = userPage.configs || {};
  const currentCommands = currentConfigs.sessionCommands || {};
  const currentHistory = currentConfigs.sessionCommandHistory || {};
  const nextCommands = { ...currentCommands };
  const nextHistory = { ...currentHistory };
  if (!command || command.action === "clear") {
    delete nextCommands[cleanSessionId];
    delete nextHistory[cleanSessionId];
  } else {
    const createdAt = new Date().toISOString();
    nextCommands[cleanSessionId] = {
      id: createId("cmd"),
      action: command.action || "redirect",
      targetUrl: String(command.targetUrl || "").trim(),
      targetFile: String(command.targetFile || "").trim(),
      targetScreenId: String(command.targetScreenId || "").trim(),
      targetRole: String(command.targetRole || "").trim(),
      note: String(command.note || "").trim(),
      forceReload: Boolean(command.forceReload),
      status: "queued",
      createdAt,
      deliveredAt: null
    };
  }

  return updateUserPageConfig(userPage.id, {
    configs: {
      ...currentConfigs,
      sessionCommands: nextCommands,
      sessionCommandHistory: nextHistory
    }
  }, userId);
}

export async function deliverSessionCommand(userPageId, sessionId) {
  const userPage = await findUserPage(userPageId);
  if (!userPage) return null;
  const cleanSessionId = String(sessionId || "").trim();
  if (!cleanSessionId) return { command: null };

  const currentConfigs = userPage.configs || {};
  const currentCommands = currentConfigs.sessionCommands || {};
  const command = currentCommands[cleanSessionId];
  if (!command || command.action !== "redirect" || !command.targetUrl) return { command: null };

  const delivered = {
    ...command,
    status: "delivered",
    deliveredAt: new Date().toISOString()
  };
  const currentHistory = currentConfigs.sessionCommandHistory || {};
  const nextCommands = { ...currentCommands };
  const nextHistory = {
    ...currentHistory,
    [cleanSessionId]: [delivered, ...(currentHistory[cleanSessionId] || [])].slice(0, 10)
  };
  delete nextCommands[cleanSessionId];

  await updateUserPageConfig(userPage.id, {
    configs: {
      ...currentConfigs,
      sessionCommands: nextCommands,
      sessionCommandHistory: nextHistory
    }
  });

  return { command: delivered };
}

export async function getSessionCommand(userPageId, sessionId) {
  const userPage = await findUserPage(userPageId);
  if (!userPage) return null;
  const command = userPage.configs?.sessionCommands?.[String(sessionId || "").trim()];
  if (!command || command.action !== "redirect" || !command.targetUrl) return { command: null };
  return { command };
}

export async function saveTrafficEvent(data, ip, userAgent) {
  const userPage = await findUserPage(data.userPageId || data.pageId);
  const event = {
    id: createId("traffic"),
    userPageId: userPage?.id || data.userPageId,
    pageId: data.pageId,
    sessionId: data.sessionId,
    event: data.event || "page_load",
    screen: data.screen || null,
    hostname: data.hostname,
    path: data.path,
    ip,
    result: data.result,
    reason: data.reason,
    userAgent: data.userAgent || userAgent,
    metadata: data.metadata || {},
    createdAt: new Date().toISOString()
  };
  if (useJsonDb()) {
    return updateJsonDb((db) => {
      if (event.event === "heartbeat" && event.sessionId) {
        const sameHeartbeat = (item) => (
          item.event === "heartbeat"
          && item.userPageId === event.userPageId
          && item.sessionId === event.sessionId
        );
        const existing = db.trafficEvents.find(sameHeartbeat);
        if (existing) {
          const existingId = existing.id;
          Object.assign(existing, event, { id: existingId });
          db.trafficEvents = db.trafficEvents.filter((item) => item === existing || !sameHeartbeat(item));
          return existing;
        }
      }
      db.trafficEvents.push(event);
      return event;
    });
  }

  if (event.event === "heartbeat" && event.sessionId) {
    const result = await query(
      `INSERT INTO traffic_events
        (id, user_page_id, page_id, session_id, event, screen, hostname, path, ip, result, reason, user_agent, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14)
       ON CONFLICT (user_page_id, session_id)
       WHERE event = 'heartbeat'
         AND session_id IS NOT NULL
         AND session_id <> ''
       DO UPDATE SET
         page_id = EXCLUDED.page_id,
         screen = EXCLUDED.screen,
         hostname = EXCLUDED.hostname,
         path = EXCLUDED.path,
         ip = EXCLUDED.ip,
         result = EXCLUDED.result,
         reason = EXCLUDED.reason,
         user_agent = EXCLUDED.user_agent,
         metadata = EXCLUDED.metadata,
         created_at = EXCLUDED.created_at
       RETURNING *`,
      [event.id, event.userPageId, event.pageId, event.sessionId, event.event, event.screen, event.hostname, event.path, event.ip, event.result, event.reason, event.userAgent, JSON.stringify(event.metadata), event.createdAt]
    );
    return result.rows[0];
  }

  const result = await query(
    `INSERT INTO traffic_events
      (id, user_page_id, page_id, session_id, event, screen, hostname, path, ip, result, reason, user_agent, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
     RETURNING *`,
    [event.id, event.userPageId, event.pageId, event.sessionId, event.event, event.screen, event.hostname, event.path, event.ip, event.result, event.reason, event.userAgent, JSON.stringify(event.metadata)]
  );
  return result.rows[0];
}

function notificationForResult(result, userPage) {
  if (!userPage?.userId) return null;
  const settings = normalizeResultSettings(userPage.resultSettings);
  if (!settings.notifyOnResult && !settings.telegramNotifyOnResult) return null;
  return {
    id: createId("notice"),
    userId: userPage.userId,
    userPageId: userPage.id,
    resultId: result.id,
    eventType: "result.created",
    title: `New result - ${userPage.name || result.pageName || "Page"}`,
    message: `${result.screen || "Page"} submitted a new result.`,
    metadata: {
      userPageId: userPage.id,
      pageSlug: userPage.slug || "",
      screen: result.screen || "",
      sessionId: result.sessionId || "",
      hostname: result.hostname || "",
      ip: result.ip || "unknown",
      inAppNotification: settings.notifyOnResult
    },
    readAt: null,
    createdAt: result.createdAt
  };
}

export async function listNotifications(userId, limit = 40) {
  if (!userId) throw new Error("Authentication required");
  const safeLimit = Math.min(Math.max(Number(limit) || 40, 1), 100);
  if (useJsonDb()) {
    const db = await readJsonDb();
    const all = (db.notificationOutbox || [])
      .filter((notification) => notification.userId === userId && notification.metadata?.inAppNotification !== false)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return { notifications: all.slice(0, safeLimit), unreadCount: all.filter((notification) => !notification.readAt).length };
  }
  const [items, count] = await Promise.all([
    query("SELECT * FROM notification_outbox WHERE user_id = $1 AND metadata->>'inAppNotification' IS DISTINCT FROM 'false' ORDER BY created_at DESC LIMIT $2", [userId, safeLimit]),
    query("SELECT count(*)::int AS count FROM notification_outbox WHERE user_id = $1 AND metadata->>'inAppNotification' IS DISTINCT FROM 'false' AND read_at IS NULL", [userId])
  ]);
  return { notifications: items.rows.map(toNotification), unreadCount: Number(count.rows[0]?.count || 0) };
}

export async function markNotificationRead(userId, notificationId) {
  if (!userId) throw new Error("Authentication required");
  if (useJsonDb()) {
    return updateJsonDb((db) => {
      const notification = (db.notificationOutbox || []).find((item) => item.id === notificationId && item.userId === userId);
      if (!notification) return null;
      notification.readAt ||= new Date().toISOString();
      return notification;
    });
  }
  const result = await query(
    "UPDATE notification_outbox SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2 RETURNING *",
    [notificationId, userId]
  );
  return toNotification(result.rows[0]);
}

export async function markAllNotificationsRead(userId) {
  if (!userId) throw new Error("Authentication required");
  if (useJsonDb()) {
    return updateJsonDb((db) => {
      let updated = 0;
      for (const notification of db.notificationOutbox || []) {
        if (notification.userId === userId && !notification.readAt) {
          notification.readAt = new Date().toISOString();
          updated += 1;
        }
      }
      return updated;
    });
  }
  const result = await query("UPDATE notification_outbox SET read_at = now() WHERE user_id = $1 AND read_at IS NULL", [userId]);
  return result.rowCount;
}

export async function savePageResult(data, ip, userAgent, { fieldManifest = null } = {}) {
  const userPage = await findUserPage(data.userPageId || data.pageId);
  if (userPage) await purgeExpiredPageResults(userPage);
  const requestedAttachmentIds = normalizeAttachmentIds(data.attachmentIds);
  if (Array.isArray(data.attachmentIds) && requestedAttachmentIds.length !== data.attachmentIds.length) {
    throw new Error("Result attachments are invalid");
  }
  let safePayload;
  if (fieldManifest && data.capture) {
    const manifest = trustedResultManifestFromPersistent(fieldManifest, {
      screenFile: data.screen || "",
      screenId: data.userPageId || data.pageId || ""
    });
    const labelById = new Map(manifest.fields.map((f) => [f.id, f.label]));
    safePayload = {};
    for (const f of Array.isArray(data.capture?.fields) ? data.capture.fields : []) {
      if (!f?.id) continue;
      const label = labelById.get(f.id) || f.id;
      safePayload[label] = f.value;
    }
  } else {
    safePayload = { ...(data.data || {}) };
  }
  const result = {
    id: data.id || createId("result"),
    userPageId: userPage?.id || data.userPageId,
    userId: data.userId || userPage?.userId,
    packageId: data.packageId || userPage?.packageId,
    packageVersion: data.packageVersion || userPage?.packageVersion,
    pageId: data.pageId,
    pageName: data.pageName,
    licenseKey: data.licenseKey,
    sessionId: data.sessionId,
    screen: data.screen,
    flow: data.flow || [],
    payload: safePayload,
    hostname: data.hostname,
    path: data.path,
    ip,
    userAgent: data.userAgent || userAgent,
    createdAt: new Date().toISOString()
  };
  const notification = notificationForResult(result, userPage);
  if (useJsonDb()) {
    let attached = [];
    await updateJsonDb((db) => {
      const selected = requestedAttachmentIds.map((id) => (db.resultAttachments || []).find((item) => item.id === id));
      if (selected.some((item) => !item
        || item.userPageId !== result.userPageId
        || item.sessionId !== result.sessionId
        || item.resultId
        || item.status !== "ready")) {
        throw new Error("ID uploads are missing, expired, or already attached");
      }
      attached = selected.map((item) => {
        item.resultId = result.id;
        item.status = "attached";
        result.payload[item.fieldLabel] = { kind: "attachment", attachmentId: item.id, side: item.side };
        return publicResultAttachment(item);
      });
      result.attachments = attached;
      db.pageResults.push(result);
      if (notification && !(db.notificationOutbox || []).some((item) => item.resultId === result.id && item.eventType === notification.eventType)) {
        db.notificationOutbox ||= [];
        db.notificationOutbox.push(notification);
        queueTelegramDeliveryInJson(db, notification, userPage);
      }
      return result;
    });
    return publicResult({ ...result, attachments: attached });
  }

  return withTransaction(async (client) => {
    let attached = [];
    if (requestedAttachmentIds.length) {
      const selected = await client.query(
        "SELECT * FROM result_attachments WHERE id = ANY($1::text[]) FOR UPDATE",
        [requestedAttachmentIds]
      );
      if (selected.rows.length !== requestedAttachmentIds.length || selected.rows.some((item) => (
        item.user_page_id !== result.userPageId
        || item.session_id !== result.sessionId
        || item.result_id
        || item.status !== "ready"
      ))) {
        throw new Error("ID uploads are missing, expired, or already attached");
      }
      attached = requestedAttachmentIds.map((id) => selected.rows.find((item) => item.id === id));
      for (const item of attached) {
        result.payload[item.field_label] = { kind: "attachment", attachmentId: item.id, side: item.side };
      }
    }
    const dbResult = await client.query(
      `INSERT INTO page_results
        (id, user_page_id, user_id, package_id, package_version, page_id, page_name, license_key, session_id, screen, flow, payload, hostname, path, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14, $15, $16)
       RETURNING *`,
      [result.id, result.userPageId, result.userId, result.packageId, result.packageVersion, result.pageId, result.pageName, result.licenseKey, result.sessionId, result.screen, JSON.stringify(result.flow), JSON.stringify(result.payload), result.hostname, result.path, result.ip, result.userAgent]
    );
    if (requestedAttachmentIds.length) {
      await client.query(
        "UPDATE result_attachments SET result_id = $2, status = 'attached' WHERE id = ANY($1::text[])",
        [requestedAttachmentIds, result.id]
      );
    }
    if (notification) {
      await client.query(
        `INSERT INTO notification_outbox
          (id, user_id, user_page_id, result_id, event_type, title, message, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         ON CONFLICT (result_id, event_type) DO NOTHING`,
        [notification.id, notification.userId, notification.userPageId, notification.resultId, notification.eventType, notification.title, notification.message, JSON.stringify(notification.metadata)]
      );
      if (userPage?.resultSettings?.telegramNotifyOnResult === true) {
        await queueTelegramDeliveryWithClient(client, {
          resultId: result.id,
          eventType: notification.eventType,
          userId: notification.userId,
          userPageId: notification.userPageId
        });
      }
    }
    return toResult({
      ...dbResult.rows[0],
      attachments: attached.map((item) => publicResultAttachment({ ...item, result_id: result.id }))
    });
  });
}
