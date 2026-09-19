// The scoreboard every race game shares: your score against theirs, and how
// far through each of you is. Pulled out because all five need exactly the
// same thing and it is the sort of panel that drifts if each writes its own.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import { useTheme } from '../ThemeContext';
import { GrowBar } from '../Motion';

export default function RaceHeader({
  score, opponentScore, progress, opponentProgress, total,
  label = 'Round', lowerIsBetter = false, done, opponentDone,
}) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const ahead = lowerIsBetter ? score < opponentScore : score > opponentScore;
  const level = score === opponentScore;

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.side}>
          <Text style={font.muted}>You</Text>
          <Text style={[font.h1, ahead && !level && { color: colors.success }]}>{score}</Text>
          <Text style={[font.muted, { fontSize: 11 }]}>
            {done ? 'Finished' : `${label} ${progress} of ${total}`}
          </Text>
          <GrowBar value={progress / total} style={[styles.bar, { backgroundColor: colors.accentPink }]} />
        </View>

        <View style={styles.middle}>
          {level ? (
            <Ionicons name="remove-outline" size={20} color={colors.textSecondary} />
          ) : (
            <Ionicons
              name={ahead ? 'chevron-back' : 'chevron-forward'}
              size={22}
              color={ahead ? colors.success : colors.danger}
            />
          )}
        </View>

        <View style={[styles.side, { alignItems: 'flex-end' }]}>
          <Text style={font.muted}>Them</Text>
          <Text style={[font.h1, !ahead && !level && { color: colors.success }]}>{opponentScore}</Text>
          <Text style={[font.muted, { fontSize: 11 }]}>
            {opponentDone ? 'Finished' : `${label} ${opponentProgress} of ${total}`}
          </Text>
          <GrowBar
            value={opponentProgress / total}
            style={[styles.bar, { backgroundColor: colors.accentIndigo, alignSelf: 'flex-end' }]}
          />
        </View>
      </View>

      {done && !opponentDone && (
        <Text style={[font.muted, styles.waiting]}>
          You're done — waiting for them to finish.
        </Text>
      )}
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface, borderRadius: radius.card,
      padding: spacing.md, marginBottom: spacing.md,
      borderWidth: 1, borderColor: colors.border,
    },
    row: { flexDirection: 'row', alignItems: 'flex-start' },
    side: { flex: 1 },
    middle: { width: 36, alignItems: 'center', justifyContent: 'center', paddingTop: spacing.lg },
    bar: { height: 5, borderRadius: 3, marginTop: 4, minWidth: 2 },
    waiting: { textAlign: 'center', marginTop: spacing.sm },
  });
