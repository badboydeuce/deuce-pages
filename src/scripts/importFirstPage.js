import "../config/loadEnv.js";
import { createPackage, findPackage, publishPackage, updatePackage } from "../repositories/appRepository.js";
import { scanGitHubRepository } from "../services/githubImport.js";

const repoUrl = process.env.FIRST_PAGE_REPO_URL;

if (!repoUrl) {
  throw new Error("FIRST_PAGE_REPO_URL is required");
}

const scan = await scanGitHubRepository({
  repoUrl,
  branch: process.env.FIRST_PAGE_BRANCH || "main",
  folder: process.env.FIRST_PAGE_FOLDER || "",
  packageName: process.env.FIRST_PAGE_NAME || "First Page",
  slug: process.env.FIRST_PAGE_SLUG || "first-page"
});

const packageData = {
  slug: scan.slug,
  name: scan.packageName,
  version: process.env.FIRST_PAGE_VERSION || "v0.1",
  status: process.env.FIRST_PAGE_STATUS || "draft",
  sourceType: "github",
  repoUrl: scan.repoUrl,
  billingPeriods: {
    daily: Number(process.env.FIRST_PAGE_PRICE_DAILY || 5),
    weekly: Number(process.env.FIRST_PAGE_PRICE_WEEKLY || 25),
    biweekly: Number(process.env.FIRST_PAGE_PRICE_BIWEEKLY || 45),
    monthly: Number(process.env.FIRST_PAGE_PRICE_MONTHLY || 80)
  },
  screens: scan.screens.map((screen) => screen.name),
  assets: scan.assets,
  cssFiles: scan.cssFiles,
  designTokens: {
    brand: process.env.FIRST_PAGE_BRAND || "#7CFFB2",
    font: process.env.FIRST_PAGE_FONT || "Inter",
    radius: process.env.FIRST_PAGE_RADIUS || "8px"
  },
  packageManifest: {
    description: process.env.FIRST_PAGE_DESCRIPTION || "Imported GitHub page package.",
    github: {
      owner: scan.owner,
      repo: scan.repo,
      branch: scan.branch,
      folder: scan.folder
    },
    files: scan.files,
    screens: scan.screens,
    scripts: scan.scripts,
    importedAt: new Date().toISOString()
  }
};

const existing = await findPackage(scan.slug);
const pagePackage = existing
  ? await updatePackage(existing.id, packageData)
  : await createPackage(packageData);

const shouldPublish = process.env.FIRST_PAGE_PUBLISH === "true";
const finalPackage = shouldPublish ? await publishPackage(pagePackage.id) : pagePackage;

console.log(JSON.stringify({
  ok: true,
  package: {
    id: finalPackage.id,
    slug: finalPackage.slug,
    name: finalPackage.name,
    status: finalPackage.status,
    version: finalPackage.version
  },
  scan: {
    files: scan.files.length,
    screens: scan.screens.length,
    cssFiles: scan.cssFiles.length,
    assets: scan.assets.length
  }
}, null, 2));
