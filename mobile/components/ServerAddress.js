import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import {
  getApiUrl,
  getBuildTimeApiUrl,
  pingServer,
  resetApiUrl,
  setApiUrl,
} from '../services/api';
import { provisionWidgets } from '../services/widgetBridge';
import Icon from './Icon';
import { colors, font, spacing, radius } from '../theme';
import { MorphButton } from './Motion';

/**
 * Lets the address of the self-hosted backend be corrected on the device.
 *
 * EXPO_PUBLIC_API_URL is inlined into the bundle at build time, so before this
 * existed a wrong Tailscale IP meant a fresh EAS build per guess — roughly
 * fifteen minutes to test a four-character change. Saving here persists the new
 * address and re-pings immediately, so a bad address is a ten-second fix.
 */
export default function ServerAddress({ compact = false }) {
  const [value, setValue] = useState(getApiUrl());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // 'ok' | 'fail' | null

  async function check() {
    setBusy(true);
    setStatus(null);
    try {
      await pingServer();
      setStatus('ok');
      Alert.alert('Connected', `The backend at ${getApiUrl()} is up.`);
    } catch (err) {
      setStatus('fail');
      Alert.alert('No connection', err.message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const saved = await setApiUrl(value);
      setValue(saved);
      // Saving without verifying would just move the confusion later.
      await pingServer();
      // The widget process caches the old address in its own storage, so it
      // has to be handed the new one or it keeps polling somewhere dead.
      provisionWidgets();
      setStatus('ok');
      Alert.alert('Saved', `Connected to ${saved}.`);
    } catch (err) {
      setStatus('fail');
      Alert.alert('Saved, but not reachable', err.message);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      const restored = await resetApiUrl();
      setValue(restored);
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  const isOverridden = getApiUrl() !== getBuildTimeApiUrl();

  return (
    <View style={compact ? styles.compact : styles.card}>
      <View style={styles.headerRow}>
        <Icon name="server-outline" size={18} />
        <Text style={font.h2}>Server</Text>
        {status === 'ok' && <Icon name="checkmark-circle" size={18} color={colors.accent} />}
        {status === 'fail' && <Icon name="alert-circle" size={18} color={colors.accent} />}
      </View>

      <Text style={[font.muted, styles.hint]}>
        Your PC's Tailscale IP and port — run `tailscale ip -4` on the server.
      </Text>

      <TextInput
        value={value}
        onChangeText={setValue}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="100.101.102.103:4000"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
      />

      <View style={styles.buttonRow}>
        <View style={styles.buttonSlot}>
          <MorphButton onPress={save} disabled={busy} style={[styles.button, styles.primary]}>
            {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.primaryText}>Save & test</Text>}
          </MorphButton>
        </View>
        <View style={styles.buttonSlot}>
          <MorphButton onPress={check} disabled={busy} style={[styles.button, styles.secondary]}>
            <Text style={styles.secondaryText}>Test</Text>
          </MorphButton>
        </View>
      </View>

      {isOverridden && (
        <MorphButton onPress={reset} disabled={busy} style={styles.resetButton}>
          <Text style={[font.muted, styles.resetText]}>
            Reset to the built-in address ({getBuildTimeApiUrl()})
          </Text>
        </MorphButton>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
  },
  compact: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, marginTop: spacing.lg,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  hint: { fontSize: 12, marginTop: spacing.xs, marginBottom: spacing.sm },
  input: {
    backgroundColor: colors.bg, color: colors.text, borderRadius: radius.md,
    padding: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  buttonRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  buttonSlot: { flex: 1 },
  button: { borderRadius: radius.pill, paddingVertical: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.accent },
  primaryText: { color: '#fff', fontWeight: '700' },
  secondary: { backgroundColor: colors.accentSoft },
  secondaryText: { color: colors.accent, fontWeight: '700' },
  resetButton: { alignItems: 'center', marginTop: spacing.sm },
  resetText: { fontSize: 12, textAlign: 'center' },
});
