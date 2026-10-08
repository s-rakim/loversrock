#!/usr/bin/env node
// Replaces every example or weak secret this server runs on with a strong
// random one, changes the database and photo-storage passwords in place, and
// restarts everything. Safe to run again: anything already strong is left
// alone.
//
// On the server PC, from the loversrock folder:
//
//     node docker/secure-setup.mjs              do it
//     node docker/secure-setup.mjs --dry-run    only say what it would change
//     node docker/secure-setup.mjs --no-restart write the files, restart yourself
//
// What it touches, and nothing else:
//   backend/.env  JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, LINK_SECRET,
//                 FABLE_KEY_SECRET (+ FABLE_KEY_SECRET_OLD, so the AI keys
//                 saved in the app are re-sealed, not lost), TURN_SECRET,
//                 STORAGE_SECRET_KEY and the password in DATABASE_URL
//   docker/.env   TURN_SECRET, CALLS_SECRET, POSTGRES_PASSWORD,
//                 MINIO_ROOT_PASSWORD
//
// No value is ever printed. Both files are gitignored; nothing here is
// committed. After it runs, everyone signs in to the app once more.
//
// Needs only Node (no packages) and, for the passwords and the restart,
// Docker Desktop running.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const RESTART = !args.has('--no-restart');
const DOCKER = process.env.LOVERSROCK_DOCKER || 'docker';

const MIN = 32;
const say = (line = '') => console.log(line);

// ------------------------------------------------------------ .env files

/** A .env file as lines, so comments and order survive a rewrite. */
function readEnv(file, example) {
  let created = false;
  let source = file;
  if (!fs.existsSync(file)) {
    if (!example || !fs.existsSync(example)) return { file, lines: [], eol: '\n', created: true, missing: true };
    // Started from the example; written only if this is not a dry run.
    source = example;
    created = true;
  }
  const text = fs.readFileSync(source, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return { file, lines, eol, created };
}

function getVar(env, name) {
  for (const line of env.lines) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (m && m[1] === name) {
      let v = m[2].trim();
      if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
      return v;
    }
  }
  return undefined;
}

function setVar(env, name, value) {
  const i = env.lines.findIndex((line) => new RegExp(`^\\s*${name}\\s*=`).test(line));
  if (i >= 0) { env.lines[i] = `${name}=${value}`; return; }
  if (!env.lines.some((l) => /secure-setup\.mjs/.test(l))) {
    env.lines.push('', '# Written by docker/secure-setup.mjs.');
  }
  env.lines.push(`${name}=${value}`);
}

