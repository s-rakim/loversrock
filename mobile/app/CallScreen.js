// The in-call screen, laid out like WhatsApp's.
//
//   [minimise]        Name           [chat]
//                    02:06:58
//
//              (their picture, or their video)
//                                   ┌───────┐
//                                   │  you  │  ← your camera, draggable
//                                   └───────┘
//   ( •••   camera   sound   mute   end )       ← one pill of controls
//
// Your chat wallpaper behind it, darkened. Tap the screen and the top bar
// and the controls slide away (on a video call they also go by themselves
// after a few seconds); tap again and they come back.
//
// Minimise shrinks a video call into picture in picture
// (PictureInPicture.kt) and drops a voice call back to the app with the call
// still going. Leaving the app mid video call shrinks it the same way.
//
// The sound button is WhatsApp's: with only the phone, it toggles the
// speaker; with Bluetooth earbuds or headphones connected, it opens a
// picker (Phone, Speaker, Bluetooth, Headphones).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, Alert, Animated, Easing, Image, PanResponder,
  NativeModules, Platform, useWindowDimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { RTCView } from 'react-native-webrtc';
import { spacing, radius } from '../theme';
import { useCall } from '../components/calls/CallContext';
import { PulsingText } from '../components/Motion';
import Wallpaper from '../components/Wallpaper';
import ChatSheet from '../components/chat/ChatSheet';
import { apiFetch, mediaUrl } from '../services/api';
import { CONTROLS_HIDE_MS, isPipSize, AUDIO_ROUTES, routeIcon } from '../components/calls/callLayout';

const Native = Platform.OS === 'android' ? NativeModules.VoiceNotes : null;

// The reactions you can send mid-call (Nextcloud Talk has the same row).
export const CALL_REACTIONS = ['❤️', '😂', '😘', '👍', '😮', '🥺'];

// WhatsApp's call colours: the night-blue it darkens to, the red of the end
// button. Fixed rather than themed: a call screen is dark in either theme.
const INK = '#0B141A';
const END_RED = '#EA0038';
const WHITE = '#FFFFFF';

function useElapsed(active) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) { setSeconds(0); return undefined; }
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
  const hh = Math.floor(seconds / 3600);
  const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return hh ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** One reaction, floating up the screen and fading, then gone. */
function FloatingReaction({ emoji, mine, lane }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 3000, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [t]);
  return (
    <Animated.Text
      style={{
        position: 'absolute', bottom: 0, fontSize: 40,
        [mine ? 'right' : 'left']: 24 + lane * 18,
        opacity: t.interpolate({ inputRange: [0, 0.1, 0.75, 1], outputRange: [0, 1, 1, 0] }),
        transform: [
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -320] }) },
          { scale: t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.4, 1.15, 1] }) },
        ],
      }}
    >
      {emoji}
    </Animated.Text>
  );
}

/**
 * A round control in the pill. `on` is WhatsApp's white circle (speaker on,
 * muted); `tint` colours the glyph on it (the red slashed microphone).
 */
function PillButton({ icon, onPress, on, tint, danger, label }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: Boolean(on) }} hitSlop={4}>
      <View style={[styles.pillButton, on && { backgroundColor: WHITE }, danger && { backgroundColor: END_RED }]}>
        <Ionicons name={icon} size={26} color={danger ? WHITE : on ? (tint || INK) : WHITE} />
      </View>
    </Pressable>
  );
}

/** Your own camera, in a tile you can drag out of the way. */
function SelfView({ stream, muted, cameraOff, bottom, lift }) {
  const pan = useRef(new Animated.ValueXY()).current;
  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) + Math.abs(g.dy) > 6,
    onPanResponderGrant: () => { pan.extractOffset(); },
    onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
    onPanResponderRelease: () => { pan.flattenOffset(); },
  }), [pan]);
  return (
    <Animated.View
      {...responder.panHandlers}
      style={[styles.selfView, { bottom, transform: [...pan.getTranslateTransform(), { translateY: lift }] }]}
    >
      {stream && !cameraOff ? (
        <RTCView streamURL={stream.toURL()} style={StyleSheet.absoluteFill} objectFit="cover" mirror zOrder={1} />
      ) : null}
      {muted ? <Ionicons name="mic-off" size={22} color={WHITE} style={styles.selfMuted} /> : null}
    </Animated.View>
  );
}

