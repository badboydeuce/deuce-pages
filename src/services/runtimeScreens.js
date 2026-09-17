import { normalizeScreenFile, screenManifestV2ForPackage } from "./screenManifest.js";

function manifestHtmlFiles(pagePackage = {}) {
  return new Set((pagePackage.packageManifest?.files || [])
    .map((item) => normalizeScreenFile(item?.path || item?.file || item))
    .filter(Boolean)
    .map((file) => file.toLowerCase()));
}

export function runtimeScreensFromPackage(pagePackage = {}) {
  const manifest = screenManifestV2ForPackage(pagePackage);
  const availableFiles = manifestHtmlFiles(pagePackage);
  return manifest.screens
    .filter((screen) => screen.enabled)
    .filter((screen) => !availableFiles.size || availableFiles.has(screen.file.toLowerCase()))
    .map((screen, order) => ({
      ...screen,
      name: screen.buttonLabel,
      label: screen.buttonLabel,
      role: screen.id === manifest.entryScreenId ? "entry" : screen.stage,
      isEntry: screen.id === manifest.entryScreenId,
      isFinal: screen.id === manifest.finalScreenId,
      order
    }));
}

export function runtimeRedirectScreensFromPackage(pagePackage = {}) {
  return runtimeScreensFromPackage(pagePackage).filter((screen) => screen.showInRedirects);
}

export function runtimeScreenForFile(pagePackage, requestedFile) {
  const cleanFile = normalizeScreenFile(requestedFile);
  if (!cleanFile) return null;
  return runtimeScreensFromPackage(pagePackage)
    .find((screen) => screen.file.toLowerCase() === cleanFile.toLowerCase()) || null;
}

export function runtimeScreenForId(pagePackage, requestedId) {
  const cleanId = String(requestedId || "").trim();
  if (!cleanId) return null;
  return runtimeScreensFromPackage(pagePackage)
    .find((screen) => screen.id === cleanId) || null;
}

export function runtimeScreenTargetUrl(userPageId, file) {
  const cleanFile = normalizeScreenFile(file);
  if (!userPageId || !cleanFile) return "";
  const params = new URLSearchParams({ userPageId: String(userPageId), file: cleanFile });
  return `/api/runtime/source?${params.toString()}`;
}

export function createRuntimePackageSnapshot(pagePackage = {}) {
  const screens = runtimeScreensFromPackage(pagePackage);
  const manifest = pagePackage.packageManifest || {};
  const screenManifest = screenManifestV2ForPackage(pagePackage);
  return {
    id: pagePackage.id || "",
    slug: pagePackage.slug || "",
    name: pagePackage.name || "",
    version: pagePackage.version || "",
    sourceType: pagePackage.sourceType || "",
    repoUrl: pagePackage.repoUrl || "",
    packageUpdatedAt: pagePackage.updatedAt || pagePackage.publishedAt || "",
    screens,
    packageManifest: {
      schemaVersion: screenManifest.schemaVersion,
      screenRevision: screenManifest.screenRevision,
      entryScreenId: screenManifest.entryScreenId,
      finalScreenId: screenManifest.finalScreenId,
      ...(manifest.r2 ? { r2: { prefix: manifest.r2.prefix || "" } } : {}),
      ...(manifest.github ? { github: { ...manifest.github } } : {}),
      files: Array.isArray(manifest.files) ? manifest.files : [],
      screens: screenManifest.screens
    }
  };
}

export function runtimePackageForUserPage(userPage, currentPackage = null) {
  const snapshot = userPage?.configs?.runtimePackageSnapshot;
  if (snapshot && runtimeScreensFromPackage(snapshot).length) return snapshot;
  return currentPackage;
}
