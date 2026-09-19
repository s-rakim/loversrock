/**
 * Exercises services/api.js outside React Native.
 *
 * The server address is the single point where this app most often fails for a
 * user: EXPO_PUBLIC_API_URL is inlined at build time, and when it is wrong every
 * screen reports the same unhelpful transport error. These checks run the real
 * module against real HTTP servers, with the three native-only imports stubbed,
 * so a regression here is caught without an EAS build.
 *
 *   node test/serverUrl.mjs      (from mobile/)
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { networkInterfaces } from 'node:os';

const require = createRequire(import.meta.url);
const babel = require('@babel/core');

// 127.0.0.1 is deliberately rejected by the module under test (on a phone it
// means the phone), so the fake servers bind to a real interface.
const HOST = Object.values(networkInterfaces())
  .flat()
  .find((i) => i.family === 'IPv4' && !i.internal)?.address;

if (!HOST) {
  console.error('No non-loopback IPv4 interface; cannot run these checks here.');
  process.exit(0);
}

const UP = `${HOST}:45671`;
const DOWN = `${HOST}:45699`; // nothing listening

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'loversrock-api-'));

function stub(name, source) {
  const dir = path.join(sandbox, 'node_modules', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.js'), source);
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name, version: '0.0.0', main: 'index.js' })
  );
}

stub('expo-secure-store', `
const mem = {};
exports.getItemAsync = async (k) => (k in mem ? mem[k] : null);
exports.setItemAsync = async (k, v) => { mem[k] = v; };
exports.deleteItemAsync = async (k) => { delete mem[k]; };
`);

stub('@react-native-async-storage/async-storage', `
const mem = {};
module.exports = {
  getItem: async (k) => (k in mem ? mem[k] : null),
  setItem: async (k, v) => { mem[k] = v; },
  removeItem: async (k) => { delete mem[k]; },
  __dump: () => ({ ...mem }),
};
module.exports.default = module.exports;
`);

stub('socket.io-client', `exports.io = (url) => ({ url, connected: false, disconnect() {} });`);

// The module under test is the real one, transpiled to CJS so plain Node runs it.
const src = fs.readFileSync(new URL('../services/api.js', import.meta.url), 'utf8');
const { code } = babel.transformSync(src, {
  filename: 'api.js',
  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  babelrc: false,
  configFile: false,
});
fs.writeFileSync(path.join(sandbox, 'api.cjs'), code);

const sandboxRequire = createRequire(path.join(sandbox, 'noop.cjs'));

let pass = 0;
let fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${extra ? `\n        ${extra}` : ''}`);
  }
};

function serve(port) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } else if (req.url === '/auth/login') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ accessToken: 'access', refreshToken: 'refresh' }));
      } else {
        res.writeHead(404);
        res.end('{}');
      }
    });
    server.listen(port, '0.0.0.0', () => resolve(server));
  });
}

const server = await serve(45671);
const AsyncStorage = sandboxRequire('@react-native-async-storage/async-storage');

// Simulates a binary built while eas.json still held the placeholder.
process.env.EXPO_PUBLIC_API_URL = 'http://100.x.x.x:4000';
const api = sandboxRequire('./api.cjs');

console.log('\nA build that shipped the eas.json placeholder');
check('starts on the build-time address', api.getApiUrl() === 'http://100.x.x.x:4000', api.getApiUrl());
check('the placeholder is named, not just "failed"', /still the placeholder/.test(api.apiUrlProblem() || ''));
let msg = '';
try {
  await api.pingServer();
} catch (err) {
  msg = err.message;
}
check('and no bare "Network request failed" escapes', /still the placeholder/.test(msg) && !/Network request failed/.test(msg), msg);

console.log('\nCorrecting the address in the app');
const saved = await api.setApiUrl(UP);
check('bare host:port is normalized to an origin', saved === `http://${UP}`, saved);
check('it is persisted', AsyncStorage.__dump().loversrock_server_url === `http://${UP}`);
check('the placeholder warning clears', api.apiUrlProblem() === null, String(api.apiUrlProblem()));
check('ping reaches the new server', (await api.pingServer()).status === 'ok');
check('apiFetch uses the new address', (await api.apiFetch('/auth/login', { method: 'POST', body: {} })).accessToken === 'access');
check('mediaUrl follows it', api.mediaUrl('k').startsWith(`http://${UP}/media/k`), api.mediaUrl('k'));
check('the socket follows it', (await api.connectSocket()).url === `http://${UP}`);

console.log('\nSurviving an app restart');
delete sandboxRequire.cache[sandboxRequire.resolve('./api.cjs')];
const restarted = sandboxRequire('./api.cjs');
check('a cold start holds the build-time value', restarted.getApiUrl() === 'http://100.x.x.x:4000', restarted.getApiUrl());
await restarted.loadApiUrl();
check('loadApiUrl restores the saved address', restarted.getApiUrl() === `http://${UP}`, restarted.getApiUrl());
check('and requests work after restoring', (await restarted.pingServer()).status === 'ok');

console.log('\nA correct address with nothing listening');
await restarted.setApiUrl(DOWN).catch(() => {});
let downMsg = '';
try {
  await restarted.pingServer();
} catch (err) {
  downMsg = err.message;
}
check('the failure names the address it tried', downMsg.includes(`http://${DOWN}`), downMsg);
check('and points at the in-app fix', /Settings/.test(downMsg));
check('still no bare "Network request failed"', !/Network request failed/.test(downMsg));

console.log('\nSigned media URLs, because <Image> cannot send a header');
// /media is authenticated, and the native image loaders make a bare GET with
// no headers JavaScript ever sees. Every photo in the app therefore 401'd and
// rendered as an empty box. The token rides in the query string instead.
await restarted.setApiUrl(UP);
check('anonymous before sign-in, rather than inventing a token',
  restarted.mediaUrl('messages/1.jpg') === `http://${UP}/media/messages/1.jpg`,
  restarted.mediaUrl('messages/1.jpg'));

await restarted.setTokens({ accessToken: 'tok-123', refreshToken: 'r' });
check('signed once there is a session',
  restarted.mediaUrl('messages/1.jpg') === `http://${UP}/media/messages/1.jpg?token=tok-123`,
  restarted.mediaUrl('messages/1.jpg'));
check('built synchronously, which is what render needs',
  typeof restarted.mediaUrl('k') === 'string');

await restarted.setTokens({ accessToken: 'tok/with+chars=', refreshToken: 'r' });
check('the token is percent-encoded, so a + never becomes a space',
  restarted.mediaUrl('k') === `http://${UP}/media/k?token=tok%2Fwith%2Bchars%3D`,
  restarted.mediaUrl('k'));

await restarted.setTokens({ accessToken: 'rotated', refreshToken: 'r' });
check('a rotated token is picked up immediately',
  restarted.mediaUrl('k').endsWith('?token=rotated'), restarted.mediaUrl('k'));

await restarted.clearTokens();
check('and signing out unsigns it', restarted.mediaUrl('k') === `http://${UP}/media/k`, restarted.mediaUrl('k'));
check('a missing key is null, not the string "undefined" in a URL',
  restarted.mediaUrl(null) === null && restarted.mediaUrl(undefined) === null);

console.log('\nResetting');
check('reverts to the build-time address', (await restarted.resetApiUrl()) === 'http://100.x.x.x:4000');
check('and clears the saved override', AsyncStorage.__dump().loversrock_server_url === undefined);

server.close();
fs.rmSync(sandbox, { recursive: true, force: true });

console.log(`\nSERVER URL RESULT — PASSED: ${pass}  FAILED: ${fail}`);
process.exit(fail ? 1 : 0);
