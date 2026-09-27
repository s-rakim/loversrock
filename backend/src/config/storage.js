import { Client } from 'minio';
import { randomUUID } from 'crypto';

const BUCKET = process.env.STORAGE_BUCKET || 'loversrock';

// MinIO by default, swappable for AWS S3 by pointing these env vars at
// s3.amazonaws.com with useSSL:true and real AWS credentials — the MinIO JS
// client speaks the S3 API, so no code change is needed to switch providers.
export const storageClient = new Client({
  endPoint: process.env.STORAGE_ENDPOINT || 'localhost',
  port: Number(process.env.STORAGE_PORT || 9000),
  useSSL: process.env.STORAGE_USE_SSL === 'true',
  accessKey: process.env.STORAGE_ACCESS_KEY,
  secretKey: process.env.STORAGE_SECRET_KEY,
});

export async function ensureBucket() {
  const exists = await storageClient.bucketExists(BUCKET).catch(() => false);
  if (!exists) {
    await storageClient.makeBucket(BUCKET);
  }
}

export async function uploadBase64Image(base64Data, { prefix = 'uploads' } = {}) {
  const match = /^data:(image\/\w+);base64,(.+)$/.exec(base64Data);
  if (!match) {
    // Bad client input, not a server fault — surfaced as 400 by the error
    // handler in server.js rather than a generic 500.
    const err = new Error('Expected a base64 data URL image');
    err.status = 400;
    throw err;
  }

  const [, mimeType, data] = match;
  const ext = mimeType.split('/')[1] || 'jpg';
  const key = `${prefix}/${randomUUID()}.${ext}`;
  const buffer = Buffer.from(data, 'base64');

  await storageClient.putObject(BUCKET, key, buffer, buffer.length, {
    'Content-Type': mimeType,
  });

  return key;
}

export async function getObjectStream(key) {
  return storageClient.getObject(BUCKET, key);
}

/** Stores raw bytes under a key the caller chose — voice notes, which are not images. */
export async function putBuffer(key, buffer, contentType) {
  await storageClient.putObject(BUCKET, key, buffer, buffer.length, { 'Content-Type': contentType });
  return key;
}

/**
 * Part of an object, for an HTTP Range request.
 *
 * Audio players seek: an .m4a from a phone's recorder keeps its index at the
 * END of the file, so a player asks for the tail first, and a server that
 * ignores Range hands it the whole file from byte zero instead.
 */
export async function getPartialObjectStream(key, offset, length) {
  return storageClient.getPartialObject(BUCKET, key, offset, length);
}

/** The stored metadata for a key — used to serve the right Content-Type. */
export async function statObject(key) {
  return storageClient.statObject(BUCKET, key);
}

export async function deleteObject(key) {
  return storageClient.removeObject(BUCKET, key);
}

export { BUCKET };
