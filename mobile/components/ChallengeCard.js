// The random challenge.
//
// One tap draws one, and you cannot draw another while one is open — which is
// the whole design. A button that re-rolls turns this into a slot machine you
// pull until you get an easy one, and then nothing ever gets done.
//
// Either of you can close it, because a challenge belongs to the pair rather
// than to whoever happened to press the button.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch, onSocketEvent } from '../services/api';
import { spacing, radius } from '../theme';
import { useTheme } from './ThemeContext';
import { MorphButton } from './Motion';

const SCOPE = {
  now: 'right now',
  today: 'today',
  week: 'this week',
};

export default function ChallengeCard() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [challenge, setChallenge] = useState(null);
  const [completed, setCompleted] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => apiFetch('/checkins/challenge')
    .then((d) => { setChallenge(d.challenge); setCompleted(d.completed); })
    .catch(() => {}), []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Live, so the one they drew appears on your phone rather than waiting for
  // you to reopen the app and wonder what they meant.
  useFocusEffect(useCallback(() => {
    const off = [
      onSocketEvent('challenge:drawn', () => load()),
      onSocketEvent('challenge:closed', () => load()),
    ];
    return () => off.forEach((fn) => fn && fn());
  }, [load]));

  async function draw() {
    setBusy(true);
    try {
      const d = await apiFetch('/checkins/challenge/draw', { method: 'POST' });
      setChallenge(d.challenge);
    } catch (err) {
      // A 409 means they drew one a second before you did, which is not a
      // failure — it just means there is one, so show it.
      if (/already have one/i.test(err.message)) load();
      else Alert.alert('Could not draw one', err.message);
    } finally {
      setBusy(false);
    }
  }

  async function close(status) {
    setBusy(true);
    try {
      await apiFetch(`/checkins/challenge/${challenge.id}/close`, { method: 'POST', body: { status } });
      await load();
    } catch (err) {
      Alert.alert('Could not close it', err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!challenge) {
    return (
      <MorphButton onPress={draw} disabled={busy} style={[styles.empty, busy && { opacity: 0.6 }]}>
        <Ionicons name="dice-outline" size={18} color={colors.accent} />
        <View style={{ flex: 1 }}>
          <Text style={[font.body, { fontWeight: '700' }]}>Draw a challenge</Text>
          <Text style={[font.muted, { fontSize: 11 }]}>
            {completed > 0 ? `${completed} done so far` : 'One thing to actually do'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </MorphButton>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.label}>
        CHALLENGE · {(SCOPE[challenge.scope] || challenge.scope).toUpperCase()}
      </Text>
      <Text style={[font.h3, { marginTop: 2 }]}>{challenge.title}</Text>
      {challenge.detail ? <Text style={[font.body, styles.detail]}>{challenge.detail}</Text> : null}

      <View style={styles.actions}>
        <MorphButton onPress={() => close('skipped')} disabled={busy} style={styles.skip}>
          <Text style={styles.skipText}>Not this one</Text>
        </MorphButton>
        <MorphButton onPress={() => close('done')} disabled={busy} style={styles.done}>
          <Ionicons name="checkmark" size={16} color="#fff" />
          <Text style={styles.doneText}>Done</Text>
        </MorphButton>
      </View>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    empty: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: colors.surface, borderRadius: radius.card,
      padding: spacing.md, marginBottom: spacing.md,
      borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed',
    },
    card: {
      backgroundColor: colors.surface, borderRadius: radius.card,
      padding: spacing.md, marginBottom: spacing.md,
      borderWidth: 1.5, borderColor: colors.accent,
    },
    label: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: colors.accent },
    detail: { marginTop: spacing.xs },
    actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    skip: {
      flex: 1, alignItems: 'center', paddingVertical: spacing.sm,
      borderRadius: radius.pill, backgroundColor: colors.surfaceAlt,
      borderWidth: 1, borderColor: colors.border,
    },
    skipText: { color: colors.textSecondary, fontWeight: '600', fontSize: 13 },
    done: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: spacing.xs, paddingVertical: spacing.sm,
      borderRadius: radius.pill, backgroundColor: colors.accent,
    },
    doneText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  });
