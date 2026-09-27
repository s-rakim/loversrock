// The mic in the middle of the nav bar.
//
// Hold to talk, let go to send — a walkie-talkie, not a recorder with a
// Send button, because the whole point is that it is as quick as shouting
// across a room. Slide up while holding to throw it away. A plain tap opens
// the list of every note the two of you have sent.
//
// A PanResponder rather than Pressable: a Pressable cancels its press the
// moment the finger drifts, which is exactly the gesture used to cancel here,
// and it cannot say how far the finger went.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing, PanResponder, Alert, Vibration } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from '../Icon';
import { useTheme } from '../ThemeContext';
import { useCall } from '../calls/CallContext';
import { sendVoiceNote, stopNative, formatDuration } from '../../services/voice';

export const MIC_SIZE = 54;
export const VOICE_FILTER_KEY = 'loversrock_voice_filter';

// Too short to be anything but a tap that lingered.
const MIN_MS = 600;
const MAX_MS = 2 * 60 * 1000;
// How long a press has to last before it counts as "hold to talk".
const HOLD_DELAY_MS = 180;
// How far up the finger slides to cancel.
const CANCEL_DY = -60;

const LIVE_CALL = new Set(['ringing-in', 'ringing-out', 'connecting', 'connected']);

// expo-av is native and only in builds from runtime 9 on. Required when first
// used rather than imported, so a missing module is an alert and not a crash
// while the bundle loads.
function audioModule() {
  try {
    return require('expo-av').Audio;
  } catch {
    return null;
  }
}

function recordingOptions(Audio) {
  const preset = Audio.RecordingOptionsPresets.HIGH_QUALITY;
  // Mono at 64 kbps: a voice, not music. Half the size of the preset, which
  // is the difference between a note that arrives now and one that arrives
  // after the moment has passed on a slow connection.
  return {
    ...preset,
    android: { ...preset.android, numberOfChannels: 1, bitRate: 64000 },
    ios: { ...preset.ios, numberOfChannels: 1, bitRate: 64000 },
  };
}

