// The two buttons that start a call. Dropped into Home and Messages rather
// than given a screen of their own: calling your partner is not a
// destination you navigate to, it is something you do from wherever you are.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import { useTheme } from '../ThemeContext';
import { MorphButton } from '../Motion';
import { useCall } from './CallContext';

export default function CallButtons({ compact = false }) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { startCall, isBusy } = useCall();

  const ring = (kind) => {
    if (isBusy) {
      Alert.alert('Already on a call', 'Finish the current call first.');
      return;
    }
    startCall(kind);
  };

  if (compact) {
    return (
      <View style={styles.compactRow}>
        <MorphButton onPress={() => ring('voice')} style={styles.compactButton}>
          <Ionicons name="call" size={20} color={colors.accentPink} />
        </MorphButton>
        <MorphButton onPress={() => ring('video')} style={styles.compactButton}>
          <Ionicons name="videocam" size={20} color={colors.accentPink} />
        </MorphButton>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <MorphButton onPress={() => ring('voice')} style={[styles.button, styles.voice]}>
        <Ionicons name="call" size={20} color="#fff" />
        <Text style={styles.label}>Voice call</Text>
      </MorphButton>
      <MorphButton onPress={() => ring('video')} style={[styles.button, styles.video]}>
        <Ionicons name="videocam" size={20} color="#fff" />
        <Text style={styles.label}>Video call</Text>
      </MorphButton>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    row: { flexDirection: 'row', gap: spacing.sm },
    button: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: spacing.xs, borderRadius: radius.pill, paddingVertical: spacing.md,
    },
    voice: { backgroundColor: colors.accentPink },
    video: { backgroundColor: colors.accentIndigo },
    label: { color: '#fff', fontWeight: '700' },
    compactRow: { flexDirection: 'row', gap: spacing.xs },
    compactButton: {
      width: 40, height: 40, borderRadius: 20,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
  });
