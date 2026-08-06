import { createScreenManifestV2, suggestScreenButtonLabel } from "./screenManifest.js";
import { createPersistentFieldManifest, normalizePersistentFieldManifest } from "./resultCapture.js";

const githubMaxFiles = Math.min(Math.max(Number(process.env.GITHUB_IMPORT_MAX_FILES) || 1000, 1), 5000);
const githubMaxFileBytes = Math.min(Math.max(Number(process.env.GITHUB_IMPORT_MAX_FILE_MB) || 20, 1), 100) * 1024 * 1024;
const githubMaxPackageBytes = Math.min(Math.max(Number(process.env.GITHUB_IMPORT_MAX_PACKAGE_MB) || 100, 1), 500) * 1024 * 1024;
const githubMaxFieldScanFiles = Math.min(Math.max(Number(process.env.GITHUB_FIELD_SCAN_MAX_FILES) || 40, 1), 200);
const githubMaxFieldScanBytes = Math.min(Math.max(Number(process.env.GITHUB_FIELD_SCAN_MAX_MB) || 2, 1), 10) * 1024 * 1024;
const githubRuntimeExtensions = new Set([
  ".html", ".htm", ".css", ".js", ".mjs", ".json", ".txt", ".xml", ".svg",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico",
  ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp3", ".mp4", ".webm"
]);
const blockedRuntimeNames = new Set([
  "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
  "credentials.json", "secrets.json", "secret.json"
]);

export function normalizeRepoUrl(repoUrl) {
  const trimmed = String(repoUrl || "").trim();
  const sshMatch = trimmed.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  let owner = "";
  let repo = "";

  if (sshMatch) {
    owner = sshMatch[1];
    repo = sshMatch[2];
  } else {
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new Error("Enter a valid GitHub repository URL like https://github.com/owner/repo");
    }

    const hostname = parsed.hostname.toLowerCase();
    const parts = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
    if (
      parsed.protocol !== "https:"
      || !["github.com", "www.github.com"].includes(hostname)
      || parsed.username
      || parsed.password
      || parsed.port
      || parts.length !== 2
    ) {
      throw new Error("Enter a valid GitHub repository URL like https://github.com/owner/repo");
    }
    [owner, repo] = parts;
  }

  repo = repo.replace(/\.git$/i, "");
  if (
    !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(owner)
    || !/^[a-z\d._-]{1,100}$/i.test(repo)
    || repo === "."
    || repo === ".."
  ) {
    throw new Error("Enter a valid GitHub repository URL like https://github.com/owner/repo");
  }

  return { owner, repo };
}

export function classifyFile(path) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "script";
  if (/\.(png|jpe?g|gif|webp|svg|ico|avif|mp3|mp4|webm)$/i.test(lower)) return "asset";
  if (/\.(woff2?|ttf|otf|eot)$/i.test(lower)) return "font";
  if (/\.(json|txt|xml)$/i.test(lower)) return "data";
  return "other";
}

function normalizedGithubPath(value = "") {
  const file = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!file || file.length > 240 || file.includes("\0")) return "";
  if (file.split("/").some((part) => !part || part === "." || part === "..")) return "";
  return file;
}

export function isAllowedGithubRuntimeFile(value = "") {
  const file = normalizedGithubPath(value);
  if (!file) return false;
  const parts = file.split("/");
  const basename = parts.at(-1).toLowerCase();
  if (parts.some((part) => part.startsWith("."))) return false;
  if (blockedRuntimeNames.has(basename) || /^(?:\.env|credentials|secrets?)(?:\.|$)/i.test(basename)) return false;
  const dot = basename.lastIndexOf(".");
  const extension = dot >= 0 ? basename.slice(dot) : "";
  return githubRuntimeExtensions.has(extension);
}

export function githubRawUrl({ repoUrl, branch = "main", file }) {
  const { owner, repo } = normalizeRepoUrl(repoUrl);
  const cleanFile = String(file || "").replace(/^\/+/, "");
  if (!cleanFile) throw new Error("GitHub file path is required");
  return `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${cleanFile.split("/").map(encodeURIComponent).join("/")}`;
}

