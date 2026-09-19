import React, { useState, useMemo } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, Share } from 'react-native';
import { apiFetch } from '../services/api';
import { spacing, radius } from '../theme';
import { FadeInUp, MorphButton } from '../components/Motion';
import Icon from '../components/Icon';
import StickerField from '../components/Stickers';
import { useTheme } from '../components/ThemeContext';
import { registerForPush } from '../services/notifications';

export default function PairingScreen({ navigation }) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [inviteCode, setInviteCode] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);
  const [enteredCode, setEnteredCode] = useState('');
  const [loading, setLoading] = useState(false);

  // The pair's timezone is pinned once, here, to the inviter's device
  // timezone — see docs/SPEC.md #2. It is never recomputed later.
  async function generateInvite() {
    setLoading(true);
    try {
      const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const data = await apiFetch('/auth/invite', { method: 'POST', body: { deviceTimezone } });
      setInviteCode(data.inviteCode);
      setExpiresAt(data.expiresAt);
    } catch (err) {
      Alert.alert('Could not generate invite', err.message);
    } finally {
      setLoading(false);
    }
  }

  async function acceptInvite() {
    if (!enteredCode) return;
    setLoading(true);
    try {
      await apiFetch('/auth/invite/accept', { method: 'POST', body: { inviteCode: enteredCode.trim() } });
      registerForPush(); // asked here, after onboarding - not at first launch
      navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
    } catch (err) {
      Alert.alert('Could not pair', err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <StickerField variant="form" />
      <FadeInUp>
        <Text style={font.h1}>Pair with your partner</Text>
        <Text style={[font.muted, { marginTop: spacing.xs, marginBottom: spacing.lg }]}>
          Generate a code for them, or enter the one they sent you. Either works — you only need to do this once.
        </Text>
      </FadeInUp>

      <FadeInUp delay={80}>
        <View style={styles.card}>
          <Text style={font.h2}>Generate an invite</Text>
          {inviteCode ? (
            <View style={{ marginTop: spacing.md }}>
              <Text style={styles.code}>{inviteCode}</Text>
              <Text style={font.muted}>Expires {new Date(expiresAt).toLocaleDateString()}</Text>
              <MorphButton
                onPress={() => Share.share({ message: `Pair with me on loversrock. — invite code: ${inviteCode}` })}
                style={styles.secondaryButton}
              >
                <Icon name="share-social-outline" size={16} color={colors.accent} />
                <Text style={styles.secondaryButtonText}>Share code</Text>
              </MorphButton>
            </View>
          ) : (
            <MorphButton onPress={generateInvite} disabled={loading} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Generate code</Text>
            </MorphButton>
          )}
        </View>
      </FadeInUp>

      <FadeInUp delay={140}>
        <View style={styles.card}>
          <Text style={font.h2}>Have a code?</Text>
          <TextInput
            placeholder="6-character code"
            placeholderTextColor={colors.textMuted}
            value={enteredCode}
            onChangeText={setEnteredCode}
            autoCapitalize="characters"
            maxLength={6}
            style={styles.input}
          />
          <MorphButton onPress={acceptInvite} disabled={loading} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Pair up</Text>
          </MorphButton>
        </View>
      </FadeInUp>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', padding: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  code: { fontSize: 32, fontWeight: '800', color: colors.accent, letterSpacing: 4, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    borderRadius: radius.md,
    padding: spacing.md,
    marginVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    letterSpacing: 2,
  },
  primaryButton: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingVertical: spacing.md, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '700' },
  secondaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, marginTop: spacing.sm },
  secondaryButtonText: { color: colors.accent, fontWeight: '600' },
});
