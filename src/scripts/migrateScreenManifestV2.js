import "../config/loadEnv.js";
import { listPackages, updatePackage } from "../repositories/appRepository.js";
import { screenManifestV2ForPackage, validateScreenManifestV2 } from "../services/screenManifest.js";

const apply = process.argv.includes("--apply");
const packages = await listPackages();
const report = [];

for (const pagePackage of packages) {
  const manifest = screenManifestV2ForPackage(pagePackage);
  const validation = validateScreenManifestV2({
    ...pagePackage,
    packageManifest: { ...(pagePackage.packageManifest || {}), ...manifest }
  }, { publishing: pagePackage.status === "published" });
  const current = pagePackage.packageManifest || {};
  const changed = current.schemaVersion !== 2
    || current.screenRevision !== manifest.screenRevision
    || current.entryScreenId !== manifest.entryScreenId
    || current.finalScreenId !== manifest.finalScreenId;

  if (apply && changed) {
    await updatePackage(pagePackage.id, {
      ...pagePackage,
      screens: manifest.screens.map((screen) => screen.buttonLabel),
      packageManifest: { ...current, ...manifest }
    });
  }

  report.push({
    id: pagePackage.id,
    slug: pagePackage.slug,
    status: pagePackage.status,
    changed,
    applied: apply && changed,
    screens: manifest.screens.length,
    entryScreenId: manifest.entryScreenId,
    finalScreenId: manifest.finalScreenId,
    issues: validation.issues,
    warnings: validation.warnings
  });
}

console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", packages: report }, null, 2));
