// Limits on guessing: passwords, invite codes, sign-ups.
//
// Before this, 50 wrong passwords in a row were each checked at full speed,
// and 200 invite-code guesses took under a second. A server for two people
// needs nothing clever: counters in memory, per account where there is one
// (so a guesser cannot lock both of you out by sharing your IP), per address
// as a backstop. A restart forgets them, which is fine; the windows are
// minutes long.
//
// Per-address limits can be scaled with RATE_LIMIT_IP_SCALE (the test suites
// sign up hundreds of accounts from one address). Per-account limits cannot.

export class Limiter {
  constructor({ windowMs, max }) {
    this.windowMs = windowMs;
    this.max = max;
    this.hits = new Map();
  }

  entry(key, now = Date.now()) {
    let e = this.hits.get(key);
    if (!e || now - e.start >= this.windowMs) {
      e = { start: now, count: 0 };
      this.hits.set(key, e);
    }
    if (this.hits.size > 10_000) this.sweep(now);
    return e;
  }

  /** Seconds until `key` may try again, or 0 when it may now. */
  blockedFor(key, now = Date.now()) {
    const e = this.entry(key, now);
    return e.count >= this.max ? Math.ceil((e.start + this.windowMs - now) / 1000) : 0;
  }

  hit(key, now = Date.now()) {
    this.entry(key, now).count += 1;
  }

  reset(key) {
    this.hits.delete(key);
  }

  sweep(now = Date.now()) {
    for (const [k, e] of this.hits) if (now - e.start >= this.windowMs) this.hits.delete(k);
  }
}

export const ipScale = () => Math.max(1, Number(process.env.RATE_LIMIT_IP_SCALE) || 1);

/** The caller's address, as Express sees it. */
export const clientIp = (req) => req.ip || req.socket?.remoteAddress || 'unknown';

/** 429 with Retry-After, in words. */
export function tooMany(res, seconds, what) {
  res.setHeader('Retry-After', String(seconds));
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return res.status(429).json({
    error: `Too many ${what}. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    retryAfter: seconds,
  });
}

/**
 * Middleware counting every request from one address; for endpoints where
 * each call is cheap to make and the only reason to make many is guessing.
 */
export function perIp({ windowMs, max, what }) {
  const limiter = new Limiter({ windowMs, max });
  return (req, res, next) => {
    limiter.max = max * ipScale();
    const key = clientIp(req);
    const wait = limiter.blockedFor(key);
    if (wait) return tooMany(res, wait, what);
    limiter.hit(key);
    next();
  };
}
