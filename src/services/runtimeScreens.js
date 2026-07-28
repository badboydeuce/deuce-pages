function cleanRuntimeFile(value = "") {
  const file = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!file || file.length > 240 || file.includes("\0")) return "";
  if (file.split("/").some((part) => part === "..")) return "";
  return /\.html?$/i.test(file) ? file : "";
}

function screenFile(screen) {
  if (typeof screen === "string") return cleanRuntimeFile(screen);
  return cleanRuntimeFile(screen?.file || screen?.path || screen?.href || "");
}

function screenName(screen, file) {
  const configured = typeof screen === "string"
    ? ""
    : screen?.name || screen?.title || screen?.label || "";
  if (String(configured || "").trim()) return String(configured).trim();
  return String(file || "")
    .split("/")
    .pop()
    .replace(/\.html?$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim() || "Page";
}

function manifestHtmlFiles(pagePackage = {}) {
  return new Set((pagePackage.packageManifest?.files || [])
    .map((item) => cleanRuntimeFile(item?.path || item?.file || item))
    .filter(Boolean)
    .map((file) => file.toLowerCase()));
}

export function runtimeScreensFromPackage(pagePackage = {}) {
  const manifestScreens = pagePackage.packageManifest?.screens || [];
  const fallbackScreens = pagePackage.screens || [];
  const candidates = manifestScreens.length ? manifestScreens : fallbackScreens;
  const availableFiles = manifestHtmlFiles(pagePackage);
  const seen = new Set();

  return candidates.reduce((screens, screen, index) => {
    const file = screenFile(screen);
    const key = file.toLowerCase();
    if (!file || seen.has(key)) return screens;
    if (availableFiles.size && !availableFiles.has(key)) return screens;
    seen.add(key);
    screens.push({
      id: key,
      file,
      name: screenName(screen, file),
      role: typeof screen === "object" && screen?.role
        ? String(screen.role)
        : index === 0 ? "entry" : "screen",
      order: screens.length
    });
    return screens;
  }, []);
}

export function runtimeScreenForFile(pagePackage, requestedFile) {
  const cleanFile = cleanRuntimeFile(requestedFile);
  if (!cleanFile) return null;
  return runtimeScreensFromPackage(pagePackage)
    .find((screen) => screen.file.toLowerCase() === cleanFile.toLowerCase()) || null;
}

export function runtimeScreenTargetUrl(userPageId, file) {
  const cleanFile = cleanRuntimeFile(file);
  if (!userPageId || !cleanFile) return "";
  const params = new URLSearchParams({ userPageId: String(userPageId), file: cleanFile });
  return `/api/runtime/source?${params.toString()}`;
}

export function createRuntimePackageSnapshot(pagePackage = {}) {
  const screens = runtimeScreensFromPackage(pagePackage);
  const manifest = pagePackage.packageManifest || {};
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
      ...(manifest.r2 ? { r2: { prefix: manifest.r2.prefix || "" } } : {}),
      ...(manifest.github ? { github: { ...manifest.github } } : {}),
      files: Array.isArray(manifest.files) ? manifest.files : [],
      screens
    }
  };
}

export function runtimePackageForUserPage(userPage, currentPackage = null) {
  const snapshot = userPage?.configs?.runtimePackageSnapshot;
  if (snapshot && runtimeScreensFromPackage(snapshot).length) return snapshot;
  return currentPackage;
}
