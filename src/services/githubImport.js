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

function inferScreenName(filePath) {
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

export async function scanGitHubRepository({ repoUrl, branch = "main", folder = "", packageName, slug }) {
  const { owner, repo } = normalizeRepoUrl(repoUrl);
  const cleanFolder = String(folder || "").replace(/^\/+|\/+$/g, "");
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
  const headers = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "deuce-pages-importer"
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(apiUrl, { headers });
  if (!response.ok) {
    throw new Error(`GitHub scan failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const files = (data.tree || [])
    .filter((item) => item.type === "blob")
    .map((item) => item.path)
    .filter((item) => !cleanFolder || item === cleanFolder || item.startsWith(`${cleanFolder}/`));

  const htmlFiles = files.filter((file) => classifyFile(file) === "html");
  const cssFiles = files.filter((file) => classifyFile(file) === "css");
  const assetFiles = files.filter((file) => ["asset", "font"].includes(classifyFile(file)));
  const scriptFiles = files.filter((file) => classifyFile(file) === "script");
  const screens = htmlFiles.map((file) => ({
    file,
    name: inferScreenName(file),
    role: file.toLowerCase().endsWith("index.html") ? "entry" : "screen"
  }));

  return {
    sourceType: "github",
    repoUrl,
    owner,
    repo,
    branch,
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
    }
  };
}
