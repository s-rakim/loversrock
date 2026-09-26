import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io } from 'socket.io-client';

// Bearer tokens in expo-secure-store, never cookies — see docs/SPEC.md #1.
const ACCESS_KEY = 'loversrock_access_token';
const REFRESH_KEY = 'loversrock_refresh_token';
const SERVER_URL_KEY = 'loversrock_server_url';

// EXPO_PUBLIC_* is inlined at build time, so the value baked into the binary is
// only ever a starting point: getting it wrong used to mean a fresh EAS build
// per guess. The address the app actually uses is whatever was last saved from
// Settings (or the login screen), falling back to the build-time value.
const BUILD_TIME_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';
let currentUrl = BUILD_TIME_URL;

export function getApiUrl() {
  return currentUrl;
}

export function getBuildTimeApiUrl() {
  return BUILD_TIME_URL;
}

/**
 * Accepts what someone would actually type — "100.101.102.103",
 * "100.101.102.103:4000", "http://host:4000/" — and returns a usable origin.
 * Returns null if there is no host at all.
 */
export function normalizeApiUrl(input) {
  const value = String(input || '').trim();
  if (!value) return null;

  const withScheme = /^https?:\/\//i.test(value) ? value : `http://${value}`;

  // Only the origin matters; any path, query or trailing slash is dropped
  // because every call site appends its own path.
  const match = /^(https?:\/\/)([^/?#]+)/i.exec(withScheme);
  if (!match) return null;

  const scheme = match[1].toLowerCase();
  let host = match[2];

  // Bare host with no port: the backend's default is 4000, and forgetting it
  // is the most common way to end up pointed at nothing.
  if (!/:\d+$/.test(host)) host = `${host}:4000`;

  return `${scheme}${host}`;
}

/** Restores the saved server URL. Call once at startup, before any request. */
export async function loadApiUrl() {
  try {
    const saved = await AsyncStorage.getItem(SERVER_URL_KEY);
    if (saved) currentUrl = saved;
  } catch {
    // A storage failure just means we fall back to the build-time value.
  }
  return currentUrl;
}

/** Saves a new server URL and drops any socket bound to the old one. */
export async function setApiUrl(input) {
  const normalized = normalizeApiUrl(input);
  if (!normalized) throw new Error('Enter your server address, e.g. 100.101.102.103:4000');

  currentUrl = normalized;
  await AsyncStorage.setItem(SERVER_URL_KEY, normalized);
  disconnectSocket();
  return normalized;
}

/** Reverts to the address baked in at build time. */
export async function resetApiUrl() {
  currentUrl = BUILD_TIME_URL;
  await AsyncStorage.removeItem(SERVER_URL_KEY);
  disconnectSocket();
  return currentUrl;
}

// eas.json ships a placeholder so the build doesn't fail before you've had a
// chance to fill in your Tailscale IP. If it was never replaced the app builds
// fine and then dies on the first request with a bare "Network request failed",
// which looks identical to the server being down. Name the real problem.
export function apiUrlProblem() {
  const host = currentUrl.replace(/^https?:\/\//, '').split(':')[0];
  if (host === '100.x.x.x' || host === '0.0.0.0') {
    return `The server address is still the placeholder (${currentUrl}). Set it to your server's Tailscale IP under Settings → Server, or tap the address on the login screen — no rebuild needed.`;
  }
  if (host === 'localhost' || host === '127.0.0.1') {
    return `The server address is ${currentUrl}. On a phone that means the phone itself, not your server. Set it to your server's Tailscale IP under Settings → Server.`;
  }
  return null;
}

// Wraps fetch so a transport failure says what could not be reached. RN throws
// a bare TypeError("Network request failed") for DNS failures, refused
// connections, ATS/cleartext blocks and timeouts alike.
async function request(url, options) {
  const problem = apiUrlProblem();
  if (problem) throw new Error(problem);

  try {
    return await fetch(url, options);
  } catch (err) {
    throw new Error(
      `Can't reach the server at ${currentUrl}. Check that Tailscale is connected on both this phone and the server, and that the backend is running (curl ${currentUrl}/health). If the address itself is wrong, change it under Settings → Server — you don't need a new build.`
    );
  }
}

/** Unauthenticated reachability check, for the "Test connection" button. */
export async function pingServer() {
  const res = await request(`${currentUrl}/health`, { method: 'GET' });
  if (!res.ok) throw new Error(`Server answered ${res.status} at ${currentUrl}/health`);
  return res.json();
}

// Kept in memory as well as in the keychain. mediaUrl() has to be able to
// build a URL synchronously, in render, and SecureStore is async — so the
// live token is mirrored here every time it is read or written.
let cachedAccessToken = null;

export async function getAccessToken() {
  if (cachedAccessToken) return cachedAccessToken;
  cachedAccessToken = await SecureStore.getItemAsync(ACCESS_KEY);
  return cachedAccessToken;
}


export async function getRefreshToken() {
  return SecureStore.getItemAsync(REFRESH_KEY);
}

export async function setTokens({ accessToken, refreshToken }) {
  cachedAccessToken = accessToken;
  await SecureStore.setItemAsync(ACCESS_KEY, accessToken);
  if (refreshToken) await SecureStore.setItemAsync(REFRESH_KEY, refreshToken);
}

export async function clearTokens() {
  cachedAccessToken = null;
  await SecureStore.deleteItemAsync(ACCESS_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}

async function refreshAccessToken() {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) throw new Error('No refresh token');

  const res = await request(`${currentUrl}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) throw new Error('Refresh failed');

  const tokens = await res.json();
  await setTokens(tokens);
  return tokens.accessToken;
}

// Thin fetch wrapper: attaches the bearer token, retries once on 401 after
// rotating both tokens via /auth/refresh.
export async function apiFetch(path, { method = 'GET', body, isRetry = false } = {}) {
  const token = await getAccessToken();

  const res = await request(`${currentUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && !isRetry) {
    try {
      await refreshAccessToken();
      return apiFetch(path, { method, body, isRetry: true });
    } catch {
      await clearTokens();
      throw new Error('Session expired');
    }
  }

  if (res.status === 204) return null;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // Keep the status and the parsed body on the error. Several endpoints
    // answer a rejection with something the caller needs - a 409 from a game
    // move carries the current board - and re-fetching to get it back is
    // both slower and racier than reading what was already sent.
    const error = new Error(data?.error || `Request failed (${res.status})`);
    error.status = res.status;
    error.body = data;
    throw error;
  }
  return data;
}

/**
 * The exact refusal the requirePair middleware sends.
 *
 * Kept as a constant so the two sides cannot drift apart silently: test/nav
 * reads this string and the backend's, and fails if they stop matching.
 */
export const UNPAIRED_ERROR = 'Not currently paired';

/**
 * Whether a request failed only because there is nobody on the other end yet.
 *
 * This is not an error in the sense a person means it. Half of this app is
 * about two people, so before pairing most endpoints answer 403 — and every
 * screen that treated that as a failure threw a modal dialog saying
 * "Error / Not currently paired" over a perfectly fine screen. The answer to
 * it is a button, not an apology.
 *
 * Matched on the message as well as the status, because 403 also covers "not
 * your call" and "not your date idea", which ARE errors.
 */
export function isUnpaired(error) {
  return error?.status === 403 && error?.message === UNPAIRED_ERROR;
}

/**
 * A URL an <Image> can actually load.
 *
 * /media is authenticated, and the native image loaders send no headers —
 * so the token rides in the query string, the same way the widget's does.
 * Without it every photo in the app came back 401 and rendered as a blank
 * box: messages, memories, the widget preview and photo wallpapers alike.
 */
export function mediaUrl(key) {
  if (!key) return null;
  const base = `${currentUrl}/media/${key}`;
  return cachedAccessToken ? `${base}?token=${encodeURIComponent(cachedAccessToken)}` : base;
}

// ---------------------------------------------------------------- socket
//
// The socket is how the other phone finds out about anything in real time:
// a message arriving, a game move, a thumb kiss, and — critically — the WebRTC
// handshake that makes a call connect at all.
//
// It used to be built like this:
//
//     socket = io(url, { auth: { token }, transports: ['websocket'] });
//
// which reads fine and is broken in a way that only shows up after fifteen
// minutes. The access token lives 15m. `auth` captured ONE token, at the
// moment of the first connect. And a socket.io middleware rejection is not a
// retryable error: the server calls next(new Error('Unauthorized')), the
// client fires a single connect_error, sets socket.active = false, and gives
// up permanently. No reconnect, no retry, nothing logged, nothing shown.
//
// So on any app launch more than fifteen minutes after the last one — which
// is to say nearly all of them — the socket connected once, was rejected, and
// stayed dead for the entire session. Messages still sent (that is a POST)
// but the partner never saw them arrive, and a call emitted its SDP offer
// into a closed socket and sat on "Calling…" forever.
//
// Three things fix it: `auth` as a CALLBACK, so every attempt fetches a live
// token; an explicit reconnect on middleware rejection, because socket.io
// will not do it; and a state anyone can subscribe to, so a dead socket is
// visible instead of silent.

let socket = null;
let socketState = 'idle';   // idle | connecting | connected | disconnected | unauthorized
const socketWatchers = new Set();
let reconnectTimer = null;
let reconnectDelay = 500;

function setSocketState(next) {
  if (socketState === next) return;
  socketState = next;
  socketWatchers.forEach((fn) => { try { fn(next); } catch { /* a bad watcher is not the socket's problem */ } });
}

export function getSocketState() {
  return socketState;
}

/** Subscribe to connection state. Returns an unsubscribe function. */
export function onSocketState(fn) {
  socketWatchers.add(fn);
  fn(socketState);
  return () => socketWatchers.delete(fn);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Enough base64url to read a JWT payload.
 *
 * Hand-rolled because Hermes has no Buffer, and atob is not something to
 * count on across every RN version this might run under. Only the ASCII a
 * JWT payload actually contains needs to survive.
 */
function decodeBase64Url(input) {
  const padded = String(input).replace(/-/g, '+').replace(/_/g, '/');
  let out = '';
  let bits = 0;
  let value = 0;

  for (const char of padded) {
    if (char === '=') break;
    const index = B64.indexOf(char);
    if (index === -1) continue;
    value = (value << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((value >> bits) & 0xff);
    }
  }
  return out;
}

/** The `exp` claim, in ms, without verifying — the server still verifies. */
function expiryOf(token) {
  try {
    const [, payload] = String(token).split('.');
    if (!payload) return null;
    const json = JSON.parse(decodeBase64Url(payload));
    return json.exp ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * A token with at least a minute of life left, refreshing it if not.
 *
 * The handshake is rejected outright for an expired token, and unlike an HTTP
 * 401 there is no retry-after-refresh to fall back on — so it is checked
 * before the attempt rather than after the failure.
 */
async function freshAccessToken() {
  const token = await getAccessToken();
  if (!token) return null;

  const exp = expiryOf(token);
  if (exp && exp - Date.now() > 60 * 1000) return token;

  try {
    return await refreshAccessToken();
  } catch {
    return token;   // let the server be the judge
  }
}

function scheduleReconnect() {
  if (reconnectTimer || !socket) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!socket || socket.connected) return;
    setSocketState('connecting');
    socket.connect();
  }, reconnectDelay);
  // Backs off to 10s. A phone with no signal should not spin.
  reconnectDelay = Math.min(reconnectDelay * 2, 10000);
}

export async function connectSocket() {
  // `active` means socket.io is connected or still trying. Rebuilding one in
  // that state leaks the old instance and doubles every listener.
  if (socket && (socket.connected || socket.active)) return socket;
  if (socket) { socket.close(); socket = null; }

  setSocketState('connecting');

  socket = io(currentUrl, {
    // A callback, NOT a value. socket.io invokes this before every attempt,
    // including reconnects, so a socket that comes back after the phone has
    // been asleep authenticates with a live token instead of a dead one.
    auth: (cb) => {
      freshAccessToken().then((token) => cb({ token })).catch(() => cb({}));
    },
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    timeout: 10000,
  });

  socket.on('connect', () => {
    reconnectDelay = 500;
    setSocketState('connected');
  });

  socket.on('disconnect', (reason) => {
    setSocketState('disconnected');
    // 'io server disconnect' means the server hung up deliberately and
    // socket.io will not reconnect on its own.
    if (reason === 'io server disconnect') scheduleReconnect();
  });

  socket.on('connect_error', () => {
    // socket.active distinguishes the two failure modes. True: an ordinary
    // transport problem, and socket.io is already retrying. False: the
    // handshake middleware rejected us and socket.io has given up for good —
    // which is the case that was silently killing calls.
    if (socket?.active) {
      setSocketState('connecting');
      return;
    }
    setSocketState('unauthorized');
    scheduleReconnect();   // with a freshly-fetched token, via the auth callback
  });

  return socket;
}

/**
 * Resolves once the socket is actually usable, or rejects.
 *
 * Anything that is worthless if it silently fails to send — a call offer,
 * above all — should wait on this rather than emitting into the void.
 */
export async function waitForSocket(timeoutMs = 8000) {
  const live = await connectSocket();
  if (live.connected) return live;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stop();
      reject(new Error(
        `Can't reach the server at ${currentUrl} for live updates. Check that Tailscale is connected on both phones and that the backend is running.`
      ));
    }, timeoutMs);

    const stop = onSocketState((state) => {
      if (state === 'connected') {
        clearTimeout(timer);
        stop();
        resolve(live);
      }
    });
  });
}

/**
 * Subscribe to a socket event for as long as a screen is mounted.
 *
 * Returns an unsubscribe function, and that is the entire point of it. The
 * pattern everywhere else in this app is
 *
 *     connectSocket().then((s) => s.on('bucket:update', handler));
 *     return () => getSocket()?.off('bucket:update');
 *
 * and `off(name)` with no handler removes EVERY listener for that event, not
 * just this screen's. Two screens listening to the same event — the gallery
 * and the canvas both want `canvas:saved` — silently unhook each other on the
 * first unmount, and the surviving screen quietly stops updating. Passing the
 * handler back to `off` is the fix.
 *
 * It also handles the case where the socket has not finished connecting when
 * the screen mounts, which is the common case on a cold start: the handler is
 * attached when the connection lands, unless the screen went away first.
 */
export function onSocketEvent(event, handler) {
  let live = null;
  let cancelled = false;

  connectSocket().then((s) => {
    if (cancelled) return;
    live = s;
    s.on(event, handler);
  }).catch(() => {});

  return () => {
    cancelled = true;
    live?.off(event, handler);
  };
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  reconnectDelay = 500;
  socket?.disconnect();
  socket = null;
  setSocketState('idle');
}