function writeEnv(env) {
  const tmp = `${env.file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, env.lines.join(env.eol) + env.eol, { mode: 0o600 });
  fs.renameSync(tmp, env.file);
}

// ------------------------------------------------------------ the secrets

const PLACEHOLDER = /change[-_ ]?me/i;
const DEFAULTS = new Set(['', 'secret', 'changeme', 'password', 'loversrock', 'loversrock123', 'minioadmin', 'postgres']);

function weak(value) {
  const v = String(value ?? '');
  return !v.trim() || DEFAULTS.has(v) || PLACEHOLDER.test(v) || v.length < MIN || new Set(v).size < 8;
}

/** Letters and digits only: no quoting trouble in SQL, a URL or a .env file. */
const strong = () => crypto.randomBytes(36).toString('base64url').replace(/[-_]/g, '').slice(0, 44);

// ------------------------------------------------------------ docker

function docker(argv, { quiet = false } = {}) {
  const res = spawnSync(DOCKER, ['compose', ...argv], {
    cwd: here, encoding: 'utf8', stdio: quiet ? 'pipe' : ['ignore', 'inherit', 'inherit'],
  });
  if (res.error) return { ok: false, error: res.error.code === 'ENOENT' ? 'docker is not installed or not on PATH' : res.error.message };
  return { ok: res.status === 0, status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function waitForPostgres(user, seconds = 90) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    const r = docker(['exec', '-T', 'postgres', 'pg_isready', '-U', user], { quiet: true });
    if (r.ok) return true;
    if (r.error) return false;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
  }
  return false;
}

// ------------------------------------------------------------ main

const backend = readEnv(path.join(root, 'backend', '.env'), path.join(root, 'backend', '.env.example'));
const dock = readEnv(path.join(root, 'docker', '.env'), path.join(here, '.env.example'));
if (backend.missing) {
  say('backend/.env is missing and so is backend/.env.example. Run this from a full loversrock checkout.');
  process.exit(1);
}

const changes = [];   // names only, for the summary
const change = (file, name, value) => { setVar(file, name, value); changes.push(`${path.relative(root, file.file)}: ${name}`); };

// Sign-in secrets. New ones sign everybody out once.
const oldRefresh = getVar(backend, 'JWT_REFRESH_SECRET') || '';
for (const name of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
  if (weak(getVar(backend, name))) change(backend, name, strong());
}
if (getVar(backend, 'JWT_ACCESS_SECRET') === getVar(backend, 'JWT_REFRESH_SECRET')) change(backend, 'JWT_REFRESH_SECRET', strong());

// Signed links (voice notes, photos, the Decline button) get a root of their own.
if (weak(getVar(backend, 'LINK_SECRET'))) change(backend, 'LINK_SECRET', strong());

// The seal on AI keys saved in the app. Its old value goes in _OLD so the
// backend can open what it sealed and seal it again with the new one.
const oldSeal = getVar(backend, 'FABLE_KEY_SECRET') || oldRefresh;
if (weak(getVar(backend, 'FABLE_KEY_SECRET'))) {
  change(backend, 'FABLE_KEY_SECRET', strong());
  if (oldSeal && !getVar(backend, 'FABLE_KEY_SECRET_OLD')) change(backend, 'FABLE_KEY_SECRET_OLD', oldSeal);
}

// The call relay: the same secret for coturn and the backend.
let turn = getVar(dock, 'TURN_SECRET');
if (weak(turn)) { turn = strong(); change(dock, 'TURN_SECRET', turn); }
if (getVar(backend, 'TURN_SECRET') !== undefined && getVar(backend, 'TURN_SECRET') !== turn) change(backend, 'TURN_SECRET', turn);

// The call media server: rooms open only with a pass the backend signed.
if (weak(getVar(dock, 'CALLS_SECRET'))) change(dock, 'CALLS_SECRET', strong());

// Photo storage.
const minioUser = getVar(dock, 'MINIO_ROOT_USER') || 'loversrock';
let minioPassword = getVar(dock, 'MINIO_ROOT_PASSWORD') || 'loversrock123';
if (weak(minioPassword)) {
  minioPassword = strong();
  change(dock, 'MINIO_ROOT_PASSWORD', minioPassword);
}
if (getVar(backend, 'STORAGE_SECRET_KEY') !== minioPassword) change(backend, 'STORAGE_SECRET_KEY', minioPassword);
if ((getVar(backend, 'STORAGE_ACCESS_KEY') || '') !== minioUser) change(backend, 'STORAGE_ACCESS_KEY', minioUser);

// The database: changed inside Postgres first, then written down.
const pgUser = getVar(dock, 'POSTGRES_USER') || 'loversrock';
const pgDb = getVar(dock, 'POSTGRES_DB') || 'loversrock';
const pgOld = getVar(dock, 'POSTGRES_PASSWORD') || 'loversrock';
const pgNew = weak(pgOld) ? strong() : null;

say(DRY ? 'Would change:' : 'Changing:');
for (const c of changes) say(`  ${c}`);
if (pgNew) say('  the database password (inside Postgres, then docker/.env and backend/.env)');
if (!changes.length && !pgNew) say('  nothing: every secret is already strong.');
if (backend.created) say('  (backend/.env did not exist: made from backend/.env.example; fill in the rest of it too)');
if (DRY) process.exit(0);

writeEnv(backend);
writeEnv(dock);

let dbChanged = false;
if (pgNew) {
  say('\nChanging the database password…');
  const up = docker(['up', '-d', 'postgres']);
  if (!up.ok) {
    say(`Could not start Postgres (${up.error || `exit ${up.status}`}). The database password was NOT changed; run this again with Docker Desktop running.`);
  } else if (!waitForPostgres(pgUser)) {
    say('Postgres did not come up in time. The database password was NOT changed; run this again.');
  } else {
    const sql = `ALTER USER "${pgUser.replace(/"/g, '""')}" WITH PASSWORD '${pgNew}'`;
    const r = docker(['exec', '-T', 'postgres', 'psql', '-U', pgUser, '-d', pgDb, '-v', 'ON_ERROR_STOP=1', '-c', sql], { quiet: true });
    if (!r.ok) {
      say(`Postgres refused the change (${(r.stderr || r.error || '').trim().split('\n').pop()}). The password was NOT changed.`);
    } else {
      setVar(dock, 'POSTGRES_PASSWORD', pgNew);
      const url = getVar(backend, 'DATABASE_URL');
      if (url) {
        try {
          const u = new URL(url);
          if (decodeURIComponent(u.username) === pgUser) { u.password = pgNew; setVar(backend, 'DATABASE_URL', u.toString()); }
        } catch { /* left as it was */ }
      }
      writeEnv(dock);
      writeEnv(backend);
      dbChanged = true;
      say('Done.');
    }
  }
}

if (!RESTART) {
  say('\nFiles written. Restart with:  cd docker; docker compose up -d --build');
  process.exit(0);
}
say('\nRestarting everything with the new secrets…');
const restarted = docker(['up', '-d', '--build']);
if (!restarted.ok) {
  say(`\n"docker compose up" failed (${restarted.error || `exit ${restarted.status}`}). The files are written: once Docker is running, run`);
  say('    cd docker; docker compose up -d --build');
  process.exit(1);
}
say('\nAll set.');
say('- Both of you sign in to the app again, once.');
if (changes.some((c) => c.includes('FABLE_KEY_SECRET'))) say('- AI keys saved in Fable are re-sealed with the new secret when the backend starts.');
if (pgNew && !dbChanged) say('- The database password is still the old one: run this again when Docker is up.');
say('- Check: docker compose logs backend --tail 20   (no "[secrets]" lines means all good)');
