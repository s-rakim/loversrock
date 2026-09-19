// Love Letters — a race.
//
// Five rounds, and you both get the SAME seven letters each round, so it is
// genuinely the same puzzle. The higher-scoring word takes the round. Their
// words stay hidden until you have both finished — on a shared rack, seeing
// them early would just be copying.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import { useTheme } from '../../components/ThemeContext';
import { MorphButton, Pop } from '../../components/Motion';
import { useMatch } from '../../components/games/useMatch';
import MatchFrame from '../../components/games/MatchFrame';
import RaceHeader from '../../components/games/RaceHeader';

// Mirrors the server's table so the running total updates as you tap. The
// server still scores the word; this only previews it.
const LETTER_VALUES = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1,
  M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
};
const previewScore = (word) =>
  word.split('').reduce((sum, l) => sum + (LETTER_VALUES[l] || 0), 0) + (word.length >= 5 ? 5 : 0);

export default function LoveLettersScreen() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const m = useMatch('love-letters');
  const s = m.match?.state;

  const [picked, setPicked] = useState([]);
  useEffect(() => { setPicked([]); }, [s?.round]);

  const rack = s?.rack || [];
  const word = picked.map((i) => rack[i]).join('');
  const canPlay = m.match?.status === 'active' && !s?.done && !m.busy;

  const tap = (i) => {
    if (!canPlay) return;
    setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]));
  };

  return (
    <MatchFrame
      title="Love Letters"
      subtitle="Same seven letters, five rounds. Best word takes it."
      {...m}
      onStart={() => { setPicked([]); return m.start(); }}
      onResign={m.resign}
    >
      {s && (
        <>
          <RaceHeader
            score={s.score}
            opponentScore={s.opponentScore}
            progress={s.round}
            opponentProgress={s.opponentRound}
            total={s.rounds}
            done={s.done}
            opponentDone={s.opponentDone}
          />

          {!s.done && (
            <View style={styles.card}>
              <View style={styles.answerBox}>
                <Text style={[font.h1, styles.answer]}>{word || '—'}</Text>
                {word.length > 0 && (
                  <Text style={[font.muted, { marginTop: 2 }]}>worth {previewScore(word)}</Text>
                )}
              </View>

              <View style={styles.tiles}>
                {rack.map((letter, i) => {
                  const used = picked.includes(i);
                  return (
                    <Pressable key={i} onPress={() => tap(i)} disabled={!canPlay}>
                      <Pop active={used}>
                        <View style={[styles.tile, used && styles.tileUsed]}>
                          <Text style={[font.h2, used && { color: '#fff' }]}>{letter}</Text>
                          <Text style={[styles.tileValue, used && { color: '#fff' }]}>
                            {LETTER_VALUES[letter]}
                          </Text>
                        </View>
                      </Pop>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.actions}>
                <MorphButton onPress={() => setPicked([])} style={styles.secondary}>
                  <Ionicons name="backspace-outline" size={18} color={colors.textPrimary} />
                  <Text style={font.body}>Clear</Text>
                </MorphButton>

                <MorphButton
                  onPress={() => { m.play({ word }); setPicked([]); }}
                  disabled={!canPlay || word.length < 2}
                  style={[styles.primary, (!canPlay || word.length < 2) && styles.disabled]}
                >
                  <Text style={styles.primaryText}>Play word</Text>
                </MorphButton>

                <MorphButton onPress={() => m.play({ action: 'pass' })} disabled={!canPlay} style={styles.secondary}>
                  <Text style={font.muted}>Pass</Text>
                </MorphButton>
              </View>
            </View>
          )}

          <View style={styles.card}>
            <Text style={font.h3}>Scorecard</Text>
            {s.words.map((entry, i) => (
              <View key={i} style={styles.scoreRow}>
                <Text style={font.muted}>Round {i + 1}</Text>
                <Text style={font.body}>{entry.word || 'passed'}</Text>
                <Text style={[font.body, { fontWeight: '700' }]}>{entry.score}</Text>
                {s.opponentWords && (
                  <Text style={[font.muted, { minWidth: 90, textAlign: 'right' }]}>
                    them: {s.opponentWords[i]?.word || 'passed'} ({s.opponentWords[i]?.score ?? 0})
                  </Text>
                )}
              </View>
            ))}
            {s.words.length === 0 && (
              <Text style={[font.muted, { marginTop: spacing.xs }]}>Nothing played yet.</Text>
            )}
            {!s.opponentWords && s.words.length > 0 && (
              <Text style={[font.muted, { marginTop: spacing.sm }]}>
                Their words appear once you've both finished.
              </Text>
            )}
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
    answerBox: {
      minHeight: 62, borderRadius: radius.md, backgroundColor: colors.surfaceAlt,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: colors.border,
    },
    answer: { letterSpacing: 3 },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md, justifyContent: 'center' },
    tile: {
      width: 44, height: 52, borderRadius: radius.sm,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: '#F2E4C9', borderWidth: 1, borderColor: '#D9C5A0',
    },
    tileUsed: { backgroundColor: colors.accentPink, borderColor: colors.accentPink },
    tileValue: { fontSize: 9, position: 'absolute', bottom: 3, right: 4, color: '#7A6642' },
    actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
    secondary: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      borderRadius: radius.pill, backgroundColor: colors.surfaceAlt,
    },
    primary: {
      flex: 1, backgroundColor: colors.accentPink, borderRadius: radius.pill,
      paddingVertical: spacing.sm, alignItems: 'center',
    },
    primaryText: { color: '#fff', fontWeight: '700' },
    disabled: { opacity: 0.4 },
    scoreRow: {
      flexDirection: 'row', alignItems: 'center',
      justifyContent: 'space-between', marginTop: spacing.sm, gap: spacing.sm,
    },
  });
