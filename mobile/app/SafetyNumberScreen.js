// Encryption, plainly: what is end-to-end encrypted and what is not, and the
// safety number that proves nobody sits between the two of you.
//
// The safety number is worked out from both public keys (services/crypto.js).
// Read it out on a call or side by side: the same digits on both phones mean
// the keys are the real ones. "They match" remembers that; if your partner's
// key changes after that, the chat says so loudly (services/keyTrust.js).
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch } from '../services/api';
import { getKeyPair, safetyNumber } from '../services/crypto';
import { checkPartnerKey, acceptPartnerKey, markPartnerKeyVerified } from '../services/keyTrust';
import { spacing, radius } from '../theme';
import { useTheme } from '../components/ThemeContext';
import { MorphButton } from '../components/Motion';
import Icon from '../components/Icon';

/** What the app encrypts end to end, and what it does not. Kept true. */
export const ENCRYPTED = ['Text messages, and their edits', 'Polls', 'Places you share in the chat'];
export const NOT_ENCRYPTED = [
  'Photos and drawings in the chat',
  'Voice notes',
  'Locket and widget photos, memories',
  'Live location sharing',
  'Cycle tracking',
  'Fable (the AI chat)',
  'Who sent what, and when',
];

export default function SafetyNumberScreen() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [state, setState] = useState(null);   // { partnerName, partnerId, partnerKey, groups, trust }
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await apiFetch('/profile');
      const mine = await getKeyPair();
      const partnerKey = d?.partner?.publicKey || null;
      const partnerId = d?.partner?.id || null;
      setState({
        partnerName: d?.partner?.displayName || 'your partner',
        partnerId,
        partnerKey,
        groups: await safetyNumber(mine.publicKeyBase64, partnerKey),
        trust: await checkPartnerKey(partnerId, partnerKey),
      });
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const verify = async () => {
    await markPartnerKeyVerified(state.partnerId, state.partnerKey);
    load();
  };
  const accept = async () => {
    await acceptPartnerKey(state.partnerId, state.partnerKey);
    load();
  };

  if (error) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}><Text style={font.muted}>{error}</Text></View>;
  }
  if (!state) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.accent} /></View>;
  }

  const { trust, groups, partnerName } = state;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.label}>Safety number</Text>
        {groups ? (
          <>
            <View style={styles.grid}>
              {groups.map((g, i) => <Text key={i} style={styles.group}>{g}</Text>)}
            </View>
            <Text style={styles.hint}>
              Open this page on {partnerName}'s phone too and read the numbers out, on a call or side by side. The
              same digits on both phones mean your messages go only to each other, with nobody in between.
            </Text>
            {trust.status === 'changed' ? (
              <View style={[styles.banner, { borderColor: colors.danger }]}>
                <Icon name="alert-circle" chip={false} size={16} color={colors.danger} />
                <Text style={[font.body, { flex: 1 }]}>
                  {partnerName}'s key has changed{trust.wasVerified ? ' since you checked it' : ''}. A reinstall or a new
                  phone does that. Compare the numbers before you accept it.
                </Text>
              </View>
            ) : null}
            <View style={styles.row}>
              {trust.status === 'changed' ? (
                <MorphButton onPress={accept} style={styles.secondary}><Text style={styles.secondaryText}>Accept the new key</Text></MorphButton>
              ) : null}
              {trust.verified ? (
                <View style={styles.verified}>
                  <Icon name="checkmark-circle" chip={false} size={16} color={colors.success} />
                  <Text style={[font.body, { color: colors.success }]}>Verified</Text>
                </View>
              ) : (
                <MorphButton onPress={verify} style={styles.primary}><Text style={styles.primaryText}>They match</Text></MorphButton>
              )}
            </View>
          </>
        ) : (
          <Text style={styles.hint}>{partnerName} has not opened the chat on this version of the app yet, so there is no key to compare.</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>End-to-end encrypted</Text>
        {ENCRYPTED.map((t) => (
          <View key={t} style={styles.item}>
            <Icon name="lock-closed" chip={false} size={13} color={colors.success} />
            <Text style={font.body}>{t}</Text>
          </View>
        ))}
        <Text style={styles.hint}>Only your two phones can read these. The server stores them scrambled.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Not end-to-end encrypted</Text>
        {NOT_ENCRYPTED.map((t) => (
          <View key={t} style={styles.item}>
            <Icon name="lock-open-outline" chip={false} size={13} color={colors.textMuted} />
            <Text style={font.body}>{t}</Text>
          </View>
        ))}
        <Text style={styles.hint}>
          These are kept readable on your own server PC, which only the two of you can sign in to. Over Tailscale they
          travel encrypted by the tunnel.
        </Text>
      </View>
    </ScrollView>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  content: { padding: spacing.lg, gap: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  label: { fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', marginBottom: spacing.sm },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' },
  group: { width: '22%', textAlign: 'center', fontSize: 18, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'], letterSpacing: 1 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, alignItems: 'center', flexWrap: 'wrap' },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 3 },
  primary: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  primaryText: { color: '#fff', fontWeight: '700' },
  secondary: { backgroundColor: colors.accentSoft, borderRadius: radius.pill, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  secondaryText: { color: colors.accent, fontWeight: '700' },
});
