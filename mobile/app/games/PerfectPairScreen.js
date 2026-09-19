// Perfect Pair — a race.
//
// Both walk the same association chain from the same word. A wrong pick ends
// your run; the longer run wins. The options are shuffled differently on
// each phone, so glancing at your partner's screen tells you nothing.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import { useTheme } from '../../components/ThemeContext';
import { MorphButton, Pop } from '../../components/Motion';
import { useMatch } from '../../components/games/useMatch';
import MatchFrame from '../../components/games/MatchFrame';
import RaceHeader from '../../components/games/RaceHeader';

export default function PerfectPairScreen() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const m = useMatch('perfect-pair');
  const s = m.match?.state;

  const canPlay = m.match?.status === 'active' && s?.alive && !m.busy;

  return (
    <MatchFrame
      title="Perfect Pair"
      subtitle="Follow the chain. One wrong link ends your run."
      {...m}
      onStart={m.start}
      onResign={m.resign}
    >
      {s && (
        <>
          <RaceHeader
            score={s.score}
            opponentScore={s.opponentScore}
            progress={s.chain.length}
            opponentProgress={s.opponentChainLength}
            total={25}
            label="Link"
            done={!s.alive}
            opponentDone={!s.opponentAlive}
          />

          {s.alive ? (
            <View style={styles.card}>
              <Text style={font.muted}>What goes with</Text>
              <Text style={[font.h1, styles.word]}>{s.word}</Text>

              <View style={styles.options}>
                {s.options.map((option) => (
                  <MorphButton
                    key={option}
                    onPress={() => canPlay && m.play({ choice: option })}
                    disabled={!canPlay}
                    style={styles.option}
                  >
                    <Text style={font.h3}>{option}</Text>
                  </MorphButton>
                ))}
              </View>
            </View>
          ) : (
            <View style={styles.card}>
              <Ionicons name="flag-outline" size={32} color={colors.textSecondary} style={{ alignSelf: 'center' }} />
              <Text style={[font.h2, styles.word]}>Your run ended</Text>
              {s.lastWrong && (
                <Text style={[font.muted, { textAlign: 'center' }]}>
                  You picked {s.lastWrong.picked} — it was {s.lastWrong.correct}.
                </Text>
              )}
              <Text style={[font.muted, { textAlign: 'center', marginTop: spacing.sm }]}>
                {s.opponentAlive ? 'They are still going…' : 'Both runs are over.'}
              </Text>
            </View>
          )}

          <View style={styles.card}>
            <Text style={font.h3}>Your chain ({s.chain.length})</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.sm }}>
              {s.chain.map((word, i) => (
                <View key={`${word}-${i}`} style={styles.chainRow}>
                  <Pop active={i === s.chain.length - 1}>
                    <View style={[styles.chainChip, i === s.chain.length - 1 && styles.chainChipLast]}>
                      <Text style={[font.muted, i === s.chain.length - 1 && { color: '#fff' }]}>{word}</Text>
                    </View>
                  </Pop>
                  {i < s.chain.length - 1 && (
                    <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
                  )}
                </View>
              ))}
            </ScrollView>
          </View>
        </>
      )}
    </MatchFrame>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.md,
      marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border,
    },
    word: { textAlign: 'center', marginVertical: spacing.sm },
    options: { gap: spacing.sm, marginTop: spacing.sm },
    option: {
      backgroundColor: colors.surfaceAlt, borderRadius: radius.pill,
      paddingVertical: spacing.md, alignItems: 'center',
      borderWidth: 1, borderColor: colors.border,
    },
    chainRow: { flexDirection: 'row', alignItems: 'center' },
    chainChip: {
      backgroundColor: colors.surfaceAlt, borderRadius: radius.pill,
      paddingHorizontal: spacing.md, paddingVertical: 6,
    },
    chainChipLast: { backgroundColor: colors.accentPink },
  });
