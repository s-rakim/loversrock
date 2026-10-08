// The server's secrets: checked before it serves anything, and kept to one job
// each.
//
// The example files ship `change-me-…` placeholders, and the repository is
// public. A server running on one of them hands anyone who has read the repo a
// way to mint a login for any account (JWT_ACCESS_SECRET), keep one forever
// (JWT_REFRESH_SECRET) or use the call relay (TURN_SECRET). So the server
// refuses to start on a placeholder, an empty value or a short one, and says
// how to make real ones: `node docker/secure-setup.mjs` writes them all.
//
// Each signed link also gets a key of its own, derived for its purpose, so a
// signature made for one thing (a voice-note link) can never be replayed as
// another (a photo link, a Decline button). LINK_SECRET is the root for those
// when set; otherwise JWT_ACCESS_SECRET is, through the same derivation.
import crypto from 'crypto';

export const MIN_SECRET_LENGTH = 32;

/** Placeholders that have been in this repository's example files. */
const KNOWN_PLACEHOLDERS = new Set([
  'change-me-access-secret', 'change-me-refresh-secret', 'change-me-turn-secret',
  'secret', 'changeme', 'password', 'loversrock', 'loversrock123',
]);

/** Why a secret is not good enough, or null when it is. */
export function secretProblem(value) {
  const v = String(value ?? '');
  if (!v.trim()) return 'is not set';
  if (KNOWN_PLACEHOLDERS.has(v) || /change[-_ ]?me/i.test(v)) return 'is still the example placeholder, which is public';
  if (v.length < MIN_SECRET_LENGTH) return `is only ${v.length} characters (at least ${MIN_SECRET_LENGTH})`;
  if (new Set(v).size < 8) return 'is too repetitive to be random';
  return null;
}

/**
 * Every secret this process depends on, and what is wrong with each. TURN is
 * only checked when it is in use; the sealing secret for saved AI keys only
 * when it is set (otherwise JWT_REFRESH_SECRET, already checked, is used).
 */
export function secretProblems(env = process.env) {
  const out = [];
  const need = (name) => {
    const problem = secretProblem(env[name]);
    if (problem) out.push({ name, problem });
  };
  need('JWT_ACCESS_SECRET');
  need('JWT_REFRESH_SECRET');
  if (env.JWT_ACCESS_SECRET && env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    out.push({ name: 'JWT_REFRESH_SECRET', problem: 'is the same as JWT_ACCESS_SECRET' });
  }
  if (env.TURN_SECRET !== undefined && env.TURN_SECRET !== '') need('TURN_SECRET');
  if (env.FABLE_KEY_SECRET) need('FABLE_KEY_SECRET');
  if (env.LINK_SECRET) need('LINK_SECRET');
  if (env.CALLS_SECRET) need('CALLS_SECRET');
  return out;
}

/** Passwords that should be changed but cannot be used from outside the PC any more. */
export function secretWarnings(env = process.env) {
  const out = [];
  const dbPassword = (() => { try { return decodeURIComponent(new URL(env.DATABASE_URL).password); } catch { return ''; } })();
  if (['loversrock', 'postgres', ''].includes(dbPassword)) out.push('the database password is the default');
  if (['loversrock123', 'minioadmin', ''].includes(String(env.STORAGE_SECRET_KEY ?? ''))) out.push('the photo storage password is the default');
  return out;
}

/** Stops the process on a weak secret, with the fix in the message. */
export function assertSecrets(env = process.env, { exit = (code) => process.exit(code), log = console.error } = {}) {
  const problems = secretProblems(env);
  for (const warning of secretWarnings(env)) {
    log(`[secrets] warning: ${warning}. Run "node docker/secure-setup.mjs" on the server PC to change it.`);
  }
  if (!problems.length) return true;
  log('[secrets] refusing to start: these secrets are not safe to run with.');
  for (const p of problems) log(`[secrets]   ${p.name} ${p.problem}`);
  log('[secrets] On the server PC, from the loversrock folder, run:');
  log('[secrets]     node docker/secure-setup.mjs');
  log('[secrets] It writes strong ones into docker/.env and backend/.env and restarts everything.');
  log('[secrets] (Everyone signs in again once; saved AI keys are kept.)');
  exit(1);
  return false;
}

/**
 * A key for one purpose only ('voice-link', 'call-decline', 'media'),
 * derived from LINK_SECRET, or JWT_ACCESS_SECRET when that is not set.
 */
export function purposeKey(purpose, env = process.env) {
  const root = env.LINK_SECRET || env.JWT_ACCESS_SECRET || '';
  return crypto.createHmac('sha256', root).update(`loversrock:${purpose}`).digest();
}

/** A random secret: 48 bytes, base64url, safe in a .env file and a URL. */
export function newSecret() {
  return crypto.randomBytes(48).toString('base64url');
}
