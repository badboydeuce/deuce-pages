import crypto from "node:crypto";

export const screenManifestVersion = 2;
export const screenStages = ["form", "verification", "success", "other"];
export const screenStates = ["default", "error", "retry", "alternate"];

const stageSet = new Set(screenStages);
const stateSet = new Set(screenStates);

export function normalizeScreenFile(value = "") {
  const file = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!file || file.length > 240 || file.includes("\0")) return "";
  if (file.split("/").some((part) => part === "..")) return "";
  return /\.html?$/i.test(file) ? file : "";
}

export function suggestScreenButtonLabel(file = "") {
  const name = String(file || "").split("/").pop()?.replace(/\.[^.]+$/, "").toLowerCase() || "";
  if (name.includes("otp") || name.includes("verify")) return "OTP";
  if (name.includes("login") || name.includes("signin")) return name.includes("2") || name.includes("error") ? "Login Error" : "Login";
  if (name.includes("sms")) return name.includes("2") || name.includes("error") ? "OTP Error" : "OTP";
  if (name.includes("pin")) return "PIN";
  if (name.includes("email")) return "Email";
  if (name.includes("home")) return "Home";
  if (name === "c" || name.includes("code") || name.includes("confirm")) return "Code Check";
  if (name.includes("info") || name.includes("personal") || name.includes("profile")) return "Personal Info";
  if (name.includes("success") || name.includes("complete") || name.includes("thanks") || name.includes("thnks")) return "Success";
  if (name.includes("redirect")) return "Redirect";
  if (name === "index") return "Entry";
  return name.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()).trim() || "Page";
}

function inferredStage(screen, label, file) {
  const requested = String(screen?.stage || screen?.kind || "").toLowerCase().trim();
  if (stageSet.has(requested)) return requested;
  const legacyRole = String(screen?.role || "").toLowerCase().trim();
  if (stageSet.has(legacyRole)) return legacyRole;
  const text = `${label} ${file}`.toLowerCase();
  if (/success|complete|thanks|redirect/.test(text)) return "success";
  if (/otp|verify|verification|sms|pin|code|confirm/.test(text)) return "verification";
  if (/login|signin|email|form|info|personal|profile|index/.test(text)) return "form";
  return "other";
}

function inferredState(screen, label, file) {
  const requested = String(screen?.state || "").toLowerCase().trim();
  if (stateSet.has(requested)) return requested;
  const text = `${label} ${file}`.toLowerCase();
  if (/error|invalid|failed|wrong|denied/.test(text) || /(?:^|[-_])2\.html?$/i.test(file)) return "error";
  if (/retry|again/.test(text)) return "retry";
  if (/alternate|backup|fallback/.test(text)) return "alternate";
  return "default";
}

function stableScreenId(packageKey, file) {
  const digest = crypto.createHash("sha256")
    .update(`${String(packageKey || "package").toLowerCase()}:${String(file).toLowerCase()}`)
    .digest("hex")
    .slice(0, 14);
  return `scr_${digest}`;
}

function rawScreenFile(screen) {
  if (typeof screen === "string") return normalizeScreenFile(screen);
  return normalizeScreenFile(screen?.file || screen?.path || screen?.href || "");
}

function normalizedBoolean(value, fallback) {
  return value === undefined || value === null ? fallback : Boolean(value);
}

function screenRevision({ entryScreenId, finalScreenId, screens }) {
  const canonical = JSON.stringify({
    entryScreenId,
    finalScreenId,
    screens: screens.map((screen) => ({
      id: screen.id,
      file: screen.file,
      buttonLabel: screen.buttonLabel,
      stage: screen.stage,
      state: screen.state,
      enabled: screen.enabled,
      showInRedirects: screen.showInRedirects,
      order: screen.order
    }))
  });
  return `sha256:${crypto.createHash("sha256").update(canonical).digest("hex")}`;
}

