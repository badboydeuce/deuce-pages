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
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      db.users.push(user);
      return publicJsonUser(user);
    });
  }

  const result = await query(
    `INSERT INTO users (id, name, email, password_hash, role, status, wallet_balance)
     VALUES ($1, $2, $3, $4, $5, 'active', 0)
     RETURNING *`,
    [createId("user"), data.name || "New User", email, passwordHash, role]
  );
  return toUser(result.rows[0]);
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

export async function getUserBySessionToken(token) {
  if (!token) return null;
  if (useJsonDb()) {
    const db = await readJsonDb();
    const tokenHash = hashToken(token);
    const session = db.sessions.find((item) => item.tokenHash === tokenHash && new Date(item.expiresAt) > new Date());
    let user = session ? db.users.find((item) => item.id === session.userId && item.status === "active") : null;
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

  const result = await query(
    `SELECT users.*
     FROM user_sessions
     JOIN users ON users.id = user_sessions.user_id
     WHERE user_sessions.token_hash = $1
       AND user_sessions.expires_at > now()
       AND users.status = 'active'
    LIMIT 1`,
    [hashToken(token)]
  );
  let row = result.rows[0];
  const promotedRole = roleForEmail(row?.email, row?.role);
  if (row && promotedRole !== row.role) {
    const promoted = await query("UPDATE users SET role = $2, updated_at = now() WHERE id = $1 RETURNING *", [row.id, promotedRole]);
    row = promoted.rows[0];
  }
  return toUser(row);
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
        billingPeriods: data.billingPeriods || { weekly: 25 },
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
      JSON.stringify(data.billingPeriods || { weekly: 25 }),
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
  if (!pagePackage) return { error: "Package not found", status: 404 };
  if (!data.userId) return { error: "Authentication required", status: 401 };
  const period = data.billingPeriod || "weekly";
  const price = Number(pagePackage.billingPeriods?.[period] || pagePackage.billingPeriods?.weekly || 25);

  if (useJsonDb()) {
    return updateJsonDb((db) => {
      const user = db.users.find((item) => item.id === data.userId);
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
        (id, user_id, package_id, package_version, name, slug, domain, status, subscription, flow, configs, security_config, hosting_config, result_settings, generated_file)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8::jsonb, $9::jsonb, '{}'::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb)
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
        JSON.stringify(userPage.securityConfig),
        JSON.stringify(userPage.hostingConfig),
        JSON.stringify(userPage.resultSettings),
        JSON.stringify(userPage.generatedFile)
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
      renewalDate: data.renewalDate || null,
      autoRenew: !data.adminFreeSubscription,
      walletSource: data.adminFreeSubscription ? "admin-free" : "main-wallet",
      adminFreeSubscription: Boolean(data.adminFreeSubscription)
    },
    flow: pagePackage.screens || [],
    configs: {},
    securityConfig: {
      domains: data.domain ? [data.domain] : [],
      captcha: false,
      turnstile: { provider: "turnstile", siteKey: "", secretKey: "" },
      bannedIps: [],
      whitelistIps: []
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
    resultSettings: { webhook: "/api/page-results", retentionDays: 30, notifyOnResult: true },
    generatedFile: {
      version: "build-001",
      downloadName: `${pagePackage.slug}-index.html`,
      apiBase: process.env.API_BASE_URL || "http://localhost:10000",
      lastGeneratedAt: null
    }
  };
}

function buildTransaction(userId, type, amount, description, metadata = {}) {
  return { id: createId("txn"), userId, type, amount, description, metadata, createdAt: new Date().toISOString() };
}

export async function listUserPages(userId) {
  if (!userId) throw new Error("Authentication required");
  if (useJsonDb()) {
    const db = await readJsonDb();
    return db.userPages.filter((page) => page.userId === userId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  const result = await query("SELECT * FROM user_pages WHERE user_id = $1 ORDER BY created_at DESC", [userId]);
  return result.rows.map(toUserPage);
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

export async function updateUserPageConfig(id, data, userId = null) {
  const current = await findUserPage(id, userId);
  if (!current) return null;
  const next = {
    ...current,
    domain: data.domain ?? current.domain,
    subscription: { ...current.subscription, ...(data.subscription || {}) },
    flow: data.flow || current.flow,
    configs: { ...current.configs, ...(data.configs || {}) },
    securityConfig: { ...current.securityConfig, ...(data.securityConfig || {}) },
    hostingConfig: { ...current.hostingConfig, ...(data.hostingConfig || {}) },
    resultSettings: { ...current.resultSettings, ...(data.resultSettings || {}) },
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
     SET domain = $2, subscription = $3::jsonb, flow = $4::jsonb, configs = $5::jsonb,
         security_config = $6::jsonb, hosting_config = $7::jsonb, result_settings = $8::jsonb, generated_file = $9::jsonb,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      current.id,
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

export async function updateSecurityConfig(id, securityConfig, userId = null) {
  const current = await findUserPage(id, userId);
  if (!current) return null;
  return updateUserPageConfig(current.id, { securityConfig: { ...current.securityConfig, ...securityConfig } }, userId);
}

export async function updateIpRule(id, ip, mode, userId = null) {
  const current = await findUserPage(id, userId);
  if (!current) return null;
  const bannedIps = new Set(current.securityConfig?.bannedIps || []);
  const whitelistIps = new Set(current.securityConfig?.whitelistIps || []);
  if (mode === "ban") {
    bannedIps.add(ip);
    whitelistIps.delete(ip);
  } else {
    whitelistIps.add(ip);
    bannedIps.delete(ip);
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

export async function adjustWallet({ userId, amount, type = "deposit", description = "Wallet update" }) {
  const value = Number(amount || 0);

  if (useJsonDb()) {
    return updateJsonDb((db) => {
      const user = db.users.find((item) => item.id === userId);
      if (!user) return { error: "User not found", status: 404 };
      user.walletBalance = Number(user.walletBalance || 0) + value;
      user.updatedAt = new Date().toISOString();
      const transaction = buildTransaction(user.id, type, value, description);
      db.walletTransactions.push(transaction);
      return { balance: user.walletBalance, transaction };
    });
  }

  return withTransaction(async (client) => {
    const userResult = await client.query("UPDATE users SET wallet_balance = wallet_balance + $1, updated_at = now() WHERE id = $2 RETURNING *", [value, userId]);
    const user = userResult.rows[0];
    if (!user) return { error: "User not found", status: 404 };
    const txnResult = await client.query(
      `INSERT INTO wallet_transactions (id, user_id, type, amount, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [createId("txn"), user.id, type, value, description]
    );
    return { balance: Number(user.wallet_balance), transaction: toTransaction(txnResult.rows[0]) };
  });
}

function buildDepositRequest(userId, amount, cryptoType, network, txHash) {
  const now = new Date().toISOString();
  return {
    id: createId("dep"),
    userId,
    amount,
    cryptoType,
    network,
    txHash,
    status: "pending",
    adminNote: "",
    reviewedBy: "",
    reviewedAt: null,
    createdAt: now,
    updatedAt: now
  };
}

function validateDepositPayload({ userId, amount, cryptoType, network, txHash }) {
  const value = Number(amount || 0);
  if (!userId) throw new Error("Authentication required");
  if (!Number.isFinite(value) || value <= 0) throw new Error("Funding amount is required");
  if (!cryptoType) throw new Error("Crypto type is required");
  if (!network) throw new Error("Crypto network is required");
  if (!txHash || String(txHash).trim().length < 8) throw new Error("Transaction hash is required");
  return {
    amount: value,
    cryptoType: String(cryptoType).trim(),
    network: String(network).trim(),
    txHash: String(txHash).trim()
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

  if (useJsonDb()) {
    return updateJsonDb((db) => {
      db.walletDepositRequests ||= [];
      const user = db.users.find((item) => item.id === data.userId);
      if (!user) return { error: "User not found", status: 404 };
      const request = buildDepositRequest(user.id, clean.amount, clean.cryptoType, clean.network, clean.txHash);
      db.walletDepositRequests.push(request);
      return { request: jsonDepositToApi(request, user) };
    });
  }

  const result = await query(
    `INSERT INTO wallet_deposit_requests (id, user_id, amount, crypto_type, network, tx_hash)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [createId("dep"), data.userId, clean.amount, clean.cryptoType, clean.network, clean.txHash]
  );
  return { request: toDepositRequest(result.rows[0]) };
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
      if (request.status !== "pending") return { error: "Deposit request already reviewed", status: 400 };
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
        { depositRequestId: request.id, txHash: request.txHash, cryptoType: request.cryptoType, network: request.network }
      );
      db.walletTransactions.push(transaction);
      return { request: jsonDepositToApi(request, user), balance: user.walletBalance, transaction };
    });
  }

  return withTransaction(async (client) => {
    const requestResult = await client.query("SELECT * FROM wallet_deposit_requests WHERE id = $1 FOR UPDATE", [requestId]);
    const request = requestResult.rows[0];
    if (!request) return { error: "Deposit request not found", status: 404 };
    if (request.status !== "pending") return { error: "Deposit request already reviewed", status: 400 };
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
        { depositRequestId: request.id, txHash: request.tx_hash, cryptoType: request.crypto_type, network: request.network }
      ]
    );
    return {
      request: toDepositRequest({ ...updatedRequestResult.rows[0], user_email: user.email, user_name: user.name }),
      balance: Number(user.wallet_balance),
      transaction: toTransaction(txnResult.rows[0])
    };
  });
}

export async function listResults(userPageId, userId = null) {
  const userPage = await findUserPage(userPageId, userId);
  if (!userPage) return null;
  if (useJsonDb()) {
    const db = await readJsonDb();
    return db.pageResults.filter((result) => result.userPageId === userPage.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  const result = await query("SELECT * FROM page_results WHERE user_page_id = $1 ORDER BY created_at DESC", [userPage.id]);
  return result.rows.map(toResult);
}

export async function deleteResult(userPageId, resultId, userId = null) {
  const userPage = await findUserPage(userPageId, userId);
  if (!userPage) return null;
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

export async function listActivePageSessions(userPageId, userId = null) {
  const trafficEvents = await listTrafficEvents(userPageId, userId, 250);
  if (!trafficEvents) return null;

  const cutoff = Date.now() - 10 * 60 * 1000;
  const sessions = new Map();
  for (const event of trafficEvents) {
    if (!event.sessionId) continue;
    const eventTime = new Date(event.createdAt).getTime();
    if (!Number.isFinite(eventTime) || eventTime < cutoff) continue;
    const current = sessions.get(event.sessionId);
    if (current && new Date(current.lastSeenAt).getTime() >= eventTime) continue;
    sessions.set(event.sessionId, {
      sessionId: event.sessionId,
      ip: event.ip || "unknown",
      screen: event.screen || event.pageId || "page",
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
  const nextCommands = { ...currentCommands };
  if (!command || command.action === "clear") {
    delete nextCommands[cleanSessionId];
  } else {
    nextCommands[cleanSessionId] = {
      action: command.action || "redirect",
      targetUrl: String(command.targetUrl || "").trim(),
      note: String(command.note || "").trim(),
      createdAt: new Date().toISOString()
    };
  }

  return updateUserPageConfig(userPage.id, {
    configs: {
      ...currentConfigs,
      sessionCommands: nextCommands
    }
  }, userId);
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
    await updateJsonDb((db) => {
      db.trafficEvents.push(event);
      return event;
    });
    return event;
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
    payload: data.data || {},
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
