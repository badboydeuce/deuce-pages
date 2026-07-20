import crypto from "node:crypto";
import path from "node:path";
import unzipper from "unzipper";
import { classifyFile, inferScreenName, scanReview } from "./githubImport.js";
import { contentTypeFor } from "./packagePreview.js";
import { deleteObject, getObjectBuffer, headObject, putObject, signedUploadUrl } from "./objectStorage.js";

const maxFiles = Math.min(Math.max(Number(process.env.LOCAL_IMPORT_MAX_FILES) || 500, 1), 2000);
const maxFileBytes = (Math.min(Math.max(Number(process.env.LOCAL_IMPORT_MAX_FILE_MB) || 20, 1), 100) * 1024 * 1024);
const maxPackageBytes = (Math.min(Math.max(Number(process.env.LOCAL_IMPORT_MAX_PACKAGE_MB) || 100, 1), 500) * 1024 * 1024);
const maxZipBytes = (Math.min(Math.max(Number(process.env.LOCAL_IMPORT_MAX_ZIP_MB) || 25, 1), 100) * 1024 * 1024);
const allowedExtensions = new Set([
  ".html", ".htm", ".css", ".js", ".json", ".txt", ".xml", ".svg",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico",
  ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp3", ".mp4", ".webm"
]);

function importSecret() {
  return process.env.LOCAL_IMPORT_TOKEN_SECRET || process.env.JWT_SECRET || "deuce-pages-local-import-secret";
}

