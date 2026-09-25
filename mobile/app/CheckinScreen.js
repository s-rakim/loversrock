// The monthly check-in.
//
// Eight questions, the same eight every month. A check-in whose questions
// change is a conversation; a check-in whose questions stay put is a
// measurement, and the whole reason to write any of it down is to be able to
// say "we were at 6 in March and 9 in June".
//
// Neither of you sees the other's answers until both have finished, and
// finishing is final — otherwise you could read theirs, go back, and edit
// yours to match, which is exactly what the reveal rule exists to stop.
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, Alert, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch } from '../services/api';
import { spacing, radius } from '../theme';
import { useTheme } from '../components/ThemeContext';
import { MorphButton, FadeInUp } from '../components/Motion';
import CelebrationBurst from '../components/Celebration';

const monthName = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

export default function CheckinScreen({ partnerName }) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [state, setState] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState([]);
  const [celebrate, setCelebrate] = useState(0);

  const load = useCallback(async () => {
    try {
      const [current, past] = await Promise.all([
        apiFetch('/checkins/current'),
        apiFetch('/checkins/history').catch(() => ({ history: [] })),
      ]);
      setState(current);
      setHistory(past.history || []);
      // Seed the drafts from whatever was already saved, so leaving the
      // screen half-done and coming back does not lose it.
      const seeded = {};
      for (const a of current.mine) {
        seeded[a.questionKey] = a.score != null ? { score: a.score } : { answer: a.answer };
      }
      setDrafts(seeded);
    } catch (err) {
      Alert.alert('Could not load the check-in', err.message);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const set = (key, value) => setDrafts((d) => ({ ...d, [key]: value }));

  const answered = state ? state.questions.filter((q) => {
    const d = drafts[q.key];
    return q.kind === 'score' ? typeof d?.score === 'number' : Boolean(d?.answer?.trim());
  }).length : 0;

  async function save({ finish }) {
    setSaving(true);
    try {
      await apiFetch('/checkins/current', { method: 'PUT', body: { answers: drafts } });
      if (finish) {
        const res = await apiFetch('/checkins/current/finish', { method: 'POST' });
        if (res.bothDone) setCelebrate((n) => n + 1);
      }
      await load();
    } catch (err) {
      Alert.alert(finish ? 'Could not finish' : 'Could not save', err.message);
    } finally {
      setSaving(false);
    }
  }

  function confirmFinish() {
    Alert.alert(
      'Finish this month?',
      'You will not be able to change your answers afterwards — that is what makes theirs worth reading.',
      [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Finish', onPress: () => save({ finish: true }) },
      ]
    );
  }

  if (!state) {
    return <View style={styles.centered}><ActivityIndicator color={colors.accent} /></View>;
  }

  const who = partnerName || 'They';
  const theirs = Object.fromEntries(state.theirs.map((a) => [a.questionKey, a]));

  return (
    <View style={styles.root}>
      {state.bothDone && (
        <View style={styles.celebration} pointerEvents="none">
          <CelebrationBurst trigger={celebrate} size={200} />
        </View>
      )}

      <ScrollView contentContainerStyle={styles.list}>
        <FadeInUp>
          <Text style={[font.h1]}>{monthName(state.checkin.month)}</Text>
          <Text style={font.muted}>
            {state.bothDone
              ? 'You both finished. Here is how the month looked from each side.'
              : state.iAmDone
                ? `Waiting on ${who}. Theirs unlocks when they finish.`
                : 'Eight questions. Neither of you sees the other until you are both done.'}
          </Text>

          {(state.myAverage != null || state.theirAverage != null) && (
            <View style={styles.scoreRow}>
              <View style={styles.scoreBox}>
                <Text style={styles.scoreValue}>{state.myAverage ?? '—'}</Text>
                <Text style={font.muted}>you</Text>
              </View>
              <View style={styles.scoreBox}>
                <Text style={styles.scoreValue}>{state.theirAverage ?? '—'}</Text>
                <Text style={font.muted}>{who.toLowerCase()}</Text>
              </View>
            </View>
          )}
        </FadeInUp>

        {state.questions.map((q, i) => {
          const mine = drafts[q.key];
          const locked = state.iAmDone;
          const theirAnswer = theirs[q.key];

          return (
            <FadeInUp key={q.key} delay={Math.min(i, 6) * 30}>
              <View style={styles.card}>
                <Text style={[font.body, styles.question]}>{q.prompt}</Text>

                {q.kind === 'score' ? (
                  <>
                    <View style={styles.scale}>
                      {Array.from({ length: 10 }, (_, n) => n + 1).map((n) => (
                        <Pressable
                          key={n}
                          disabled={locked}
                          onPress={() => set(q.key, { score: n })}
                          style={[
                            styles.pip,
                            mine?.score === n && styles.pipOn,
                            locked && { opacity: 0.55 },
                          ]}
                        >
                          <Text style={[styles.pipText, mine?.score === n && { color: '#fff' }]}>{n}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <View style={styles.scaleLabels}>
                      <Text style={[font.muted, { fontSize: 10 }]}>{q.low}</Text>
                      <Text style={[font.muted, { fontSize: 10 }]}>{q.high}</Text>
                    </View>
                  </>
                ) : (
                  <TextInput
                    editable={!locked}
                    value={mine?.answer || ''}
                    onChangeText={(t) => set(q.key, { answer: t })}
                    placeholder="…"
                    placeholderTextColor={colors.textMuted}
                    multiline
                    style={[styles.input, locked && { opacity: 0.6 }]}
                  />
                )}

                {state.bothDone && theirAnswer && (
                  <View style={styles.theirs}>
                    <Text style={[font.muted, { fontSize: 11, fontWeight: '700' }]}>{who.toUpperCase()}</Text>
                    <Text style={font.body}>
                      {theirAnswer.score != null ? `${theirAnswer.score} / 10` : theirAnswer.answer}
                    </Text>
                  </View>
                )}
              </View>
            </FadeInUp>
          );
        })}

        {!state.iAmDone && (
          <View style={styles.actions}>
            <MorphButton onPress={() => save({ finish: false })} disabled={saving} style={styles.secondary}>
              <Text style={styles.secondaryText}>Save for now</Text>
            </MorphButton>
            <MorphButton
              onPress={confirmFinish}
              disabled={saving || answered < state.questions.length}
              style={[styles.primary, answered < state.questions.length && { opacity: 0.5 }]}
            >
              <Text style={styles.primaryText}>
                {answered < state.questions.length
                  ? `${answered} of ${state.questions.length}`
                  : 'Finish'}
              </Text>
            </MorphButton>
          </View>
        )}

        {history.length > 1 && (
          <FadeInUp>
            <Text style={[font.h3, { marginTop: spacing.lg }]}>Over time</Text>
            {/* Deliberately a list rather than a chart. Six months of two
                numbers is not a graph, it is six rows, and a sparkline of
                three points is a decoration pretending to be data. */}
            {history.slice().reverse().map((h) => (
              <View key={h.month} style={styles.historyRow}>
                <Text style={font.body}>{monthName(h.month)}</Text>
                <Text style={font.muted}>{h.myAverage} · {h.theirAverage}</Text>
              </View>
            ))}
          </FadeInUp>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent' },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    celebration: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
    list: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },
    scoreRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    scoreBox: {
      flex: 1, alignItems: 'center', paddingVertical: spacing.md,
      backgroundColor: colors.surface, borderRadius: radius.card,
      borderWidth: 1, borderColor: colors.border,
    },
    scoreValue: { fontSize: 28, fontWeight: '800', color: colors.accent },
    card: {
      backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.md,
      borderWidth: 1, borderColor: colors.border,
    },
    question: { fontWeight: '600', marginBottom: spacing.sm },
    scale: { flexDirection: 'row', gap: 4 },
    pip: {
      flex: 1, aspectRatio: 1, borderRadius: radius.sm,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
    },
    pipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    pipText: { fontSize: 11, color: colors.textSecondary, fontWeight: '700' },
    scaleLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
    input: {
      borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
      padding: spacing.sm, minHeight: 64, textAlignVertical: 'top',
      color: colors.textPrimary, backgroundColor: colors.surfaceAlt,
    },
    theirs: {
      marginTop: spacing.sm, paddingTop: spacing.sm,
      borderTopWidth: 1, borderTopColor: colors.border,
    },
    actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    secondary: {
      flex: 1, alignItems: 'center', paddingVertical: spacing.md,
      borderRadius: radius.pill, backgroundColor: colors.surface,
      borderWidth: 1, borderColor: colors.border,
    },
    secondaryText: { fontWeight: '700', color: colors.textPrimary },
    primary: {
      flex: 1, alignItems: 'center', paddingVertical: spacing.md,
      borderRadius: radius.pill, backgroundColor: colors.accent,
    },
    primaryText: { color: '#fff', fontWeight: '700' },
    historyRow: {
      flexDirection: 'row', justifyContent: 'space-between',
      paddingVertical: spacing.sm,
      borderBottomWidth: 1, borderBottomColor: colors.border,
    },
  });
