// Is the live connection actually up?
//
// This card exists because of a bug that was invisible by design. The socket
// authenticates on handshake with the 15-minute access token, and a socket.io
// middleware rejection is NOT a retryable error — the client fires one
// connect_error, sets active = false and gives up permanently. So on any
// launch more than fifteen minutes after the last one, the socket was
// rejected once and stayed dead all session.
//
// Nothing said so. Messages still sent, because that is a POST, but the
// partner never saw them arrive; a call emitted its SDP offer into a closed
// socket and sat on "Calling…" until the app was killed. The reconnect is
// fixed in services/api.js — this is here so that if it ever breaks again it
// is something you can SEE rather than something you have to infer from a
// call that will not connect.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { connectSocket, getSocketState, onSocketState, getApiUrl } from '../services/api';
import { spacing, radius } from '../theme';
import { useTheme } from './ThemeContext';
import { MorphButton } from './Motion';
import Icon from './Icon';

const LOOK = {
  connected: { icon: 'checkmark-circle', tone: 'success', label: 'Connected', blurb: 'Messages, calls and games arrive live.' },
  connecting: { icon: 'sync', tone: 'gold', label: 'Connecting…', blurb: 'Reaching your server.' },
  disconnected: { icon: 'cloud-offline', tone: 'gold', label: 'Offline', blurb: 'Reconnecting automatically.' },
  unauthorized: { icon: 'alert-circle', tone: 'danger', label: "Can't sign in to live updates", blurb: 'Retrying with a fresh token.' },
  idle: { icon: 'ellipse', tone: 'textMuted', label: 'Not connected', blurb: 'Nothing has needed the live connection yet.' },
};

export default function ConnectionCard() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [state, setState] = useState(getSocketState());

  useEffect(() => onSocketState(setState), []);

  const look = LOOK[state] || LOOK.idle;
  const tone = colors[look.tone] || colors.textMuted;

  return (
    <View style={styles.card}>
      <Text style={font.h2}>Live connection</Text>

      <View style={styles.row}>
        <Icon name={look.icon} chip chipSize={38} color={tone} chipColor={colors.surfaceAlt} />
        <View style={{ flex: 1 }}>
          <Text style={[font.body, { color: tone, fontWeight: '700' }]}>{look.label}</Text>
          <Text style={font.muted}>{look.blurb}</Text>
        </View>
      </View>

      <Text style={[font.muted, styles.server]} numberOfLines={1}>{getApiUrl()}</Text>

      {state !== 'connected' && (
        <MorphButton onPress={() => connectSocket()} style={styles.retry}>
          <Icon name="refresh-outline" chip={false} size={16} color={colors.accent} />
          <Text style={{ color: colors.accent, fontWeight: '600' }}>Reconnect now</Text>
        </MorphButton>
      )}
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
      borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
    server: { marginTop: spacing.sm, fontSize: 11, opacity: 0.8 },
    retry: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
      backgroundColor: colors.accentSoft, borderRadius: radius.pill,
      paddingVertical: spacing.sm, marginTop: spacing.md,
    },
  });
