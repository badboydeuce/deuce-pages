import { scanGitHubRepository } from "./githubImport.js";
import {
  createScreenManifestV2,
  screenManifestV2ForPackage,
  suggestScreenButtonLabel
} from "./screenManifest.js";

function normalizedFile(item) {
  const path = String(item?.path || item?.file || item || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!path) return null;
  return {
    path,
    type: String(item?.type || ""),
    size: Number(item?.size || 0),
    sha: String(item?.sha || "")
  };
}

function fileMap(files = []) {
  return new Map((Array.isArray(files) ? files : [])
    .map(normalizedFile)
    .filter(Boolean)
    .map((file) => [file.path.toLowerCase(), file]));
}

function sameFileVersion(previous, next) {
  if (previous.sha && next.sha) return previous.sha === next.sha;
  return previous.size === next.size;
}

export function diffGitHubFileInventory(previousFiles = [], nextFiles = []) {
  const previous = fileMap(previousFiles);
  const next = fileMap(nextFiles);
  const unchanged = [];
  const modified = [];
  const removedCandidates = [];
  const addedCandidates = [];

  for (const [key, file] of previous) {
    const current = next.get(key);
    if (!current) removedCandidates.push(file);
    else if (sameFileVersion(file, current)) unchanged.push(current);
    else modified.push({ previous: file, current });
  }
  for (const [key, file] of next) {
    if (!previous.has(key)) addedCandidates.push(file);
  }

  const renamed = [];
  const renamedAdded = new Set();
  const renamedRemoved = new Set();
  for (const removed of removedCandidates) {
    if (!removed.sha) continue;
    const match = addedCandidates.find((added) => (
      !renamedAdded.has(added.path.toLowerCase())
      && added.sha
      && added.sha === removed.sha
      && (!removed.type || !added.type || removed.type === added.type)
    ));
    if (!match) continue;
    renamed.push({ previous: removed, current: match });
    renamedRemoved.add(removed.path.toLowerCase());
    renamedAdded.add(match.path.toLowerCase());
  }

  const added = addedCandidates.filter((file) => !renamedAdded.has(file.path.toLowerCase()));
  const removed = removedCandidates.filter((file) => !renamedRemoved.has(file.path.toLowerCase()));
  return {
    added,
    removed,
    modified,
    renamed,
    unchanged,
    changed: Boolean(added.length || removed.length || modified.length || renamed.length)
  };
}

function isHtml(file) {
  return String(file?.type || "").toLowerCase() === "html" || /\.html?$/i.test(file?.path || "");
}

export function githubScreenDrift(pagePackage, scan, fileDiff = null) {
  const diff = fileDiff || diffGitHubFileInventory(pagePackage?.packageManifest?.files, scan?.files);
  const manifest = screenManifestV2ForPackage(pagePackage);
  const mappedPaths = new Set(manifest.screens.map((screen) => screen.file.toLowerCase()));
  const htmlPaths = new Set((scan?.files || []).filter(isHtml).map((file) => String(file.path).toLowerCase()));
  const addedHtmlPaths = new Set(diff.added.filter(isHtml).map((file) => file.path.toLowerCase()));
  const renamedScreens = diff.renamed
    .filter(({ previous, current }) => isHtml(previous) && isHtml(current) && mappedPaths.has(previous.path.toLowerCase()))
    .map(({ previous, current }) => ({ from: previous.path, to: current.path }));
  const renamedFrom = new Set(renamedScreens.map((item) => item.from.toLowerCase()));
  const renamedTo = new Set(renamedScreens.map((item) => item.to.toLowerCase()));
  const addedScreens = (scan?.files || [])
    .filter(isHtml)
    .filter((file) => !mappedPaths.has(String(file.path).toLowerCase()) && !renamedTo.has(String(file.path).toLowerCase()))
    .map((file) => file.path);
  const missingScreens = manifest.screens
    .filter((screen) => !htmlPaths.has(screen.file.toLowerCase()) && !renamedFrom.has(screen.file.toLowerCase()))
    .map((screen) => screen.file);
  const restoredScreens = manifest.screens
    .filter((screen) => htmlPaths.has(screen.file.toLowerCase()) && addedHtmlPaths.has(screen.file.toLowerCase()))
    .map((screen) => screen.file);
  const modifiedScreens = diff.modified
    .filter(({ current }) => isHtml(current) && mappedPaths.has(current.path.toLowerCase()))
    .map(({ current }) => current.path);

  return {
    addedScreens,
    missingScreens,
    restoredScreens,
    renamedScreens,
    modifiedScreens,
    hasStructuralChanges: Boolean(addedScreens.length || missingScreens.length || renamedScreens.length || restoredScreens.length)
  };
}

