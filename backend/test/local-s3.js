const S3rver = require('s3rver');
const fs = require('fs');

fs.rmSync('./.s3-data', { recursive: true, force: true });
fs.mkdirSync('./.s3-data', { recursive: true });

new S3rver({
  port: 9000,
  address: '127.0.0.1',
  silent: false,
  directory: './.s3-data',
  configureBuckets: [{ name: 'loversrock' }],
}).run((err, { address, port } = {}) => {
  if (err) {
    console.error('[s3rver] failed:', err);
    process.exit(1);
  }
  console.log(`[s3rver] listening on ${address}:${port}`);
});
