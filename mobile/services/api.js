import * as SecureStore from 'expo-secure-store';
import { io } from 'socket.io-client';

// Bearer tokens in expo-secure-store, never cookies — see docs/SPEC.md #1.
const ACCESS_KEY = 'loversrock_access_token';
const REFRESH_KEY = 'loversrock_refresh_token';

export const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

// eas.json ships a placeholder so the build doesn't fail before you've had a
// chance to fill in your Tailscale IP. If it was never replaced the app builds
// fine and then dies on the first request with a bare "Network request failed",
// which looks identical to the server being down. Name the real problem.
export function apiUrlProblem() {
  const host = API_URL.replace(/^https?:\/\//, '').split(':')[0];
  if (host === '100.x.x.x') {
    return `EXPO_PUBLIC_API_URL is still the placeholder (${API_URL}). Edit mobile/eas.json, replace 100.x.x.x with your server's Tailscale IP, and rebuild.`;
  }
  if (host === 'localhost' || host === '127.0.0.1') {
    return `EXPO_PUBLIC_API_URL points at ${API_URL}. On a phone that means the phone itself, not your server. Use the server's Tailscale IP.`;
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
      `Can't reach the server at ${API_URL}. Check that Tailscale is connected on both this phone and the server, and that the backend is running (curl ${API_URL}/health).`
    );
  }
}

/** Unauthenticated reachability check, for the "Test connection" button. */
export async function pingServer() {
  const res = await request(`${API_URL}/health`, { method: 'GET' });
  if (!res.ok) throw new Error(`Server answered ${res.status} at ${API_URL}/health`);
  return res.json();
}

export async function getAccessToken() {
  return SecureStore.getItemAsync(ACCESS_KEY);
}

export async function getRefreshToken() {
  return SecureStore.getItemAsync(REFRESH_KEY);
}

export async function setTokens({ accessToken, refreshToken }) {
  await SecureStore.setItemAsync(ACCESS_KEY, accessToken);
  if (refreshToken) await SecureStore.setItemAsync(REFRESH_KEY, refreshToken);
}

export async function clearTokens() {
  await SecureStore.deleteItemAsync(ACCESS_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}

async function refreshAccessToken() {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) throw new Error('No refresh token');

  const res = await request(`${API_URL}/auth/refresh`, {
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

  const res = await request(`${API_URL}${path}`, {
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
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export function mediaUrl(key) {
  return `${API_URL}/media/${key}`;
}

let socket = null;

export async function connectSocket() {
  if (socket?.connected) return socket;
  const token = await getAccessToken();
  socket = io(API_URL, { auth: { token }, transports: ['websocket'] });
  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