export function reconcileGitHubScreenManifest(pagePackage, scan, fileDiff = null) {
  const current = screenManifestV2ForPackage(pagePackage);
  const diff = fileDiff || diffGitHubFileInventory(pagePackage?.packageManifest?.files, scan?.files);
  const drift = githubScreenDrift(pagePackage, scan, diff);
  const liveHtml = new Map((scan?.files || [])
    .filter(isHtml)
    .map((file) => [String(file.path).toLowerCase(), file]));
  const renameMap = new Map(drift.renamedScreens.map((item) => [item.from.toLowerCase(), item.to]));
  const restoredPaths = new Set(drift.restoredScreens.map((file) => file.toLowerCase()));
  const reconciled = [];
  const claimedPaths = new Set();

  for (const screen of current.screens) {
    const renamedTo = renameMap.get(screen.file.toLowerCase());
    if (renamedTo) {
      reconciled.push({ ...screen, file: renamedTo, needsReview: true });
      claimedPaths.add(renamedTo.toLowerCase());
      continue;
    }
    if (liveHtml.has(screen.file.toLowerCase())) {
      reconciled.push(restoredPaths.has(screen.file.toLowerCase()) ? { ...screen, needsReview: true } : screen);
      claimedPaths.add(screen.file.toLowerCase());
      continue;
    }
    reconciled.push({
      ...screen,
      enabled: false,
      showInRedirects: false,
      needsReview: true
    });
  }

  for (const file of (scan?.files || []).filter(isHtml)) {
    const key = String(file.path).toLowerCase();
    if (claimedPaths.has(key)) continue;
    reconciled.push({
      file: file.path,
      buttonLabel: suggestScreenButtonLabel(file.path),
      enabled: false,
      showInRedirects: false,
      needsReview: true,
      order: reconciled.length
    });
  }

  return {
    manifest: createScreenManifestV2({
      packageKey: pagePackage?.id || pagePackage?.slug || pagePackage?.name || "package",
      screens: reconciled,
      entryScreenId: current.entryScreenId,
      finalScreenId: current.finalScreenId
    }),
    drift,
    fileDiff: diff
  };
}

function requireGitHubSource(pagePackage) {
  const github = pagePackage?.packageManifest?.github;
  if (String(pagePackage?.sourceType || "").toLowerCase() !== "github" || !github?.owner || !github?.repo) {
    throw new Error("This package is not connected to a live GitHub source");
  }
  return github;
}

export async function checkGitHubLivePackage(pagePackage) {
  const github = requireGitHubSource(pagePackage);
  const repoUrl = pagePackage.repoUrl || `https://github.com/${github.owner}/${github.repo}`;
  const scan = await scanGitHubRepository({
    repoUrl,
    branch: github.branch || "main",
    folder: github.folder || "",
    packageName: pagePackage.name,
    slug: pagePackage.slug,
    allowBranchFallback: false
  });
  const fileDiff = diffGitHubFileInventory(pagePackage.packageManifest?.files, scan.files);
  const drift = githubScreenDrift(pagePackage, scan, fileDiff);
  const storedCommitSha = String(github.lastSyncedCommitSha || "");
  return {
    mode: "live",
    repo: `${scan.owner}/${scan.repo}`,
    branch: scan.branch,
    folder: scan.folder,
    storedCommitSha,
    currentCommitSha: scan.commitSha,
    treeSha: scan.treeSha,
    committedAt: scan.committedAt,
    commitUrl: scan.commitUrl,
    lastSyncedAt: github.lastSyncedAt || "",
    checkedAt: new Date().toISOString(),
    commitChanged: Boolean(!storedCommitSha || storedCommitSha !== scan.commitSha),
    fileDiff,
    screenDrift: drift,
    summary: scan.summary,
    review: scan.review,
    scan
  };
}

export function publicGitHubLiveStatus(status) {
  const { scan, ...safeStatus } = status || {};
  return safeStatus;
}
