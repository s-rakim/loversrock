// Runs first on every container start, before anything imports a package.
//
// If the image's node_modules is missing or half there (Docker Desktop
// crashing mid-write can leave an image like that), every start used to die
// on "Cannot find module .../dotenv/config" — one 20-line stack trace a
// minute, forever, with nothing saying what to do. This says it once, in one
// line, and exits so the restart policy still retries.
//
// Uses nothing but Node itself, so it works exactly when the packages don't.
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const missing = Object.keys(pkg.dependencies || {})
  .filter((name) => !existsSync(new URL(`node_modules/${name}/package.json`, root)));

if (missing.length) {
  console.error(`[start] ${missing.length} package(s) missing from this image (${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ', …' : ''}). `
    + 'The image is damaged or out of date. Rebuild it: '
    + 'docker compose rm -sf backend && docker compose build --no-cache backend && docker compose up -d');
  process.exit(1);
}
