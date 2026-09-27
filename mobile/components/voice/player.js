// One voice note playing at a time, inside the app.
//
// The list screen plays through this, and so does the open app on a phone
// with no native player (an iPhone, or an APK from before voice notes). A
// module rather than a hook, so starting a note anywhere stops the one
// playing anywhere else — two voices at once is never what anybody meant.
import { stopNative } from '../../services/voice';

let current = null; // { sound, id, onStatus }

function audioModule() {
  try {
    return require('expo-av').Audio;
  } catch {
    return null;
  }
}

export async function stopPlayback() {
  const playing = current;
  current = null;
  if (!playing) return;
  playing.onStatus?.({ id: playing.id, playing: false, positionMs: 0, done: false });
  try {
    await playing.sound.unloadAsync();
  } catch {
    /* Already unloaded. */
  }
}

/**
 * Plays `url`. `onStatus` hears { id, playing, positionMs, durationMs, done }.
 * Returns false if this build cannot play audio at all.
 */
export async function playNote({ id, url, onStatus }) {
  const Audio = audioModule();
  if (!Audio) return false;

  await stopPlayback();
  await stopNative();
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    shouldDuckAndroid: true,
    staysActiveInBackground: false,
  }).catch(() => {});

  const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: true, progressUpdateIntervalMillis: 150 });
  const entry = { sound, id, onStatus };
  current = entry;

  sound.setOnPlaybackStatusUpdate((status) => {
    if (current !== entry) return;
    if (!status.isLoaded) {
      if (status.error) onStatus?.({ id, playing: false, positionMs: 0, done: false, error: status.error });
      return;
    }
    const done = Boolean(status.didJustFinish);
    onStatus?.({
      id,
      playing: status.isPlaying && !done,
      positionMs: done ? 0 : status.positionMillis || 0,
      durationMs: status.durationMillis || 0,
      done,
    });
    if (done) {
      current = null;
      sound.unloadAsync().catch(() => {});
    }
  });
  return true;
}

export function playingId() {
  return current?.id || null;
}
