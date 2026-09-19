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

let socket = null;

export async function connectSocket() {
  if (socket?.connected) return socket;
  const token = await getAccessToken();
  socket = io(currentUrl, { auth: { token }, transports: ['websocket'] });
  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