function githubHeaders() {
  const headers = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "deuce-pages-importer"
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  return headers;
}

async function githubJson(url, label) {
  let response;
  try {
    response = await fetch(url, { headers: githubHeaders() });
  } catch (error) {
    throw new Error(`${label} could not connect to GitHub. Check Render outbound access and retry.`);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.message || `${response.status} ${response.statusText}`;
    if (response.status === 401 || response.status === 403) {
      throw new Error(`${label} failed: ${message}. Add a valid GITHUB_TOKEN on Render if the repo is private or rate-limited.`);
    }
    if (response.status === 404) {
      throw new Error(`${label} failed: repository, branch, or path was not found.`);
    }
    throw new Error(`${label} failed: ${message}`);
  }

  return data;
}

async function getRepositoryInfo(owner, repo) {
  return githubJson(`https://api.github.com/repos/${owner}/${repo}`, "GitHub repo lookup");
}

async function getRepositoryTree(owner, repo, branch) {
  return githubJson(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, `GitHub scan for branch ${branch}`);
}

async function getRepositoryCommit(owner, repo, branch) {
  return githubJson(`https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`, `GitHub commit lookup for branch ${branch}`);
}

async function getRepositoryBlobText(owner, repo, file) {
  if (!file?.sha || Number(file.size || 0) > githubMaxFieldScanBytes) {
    throw new Error("HTML field scan limit exceeded");
  }
  const blob = await githubJson(
    `https://api.github.com/repos/${owner}/${repo}/git/blobs/${encodeURIComponent(file.sha)}`,
    `GitHub field scan for ${file.path}`
  );
  if (blob.encoding !== "base64" || typeof blob.content !== "string") throw new Error("GitHub HTML blob is unavailable");
  const buffer = Buffer.from(blob.content.replace(/\s+/g, ""), "base64");
  if (buffer.length > githubMaxFieldScanBytes) throw new Error("HTML field scan limit exceeded");
  return buffer.toString("utf8");
}

async function scanGitHubScreenFields({ owner, repo, files, screenManifest }) {
  const filesByPath = new Map(files.map((file) => [file.path.toLowerCase(), file]));
  let scanned = 0;
  const screens = await Promise.all(screenManifest.screens.map(async (screen) => {
    const file = filesByPath.get(screen.file.toLowerCase());
    if (!file || scanned >= githubMaxFieldScanFiles) {
      return {
        ...screen,
        fieldManifest: normalizePersistentFieldManifest({
          warnings: [file ? "Field scan limit reached; review this screen manually" : "HTML source is unavailable for field detection"],
          needsReview: true
        }, { screenId: screen.id }),
        needsReview: true
      };
    }
    scanned += 1;
    try {
      const html = await getRepositoryBlobText(owner, repo, file);
      const fieldManifest = createPersistentFieldManifest(html, { screenFile: screen.file, screenId: screen.id });
      return { ...screen, fieldManifest, needsReview: Boolean(screen.needsReview || fieldManifest.needsReview) };
    } catch {
      return {
        ...screen,
        fieldManifest: normalizePersistentFieldManifest({
          warnings: ["Field detection could not read this HTML file; review it before publishing"],
          needsReview: true
        }, { screenId: screen.id }),
        needsReview: true
      };
    }
  }));
  return createScreenManifestV2({
    packageKey: `${owner}/${repo}`,
    screens,
    entryScreenId: screenManifest.entryScreenId,
    finalScreenId: screenManifest.finalScreenId
  });
}

export function inferScreenName(filePath) {
  return suggestScreenButtonLabel(filePath);
}

