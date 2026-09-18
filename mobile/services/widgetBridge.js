import { NativeModules, Platform } from 'react-native';
import { apiFetch, API_URL } from './api';

// The native module only exists in a dev-client/EAS build that ran
// `expo prebuild` with the widget config plugins. In Expo Go it is simply
// absent, so every call here degrades to a no-op rather than throwing — the
// app must stay fully usable without widgets.
const native = NativeModules.WidgetBridge || null;

export const widgetsSupported = native !== null;

// Android phones have no lock screen widget API (removed in Android 5.0,
// tablet-only since Android 15). There we fall back to an ongoing
// notification; iOS gets real WidgetKit lock screen widgets.
export const lockScreenStyle = Platform.OS === 'ios' ? 'widget' : 'notification';

/**
 * Issues a fresh scoped widget token and hands it to the native side. Safe to
 * call on every login — old tokens stay listed and individually revocable.
 */
export async function provisionWidgets() {
  if (!native) return { provisioned: false, reason: 'Widgets need a dev-client build' };

  try {
    const { widgetToken } = await apiFetch('/widget/token', {
      method: 'POST',
      body: { label: `${Platform.OS} device` },
    });
    await native.setCredentials(API_URL, widgetToken);
    return { provisioned: true };
  } catch (err) {
    return { provisioned: false, reason: err.message };
  }
}

/** Called on logout/unlink so a widget can't keep showing the old couple's data. */
export async function clearWidgets() {
  if (!native) return;
  try {
    await native.clearCredentials();
  } catch {
    // Nothing actionable — the widget will fail its next fetch and blank out.
  }
}

export async function refreshWidgets() {
  if (!native) return;
  try {
    await native.refresh();
  } catch {}
}

export async function setLockScreenEnabled(enabled) {
  if (!native) return;
  try {
    await native.setLockScreenEnabled(enabled);
  } catch {}
}