export default function CallScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const pip = Platform.OS === 'android' && isPipSize(window);
  const {
    call, localStream, remoteStream, muted, cameraOff, speakerOn, error, iceState, relayed,
    reconnecting, partnerReconnecting, partnerState, reactions, audioRoute, sendReaction,
    answerCall, endCall, toggleMute, toggleCamera, switchCamera, toggleSpeaker, chooseAudio, clearError,
  } = useCall();

  const [partner, setPartner] = useState({ name: 'Your partner', picture: null });
  const [wallpaper, setWallpaper] = useState('hearts');
  const [moreOpen, setMoreOpen] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);
  const connected = call.phase === 'connected';
  const elapsed = useElapsed(connected);
  const isVideo = call.kind === 'video';

  useEffect(() => {
    apiFetch('/profile')
      .then((d) => {
        const p = d?.partner;
        // Their profile picture, else the picture they chose as their mascot.
        const key = p?.avatarUrl || p?.mascot?.key || null;
        setPartner({ name: p?.displayName || 'Your partner', picture: key ? mediaUrl(key) : null });
        const chosen = d?.me?.chatWallpaper;
        if (chosen && chosen !== 'none') setWallpaper(chosen);
      })
      .catch(() => {});
  }, []);

  // Leaving the screen when the call is over — but not before, or hanging up
  // would strand the user on a dead screen.
  useEffect(() => {
    if (call.phase === 'idle' && navigation.canGoBack()) navigation.goBack();
  }, [call.phase, navigation]);

  useEffect(() => {
    if (!error) return;
    Alert.alert('Call problem', error, [{ text: 'OK', onPress: clearError }]);
  }, [error, clearError]);

  // While this screen is up during a video call, leaving the app shrinks the
  // call into picture in picture rather than hiding it.
  useFocusEffect(useCallback(() => {
    const auto = isVideo && (connected || call.phase === 'connecting');
    Native?.setAutoPictureInPicture?.(auto)?.catch?.(() => {});
    return () => { Native?.setAutoPictureInPicture?.(false)?.catch?.(() => {}); };
  }, [isVideo, connected, call.phase]));

  // ---- Controls that slide away -------------------------------------------
  const [controlsShown, setControlsShown] = useState(true);
  const shown = useRef(new Animated.Value(1)).current;
  const hideTimer = useRef(null);
  const autoHide = isVideo && connected && !moreOpen && !soundOpen;
  const wake = useCallback(() => {
    setControlsShown(true);
    clearTimeout(hideTimer.current);
    if (autoHide) hideTimer.current = setTimeout(() => setControlsShown(false), CONTROLS_HIDE_MS);
  }, [autoHide]);
  useEffect(() => { wake(); return () => clearTimeout(hideTimer.current); }, [wake]);
  useEffect(() => {
    Animated.timing(shown, {
      toValue: controlsShown ? 1 : 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start();
  }, [controlsShown, shown]);
  // Ringing: the answer buttons always stay. Otherwise a tap toggles.
  const toggleControls = useCallback(() => {
    if (call.phase === 'ringing-in') return;
    if (controlsShown) { clearTimeout(hideTimer.current); setControlsShown(false); } else wake();
  }, [call.phase, controlsShown, wake]);
  const topSlide = shown.interpolate({ inputRange: [0, 1], outputRange: [-140, 0] });
  const bottomSlide = shown.interpolate({ inputRange: [0, 1], outputRange: [180, 0] });
  // The self view drops into the room the controls leave.
  const selfLift = shown.interpolate({ inputRange: [0, 1], outputRange: [96, 0] });
  const touch = (fn) => (...args) => { wake(); return fn(...args); };

  const minimise = useCallback(async () => {
    if (isVideo && Native?.enterPictureInPicture) {
      const entered = await Native.enterPictureInPicture().catch(() => false);
      if (entered) return;
    }
    // A voice call (or a phone without picture in picture): back to the app,
    // call still going.
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('MainTabs');
  }, [isVideo, navigation]);

  const openChat = useCallback(() => {
    navigation.navigate('MainTabs', { screen: 'Photos', params: { screen: 'Messages' } });
  }, [navigation]);

  // More than the phone and its speaker: let them pick, as WhatsApp does.
  const routes = AUDIO_ROUTES.filter((r) => r.id === 'SPEAKER_PHONE' || audioRoute?.available?.includes(r.id));
  const hasHeadset = audioRoute?.available?.some((d) => d === 'BLUETOOTH' || d === 'WIRED_HEADSET');
  const onSound = () => (hasHeadset ? setSoundOpen(true) : toggleSpeaker());
  const soundOn = hasHeadset ? audioRoute.selected !== 'EARPIECE' : speakerOn;

  // "Connecting…" on its own is the least informative thing this screen can
  // say. ICE knows which stage it is at, so show that.
  const stageText = {
    checking: 'Connecting to the call…',
    disconnected: 'Connection dropped — trying to recover…',
    failed: 'No path found',
  }[iceState] || null;

  const statusLine = {
    'ringing-out': 'Ringing…',
    'ringing-in': isVideo ? 'Incoming video call' : 'Incoming voice call',
    connecting: stageText || 'Connecting…',
    connected: reconnecting ? 'Reconnecting…' : elapsed,
    ended: 'Call ended',
    idle: '',
  }[call.phase];

  // Their camera off: their picture rather than a frozen last frame.
  const showRemoteVideo = isVideo && connected && remoteStream && !partnerState?.cameraOff;
  const notice = connected
    ? (partnerReconnecting && `${partner.name} is reconnecting…`)
      || (partnerState?.muted && `${partner.name} is muted`)
      || (isVideo && partnerState?.cameraOff && `${partner.name}'s camera is off`)
      || (relayed && 'Relayed through your server')
      || null
    : null;

  const avatar = (size) => (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      {partner.picture
        ? <Image source={{ uri: partner.picture }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        : <Ionicons name="person" size={size * 0.45} color="rgba(255,255,255,0.7)" />}
    </View>
  );

  // Picture in picture: just the call, nothing to press.
  if (pip) {
    return (
      <View style={[styles.root, styles.center]}>
        {showRemoteVideo ? (
          <RTCView streamURL={remoteStream.toURL()} style={StyleSheet.absoluteFill} objectFit="cover" />
        ) : (
          <>
            {avatar(Math.min(window.width, window.height) * 0.45)}
            <Text style={styles.pipName} numberOfLines={1}>{partner.name}</Text>
          </>
        )}
        <Text style={styles.pipTime}>{statusLine}</Text>
      </View>
    );
  }

  const pillBottom = insets.bottom + spacing.lg;

  return (
    <View style={styles.root}>
      <Wallpaper value={wallpaper} style={StyleSheet.absoluteFill} preview />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(11,20,26,0.72)' }]} />

      {/* The whole background is the tap that shows and hides the controls. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={toggleControls} accessibilityLabel={controlsShown ? 'Hide the call controls' : 'Show the call controls'}>
        {showRemoteVideo ? (
          <RTCView streamURL={remoteStream.toURL()} style={StyleSheet.absoluteFill} objectFit="cover" mirror={false} />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.center]}>
            {avatar(Math.min(220, window.width * 0.55))}
          </View>
        )}
      </Pressable>

      {/* Top: minimise, who and how long, the chat. */}
      <Animated.View
        pointerEvents={controlsShown ? 'box-none' : 'none'}
        style={[styles.top, { paddingTop: insets.top + spacing.sm, opacity: shown, transform: [{ translateY: topSlide }] }]}
      >
        <Pressable onPress={touch(minimise)} style={styles.roundButton} accessibilityLabel="Minimise the call">
          <Ionicons name="contract" size={24} color={WHITE} />
        </Pressable>
        <View style={styles.title}>
          <Text style={styles.name} numberOfLines={1}>{partner.name}</Text>
          {call.phase === 'ringing-out' || call.phase === 'ringing-in' ? (
            <PulsingText style={styles.status}>{statusLine}</PulsingText>
          ) : (
            <Text style={styles.status}>{statusLine}</Text>
          )}
        </View>
        <Pressable onPress={touch(openChat)} style={styles.roundButton} accessibilityLabel="Open the chat">
          <Ionicons name="chatbubble-ellipses" size={24} color={WHITE} />
        </Pressable>
      </Animated.View>

      {notice ? (
        <View pointerEvents="none" style={[styles.notice, { top: insets.top + 96 }]}>
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}

      <View pointerEvents="none" style={[styles.reactionLayer, { bottom: pillBottom + 120 }]}>
        {reactions.map((r, i) => <FloatingReaction key={r.id} emoji={r.emoji} mine={r.mine} lane={i % 4} />)}
      </View>

      {isVideo && call.phase !== 'ringing-in' ? (
        <SelfView stream={localStream} muted={muted} cameraOff={cameraOff} bottom={pillBottom + 104} lift={selfLift} />
      ) : null}

      {call.phase === 'ringing-in' ? (
        <View style={[styles.answerRow, { bottom: pillBottom }]}>
          <View style={styles.answerItem}>
            <Pressable onPress={() => endCall('declined')} accessibilityLabel="Decline">
              <View style={[styles.bigButton, { backgroundColor: END_RED }]}>
                <Ionicons name="call" size={32} color={WHITE} style={{ transform: [{ rotate: '135deg' }] }} />
              </View>
            </Pressable>
            <Text style={styles.answerLabel}>Decline</Text>
          </View>
          <View style={styles.answerItem}>
            <Pressable onPress={answerCall} accessibilityLabel="Answer">
              <View style={[styles.bigButton, { backgroundColor: '#25D366' }]}>
                <Ionicons name={isVideo ? 'videocam' : 'call'} size={32} color={WHITE} />
              </View>
            </Pressable>
            <Text style={styles.answerLabel}>Answer</Text>
          </View>
        </View>
      ) : (
        <Animated.View
          pointerEvents={controlsShown ? 'auto' : 'none'}
          style={[styles.pill, { bottom: pillBottom, opacity: shown, transform: [{ translateY: bottomSlide }] }]}
        >
          <PillButton icon="ellipsis-horizontal" label="More" onPress={touch(() => setMoreOpen(true))} />
          {isVideo ? (
            <PillButton icon={cameraOff ? 'videocam-off' : 'videocam'} label={cameraOff ? 'Turn camera on' : 'Turn camera off'} onPress={touch(toggleCamera)} />
          ) : null}
          <PillButton
            icon={routeIcon(audioRoute?.selected)}
            label={hasHeadset ? 'Choose where the sound goes' : speakerOn ? 'Speaker off' : 'Speaker on'}
            on={soundOn}
            onPress={touch(onSound)}
          />
          <PillButton icon={muted ? 'mic-off' : 'mic'} label={muted ? 'Unmute' : 'Mute'} on={muted} tint={END_RED} onPress={touch(toggleMute)} />
          <PillButton icon="call" label="End call" danger onPress={() => endCall('hangup')} />
        </Animated.View>
      )}

      <ChatSheet
        visible={soundOpen}
        title="Audio"
        onClose={() => { setSoundOpen(false); wake(); }}
        rows={routes.map((r) => ({
          icon: audioRoute?.selected === r.id ? 'checkmark-circle' : r.icon,
          label: r.label,
          hint: audioRoute?.selected === r.id ? 'In use' : undefined,
          onPress: () => chooseAudio(r.id),
        }))}
      />

      <ChatSheet
        visible={moreOpen}
        onClose={() => { setMoreOpen(false); wake(); }}
        header={connected ? (
          <View style={styles.sheetReactions}>
            {CALL_REACTIONS.map((emoji) => (
              <Pressable key={emoji} onPress={() => { sendReaction(emoji); setMoreOpen(false); }} accessibilityLabel={`Send ${emoji}`} hitSlop={6}>
                <Text style={styles.sheetEmoji}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        rows={[
          isVideo && { icon: 'camera-reverse-outline', label: 'Flip camera', onPress: switchCamera },
          isVideo && { icon: 'albums-outline', label: 'Picture in picture', onPress: minimise },
          { icon: 'chatbubble-ellipses-outline', label: 'Open the chat', onPress: openChat },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: INK },
  center: { alignItems: 'center', justifyContent: 'center' },
  top: {
    position: 'absolute', left: 0, right: 0, top: 0,
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  roundButton: {
    width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  title: { flex: 1, alignItems: 'center', paddingTop: 6, paddingHorizontal: spacing.sm },
  name: { color: WHITE, fontSize: 20, fontWeight: '500' },
  status: { color: 'rgba(255,255,255,0.75)', fontSize: 15, marginTop: 2, fontVariant: ['tabular-nums'] },
  avatar: {
    overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  notice: {
    position: 'absolute', alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
  },
  noticeText: { color: WHITE, fontWeight: '600' },
  reactionLayer: { position: 'absolute', left: 0, right: 0, height: 340 },
  selfView: {
    position: 'absolute', right: spacing.md,
    width: 132, height: 200, borderRadius: 16, overflow: 'hidden',
    backgroundColor: '#000',
  },
  selfMuted: { position: 'absolute', left: 12, top: 12 },
  pill: {
    position: 'absolute', alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: 48,
    backgroundColor: 'rgba(30,38,44,0.92)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  pillButton: {
    width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  answerRow: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-evenly' },
  answerItem: { alignItems: 'center' },
  bigButton: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  answerLabel: { color: WHITE, marginTop: spacing.xs },
  sheetReactions: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: spacing.sm },
  sheetEmoji: { fontSize: 30 },
  pipName: { color: WHITE, fontSize: 13, marginTop: 6, maxWidth: '90%' },
  pipTime: { position: 'absolute', bottom: 6, color: WHITE, fontSize: 12, fontVariant: ['tabular-nums'] },
});