export function scanReview({ htmlFiles, cssFiles, assetFiles, scriptFiles, screens, excludedFiles = [] }) {
  const hasEntry = screens.some((screen) => screen.role === "entry" || screen.isEntry);
  const issues = [];
  const warnings = [];
  const checks = [
    {
      label: "HTML screens",
      status: htmlFiles.length ? "pass" : "fail",
      detail: htmlFiles.length ? `${htmlFiles.length} screen file${htmlFiles.length === 1 ? "" : "s"} detected` : "No HTML screens detected"
    },
    {
      label: "Entry screen",
      status: hasEntry ? "pass" : "warn",
      detail: hasEntry ? "An HTML file is mapped as the entry screen" : "No entry screen is mapped"
    },
    {
      label: "CSS",
      status: cssFiles.length ? "pass" : "warn",
      detail: cssFiles.length ? `${cssFiles.length} stylesheet${cssFiles.length === 1 ? "" : "s"} detected` : "No external CSS file detected"
    },
    {
      label: "Assets",
      status: assetFiles.length ? "pass" : "warn",
      detail: assetFiles.length ? `${assetFiles.length} asset file${assetFiles.length === 1 ? "" : "s"} detected` : "No image, icon, or font assets detected"
    },
    {
      label: "Scripts",
      status: scriptFiles.length ? "warn" : "pass",
      detail: scriptFiles.length ? `${scriptFiles.length} script file${scriptFiles.length === 1 ? "" : "s"} need review` : "No script files detected"
    },
    {
      label: "Public file boundary",
      status: excludedFiles.length ? "warn" : "pass",
      detail: excludedFiles.length ? `${excludedFiles.length} unsupported or private file${excludedFiles.length === 1 ? "" : "s"} excluded` : "Only approved public page files are mapped"
    }
  ];

  if (!htmlFiles.length) issues.push("At least one HTML file is required before publishing.");
  if (!hasEntry) warnings.push("Select an entry screen before using this package in production.");
  if (!cssFiles.length) warnings.push("No external CSS was found. Confirm the page is styled by inline CSS or external assets.");
  if (scriptFiles.length) warnings.push("Review imported JavaScript before publishing.");
  if (excludedFiles.length) warnings.push(`${excludedFiles.length} repository file${excludedFiles.length === 1 ? " was" : "s were"} excluded from runtime access.`);

  return {
    status: issues.length ? "blocked" : warnings.length ? "review" : "ready",
    publishable: issues.length === 0,
    issues,
    warnings,
    checks
  };
}

