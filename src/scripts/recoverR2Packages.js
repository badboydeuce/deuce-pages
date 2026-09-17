import fs from "node:fs";
import path from "node:path";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

const envFile = process.argv.find((arg) => arg.startsWith("--env="))?.slice(6);
const apply = process.argv.includes("--apply");
if (!envFile) throw new Error("Pass --env=/path/to/exported.env");

for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const separator = line.indexOf("=");
  if (separator < 1) continue;
  const key = line.slice(0, separator).trim();
  let value = line.slice(separator + 1).trim();
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
  process.env[key] = value;
}

const [{ createPackage, findPackage, updatePackage }, { classifyFile, inferScreenName, scanReview },
  { createScreenManifestV2 }, { createPersistentFieldManifest }, { validatePackageData }] = await Promise.all([
  import("../repositories/appRepository.js"),
  import("../services/githubImport.js"),
  import("../services/screenManifest.js"),
  import("../services/resultCapture.js"),
  import("../services/packageValidation.js")
]);

const endpoint = process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const client = new S3Client({
  region: "auto",
  endpoint,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});
const bucket = process.env.R2_BUCKET_NAME;

const objects = [];
let continuationToken;
do {
  const result = await client.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: "packages/",
    ContinuationToken: continuationToken,
    MaxKeys: 1000
  }));
  objects.push(...(result.Contents || []));
  continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
} while (continuationToken);

const sessions = new Map();
for (const object of objects) {
  const parts = String(object.Key || "").split("/");
  if (parts.length < 5) continue;
  const [root, slug, version, sessionId, ...fileParts] = parts;
  if (root !== "packages" || !slug || !version || !sessionId || !fileParts.length) continue;
  const prefix = [root, slug, version, sessionId].join("/");
  const record = sessions.get(prefix) || { slug, version, sessionId, prefix, files: [], latest: 0 };
  record.files.push({
    path: fileParts.join("/"),
    size: Number(object.Size || 0),
    type: classifyFile(fileParts.join("/"))
  });
  record.latest = Math.max(record.latest, new Date(object.LastModified || 0).getTime());
  sessions.set(prefix, record);
}

const latestBySlug = new Map();
for (const session of sessions.values()) {
  const current = latestBySlug.get(session.slug);
  if (!current || session.latest > current.latest) latestBySlug.set(session.slug, session);
}

const titleCase = (slug) => slug.split("-").map((word) => word ? word[0].toUpperCase() + word.slice(1) : word).join(" ");
const report = [];
for (const session of [...latestBySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug))) {
  const htmlFiles = session.files.filter((file) => file.type === "html").map((file) => file.path);
  if (!htmlFiles.length) {
    report.push({ slug: session.slug, status: "skipped", reason: "no HTML files" });
    continue;
  }
  const cssFiles = session.files.filter((file) => file.type === "css").map((file) => file.path);
  const assets = session.files.filter((file) => ["asset", "font"].includes(file.type)).map((file) => file.path);
  const scripts = session.files.filter((file) => file.type === "script").map((file) => file.path);
  const baseManifest = createScreenManifestV2({
    packageKey: session.slug,
    screens: htmlFiles.map((file) => ({
      file,
      buttonLabel: inferScreenName(file),
      role: /^index\.html?$/i.test(path.posix.basename(file)) ? "entry" : "screen"
    }))
  });
  const mappedScreens = [];
  for (const screen of baseManifest.screens) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: `${session.prefix}/${screen.file}` }));
    const html = Buffer.from(await object.Body.transformToByteArray()).toString("utf8");
    mappedScreens.push({
      ...screen,
      fieldManifest: createPersistentFieldManifest(html, { screenFile: screen.file, screenId: screen.id })
    });
  }
  const screenManifest = createScreenManifestV2({
    packageKey: session.slug,
    screens: mappedScreens,
    entryScreenId: baseManifest.entryScreenId,
    finalScreenId: baseManifest.finalScreenId
  });
  const review = scanReview({ htmlFiles, cssFiles, assetFiles: assets, scriptFiles: scripts, screens: screenManifest.screens });
  const data = {
    slug: session.slug,
    name: titleCase(session.slug),
    version: session.version,
    status: "draft",
    sourceType: "r2",
    billingPeriods: { daily: 25, weekly: 50, biweekly: 100, monthly: 150 },
    screens: screenManifest.screens.map((screen) => screen.buttonLabel),
    assets,
    cssFiles,
    designTokens: { brand: "#7CFFB2", font: "Inter", radius: "8px" },
    packageManifest: {
      ...screenManifest,
      r2: { prefix: session.prefix },
      files: session.files,
      scripts,
      review,
      recoveredAt: new Date().toISOString(),
      recoverySource: "r2"
    }
  };
  const validation = validatePackageData(data, { publishing: false });
  if (!validation.valid) {
    report.push({ slug: session.slug, status: "invalid", issues: validation.issues });
    continue;
  }
  if (apply) {
    const existing = await findPackage(session.slug);
    const saved = existing
      ? await updatePackage(existing.id, validation.value)
      : await createPackage(validation.value);
    report.push({ slug: session.slug, status: existing ? "updated" : "created", id: saved.id, files: session.files.length, screens: htmlFiles.length });
  } else {
    report.push({ slug: session.slug, status: "ready", files: session.files.length, screens: htmlFiles.length, prefix: session.prefix });
  }
}

console.log(JSON.stringify({ apply, packages: report }, null, 2));
process.exit(0);
