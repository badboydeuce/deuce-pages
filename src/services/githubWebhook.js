import crypto from "node:crypto";
import {
  createGitHubChangeEvent,
  listPackages,
  notifyActiveAdmins,
  updateGitHubChangeEvent,
  updatePackage
} from "../repositories/appRepository.js";
import { checkGitHubLivePackage } from "./githubLiveSync.js";
import { screenManifestV2ForPackage } from "./screenManifest.js";

function webhookError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function verifyGitHubWebhookSignature(rawBody, signature, secret = process.env.GITHUB_WEBHOOK_SECRET) {
  const signingSecret = String(secret || "");
  if (signingSecret.length < 16) throw webhookError("GitHub webhook signing secret is not configured", 503);
  const supplied = String(signature || "").trim().toLowerCase();
  if (!/^sha256=[a-f0-9]{64}$/.test(supplied)) throw webhookError("Invalid GitHub webhook signature", 401);
  const expected = `sha256=${crypto.createHmac("sha256", signingSecret).update(rawBody || Buffer.alloc(0)).digest("hex")}`;
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (suppliedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) {
    throw webhookError("Invalid GitHub webhook signature", 401);
  }
  return true;
}

function pushBranch(ref = "") {
  const prefix = "refs/heads/";
  return String(ref).startsWith(prefix) ? String(ref).slice(prefix.length) : "";
}

function cleanRepository(value = "") {
  const repository = String(value || "").trim().toLowerCase();
  return /^[a-z0-9_.-]{1,100}\/[a-z0-9_.-]{1,100}$/.test(repository) ? repository : "";
}

export function githubPushChangedFiles(payload = {}) {
  const files = [];
  const commits = Array.isArray(payload.commits) ? payload.commits : [];
  for (const commit of commits) {
    for (const key of ["added", "modified", "removed"]) {
      if (Array.isArray(commit?.[key])) files.push(...commit[key]);
    }
  }
  for (const key of ["added", "modified", "removed"]) {
    if (Array.isArray(payload.head_commit?.[key])) files.push(...payload.head_commit[key]);
  }
  return [...new Set(files
    .map((file) => String(file || "").replace(/\\/g, "/").replace(/^\/+/, "").trim())
    .filter((file) => file && file.length <= 240 && !file.split("/").some((part) => part === "..")))]
    .slice(0, 500);
}

function pushFilesComplete(payload = {}) {
  const commitCount = Array.isArray(payload.commits) ? payload.commits.length : 0;
  const distinctSize = Number(payload.distinct_size ?? payload.size ?? commitCount);
  return Number.isFinite(distinctSize) && commitCount >= distinctSize;
}

function packageRepository(pagePackage) {
  const github = pagePackage?.packageManifest?.github || {};
  return cleanRepository(`${github.owner || ""}/${github.repo || ""}`);
}

function packageAffectedByPush(pagePackage, { repository, branch, changedFiles, completeFileList }) {
  const github = pagePackage?.packageManifest?.github || {};
  if (String(pagePackage?.sourceType || "").toLowerCase() !== "github") return false;
  if (packageRepository(pagePackage) !== repository || String(github.branch || "main") !== branch) return false;
  const folder = String(github.folder || "").replace(/^\/+|\/+$/g, "");
  if (!folder || !completeFileList || !changedFiles.length) return true;
  return changedFiles.some((file) => file === folder || file.startsWith(`${folder}/`));
}

function fileDiffSummary(fileDiff = {}) {
  return {
    added: fileDiff.added?.length || 0,
    removed: fileDiff.removed?.length || 0,
    modified: fileDiff.modified?.length || 0,
    renamed: fileDiff.renamed?.length || 0
  };
}

function screenDriftSummary(screenDrift = {}) {
  return {
    added: screenDrift.addedScreens || [],
    missing: screenDrift.missingScreens || [],
    renamed: screenDrift.renamedScreens || [],
    restored: screenDrift.restoredScreens || [],
    modified: screenDrift.modifiedScreens || []
  };
}