export async function scanGitHubRepository({ repoUrl, branch = "main", folder = "", packageName, slug, allowBranchFallback = true }) {
  const { owner, repo } = normalizeRepoUrl(repoUrl);
  const cleanFolder = String(folder || "").replace(/^\/+|\/+$/g, "");
  const requestedBranch = String(branch || "").trim();
  const repoInfo = await getRepositoryInfo(owner, repo);
  const defaultBranch = repoInfo.default_branch || "main";
  const branchCandidates = allowBranchFallback
    ? Array.from(new Set([requestedBranch, defaultBranch, "main", "master"].filter(Boolean)))
    : [requestedBranch || defaultBranch];

  let data = null;
  let resolvedBranch = "";
  const failures = [];

  for (const candidate of branchCandidates) {
    try {
      data = await getRepositoryTree(owner, repo, candidate);
      resolvedBranch = candidate;
      break;
    } catch (error) {
      failures.push(`${candidate}: ${error.message}`);
      if (!/not found/i.test(error.message)) throw error;
    }
  }

  if (!data) {
    throw new Error(`GitHub scan failed. Tried branches: ${failures.join(" | ")}`);
  }

  if (data.truncated) throw new Error("GitHub returned a truncated repository tree. Select a smaller folder before importing.");
  const selectedBlobs = (data.tree || [])
    .filter((item) => item.type === "blob")
    .filter((item) => !cleanFolder || item.path === cleanFolder || item.path.startsWith(`${cleanFolder}/`));

  if (!selectedBlobs.length) {
    throw new Error(cleanFolder
      ? `No files found in folder "${cleanFolder}" on branch "${resolvedBranch}". Check the folder path.`
      : `No files found on branch "${resolvedBranch}".`);
  }

  if (selectedBlobs.length > githubMaxFiles) throw new Error(`The selected GitHub folder contains more than ${githubMaxFiles} files`);
  const excludedFiles = selectedBlobs
    .filter((item) => !isAllowedGithubRuntimeFile(item.path))
    .map((item) => ({ path: item.path, reason: "unsupported-or-private" }));
  const runtimeBlobs = selectedBlobs.filter((item) => isAllowedGithubRuntimeFile(item.path));
  if (!runtimeBlobs.length) throw new Error("No supported public page files were found in the selected GitHub folder");
  let totalBytes = 0;
  for (const item of runtimeBlobs) {
    const size = Number(item.size || 0);
    if (size > githubMaxFileBytes) throw new Error(`GitHub file is too large: ${item.path}`);
    totalBytes += size;
  }
  if (totalBytes > githubMaxPackageBytes) throw new Error("The GitHub page package exceeds the configured total size limit");

  const files = runtimeBlobs.map((item) => ({
    path: normalizedGithubPath(item.path),
    type: classifyFile(item.path),
    size: Number(item.size || 0),
    sha: String(item.sha || "")
  }));

  const htmlFiles = files.filter((file) => file.type === "html").map((file) => file.path);
  const cssFiles = files.filter((file) => file.type === "css").map((file) => file.path);
  const assetFiles = files.filter((file) => ["asset", "font"].includes(file.type)).map((file) => file.path);
  const scriptFiles = files.filter((file) => file.type === "script").map((file) => file.path);
  const expectedEntryFiles = new Set([
    cleanFolder ? `${cleanFolder}/index.html` : "index.html",
    cleanFolder ? `${cleanFolder}/index.htm` : "index.htm"
  ].map((file) => file.toLowerCase()));
  const screenCandidates = htmlFiles.map((file) => ({
    file,
    buttonLabel: inferScreenName(file),
    role: expectedEntryFiles.has(file.toLowerCase()) ? "entry" : "screen"
  }));
  const baseScreenManifest = createScreenManifestV2({ packageKey: slug || `${owner}/${repo}`, screens: screenCandidates });
  const screenManifest = await scanGitHubScreenFields({ owner, repo, files, screenManifest: baseScreenManifest });
  const screens = screenManifest.screens.map((screen) => ({
    ...screen,
    role: screen.id === screenManifest.entryScreenId ? "entry" : screen.stage
  }));
  const review = scanReview({ htmlFiles, cssFiles, assetFiles, scriptFiles, screens, excludedFiles });
  const detectedFieldCount = screens.reduce((count, screen) => count + (screen.fieldManifest?.fields?.length || 0), 0);
  const fieldWarnings = screens.flatMap((screen) => screen.fieldManifest?.warnings || []);
  review.checks.push({
    label: "Result fields",
    status: fieldWarnings.length ? "warn" : "pass",
    detail: `${detectedFieldCount} field${detectedFieldCount === 1 ? "" : "s"} mapped across ${screens.length} screen${screens.length === 1 ? "" : "s"}`
  });
  if (fieldWarnings.length) review.warnings.push(`${fieldWarnings.length} field mapping warning${fieldWarnings.length === 1 ? " requires" : "s require"} review.`);
  if (fieldWarnings.length && review.status === "ready") review.status = "review";
  const commit = await getRepositoryCommit(owner, repo, resolvedBranch);

  return {
    sourceType: "github",
    repoUrl,
    owner,
    repo,
    branch: resolvedBranch,
    requestedBranch,
    defaultBranch,
    folder: cleanFolder,
    commitSha: String(commit.sha || ""),
    treeSha: String(data.sha || commit.commit?.tree?.sha || ""),
    committedAt: commit.commit?.committer?.date || commit.commit?.author?.date || "",
    commitUrl: commit.html_url || "",
    packageName: packageName || repo.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    slug: slug || repo.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    files,
    screens,
    cssFiles,
    assets: assetFiles,
    scripts: scriptFiles,
    screenManifest,
    excludedFiles,
    summary: {
      totalFiles: files.length,
      selectedFiles: selectedBlobs.length,
      excludedFiles: excludedFiles.length,
      totalBytes,
      html: htmlFiles.length,
      css: cssFiles.length,
      assets: assetFiles.length,
      scripts: scriptFiles.length,
      fields: detectedFieldCount
    },
    review
  };
}