export default function VoiceMic({ onTap, style, overlayBottom = 96 }) {
  const { colors, font, reduceMotion } = useTheme();
  const styles = useMemo(() => makeStyles(colors, font), [colors, font]);
  const { call } = useCall();
  // The responder below is made once, so it reads these through refs; a
  // closure over `call` would see the call state from the first render.
  const callRef = useRef(call);
  callRef.current = call;
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;

  // idle | starting | recording | sending
  const [phase, setPhase] = useState('idle');
  const [elapsed, setElapsed] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [toast, setToast] = useState(null);

  const recordingRef = useRef(null);
  const holdTimer = useRef(null);
  const elapsedRef = useRef(0);
  const cancellingRef = useRef(false);
  // The finger can lift while the recorder is still starting up. Rather than
  // lose that, remember it and finish the moment recording has begun.
  const releasedEarly = useRef(null);
  const phaseRef = useRef('idle');
  const setPhaseBoth = (next) => { phaseRef.current = next; setPhase(next); };

  const scale = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const live = phase === 'recording';
    Animated.spring(scale, { toValue: live ? 1.14 : 1, useNativeDriver: true, stiffness: 400, damping: 18 }).start();
    if (!live || reduceMotion) { pulse.setValue(0); return undefined; }
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.out(Easing.quad), useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [phase, scale, pulse, reduceMotion]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 1600);
    return () => clearTimeout(timer);
  }, [toast]);

  // Never leave the microphone open behind an unmounted bar.
  useEffect(() => () => {
    clearTimeout(holdTimer.current);
    recordingRef.current?.stopAndUnloadAsync().catch(() => {});
  }, []);

  async function begin() {
    if (LIVE_CALL.has(callRef.current?.phase)) {
      Alert.alert('You are on a call', 'Voice messages can be sent once the call has ended.');
      return;
    }
    const Audio = audioModule();
    if (!Audio) {
      Alert.alert('Update needed', 'Voice messages need the newest version of the app. Install the latest build.');
      return;
    }
    setPhaseBoth('starting');
    releasedEarly.current = null;
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        setPhaseBoth('idle');
        Alert.alert('Microphone is off', 'Allow loversrock to use the microphone in your phone’s settings to send voice messages.');
        return;
      }
      await stopNative();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        staysActiveInBackground: false,
      });
      const { recording } = await Audio.Recording.createAsync(
        recordingOptions(Audio),
        (status) => {
          if (!status.isRecording) return;
          elapsedRef.current = status.durationMillis || 0;
          setElapsed(elapsedRef.current);
          if (elapsedRef.current >= MAX_MS) finish(true);
        },
        200
      );
      recordingRef.current = recording;
      elapsedRef.current = 0;
      setElapsed(0);
      setPhaseBoth('recording');
      Vibration.vibrate(15);

      if (releasedEarly.current !== null) finish(releasedEarly.current);
    } catch (err) {
      setPhaseBoth('idle');
      Alert.alert('Could not start recording', err.message);
    }
  }

  async function finish(send) {
    const recording = recordingRef.current;
    if (!recording) {
      // Still starting: finish as soon as it has.
      if (phaseRef.current === 'starting') releasedEarly.current = send;
      return;
    }
    recordingRef.current = null;
    setCancelling(false);
    cancellingRef.current = false;

    let uri = null;
    const durationMs = elapsedRef.current;
    try {
      await recording.stopAndUnloadAsync();
      uri = recording.getURI();
    } catch {
      /* A recording stopped almost as soon as it began can throw; treat it as too short. */
    }
    audioModule()?.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});

    if (!send || !uri) {
      setPhaseBoth('idle');
      if (send === false && durationMs > MIN_MS) setToast('Cancelled');
      return;
    }
    if (durationMs < MIN_MS) {
      setPhaseBoth('idle');
      setToast('Hold to talk');
      return;
    }

    setPhaseBoth('sending');
    try {
      const filter = await AsyncStorage.getItem(VOICE_FILTER_KEY).catch(() => null);
      await sendVoiceNote({ uri, durationMs, filter: filter && filter !== 'none' ? filter : undefined });
      setToast('Sent');
    } catch (err) {
      Alert.alert('Voice message not sent', err.message);
    } finally {
      setPhaseBoth('idle');
    }
  }

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    // Nothing else gets the finger once a recording has it — a scroll view
    // behind the bar stealing it mid-sentence would drop the note.
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      if (phaseRef.current === 'sending') return;
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null;
        begin();
      }, HOLD_DELAY_MS);
    },
    onPanResponderMove: (_, gesture) => {
      const next = gesture.dy < CANCEL_DY;
      if (next !== cancellingRef.current) {
        cancellingRef.current = next;
        setCancelling(next);
      }
    },
    onPanResponderRelease: () => {
      if (holdTimer.current) {
        clearTimeout(holdTimer.current);
        holdTimer.current = null;
        onTapRef.current?.();
        return;
      }
      finish(!cancellingRef.current);
    },
    onPanResponderTerminate: () => {
      if (holdTimer.current) {
        clearTimeout(holdTimer.current);
        holdTimer.current = null;
        return;
      }
      finish(false);
    },
  // begin/finish read refs, not state, so the responder can be made once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const live = phase === 'recording' || phase === 'starting';
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });

  return (
    <View style={[styles.root, style]} pointerEvents="box-none">
      {(live || phase === 'sending' || toast) && (
        <View pointerEvents="none" style={[styles.overlay, { bottom: overlayBottom }]}>
          {phase === 'sending' ? (
            <Text style={styles.overlayText}>Sending…</Text>
          ) : live ? (
            <>
              <View style={[styles.dot, cancelling && { backgroundColor: colors.textMuted }]} />
              <Text style={styles.timer}>{formatDuration(elapsed)}</Text>
              <Text style={styles.hint}>{cancelling ? 'Let go to cancel' : 'Slide up to cancel'}</Text>
            </>
          ) : (
            <Text style={styles.overlayText}>{toast}</Text>
          )}
        </View>
      )}

      <Animated.View
        pointerEvents="none"
        style={[styles.ring, { opacity: ringOpacity, transform: [{ scale: ringScale }] }]}
      />
      <Animated.View
        {...responder.panHandlers}
        accessibilityRole="button"
        accessibilityLabel="Voice message"
        accessibilityHint="Hold to record and let go to send. Tap to see your voice messages."
        style={[
          styles.button,
          live && !cancelling && styles.buttonLive,
          cancelling && styles.buttonCancel,
          { transform: [{ scale }] },
        ]}
      >
        <Icon
          name={cancelling ? 'close' : phase === 'sending' ? 'arrow-up' : 'mic'}
          color="#FFFFFF"
          size={26}
          chip={false}
        />
      </Animated.View>
    </View>
  );
}

const RECORD_RED = '#FF3B30';

const makeStyles = (colors, font) => StyleSheet.create({
  root: {
    width: MIC_SIZE,
    height: MIC_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: {
    width: MIC_SIZE,
    height: MIC_SIZE,
    borderRadius: MIC_SIZE / 2,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.accent,
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  buttonLive: { backgroundColor: RECORD_RED, shadowColor: RECORD_RED },
  buttonCancel: { backgroundColor: colors.textMuted, shadowOpacity: 0 },
  ring: {
    position: 'absolute',
    width: MIC_SIZE,
    height: MIC_SIZE,
    borderRadius: MIC_SIZE / 2,
    backgroundColor: RECORD_RED,
  },
  overlay: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    minWidth: 120,
    justifyContent: 'center',
  },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: RECORD_RED },
  timer: { ...font.body, fontWeight: '800', color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  hint: { ...font.muted, fontSize: 12, color: colors.textMuted },
  overlayText: { ...font.body, fontWeight: '700', color: colors.textPrimary },
});
