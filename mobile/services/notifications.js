import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { apiFetch } from './api';

/**
 * Notifications, client side.
 *
 * The server pushes through FCM (backend/src/config/firebase.js) and this
 * registers the device's FCM token with it. expo-notifications is used for the
 * device token, permissions, Android channels, local scheduling and tap
 * handling — not Expo's push *service*, which would be a second, parallel
 * token system alongside the FCM one the backend already speaks.
 */

const PERMISSION_ASKED_KEY = 'loversrock_push_asked';
const REMINDERS_KEY = 'loversrock_reminders';

/**
 * Android requires a channel before anything can be shown, and the channel —
 * not the message — decides importance. Calls need their own at MAX so a ring
 * can interrupt; reminders sit lower so they don't.
 */
export const CHANNELS = {
  reminders: {
    name: 'Reminders',
    description: 'Cycle predictions, daily logging and water reminders',
    importance: Notifications.AndroidImportance.DEFAULT,
  },
  partner: {
    name: 'Partner',
    description: 'Prompts, quizzes and updates from your partner',
    importance: Notifications.AndroidImportance.HIGH,
  },
  games: {
    name: 'Games',
    description: 'Game invites and turn notifications',
    importance: Notifications.AndroidImportance.HIGH,
  },
  calls: {
    name: 'Calls',
    description: 'Incoming audio and video calls',
    importance: Notifications.AndroidImportance.MAX,
  },
};

/** Default reminder settings; each one is individually switchable. */
export const DEFAULT_REMINDERS = {
  periodSoon: true,
  fertilityStart: true,
  ovulationDay: true,
  dailyLog: false,
  water: false,
  dailyLogHour: 20,
  waterEveryHours: 3,
};

// Foreground behaviour: show the banner rather than swallowing it. A quiz or a
// game turn arriving while the app is open is still worth surfacing.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function ensureChannels() {
  if (Platform.OS !== 'android') return;
  await Promise.all(
    Object.entries(CHANNELS).map(([id, channel]) =>
      Notifications.setNotificationChannelAsync(id, {
        name: channel.name,
        description: channel.description,
        importance: channel.importance,
        vibrationPattern: id === 'calls' ? [0, 500, 250, 500] : [0, 250],
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      })
    )
  );
}

/** True once the app has asked — used to ask after onboarding, not at launch. */
export async function hasAskedPermission() {
  return (await AsyncStorage.getItem(PERMISSION_ASKED_KEY)) === 'yes';
}

/**
 * Asks for permission and registers the device token with the backend.
 * Safe to call more than once; returns why it stopped rather than throwing,
 * because a declined permission is a normal outcome, not an error.
 */
export async function registerForPush() {
  await AsyncStorage.setItem(PERMISSION_ASKED_KEY, 'yes');
  await ensureChannels();

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') return { registered: false, reason: 'permission-denied' };

  let token;
  try {
    // The FCM (or APNs) token, not an Expo push token — the backend talks to
    // FCM directly through firebase-admin.
    token = (await Notifications.getDevicePushTokenAsync()).data;
  } catch (err) {
    return { registered: false, reason: `token-unavailable: ${err.message}` };
  }
  if (!token) return { registered: false, reason: 'token-empty' };

  try {
    await apiFetch('/auth/fcm-token', {
      method: 'POST',
      body: { fcmToken: token, platform: Platform.OS },
    });
  } catch (err) {
    return { registered: false, reason: `server: ${err.message}` };
  }

  return { registered: true, token };
}

/**
 * Where a notification should land when tapped. The server sets `screen` (and
 * optionally `params`) in the data payload; anything unknown falls through to
 * the home screen rather than crashing the navigator.
 */
export const SCREEN_FOR_TYPE = {
  prompt: 'DailyPrompt',
  quiz: 'Quiz',
  partner_update: 'Home',
  game_invite: 'Games',
  game_turn: 'Games',
  call: 'Home',
  period_reminder: 'PeriodTracker',
  water: 'PeriodTracker',
  memory: 'Memories',
  message: 'Messages',
};

export function routeForNotification(response) {
  const data = response?.notification?.request?.content?.data || {};
  const screen = data.screen || SCREEN_FOR_TYPE[data.type];
  if (!screen) return null;
  return { screen, params: data.params ? safeParse(data.params) : undefined };
}

function safeParse(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export async function getReminderSettings() {
  try {
    const raw = await AsyncStorage.getItem(REMINDERS_KEY);
    return raw ? { ...DEFAULT_REMINDERS, ...JSON.parse(raw) } : { ...DEFAULT_REMINDERS };
  } catch {
    return { ...DEFAULT_REMINDERS };
  }
}

export async function setReminderSettings(next) {
  const merged = { ...DEFAULT_REMINDERS, ...next };
  await AsyncStorage.setItem(REMINDERS_KEY, JSON.stringify(merged));
  await rescheduleLocalReminders(merged);
  return merged;
}

/**
 * Rebuilds every local reminder from scratch.
 *
 * Cancelling first is deliberate: scheduled notifications survive app restarts,
 * so incrementally adding would slowly accumulate duplicates every launch.
 */
export async function rescheduleLocalReminders(settings, predictions = null) {
  await Notifications.cancelAllScheduledNotificationsAsync();
  const scheduled = [];

  const schedule = async (content, trigger) => {
    const id = await Notifications.scheduleNotificationAsync({
      content: { ...content, data: { ...(content.data || {}) }, channelId: 'reminders' },
      trigger,
    });
    scheduled.push(id);
  };

  if (settings.dailyLog) {
    await schedule(
      { title: 'How was today?', body: 'Log how you felt.', data: { type: 'period_reminder' } },
      { hour: settings.dailyLogHour, minute: 0, repeats: true }
    );
  }

  if (settings.water) {
    // A repeating interval rather than fixed clock times, so it follows the
    // person's day instead of firing while they sleep.
    await schedule(
      { title: 'Drink some water', body: 'A glass gets you closer to 2000 ml.', data: { type: 'water' } },
      { seconds: settings.waterEveryHours * 3600, repeats: true }
    );
  }

  // Cycle reminders need dates, which only exist once enough has been logged.
  if (predictions) {
    const at = (iso, hour = 9) => {
      const date = new Date(`${iso}T00:00:00`);
      date.setHours(hour, 0, 0, 0);
      return date;
    };
    const future = (date) => date.getTime() > Date.now();

    if (settings.periodSoon && predictions.nextPeriodDate) {
      const when = at(predictions.nextPeriodDate);
      when.setDate(when.getDate() - 2);
      if (future(when)) {
        await schedule(
          { title: 'Period due soon', body: 'Expected in about two days.', data: { type: 'period_reminder' } },
          when
        );
      }
    }
    if (settings.fertilityStart && predictions.fertileWindowStart) {
      const when = at(predictions.fertileWindowStart);
      if (future(when)) {
        await schedule(
          { title: 'Fertile window starts today', body: null, data: { type: 'period_reminder' } },
          when
        );
      }
    }
    if (settings.ovulationDay && predictions.ovulationDate) {
      const when = at(predictions.ovulationDate);
      if (future(when)) {
        await schedule(
          { title: 'Ovulation day', body: 'Today is your predicted ovulation day.', data: { type: 'period_reminder' } },
          when
        );
      }
    }
  }

  return scheduled;
}
