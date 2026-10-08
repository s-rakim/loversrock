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

/**
 * The image type a file really is, from its first bytes, or null when it is
 * not one of the pictures the app shows. An upload labelled image/png that is
 * actually HTML or a script is refused rather than stored and served back.
 */
export function sniffImage(buffer) {
  if (!buffer || buffer.length < 12) return null;
  const b = buffer;
  const ascii = (from, to) => b.subarray(from, to).toString('latin1');
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (['heic', 'heix', 'hevc', 'heim', 'heis'].includes(brand)) return 'image/heic';
    if (['mif1', 'msf1', 'avif'].includes(brand)) return brand === 'avif' ? 'image/avif' : 'image/heif';
  }
  if (ascii(0, 2) === 'BM') return 'image/bmp';
  return null;
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

  const [, , data] = match;
  const buffer = Buffer.from(data, 'base64');
  // What the bytes are, not what the upload says they are: only real
  // pictures are stored, under their real type.
  const mimeType = sniffImage(buffer);
  if (!mimeType) {
    const err = new Error('That file is not a picture (JPEG, PNG, GIF, WebP, HEIC or BMP).');
    err.status = 400;
    throw err;
  }
  const ext = mimeType.split('/')[1].replace('jpeg', 'jpg');
  const key = `${prefix}/${randomUUID()}.${ext}`;

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