export function createScreenManifestV2({
  packageKey = "",
  screens = [],
  entryScreenId = "",
  finalScreenId = ""
} = {}) {
  const seenFiles = new Set();
  const seenIds = new Set();
  const candidates = (Array.isArray(screens) ? screens : [])
    .map((screen, index) => ({ screen, index, file: rawScreenFile(screen) }))
    .filter((item) => item.file)
    .sort((left, right) => {
      const leftOrder = Number.isFinite(Number(left.screen?.order)) ? Number(left.screen.order) : left.index;
      const rightOrder = Number.isFinite(Number(right.screen?.order)) ? Number(right.screen.order) : right.index;
      return leftOrder - rightOrder || left.index - right.index;
    });

  const normalizedScreens = [];
  for (const { screen, file } of candidates) {
    const fileKey = file.toLowerCase();
    if (seenFiles.has(fileKey)) continue;
    seenFiles.add(fileKey);
    const requestedId = typeof screen === "object" ? String(screen?.id || "").trim() : "";
    let id = /^[a-zA-Z0-9_-]{3,80}$/.test(requestedId) ? requestedId : stableScreenId(packageKey, file);
    if (seenIds.has(id.toLowerCase())) id = stableScreenId(`${packageKey}:${normalizedScreens.length}`, file);
    seenIds.add(id.toLowerCase());
    const configuredLabel = typeof screen === "object"
      ? screen?.buttonLabel || screen?.label || screen?.name || screen?.title || ""
      : "";
    const buttonLabel = String(configuredLabel || suggestScreenButtonLabel(file)).trim().slice(0, 80) || "Page";
    normalizedScreens.push({
      id,
      file,
      buttonLabel,
      stage: inferredStage(screen, buttonLabel, file),
      state: inferredState(screen, buttonLabel, file),
      enabled: normalizedBoolean(typeof screen === "object" ? screen?.enabled : undefined, true),
      showInRedirects: normalizedBoolean(typeof screen === "object" ? screen?.showInRedirects : undefined, true),
      order: normalizedScreens.length,
      legacyRole: typeof screen === "object" ? String(screen?.role || "").toLowerCase() : ""
    });
  }

  const enabledScreens = normalizedScreens.filter((screen) => screen.enabled);
  const requestedEntry = String(entryScreenId || "").trim();
  const legacyEntry = enabledScreens.find((screen) => screen.legacyRole === "entry");
  const conventionalEntry = enabledScreens.find((screen) => /(^|\/)index\.html?$/i.test(screen.file));
  const entry = enabledScreens.find((screen) => screen.id === requestedEntry)
    || legacyEntry
    || conventionalEntry
    || enabledScreens[0]
    || null;
  const requestedFinal = String(finalScreenId || "").trim();
  const legacyFinal = enabledScreens.find((screen) => screen.stage === "success" || screen.legacyRole === "success");
  const final = enabledScreens.find((screen) => screen.id === requestedFinal)
    || legacyFinal
    || null;
  const cleanScreens = normalizedScreens.map(({ legacyRole, ...screen }) => screen);
  const manifest = {
    schemaVersion: screenManifestVersion,
    entryScreenId: entry?.id || "",
    finalScreenId: final?.id || "",
    screens: cleanScreens
  };
  return { ...manifest, screenRevision: screenRevision(manifest) };
}

export function screenManifestV2ForPackage(pagePackage = {}) {
  const packageManifest = pagePackage.packageManifest || {};
  const manifestScreens = Array.isArray(packageManifest.screens) ? packageManifest.screens : [];
  const fallbackScreens = Array.isArray(pagePackage.screens) ? pagePackage.screens : [];
  const fallbackMappedScreens = fallbackScreens.filter((screen) => rawScreenFile(screen));
  const fileDerivedScreens = (packageManifest.files || [])
    .map((item) => normalizeScreenFile(item?.path || item?.file || item))
    .filter(Boolean)
    .map((file, index) => ({
      file,
      buttonLabel: typeof fallbackScreens[index] === "string" ? fallbackScreens[index] : undefined
    }));
  return createScreenManifestV2({
    packageKey: pagePackage.id || pagePackage.slug || pagePackage.name || "package",
    screens: manifestScreens.length
      ? manifestScreens
      : fallbackMappedScreens.length ? fallbackMappedScreens : fileDerivedScreens,
    entryScreenId: packageManifest.entryScreenId,
    finalScreenId: packageManifest.finalScreenId
  });
}

