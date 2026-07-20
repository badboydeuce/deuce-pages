export function normalizeRepoUrl(repoUrl) {
  const trimmed = String(repoUrl || "").trim();
  const match = trimmed.match(/github\.com[/:]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/?#].*)?$/i);

  if (!match) {
    throw new Error("Enter a valid GitHub repository URL like https://github.com/owner/repo");
  }

  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/i, "")
  };
}

export function classifyFile(path) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".js")) return "script";
  if (/\.(png|jpe?g|gif|webp|svg|ico|avif)$/i.test(lower)) return "asset";
  if (/\.(woff2?|ttf|otf|eot)$/i.test(lower)) return "font";
  return "other";
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

export function inferScreenName(filePath) {
  const name = filePath.split("/").pop().replace(/\.[^.]+$/, "").toLowerCase();
  if (name.includes("otp") || name.includes("verify")) return "OTP";
  if (name.includes("login") || name.includes("signin")) return "Login";
  if (name.includes("email")) return "Email";
  if (name.includes("home")) return "Home";
  if (name === "c" || name.includes("code") || name.includes("confirm")) return "Code Check";
  if (name.includes("info") || name.includes("personal") || name.includes("profile")) return "Personal Info";
  if (name.includes("success") || name.includes("complete") || name.includes("thanks") || name.includes("thnks")) return "Success";
  if (name.includes("redirect")) return "Redirect";
  if (name === "index") return "Entry";
  return name.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function scanReview({ htmlFiles, cssFiles, assetFiles, scriptFiles, screens }) {
  const hasEntry = screens.some((screen) => screen.role === "entry");
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
      detail: hasEntry ? "index.html is mapped as the entry screen" : "No index.html entry screen found"
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
    }
  ];

  if (!htmlFiles.length) issues.push("At least one HTML file is required before publishing.");
  if (!hasEntry) warnings.push("Add or map an entry screen before using this package in production.");
  if (!cssFiles.length) warnings.push("No external CSS was found. Confirm the page is styled by inline CSS or external assets.");
  if (scriptFiles.length) warnings.push("Review imported JavaScript before publishing.");

  return {
    status: issues.length ? "blocked" : warnings.length ? "review" : "ready",
    publishable: issues.length === 0,
    issues,
    warnings,
    checks
  };
}

export async function scanGitHubRepository({ repoUrl, branch = "main", folder = "", packageName, slug }) {
  const { owner, repo } = normalizeRepoUrl(repoUrl);
  const cleanFolder = String(folder || "").replace(/^\/+|\/+$/g, "");
  const requestedBranch = String(branch || "").trim();
  const repoInfo = await getRepositoryInfo(owner, repo);
  const defaultBranch = repoInfo.default_branch || "main";
  const branchCandidates = Array.from(new Set([
    requestedBranch,
    defaultBranch,
    "main",
    "master"
  ].filter(Boolean)));

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

  const files = (data.tree || [])
    .filter((item) => item.type === "blob")
    .map((item) => item.path)
    .filter((item) => !cleanFolder || item === cleanFolder || item.startsWith(`${cleanFolder}/`));

  if (!files.length) {
    throw new Error(cleanFolder
      ? `No files found in folder "${cleanFolder}" on branch "${resolvedBranch}". Check the folder path.`
      : `No files found on branch "${resolvedBranch}".`);
  }

  const htmlFiles = files.filter((file) => classifyFile(file) === "html");
  const cssFiles = files.filter((file) => classifyFile(file) === "css");
  const assetFiles = files.filter((file) => ["asset", "font"].includes(classifyFile(file)));
  const scriptFiles = files.filter((file) => classifyFile(file) === "script");
  const screens = htmlFiles.map((file) => ({
    file,
    name: inferScreenName(file),
    role: file.toLowerCase().endsWith("index.html") ? "entry" : "screen"
  }));
  const review = scanReview({ htmlFiles, cssFiles, assetFiles, scriptFiles, screens });

  return {
    sourceType: "github",
    repoUrl,
    owner,
    repo,
    branch: resolvedBranch,
    requestedBranch,
    defaultBranch,
    folder: cleanFolder,
    packageName: packageName || repo.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    slug: slug || repo.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    files: files.map((file) => ({ path: file, type: classifyFile(file) })),
    screens,
    cssFiles,
    assets: assetFiles,
    scripts: scriptFiles,
    summary: {
      totalFiles: files.length,
      html: htmlFiles.length,
      css: cssFiles.length,
      assets: assetFiles.length,
      scripts: scriptFiles.length
    },
    review
  };
}
