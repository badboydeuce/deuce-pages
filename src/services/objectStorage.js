import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function storageConfig() {
  const accountId = String(process.env.R2_ACCOUNT_ID || "").trim();
  const bucket = String(process.env.R2_BUCKET_NAME || "").trim();
  const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || "").trim();
  const endpoint = String(process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "")).replace(/\/$/, "");
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 is not configured. Set R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.");
  }
  return { endpoint, bucket, accessKeyId, secretAccessKey };
}

let cachedClient = null;
let cachedKey = "";

function storageClient() {
  const config = storageConfig();
  const key = `${config.endpoint}:${config.accessKeyId}`;
  if (!cachedClient || cachedKey !== key) {
    cachedClient = new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    });
    cachedKey = key;
  }
  return { client: cachedClient, bucket: config.bucket };
}

export function objectStorageConfigured() {
  try {
    storageConfig();
    return true;
  } catch {
    return false;
  }
}

export async function signedUploadUrl(key, contentType, expiresIn = 600) {
  const { client, bucket } = storageClient();
  return getSignedUrl(client, new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType || "application/octet-stream"
  }), { expiresIn });
}

export async function headObject(key) {
  const { client, bucket } = storageClient();
  return client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
}

export async function getObjectBuffer(key) {
  const { client, bucket } = storageClient();
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await result.Body.transformToByteArray());
}

export async function putObject(key, body, contentType) {
  const { client, bucket } = storageClient();
  return client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType || "application/octet-stream"
  }));
}

export async function deleteObject(key) {
  const { client, bucket } = storageClient();
  return client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function deleteObjectPrefix(prefix) {
  const cleanPrefix = String(prefix || "").replace(/^\/+|\/+$/g, "");
  if (!cleanPrefix || !cleanPrefix.startsWith("packages/")) throw new Error("Invalid package storage prefix");
  const { client, bucket } = storageClient();
  let deleted = 0;
  while (true) {
    const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `${cleanPrefix}/`, MaxKeys: 1000 }));
    const keys = (listed.Contents || []).map((item) => item.Key).filter(Boolean);
    if (!keys.length) break;
    await Promise.all(keys.map((Key) => client.send(new DeleteObjectCommand({ Bucket: bucket, Key }))));
    deleted += keys.length;
  }
  return deleted;
}