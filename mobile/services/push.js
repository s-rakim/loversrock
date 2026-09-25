// Push notifications. The backend sends through Firebase Cloud Messaging, so
// the token registered here is the device's *native* push token — on Android
// that is an FCM token. Taps route to the screen named in the push's data.
//
// iOS caveat: getDevicePushTokenAsync returns an APNs token on iOS, which FCM
// won't accept directly. iOS pushes need the Firebase iOS SDK (or an APNs key
// uploaded to Firebase + token exchange) — see docs/FEATURES.md.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { apiFetch } from './api';

let handlerInstalled = false;

function installForegroundHandler() {
  if (handlerInstalled) return;
  handlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

/** Asks permission (if needed) and registers this device with the backend. */
export async function registerForPush() {
  try {
    installForegroundHandler();
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'loversrock',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    const existing = await Notifications.getPermissionsAsync();
    const status = existing.granted ? existing : await Notifications.requestPermissionsAsync();
    if (!status.granted) return { granted: false };

    const { data: token } = await Notifications.getDevicePushTokenAsync();
    await apiFetch('/auth/fcm-token', { method: 'POST', body: { fcmToken: token, platform: Platform.OS } });
    return { granted: true };
  } catch (err) {
    // Expo Go / missing google-services.json / simulator: keep the app usable.
    return { granted: false, reason: err.message };
  }
}

/** Re-registers silently on launch if permission was already given. */
export async function refreshPushRegistration() {
  try {
    const { granted } = await Notifications.getPermissionsAsync();
    if (granted) await registerForPush();
  } catch {}
}

/** Routes a tapped notification (data.screen) into the app. */
export function routeNotificationTaps(navigationRef) {
  installForegroundHandler();
  const go = (response) => {
    const screen = response?.notification?.request?.content?.data?.screen;
    if (!screen || !navigationRef.isReady()) return;
    const TAB_SCREENS = ['Home', 'Feed', 'Games', 'Messages', 'Memories', 'Settings'];
    if (TAB_SCREENS.includes(screen)) navigationRef.navigate('MainTabs', { screen });
    else navigationRef.navigate(screen);
  };
  Notifications.getLastNotificationResponseAsync().then(go).catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener(go);
  return () => sub.remove();
}