function safeSlug(value) {
  return String(value || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function normalizeImportPath(value) {
  const clean = String(value || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  if (clean.split("/").includes("..")) throw new Error(`Unsafe file path: ${value}`);
  const normalized = path.posix.normalize(clean);
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../") || path.posix.isAbsolute(normalized)) {
    throw new Error(`Unsafe file path: ${value}`);
  }
  if (normalized.toLowerCase().endsWith(".php")) throw new Error(`PHP files are not supported: ${normalized}`);
  const extension = path.posix.extname(normalized).toLowerCase();
  if (!allowedExtensions.has(extension)) throw new Error(`Unsupported file type: ${normalized}`);
  return normalized;
}

function validateFiles(files = []) {
  if (!Array.isArray(files) || !files.length) throw new Error("Select at least one file");
  if (files.length > maxFiles) throw new Error(`A package can contain at most ${maxFiles} files`);
  const seen = new Set();
  let totalBytes = 0;
  const normalized = files.map((file) => {
    const filePath = normalizeImportPath(file.path || file.name);
    const size = Number(file.size || 0);
    if (!Number.isFinite(size) || size < 0 || size > maxFileBytes) throw new Error(`File is too large: ${filePath}`);
    if (seen.has(filePath.toLowerCase())) throw new Error(`Duplicate file path: ${filePath}`);
    seen.add(filePath.toLowerCase());
    totalBytes += size;
    return { path: filePath, size, contentType: contentTypeFor(filePath) };
  });
  if (totalBytes > maxPackageBytes) throw new Error("The package exceeds the configured total size limit");
  if (!normalized.some((file) => file.path.toLowerCase() === "index.html")) throw new Error("index.html is required at the package root");
  return normalized;
}

function signPayload(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", importSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyPayload(token, userId) {
  const [encoded, signature] = String(token || "").split(".");
  if (!encoded || !signature) throw new Error("Invalid import token");
  const expected = crypto.createHmac("sha256", importSecret()).update(encoded).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) throw new Error("Invalid import token");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (payload.userId !== userId || Number(payload.expiresAt) < Date.now()) throw new Error("Import session expired");
  return payload;
}

function packageScan(files, packageName, slug) {
  const htmlFiles = files.filter((file) => classifyFile(file.path) === "html").map((file) => file.path);
  const cssFiles = files.filter((file) => classifyFile(file.path) === "css").map((file) => file.path);
  const assets = files.filter((file) => ["asset", "font"].includes(classifyFile(file.path))).map((file) => file.path);
  const scripts = files.filter((file) => classifyFile(file.path) === "script").map((file) => file.path);
  const screens = htmlFiles.map((file) => ({
    file,
    name: inferScreenName(file),
    role: file.toLowerCase() === "index.html" ? "entry" : "screen"
  }));
  return {
    sourceType: "r2",
    packageName,
    slug,
    files: files.map((file) => ({ path: file.path, type: classifyFile(file.path), size: file.size })),
    screens,
    cssFiles,
    assets,
    scripts,
    review: scanReview({ htmlFiles, cssFiles, assetFiles: assets, scriptFiles: scripts, screens })
  };
}

export async function startLooseImport({ userId, files, packageName, slug, version = "v0.1" }) {
  const cleanName = String(packageName || "Local Imported Page").trim();
  const cleanSlug = safeSlug(slug || cleanName);
  if (!cleanSlug) throw new Error("Package slug is required");
  const cleanFiles = validateFiles(files);
  const sessionId = crypto.randomUUID();
  const prefix = `packages/${cleanSlug}/${version}/${sessionId}`;
  const uploads = await Promise.all(cleanFiles.map(async (file) => {
    const key = `${prefix}/${file.path}`;
    return { ...file, key, uploadUrl: await signedUploadUrl(key, file.contentType, 600) };
  }));
  const payload = { type: "loose", userId, sessionId, prefix, packageName: cleanName, slug: cleanSlug, version, files: cleanFiles, expiresAt: Date.now() + 15 * 60 * 1000 };
  return { importToken: signPayload(payload), uploads, expiresIn: 600 };
}

export async function startZipImport({ userId, file, packageName, slug, version = "v0.1" }) {
  const size = Number(file?.size || 0);
  if (!file || !String(file.name || "").toLowerCase().endsWith(".zip")) throw new Error("Select a ZIP file");
  if (!Number.isFinite(size) || size <= 0 || size > maxZipBytes) throw new Error("ZIP file exceeds the configured size limit");
  const cleanName = String(packageName || String(file.name).replace(/\.zip$/i, "") || "Local Imported Page").trim();
  const cleanSlug = safeSlug(slug || cleanName);
  if (!cleanSlug) throw new Error("Package slug is required");
  const sessionId = crypto.randomUUID();
  const prefix = `packages/${cleanSlug}/${version}/${sessionId}`;
  const key = `imports/${userId}/${sessionId}/source.zip`;
  const payload = { type: "zip", userId, sessionId, prefix, key, packageName: cleanName, slug: cleanSlug, version, size, expiresAt: Date.now() + 15 * 60 * 1000 };
  return { importToken: signPayload(payload), upload: { key, contentType: "application/zip", uploadUrl: await signedUploadUrl(key, "application/zip", 600) }, expiresIn: 600 };
}

async function verifyLooseFiles(payload) {
  await Promise.all(payload.files.map(async (file) => {
    const object = await headObject(`${payload.prefix}/${file.path}`);
    if (Number(object.ContentLength) !== Number(file.size)) throw new Error(`Uploaded size does not match: ${file.path}`);
  }));
  return payload.files;
}

async function extractZip(payload) {
  const object = await headObject(payload.key);
  if (Number(object.ContentLength) !== Number(payload.size) || Number(object.ContentLength) > maxZipBytes) throw new Error("Uploaded ZIP size does not match");
  const zipBuffer = await getObjectBuffer(payload.key);
  const archive = await unzipper.Open.buffer(zipBuffer);
  const entries = archive.files.filter((entry) => entry.type === "File" && !entry.path.endsWith("/"));
  const entryPaths = entries.map((entry) => String(entry.path || "").replace(/\\/g, "/"));
  const firstSegments = new Set(entryPaths.map((entryPath) => entryPath.split("/")[0]));
  const stripRoot = firstSegments.size === 1 && !entryPaths.some((entryPath) => !entryPath.includes("/"));
  const declared = entries.map((entry, index) => ({
    path: stripRoot ? entryPaths[index].split("/").slice(1).join("/") : entryPaths[index],
    size: Number(entry.uncompressedSize || 0)
  }));
  const files = validateFiles(declared);
  await Promise.all(entries.map(async (entry, index) => {
    const file = files[index];
    const buffer = await entry.buffer();
    if (buffer.length !== file.size) throw new Error(`Extracted size does not match: ${file.path}`);
    await putObject(`${payload.prefix}/${file.path}`, buffer, file.contentType);
  }));
  await deleteObject(payload.key);
  return files;
}

export async function finalizeLocalImport({ token, userId }) {
  const payload = verifyPayload(token, userId);
  const files = payload.type === "zip" ? await extractZip(payload) : await verifyLooseFiles(payload);
  return {
    payload,
    files,
    scan: packageScan(files, payload.packageName, payload.slug)
  };
}
