// The headline a finished quiz earns, and the side-by-side comparison
// underneath it.
//
// Shown only once BOTH of you have answered everything — before that the
// partner's answers are not in the payload at all, so there is nothing here
// that could render early by mistake.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { spacing, radius } from '../theme';
import { useTheme } from './ThemeContext';
import { Stagger, GrowBar } from './Motion';

// Each tier gets its own look, so the result reads at a glance before the
// words are.
const TIER = {
  perfect: { icon: 'heart', light: ['#FFC1CC', '#FFDCA8'], dark: ['#7A1F6B', '#A3197D'] },
  strong: { icon: 'sparkles', light: ['#C7CFFF', '#E3C9FF'], dark: ['#3B2FA0', '#5B2A8C'] },
  growing: { icon: 'leaf', light: ['#C1F5DC', '#C1EAF5'], dark: ['#1F5B4A', '#22485F'] },
};

export default function QuizResult({ result, questions }) {
  const { colors, font, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (!result) return null;

  const tier = TIER[result.tier] || TIER.growing;
  const gradient = isDark ? tier.dark : tier.light;

  return (
    <Stagger delayStep={70}>
      <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.banner}>
        <Ionicons name={tier.icon} size={34} color={isDark ? '#FFFFFF' : '#3A2A33'} />
        <Text style={[styles.title, { color: isDark ? '#FFFFFF' : '#2A1F26' }]}>{result.title}</Text>
        <Text style={[styles.blurb, { color: isDark ? 'rgba(255,255,255,0.85)' : '#4A3A44' }]}>
          {result.blurb}
        </Text>

        <View style={styles.meter}>
          <GrowBar
            value={result.fraction}
            style={[styles.meterFill, { backgroundColor: isDark ? '#FFFFFF' : '#3A2A33' }]}
          />
        </View>
        <Text style={[styles.count, { color: isDark ? 'rgba(255,255,255,0.9)' : '#3A2A33' }]}>
          {result.matched} of {result.total} matched
        </Text>
      </LinearGradient>

      <View style={styles.card}>
        <Text style={font.h3}>Side by side</Text>
        {questions.map((q) => (
          <View key={q.id} style={styles.row}>
            <Text style={[font.muted, styles.question]} numberOfLines={2}>{q.questionText}</Text>
            <View style={styles.answers}>
              <View style={[styles.answerChip, q.matched && styles.matchedChip]}>
                <Text style={[font.muted, styles.answerLabel]}>You</Text>
                <Text style={font.body}>{q.myAnswer ?? '—'}</Text>
              </View>
              <Ionicons
                name={q.matched ? 'checkmark-circle' : 'remove-circle-outline'}
                size={18}
                color={q.matched ? colors.success : colors.textSecondary}
              />
              <View style={[styles.answerChip, q.matched && styles.matchedChip]}>
                <Text style={[font.muted, styles.answerLabel]}>Them</Text>
                <Text style={font.body}>{q.partnerAnswer ?? '—'}</Text>
              </View>
            </View>
          </View>
        ))}
      </View>
    </Stagger>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    banner: {
      borderRadius: radius.card, padding: spacing.lg,
      alignItems: 'center', marginBottom: spacing.md,
    },
    title: { fontSize: 26, fontWeight: '800', marginTop: spacing.sm, textAlign: 'center' },
    blurb: { fontSize: 14, textAlign: 'center', marginTop: spacing.xs },
    meter: {
      height: 8, borderRadius: 4, width: '100%',
      backgroundColor: 'rgba(0,0,0,0.14)', marginTop: spacing.md, overflow: 'hidden',
    },
    meterFill: { height: 8, borderRadius: 4 },
    count: { fontSize: 12, marginTop: spacing.xs, fontWeight: '600' },
    card: {
      backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.md,
      borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
    },
    row: { marginTop: spacing.md },
    question: { marginBottom: spacing.xs },
    answers: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    answerChip: {
      flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md,
      padding: spacing.sm, borderWidth: 1, borderColor: colors.border,
    },
    matchedChip: { borderColor: colors.success, backgroundColor: `${colors.success}18` },
    answerLabel: { fontSize: 10, marginBottom: 2 },
  });
