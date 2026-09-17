import { validateScreenManifestV2 } from "./screenManifest.js";

const allowedStatuses = new Set(["draft", "review", "published", "archived"]);
const allowedPeriods = ["daily", "weekly", "biweekly", "monthly"];

function cleanPrice(value, label, issues) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100000) {
    issues.push(`${label} price must be between 0 and 100000`);
    return undefined;
  }
  return Math.round(number * 100) / 100;
}

export function validatePackageData(data = {}, { publishing = false } = {}) {
  const issues = [];
  const slug = String(data.slug || "").trim().toLowerCase();
  const name = String(data.name || "").trim();
  const status = String(data.status || "draft").trim().toLowerCase();
  const sourceType = String(data.sourceType || "upload").trim().toLowerCase();
  if (!name) issues.push("Package name is required");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) issues.push("Slug must contain lowercase letters, numbers, and single hyphens only");
  if (!allowedStatuses.has(status)) issues.push("Unsupported package status");
  if (!["upload", "local", "github", "r2"].includes(sourceType)) issues.push("Unsupported package source type");

  const billingPeriods = {};
  for (const period of allowedPeriods) {
    const price = cleanPrice(data.billingPeriods?.[period], period, issues);
    if (price !== undefined) billingPeriods[period] = price;
  }
  if (!Object.keys(billingPeriods).length && !publishing) {
    Object.assign(billingPeriods, { daily: 25, weekly: 50, biweekly: 100, monthly: 150 });
  }
  if (publishing && !Object.values(billingPeriods).some((price) => price > 0)) {
    issues.push("At least one paid billing period is required before publishing");
  }

  const screenValidation = validateScreenManifestV2(data, { publishing });
  issues.push(...screenValidation.issues);
  const packageManifest = {
    ...(data.packageManifest || {}),
    ...screenValidation.manifest
  };
  return {
    valid: issues.length === 0,
    issues: [...new Set(issues)],
    warnings: screenValidation.warnings,
    value: {
      ...data,
      name,
      slug,
      status,
      sourceType,
      billingPeriods,
      screens: screenValidation.manifest.screens.map((screen) => screen.buttonLabel),
      packageManifest
    }
  };
}
