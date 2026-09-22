// The in-call screen.
//
// Video fills the screen with your own feed as a small inset; voice shows
// the partner's name and a running timer instead. Both share one control
// bar, because switching between them mid-call should not move the buttons.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { RTCView } from 'react-native-webrtc';
import { spacing, radius } from '../theme';
import { useTheme } from '../components/ThemeContext';
import { useCall } from '../components/calls/CallContext';
import { PulsingText, Pop } from '../components/Motion';
import { apiFetch } from '../services/api';

function useElapsed(active) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) { setSeconds(0); return undefined; }
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function ControlButton({ icon, label, onPress, active, danger, size = 60 }) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={{ alignItems: 'center' }}>
      <Pressable onPress={onPress}>
        <Pop active={Boolean(active)}>
          <View
            style={[
              styles.control,
              { width: size, height: size, borderRadius: size / 2 },
              active && styles.controlActive,
              danger && styles.controlDanger,
            ]}
          >
            <Ionicons name={icon} size={size * 0.42} color={danger || active ? '#fff' : colors.textPrimary} />
          </View>
        </Pop>
      </Pressable>
      {label ? <Text style={[font.muted, styles.controlLabel]}>{label}</Text> : null}
    </View>
  );
}

export default function CallScreen({ navigation }) {
  const { colors, font } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const {
    call, localStream, remoteStream, muted, cameraOff, speakerOn, error, iceState, relayed,
    answerCall, endCall, toggleMute, toggleCamera, switchCamera, toggleSpeaker, clearError,
  } = useCall();

  // "Connecting…" on its own is the least informative thing this screen can
  // say, and it is what it said for the entire time calls were not working.
  // ICE knows exactly which stage it is at, so show that.
  const stageText = {
    new: 'Starting…',
    checking: 'Finding a path between your phones…',
    connected: relayed ? 'Connected via relay' : 'Connected',
    completed: relayed ? 'Connected via relay' : 'Connected',
    disconnected: 'Connection dropped — trying to recover…',
    failed: 'No path found',
    closed: 'Closed',
  }[iceState] || null;

  const [partnerName, setPartnerName] = useState('Your partner');
  const elapsed = useElapsed(call.phase === 'connected');
  const isVideo = call.kind === 'video';

  useEffect(() => {
    apiFetch('/profile')
      .then((d) => setPartnerName(d?.partner?.displayName || 'Your partner'))
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

  const statusLine = {
    'ringing-out': 'Calling…',
    'ringing-in': isVideo ? 'Incoming video call' : 'Incoming call',
    connecting: 'Connecting…',
    connected: elapsed,
    ended: 'Call ended',
    idle: '',
  }[call.phase];

  const showVideo = isVideo && call.phase === 'connected' && remoteStream;

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + spacing.lg }]}>
      {showVideo ? (
        <>
          <RTCView
            streamURL={remoteStream.toURL()}
            style={StyleSheet.absoluteFill}
            objectFit="cover"
            mirror={false}
          />
          {localStream && !cameraOff && (
            <View style={styles.selfView}>
              <RTCView
                streamURL={localStream.toURL()}
                style={StyleSheet.absoluteFill}
                objectFit="cover"
                mirror
              />
            </View>
          )}
        </>
      ) : (
        <View style={styles.voiceBody}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={64} color={colors.accentPink} />
          </View>
          <Text style={[font.h1, styles.name]}>{partnerName}</Text>
          {call.phase === 'ringing-out' || call.phase === 'ringing-in' ? (
            <PulsingText style={[font.h3, styles.status]}>{statusLine}</PulsingText>
          ) : (
            <Text style={[font.h3, styles.status]}>{statusLine}</Text>
          )}
          {/* Which stage ICE is at. A call that is going to fail spends its
              last thirty seconds in 'checking'; saying so is the difference
              between "it's working on it" and "it is never going to work". */}
          {stageText && call.phase !== 'connected' && (
            <Text style={[font.muted, styles.status]}>{stageText}</Text>
          )}
          {isVideo && call.phase === 'connected' && (
            <Text style={[font.muted, styles.status]}>
              {cameraOff ? 'Your camera is off' : 'Waiting for their video…'}
            </Text>
          )}
          {call.phase === 'connected' && relayed && (
            <Text style={[font.muted, styles.status]}>Relayed through your server</Text>
          )}
        </View>
      )}

      {showVideo && (
        <View style={[styles.videoHeader, { top: insets.top + spacing.sm }]}>
          <Text style={[font.h3, styles.videoHeaderText]}>{partnerName}</Text>
          <Text style={[font.muted, styles.videoHeaderText]}>{elapsed}</Text>
        </View>
      )}

      <View style={styles.controls}>
        {call.phase === 'ringing-in' ? (
          <View style={styles.answerRow}>
            <ControlButton icon="close" label="Decline" danger size={72} onPress={() => endCall('declined')} />
            <View style={styles.answerButton}>
              <ControlButton icon={isVideo ? 'videocam' : 'call'} label="Answer" active size={72} onPress={answerCall} />
            </View>
          </View>
        ) : (
          <>
            <View style={styles.controlRow}>
              <ControlButton
                icon={muted ? 'mic-off' : 'mic'}
                label={muted ? 'Unmute' : 'Mute'}
                active={muted}
                onPress={toggleMute}
              />
              {isVideo ? (
                <>
                  <ControlButton
                    icon={cameraOff ? 'videocam-off' : 'videocam'}
                    label={cameraOff ? 'Camera on' : 'Camera off'}
                    active={cameraOff}
                    onPress={toggleCamera}
                  />
                  <ControlButton icon="camera-reverse" label="Flip" onPress={switchCamera} />
                </>
              ) : (
                <ControlButton
                  icon={speakerOn ? 'volume-high' : 'volume-medium'}
                  label="Speaker"
                  active={speakerOn}
                  onPress={toggleSpeaker}
                />
              )}
            </View>
            <View style={styles.hangupRow}>
              <ControlButton icon="call" label="" danger size={72} onPress={() => endCall('hangup')} />
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background, justifyContent: 'space-between' },
    voiceBody: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    avatar: {
      width: 132, height: 132, borderRadius: 66,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.accentSoft,
      borderWidth: 2, borderColor: colors.accentPink,
    },
    name: { marginTop: spacing.lg, textAlign: 'center' },
    status: { marginTop: spacing.sm, color: colors.textSecondary, textAlign: 'center' },
    selfView: {
      position: 'absolute', right: spacing.md, top: spacing.xl * 2,
      width: 104, height: 150, borderRadius: radius.md, overflow: 'hidden',
      borderWidth: 2, borderColor: 'rgba(255,255,255,0.7)',
      backgroundColor: '#000',
    },
    videoHeader: {
      position: 'absolute', left: spacing.lg,
      backgroundColor: 'rgba(0,0,0,0.42)',
      paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
      borderRadius: radius.pill,
    },
    videoHeaderText: { color: '#fff' },
    controls: { paddingHorizontal: spacing.lg },
    controlRow: {
      flexDirection: 'row', justifyContent: 'space-evenly',
      alignItems: 'center', marginBottom: spacing.lg,
    },
    hangupRow: { alignItems: 'center' },
    answerRow: { flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center' },
    answerButton: {},
    control: {
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1, borderColor: colors.border,
    },
    controlActive: { backgroundColor: colors.accentIndigo, borderColor: colors.accentIndigo },
    controlDanger: { backgroundColor: colors.danger, borderColor: colors.danger, transform: [{ rotate: '135deg' }] },
    controlLabel: { marginTop: spacing.xs, fontSize: 11 },
  });
