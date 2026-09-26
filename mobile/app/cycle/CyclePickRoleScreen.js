// Which side of the tracker you are on, asked rather than assumed.
//
// The cycle tracker is the one part of this app that is not symmetric. One of
// you keeps a health diary; the other is shown the parts of it that were
// chosen for them. Every other feature here is the same on both phones, so
// this is the only place the app has to know who is who.
//
// It used to guess, and guessed the same way for everybody: every account got
// the full set of tabs, including the partner's read-only view. Someone
// tracking their own cycle could land on that view, find nothing they could
// change, and reasonably conclude the page was a placeholder.
//
// Asked here, and again from Settings, so nobody is stuck on the wrong side.
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '../../services/api';
import { spacing, radius } from '../../theme';
import { MorphButton } from '../../components/Motion';
import { useTheme } from '../../components/ThemeContext';
import { useCycle } from '../../components/cycle/CycleContext';

// Worded around what the person does, not around gender: both are true for
// whoever they apply to, and the app has no business inferring either.
export const ROLE_CHOICES = [
  {
    key: 'owner',
    icon: 'flower',
    title: 'I track my cycle',
    blurb: 'The calendar, daily logging, symptoms, moods and history — all editable. You decide what your partner sees.',
  },
  {
    key: 'partner',
    icon: 'heart',
    title: "I'm the partner",
    blurb: 'Their phase, what is coming, and whatever they chose to share. Read-only, by design.',
  },
];

export default function CyclePickRoleScreen({ onPicked }) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { setRole } = useCycle();
  const [saving, setSaving] = useState(null);
  const [problem, setProblem] = useState(null);

  async function pick(key) {
    setSaving(key);
    setProblem(null);
    try {
      await apiFetch('/profile/preferences', { method: 'PATCH', body: { cycleRole: key } });
      setRole(key);
      onPicked?.(key);
    } catch (err) {
      // Left on this screen rather than dropped into a half-chosen state: a
      // role that did not save is worse than one not yet picked.
      setProblem(err.message);
      setSaving(null);
    }
  }

  return (
    <View style={styles.root}>
      <Ionicons name="water" size={40} color={colors.accent} />
      <Text style={[font.h1, styles.title]}>Set up your cycle tracker</Text>
      <Text style={[font.muted, styles.body]}>
        This is the one part of loversrock that works differently for each of you.
      </Text>

      <View style={styles.choices}>
        {ROLE_CHOICES.map((choice) => (
          <MorphButton
            key={choice.key}
            onPress={() => pick(choice.key)}
            disabled={saving !== null}
            style={[styles.choice, saving === choice.key && styles.choiceBusy]}
          >
            <View style={styles.choiceHead}>
              <Ionicons name={choice.icon} size={22} color={colors.accent} />
              <Text style={[font.h3, { flex: 1 }]}>{choice.title}</Text>
              {saving === choice.key ? <ActivityIndicator color={colors.accent} /> : null}
            </View>
            <Text style={font.muted}>{choice.blurb}</Text>
          </MorphButton>
        ))}
      </View>

      {problem ? <Text style={styles.problem}>{problem}</Text> : null}

      <Text style={[font.muted, styles.footnote]}>
        You can change this any time in Settings.
      </Text>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    root: { flex: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.sm },
    title: { marginTop: spacing.sm },
    body: { marginBottom: spacing.md },
    choices: { gap: spacing.md },
    choice: {
      padding: spacing.md,
      borderRadius: radius.card,
      borderWidth: 1.5,
      borderColor: colors.cardBorder,
      backgroundColor: colors.card,
      gap: spacing.xs,
    },
    choiceBusy: { borderColor: colors.accent },
    choiceHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    problem: { color: colors.danger ?? '#c0392b', marginTop: spacing.sm },
    footnote: { marginTop: spacing.md, textAlign: 'center' },
  });