function adminNoticeFor(pagePackage, event, summary, error = "") {
  const unhealthy = summary.entryMissing || summary.classification === "branch_deleted" || Boolean(error);
  return {
    eventType: unhealthy ? "github.package_unhealthy" : "github.screen_review",
    title: unhealthy ? `GitHub health alert - ${pagePackage.name}` : `GitHub screen review - ${pagePackage.name}`,
    message: error
      ? `The ${summary.branch || "configured"} branch check failed: ${error}`
      : summary.classification === "branch_deleted"
        ? `The configured ${summary.branch} branch was deleted.`
        : summary.entryMissing
          ? "The configured entry screen is missing from the live branch."
          : "GitHub changed the package screen structure. Review the new mapping before publishing.",
    metadata: {
      packageId: pagePackage.id,
      packageSlug: pagePackage.slug,
      githubChangeEventId: event.id,
      repository: summary.repository,
      branch: summary.branch,
      afterSha: summary.afterSha || "",
      classification: summary.classification
    }
  };
}

async function recordPackageHealth(pagePackage, delivery, health, status = pagePackage.status) {
  const packageManifest = pagePackage.packageManifest || {};
  const github = packageManifest.github || {};
  return updatePackage(pagePackage.id, {
    status,
    packageManifest: {
      ...packageManifest,
      github: {
        ...github,
        lastObservedCommitSha: delivery.afterSha || github.lastObservedCommitSha || "",
        lastObservedAt: delivery.receivedAt,
        lastWebhookAt: delivery.receivedAt,
        lastWebhookDeliveryId: delivery.deliveryId,
        health
      }
    }
  });
}

async function processMatchedPackage(pagePackage, delivery) {
  const created = await createGitHubChangeEvent({
    packageId: pagePackage.id,
    deliveryId: delivery.deliveryId,
    repository: delivery.repository,
    branch: delivery.branch,
    beforeSha: delivery.beforeSha,
    afterSha: delivery.afterSha,
    compareUrl: delivery.compareUrl,
    author: delivery.author,
    eventType: delivery.deleted ? "branch.deleted" : delivery.created ? "branch.created" : "push",
    changedFiles: delivery.changedFiles
  });
  if (!created.created) return { event: created.event, duplicate: true };
  const event = await updateGitHubChangeEvent(created.event.id, { status: "processing", error: "" });
  const processedAt = new Date().toISOString();

  if (delivery.deleted) {
    const summary = {
      classification: "branch_deleted",
      repository: delivery.repository,
      branch: delivery.branch,
      afterSha: delivery.afterSha,
      structural: true,
      entryMissing: true,
      changedFileCount: delivery.changedFiles.length
    };
    await recordPackageHealth(pagePackage, delivery, {
      state: "unhealthy",
      reason: "Configured GitHub branch was deleted",
      checkedAt: processedAt,
      deliveryId: delivery.deliveryId,
      commitSha: delivery.afterSha
    }, pagePackage.status === "published" ? "review" : pagePackage.status);
    const updatedEvent = await updateGitHubChangeEvent(event.id, { status: "unhealthy", summary, processedAt });
    await notifyActiveAdmins(adminNoticeFor(pagePackage, updatedEvent, summary));
    return { event: updatedEvent, duplicate: false };
  }

  try {
    const status = await checkGitHubLivePackage(pagePackage);
    const manifest = screenManifestV2ForPackage(pagePackage);
    const entryFile = manifest.screens.find((screen) => screen.id === manifest.entryScreenId)?.file || "";
    const missingSet = new Set((status.screenDrift.missingScreens || []).map((file) => String(file).toLowerCase()));
    const entryMissing = Boolean(entryFile && missingSet.has(entryFile.toLowerCase()));
    const structural = Boolean(status.screenDrift.hasStructuralChanges);
    const classification = entryMissing ? "entry_missing" : structural ? "screen_review" : status.fileDiff.changed ? "live" : "healthy";
    const eventStatus = entryMissing ? "unhealthy" : structural ? "action_required" : classification;
    const summary = {
      classification,
      repository: delivery.repository,
      branch: delivery.branch,
      afterSha: status.currentCommitSha || delivery.afterSha,
      commitUrl: status.commitUrl || delivery.compareUrl,
      commitChanged: status.commitChanged,
      structural,
      entryMissing,
      entryFile,
      changedFileCount: delivery.changedFiles.length,
      files: fileDiffSummary(status.fileDiff),
      screens: screenDriftSummary(status.screenDrift)
    };
    await recordPackageHealth(pagePackage, delivery, {
      state: entryMissing ? "unhealthy" : structural ? "review" : "healthy",
      reason: entryMissing ? "Entry screen is missing from the live branch" : structural ? "Screen mapping review required" : "Configured branch is healthy",
      checkedAt: processedAt,
      deliveryId: delivery.deliveryId,
      commitSha: status.currentCommitSha || delivery.afterSha
    }, structural && pagePackage.status === "published" ? "review" : pagePackage.status);
    const updatedEvent = await updateGitHubChangeEvent(event.id, { status: eventStatus, summary, processedAt });
    if (structural || entryMissing) await notifyActiveAdmins(adminNoticeFor(pagePackage, updatedEvent, summary));
    return { event: updatedEvent, duplicate: false };
  } catch (error) {
    const cleanError = String(error.message || "GitHub branch check failed").slice(0, 1000);
    const summary = {
      classification: "check_failed",
      repository: delivery.repository,
      branch: delivery.branch,
      afterSha: delivery.afterSha,
      structural: false,
      entryMissing: false,
      changedFileCount: delivery.changedFiles.length
    };
    await recordPackageHealth(pagePackage, delivery, {
      state: "degraded",
      reason: cleanError,
      checkedAt: processedAt,
      deliveryId: delivery.deliveryId,
      commitSha: delivery.afterSha
    });
    const updatedEvent = await updateGitHubChangeEvent(event.id, { status: "error", summary, error: cleanError, processedAt });
    await notifyActiveAdmins(adminNoticeFor(pagePackage, updatedEvent, summary, cleanError));
    return { event: updatedEvent, duplicate: false, error: cleanError };
  }
}

