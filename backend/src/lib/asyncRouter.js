import { Router } from 'express';

const ROUTER_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all', 'use'];

// Express 4 does not forward a rejected promise from an async handler to the
// error middleware — it surfaces as an unhandled rejection, which Node kills
// the process over. Every handler in this app is async, so a single bad
// request body (or a momentary Postgres/storage hiccup) would otherwise take
// the whole server down for both partners.
export function wrapAsync(fn) {
  if (typeof fn !== 'function') return fn;

  // Error-handling middleware is identified by arity 4; preserve it.
  if (fn.length === 4) {
    return function wrappedErrorHandler(err, req, res, next) {
      return Promise.resolve(fn(err, req, res, next)).catch(next);
    };
  }

  return function wrappedHandler(req, res, next) {
    return Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Drop-in replacement for express.Router() that auto-wraps every handler at
// registration time, so new routes are protected by default rather than
// relying on each author remembering to catch.
export function asyncRouter() {
  const router = Router();

  for (const method of ROUTER_METHODS) {
    const original = router[method].bind(router);
    router[method] = (...args) => original(...args.map((arg) => (Array.isArray(arg) ? arg.map(wrapAsync) : wrapAsync(arg))));
  }

  return router;
}
