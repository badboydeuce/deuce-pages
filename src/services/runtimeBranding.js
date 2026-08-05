import { fetchPackageFile, previewSourceForPackage } from "./packagePreview.js";

const MAX_BRANDING_BYTES = 512 * 1024;
const imageTypes = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"]
]);

function cleanPath(value = "") {
  const path = String(value).trim().replace(/^\/+/, "").replace(/\\/g, "/");
  if (!path || path.length > 240 || path.includes("\0")) return "";
  if (path.split("/").some((part) => part === "..")) return "";
  return path;
}

function extensionFor(value = "") {
  const path = cleanPath(value).toLowerCase();
  return [...imageTypes.keys()].find((extension) => path.endsWith(extension)) || "";
}

function hasImageSignature(buffer, contentType) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_BRANDING_BYTES) return false;
  if (contentType === "image/png") return buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  if (contentType === "image/jpeg") return buffer.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"));
  if (contentType === "image/webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  if (contentType === "image/x-icon") return buffer.subarray(0, 4).equals(Buffer.from("00000100", "hex"));
  return false;
}

export function decodeBrandingDataUrl(value = "") {
  const match = String(value).match(/^data:(image\/(?:png|jpeg|webp)|image\/x-icon);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const contentType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  return hasImageSignature(buffer, contentType) ? { buffer, contentType } : null;
}

function manifestPaths(pagePackage) {
  const manifest = pagePackage?.packageManifest || {};
  return [...(manifest.files || []), ...(manifest.assets || [])]
    .map((item) => cleanPath(item?.path || item))
    .filter(Boolean);
}

export function packageBrandingPath(pagePackage) {
  const manifest = pagePackage?.packageManifest || {};
  const paths = [...new Set(manifestPaths(pagePackage))];
  const explicit = cleanPath(manifest.thumbnailPath);
  if (explicit && paths.includes(explicit) && extensionFor(explicit)) return explicit;

  const priorities = [
    /(?:^|\/)favicon(?:[-_][^/]*)?\.(?:png|ico|webp)$/i,
    /(?:^|\/)apple-touch-icon(?:[-_][^/]*)?\.png$/i,
    /(?:^|\/)(?:logo|icon|brand)(?:[-_][^/]*)?\.(?:png|jpe?g|webp|ico)$/i
  ];
  for (const pattern of priorities) {
    const matched = paths.find((file) => pattern.test(file));
    if (matched) return matched;
  }
  return "";
}

export async function brandingImageForPackage(pagePackage) {
  const embedded = decodeBrandingDataUrl(pagePackage?.packageManifest?.thumbnailDataUrl);
  if (embedded) return embedded;

  const file = packageBrandingPath(pagePackage);
  const extension = extensionFor(file);
  if (!file || !extension) return null;
  const contentType = imageTypes.get(extension);
  const source = previewSourceForPackage(pagePackage, file);
  const response = await fetchPackageFile(source);
  if (!response.ok) return null;
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_BRANDING_BYTES) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  return hasImageSignature(buffer, contentType) ? { buffer, contentType } : null;
}

export const runtimeBrandingLimits = Object.freeze({ maxBytes: MAX_BRANDING_BYTES });
