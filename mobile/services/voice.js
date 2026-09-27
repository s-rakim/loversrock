import { NativeModules, Platform } from 'react-native';
import naclUtil from 'tweetnacl-util';
import { apiFetch, getAccessToken, getApiUrl } from './api';

/**
 * Voice notes, client side.
 *
 * Recording happens in components/voice/VoiceMic.js; this is everything
 * around it: sending, listing, and the native service that plays an arriving
 * note out loud with the app closed (mobile/native/android/voice/).
 *
 * That service is Android-only and only in builds from runtime 9 on, so every
 * call to it is guarded: on an iPhone, or an older APK, `native` is null and
 * the app plays notes itself while it is open.
 */

// Looked up when used, not when this file loads: it is imported by the nav
// bar, which loads with everything else, and a module-scope read of a native
// module is exactly the kind of thing that fails before React has started.
export function getNative() {
  try {
    return Platform?.OS === 'android' ? NativeModules?.VoiceNotes || null : null;
  } catch {
    return null;
  }
}

/** The whole API address plus a signed path from the server. */
export function audioUrl(path) {
  return `${getApiUrl()}${path}`;
}

/** Reads a recording off disk as base64. expo-file-system is required lazily: see sendVoiceNote. */
async function readBase64(uri) {
  const FileSystem = require('expo-file-system');
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

/**
 * Uploads a finished recording. Both platforms record AAC in an MPEG-4
 * container (.m4a), which the server stores as audio/mp4.
 */
export async function sendVoiceNote({ uri, durationMs, filter }) {
  const audio = await readBase64(uri);
  return apiFetch('/voice', {
    method: 'POST',
    body: { audio, mimeType: 'audio/mp4', durationMs: Math.round(durationMs || 0), ...(filter ? { filter } : {}) },
  });
}

export async function listVoiceNotes() {
  return (await apiFetch('/voice')).voiceMessages;
}

export async function deleteVoiceNote(id) {
  return apiFetch(`/voice/${id}`, { method: 'DELETE' });
}

/**
 * Who this phone is signed in as, from the access token's `sub`.
 *
 * A voice:new event goes to both phones in the pair; only the one it was sent
 * TO should play it. The token already says who that is, so there is no need
 * for a round trip to find out.
 */
export async function myUserId() {
  try {
    const token = await getAccessToken();
    const part = token?.split('.')[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(naclUtil.encodeUTF8(naclUtil.decodeBase64(padded))).sub || null;
  } catch {
    return null;
  }
}

/** Tells the native service where the server is, for pushes that arrive with the app closed. */
export async function configureNative() {
  const native = getNative();
  if (!native) return;
  try {
    await native.setApiUrl(getApiUrl());
  } catch {
    /* An older build without the method; the push carries a fallback URL. */
  }
}

export const DEFAULT_VOICE_SETTINGS = { autoPlay: true, whenSilent: false };

export async function getVoiceSettings() {
  const native = getNative();
  if (!native) return null;
  try {
    return { ...DEFAULT_VOICE_SETTINGS, ...JSON.parse(await native.getSettings()) };
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}

export async function setVoiceSettings({ autoPlay, whenSilent }) {
  const native = getNative();
  if (!native) return;
  await native.setSettings(Boolean(autoPlay), Boolean(whenSilent));
}

/** Hands a note the open app heard about to the native player. Plays once, whichever path arrives first. */
export async function receiveNatively({ id, path, from }) {
  const native = getNative();
  if (!native) return false;
  try {
    await native.receive(id, audioUrl(path), from || 'Your partner');
    return true;
  } catch {
    return false;
  }
}

/** Stops native playback, before the app plays something itself. */
export async function stopNative() {
  const native = getNative();
  if (!native) return;
  try {
    await native.stop();
  } catch {
    /* Nothing was playing. */
  }
}

/** 0:07, 1:23 */
export function formatDuration(ms) {
  const total = Math.max(0, Math.round((ms || 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