function manifestHtmlFiles(pagePackage = {}) {
  return new Set((pagePackage.packageManifest?.files || [])
    .map((item) => normalizeScreenFile(item?.path || item?.file || item))
    .filter(Boolean)
    .map((file) => file.toLowerCase()));
}

export function validateScreenManifestV2(pagePackage = {}, { publishing = false } = {}) {
  const issues = [];
  const warnings = [];
  const packageManifest = pagePackage.packageManifest || {};
  const manifest = screenManifestV2ForPackage(pagePackage);
  const rawScreens = Array.isArray(packageManifest.screens) && packageManifest.screens.length
    ? packageManifest.screens
    : manifest.screens;
  const availableFiles = manifestHtmlFiles(pagePackage);
  const rawFiles = new Set();
  const rawIds = new Set();

  for (const screen of rawScreens) {
    const file = rawScreenFile(screen);
    if (!file) {
      if (publishing) issues.push("Every mapped screen must reference an .html or .htm file");
      continue;
    }
    const fileKey = file.toLowerCase();
    if (rawFiles.has(fileKey)) issues.push(`Duplicate screen file: ${file}`);
    rawFiles.add(fileKey);
    const id = typeof screen === "object" ? String(screen?.id || "").trim().toLowerCase() : "";
    if (id && rawIds.has(id)) issues.push(`Duplicate screen id: ${screen.id}`);
    if (id) rawIds.add(id);
  }

  const visibleLabels = new Set();
  for (const screen of manifest.screens) {
    if (availableFiles.size && !availableFiles.has(screen.file.toLowerCase())) {
      const message = `Mapped screen file is missing from the package: ${screen.file}`;
      (publishing ? issues : warnings).push(message);
    }
    if (!screen.buttonLabel) issues.push(`Redirect button name is required: ${screen.file}`);
    if (!stageSet.has(screen.stage)) issues.push(`Unsupported screen stage: ${screen.stage}`);
    if (!stateSet.has(screen.state)) issues.push(`Unsupported screen state: ${screen.state}`);
    if (screen.enabled && screen.showInRedirects) {
      const labelKey = screen.buttonLabel.toLowerCase();
      if (visibleLabels.has(labelKey)) {
        const message = `Duplicate redirect button name: ${screen.buttonLabel}`;
        (publishing ? issues : warnings).push(message);
      }
      visibleLabels.add(labelKey);
    }
  }

  const entry = manifest.screens.find((screen) => screen.id === manifest.entryScreenId);
  const final = manifest.finalScreenId
    ? manifest.screens.find((screen) => screen.id === manifest.finalScreenId)
    : null;
  if (publishing && !manifest.screens.length) issues.push("At least one HTML screen is required before publishing");
  if (publishing && (!entry || !entry.enabled)) issues.push("Select one enabled entry screen before publishing");
  if (manifest.finalScreenId && (!final || !final.enabled)) issues.push("The final screen must reference an enabled screen");
  if (!publishing && !entry && manifest.screens.length) warnings.push("Select an entry screen before publishing");

  return {
    valid: issues.length === 0,
    issues: [...new Set(issues)],
    warnings: [...new Set(warnings)],
    manifest
  };
}

export function screenById(pagePackage, screenId) {
  const requested = String(screenId || "").trim();
  if (!requested) return null;
  return screenManifestV2ForPackage(pagePackage).screens.find((screen) => screen.id === requested) || null;
}