export async function processGitHubPush(payload = {}, deliveryId = "") {
  const repository = cleanRepository(payload.repository?.full_name);
  const branch = pushBranch(payload.ref);
  const cleanDeliveryId = String(deliveryId || "").trim();
  if (!repository || !branch) throw webhookError("Unsupported GitHub push payload");
  if (!/^[a-zA-Z0-9_-]{6,180}$/.test(cleanDeliveryId)) throw webhookError("Invalid GitHub delivery id");
  const changedFiles = githubPushChangedFiles(payload);
  const completeFileList = pushFilesComplete(payload);
  const delivery = {
    deliveryId: cleanDeliveryId,
    repository,
    branch,
    beforeSha: String(payload.before || "").slice(0, 80),
    afterSha: String(payload.after || "").slice(0, 80),
    compareUrl: String(payload.compare || "").slice(0, 500),
    author: String(payload.head_commit?.author?.name || payload.pusher?.name || payload.sender?.login || "GitHub").slice(0, 180),
    changedFiles,
    completeFileList,
    created: Boolean(payload.created),
    deleted: Boolean(payload.deleted),
    receivedAt: new Date().toISOString()
  };
  const packages = await listPackages();
  const matches = packages.filter((pagePackage) => packageAffectedByPush(pagePackage, delivery));
  const results = [];
  for (const pagePackage of matches) results.push(await processMatchedPackage(pagePackage, delivery));
  return {
    repository,
    branch,
    matchedPackages: matches.length,
    processedPackages: results.filter((result) => !result.duplicate).length,
    duplicatePackages: results.filter((result) => result.duplicate).length,
    failedPackages: results.filter((result) => result.error).length
  };
}
