// Stands in for MinIO so the upload path runs unmodified against a real S3
// API. The backend package is "type": "module", so this is ESM — s3rver is
// CommonJS but Node exposes its export as the default import.
import fs from 'node:fs';
import S3rver from 's3rver';

const DIRECTORY = new URL('./.s3-data/', import.meta.url).pathname;

fs.rmSync(DIRECTORY, { recursive: true, force: true });
fs.mkdirSync(DIRECTORY, { recursive: true });

new S3rver({
  port: 9000,
  address: '127.0.0.1',
  silent: false,
  directory: DIRECTORY,
  configureBuckets: [{ name: 'loversrock' }],
}).run((err, { address, port } = {}) => {
  if (err) {
    console.error('[s3rver] failed:', err);
    process.exit(1);
  }
  console.log(`[s3rver] listening on ${address}:${port}`);
});
