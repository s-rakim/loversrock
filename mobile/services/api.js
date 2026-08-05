import * as SecureStore from "expo-secure-store";

const API_URL = process.env.EXPO_PUBLIC_API_URL;

async function getTokens() {
  const accessToken = await SecureStore.getItemAsync("accessToken");
  const refreshToken = await SecureStore.getItemAsync("refreshToken");
  return { accessToken, refreshToken };
}

async function setTokens(accessToken, refreshToken) {
  await SecureStore.setItemAsync("accessToken", accessToken);
  await SecureStore.setItemAsync("refreshToken", refreshToken);
}

// Bearer-token auth (not cookies — see backend/src/middleware/auth.js for why).
// Automatically retries once with a refreshed access token on a 401.
async function request(path, options = {}, isRetry = false) {
  const { accessToken } = await getTokens();

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401 && !isRetry) {
    const refreshed = await tryRefresh();
    if (refreshed) return request(path, options, true);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

async function tryRefresh() {
  const { refreshToken } = await getTokens();
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    await setTokens(data.accessToken, data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

export const api = {
  signup: (name, email, password) =>
    request("/auth/signup", { method: "POST", body: JSON.stringify({ name, email, password }) })
      .then(async (data) => { await setTokens(data.accessToken, data.refreshToken); return data; }),

  login: (email, password) =>
    request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) })
      .then(async (data) => { await setTokens(data.accessToken, data.refreshToken); return data; }),

  createInvite: (timezone) =>
    request("/auth/invite", { method: "POST", body: JSON.stringify({ timezone }) }),

  acceptInvite: (code) =>
    request("/auth/invite/accept", { method: "POST", body: JSON.stringify({ code }) }),

  getTodayPrompt: () => request("/daily-prompt/today"),

  respondToPrompt: (answerText) =>
    request("/daily-prompt/today/respond", { method: "POST", body: JSON.stringify({ answerText }) }),
};
