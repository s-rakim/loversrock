// App updates: the JavaScript sent with `npm run ship` (expo-updates), for
// the Settings button and Diagnostics.
//
// The app already picks updates up by itself — it checks on every launch and
// switches on the launch after — but that can take two restarts to notice.
// The button does it now: check, download, and restart straight into the new
// version.
//
// What it cannot do is install a new APK. Native changes (a new widget, the
// call ringer) ship as an APK and are never sent this way; the ship script
// refuses to publish those, so there is simply no update to find.
let Updates = null;
try {
  // Required rather than imported: a build without the native module must
  // still open, and simply has no updates to offer.
  // eslint-disable-next-line global-require
  Updates = require('expo-updates');
} catch {
  Updates = null;
}

/** Whether this build can receive updates at all. */
export function updatesAvailable() {
  return Boolean(Updates && (Updates.isEnabled !== false) && (Updates.channel || Updates.runtimeVersion));
}

/** Which code is running, in words, for Settings and Diagnostics. */
export function currentVersion() {
  if (!updatesAvailable()) return { label: 'Updates are not built into this version', runtime: null };
  const runtime = Updates.runtimeVersion || '?';
  if (Updates.isEmbeddedLaunch || !Updates.updateId) {
    return { label: `The version that came with the app · build ${runtime}`, runtime, channel: Updates.channel };
  }
  const when = Updates.createdAt ? new Date(Updates.createdAt) : null;
  return {
    label: `Updated${when ? ` ${when.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : ''} · build ${runtime}`,
    runtime,
    channel: Updates.channel,
  };
}

/**
 * Checks for an update, downloads it and restarts the app into it.
 * `onStatus(text)` hears each step. Resolves to 'current' when there is
 * nothing new, 'unsupported' on a build that cannot update; on success the
 * app restarts and it never resolves.
 */
export async function checkAndUpdate(onStatus = () => {}) {
  if (!updatesAvailable()) {
    onStatus('This version cannot update itself. Install the newest APK once, and it will from then on.');
    return 'unsupported';
  }
  if (__DEV__) {
    onStatus('Updates are off while developing.');
    return 'unsupported';
  }
  onStatus('Checking…');
  const found = await Updates.checkForUpdateAsync();
  if (!found.isAvailable) {
    onStatus('You have the latest version.');
    return 'current';
  }
  onStatus('Downloading the update…');
  const fetched = await Updates.fetchUpdateAsync();
  if (fetched && fetched.isNew === false) {
    onStatus('You have the latest version.');
    return 'current';
  }
  onStatus('Installing — the app will restart…');
  // A moment for that line to be seen before the screen goes.
  await new Promise((resolve) => setTimeout(resolve, 600));
  await Updates.reloadAsync();
  return 'updated';
}

/** The error from a failed check, in words. */
export function explainUpdateError(err) {
  const text = String(err?.message || err || '');
  if (/network|fetch|timeout|internet|offline/i.test(text)) {
    return 'Could not reach the update server. Check the phone is online and try again.';
  }
  return `Could not update: ${text || 'unknown error'}`;
}
