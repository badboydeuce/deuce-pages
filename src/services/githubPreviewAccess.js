import crypto from "node:crypto";
import { classifyFile, normalizeRepoUrl } from "./githubImport.js";

const ticketVersion = "gp1";
const ticketAudience = "github-import-preview";
const defaultLifetimeSeconds = 5 * 60;
const allowedAssetTypes = new Set(["css", "script", "asset", "font"]);

function signingSecret(env) {
  const secret = env.GITHUB_PREVIEW_SECRET || env.PREVIEW_TOKEN_SECRET || env.JWT_SECRET;
  if (secret) return String(secret);
  if (env.NODE_ENV === "production") {
    throw new Error("GitHub preview signing secret is not configured");
  }
  return "deuce-pages-local-github-preview-secret";
}

function normalizeBranch(value) {
  const branch = String(value || "").trim();
  if (
    !branch
    || branch.length > 255
    || /[\u0000-\u0020\u007f~^:?*[\]\\]/.test(branch)
    || branch.includes("..")
    || branch.includes("@{")
    || branch.includes("//")
    || branch.startsWith(".")
    || branch.startsWith("/")
    || branch.endsWith("/")
    || branch.endsWith(".")
    || branch.endsWith(".lock")
  ) {
    throw new Error("Invalid GitHub branch");
  }
  return branch;
}

export function normalizeGitHubFilePath(value) {
  const file = String(value || "").trim();
  const segments = file.split("/");
  if (
    !file
    || file.length > 1024
    || file.startsWith("/")
    || file.includes("\\")
    || /[\u0000-\u001f\u007f]/.test(file)
    || segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Invalid GitHub file path");
  }
  return file;
}

function validateKindAndFile(kind, file) {
  const fileType = classifyFile(file);
  if (kind === "page" && fileType === "html") return;
  if (kind === "asset" && allowedAssetTypes.has(fileType)) return;
  throw new Error(kind === "page" ? "Preview ticket requires an HTML file" : "Unsupported preview asset type");
}

function signatureFor(body, env) {
  return crypto.createHmac("sha256", signingSecret(env)).update(body).digest("base64url");
}

function signaturesMatch(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ""));
  const expectedBuffer = Buffer.from(String(expected || ""));
  return actualBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export function createGitHubPreviewTicket(input, options = {}) {
  const env = options.env || process.env;
  const now = Math.floor((options.now ?? Date.now()) / 1000);
  const { owner, repo } = normalizeRepoUrl(input.repoUrl);
  const branch = normalizeBranch(input.branch || "main");
  const file = normalizeGitHubFilePath(input.file);
  const kind = input.kind === "asset" ? "asset" : "page";
  validateKindAndFile(kind, file);

  const requestedExpiry = Number(input.expiresAt);
  const expiresAt = Number.isInteger(requestedExpiry)
    ? Math.min(requestedExpiry, now + defaultLifetimeSeconds)
    : now + defaultLifetimeSeconds;
  if (expiresAt <= now) throw new Error("GitHub preview ticket has expired");

  const payload = {
    aud: ticketAudience,
    v: 1,
    owner,
    repo,
    branch,
    file,
    kind,
    sub: String(input.userId || "").slice(0, 128),
    iat: now,
    exp: expiresAt
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${ticketVersion}.${body}.${signatureFor(body, env)}`;
}

export function verifyGitHubPreviewTicket(token, expectedKind, options = {}) {
  const env = options.env || process.env;
  const now = Math.floor((options.now ?? Date.now()) / 1000);
  const value = String(token || "");
  if (!value || value.length > 4096) throw new Error("GitHub preview authorization required");

  const [version, body, signature, extra] = value.split(".");
  if (version !== ticketVersion || !body || !signature || extra) {
    throw new Error("Invalid GitHub preview authorization");
  }
  if (!signaturesMatch(signature, signatureFor(body, env))) {
    throw new Error("Invalid GitHub preview authorization");
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid GitHub preview authorization");
  }

  if (
    payload?.aud !== ticketAudience
    || payload?.v !== 1
    || payload?.kind !== expectedKind
    || !Number.isInteger(payload.iat)
    || !Number.isInteger(payload.exp)
    || payload.iat > now + 30
    || payload.exp <= now
    || payload.exp - payload.iat > defaultLifetimeSeconds
  ) {
    throw new Error("Invalid or expired GitHub preview authorization");
  }

  const { owner, repo } = normalizeRepoUrl(`https://github.com/${payload.owner}/${payload.repo}`);
  const branch = normalizeBranch(payload.branch);
  const file = normalizeGitHubFilePath(payload.file);
  validateKindAndFile(expectedKind, file);

  return {
    repoUrl: `https://github.com/${owner}/${repo}`,
    owner,
    repo,
    branch,
    file,
    userId: String(payload.sub || ""),
    expiresAt: payload.exp
  };
}
