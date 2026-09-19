// Anagrams — a race, not a solo puzzle.
//
// Both phones get the same eight scrambled words. You tap letters to build
// your answer and move on; neither of you waits for the other.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import { useTheme } from '../../components/ThemeContext';
import { MorphButton, Pop } from '../../components/Motion';
import { useMatch } from '../../components/games/useMatch';
import MatchFrame from '../../components/games/MatchFrame';
import RaceHeader from '../../components/games/RaceHeader';

export default function AnagramsScreen() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const m = useMatch('anagrams');
  const s = m.match?.state;

  const [picked, setPicked] = useState([]);

  // A new round means a fresh set of tiles.
  useEffect(() => { setPicked([]); }, [s?.round]);

  const letters = (s?.scrambled || '').split('');
  const guess = picked.map((i) => letters[i]).join('');
  const canPlay = m.match?.status === 'active' && !s?.done && !m.busy;

  const tap = (i) => {
    if (!canPlay) return;
    setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]));
  };

  return (
    <MatchFrame
      title="Anagrams"
      subtitle="Same eight words, both phones. Unscramble them faster."
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

          {s.done ? (
            <Text style={[font.h2, styles.finished]}>
              All eight done. {s.opponentDone ? '' : 'Waiting for them…'}
            </Text>
          ) : (
            <View style={styles.card}>
              <Text style={font.muted}>{s.length} letters</Text>

              <View style={styles.answerBox}>
                <Text style={[font.h1, styles.answer]}>
                  {guess || '—'}
                </Text>
              </View>

              <View style={styles.tiles}>
                {letters.map((letter, i) => {
                  const used = picked.includes(i);
                  return (
                    <Pressable key={i} onPress={() => tap(i)} disabled={!canPlay}>
                      <Pop active={used}>
                        <View style={[styles.tile, used && styles.tileUsed]}>
                          <Text style={[font.h2, used && { color: '#fff' }]}>{letter}</Text>
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
                  onPress={() => { m.play({ guess }); setPicked([]); }}
                  disabled={!canPlay || picked.length !== letters.length}
                  style={[
                    styles.primary,
                    (!canPlay || picked.length !== letters.length) && styles.disabled,
                  ]}
                >
                  <Text style={styles.primaryText}>Submit</Text>
                </MorphButton>

                <MorphButton onPress={() => m.play({ action: 'skip' })} disabled={!canPlay} style={styles.secondary}>
                  <Text style={font.muted}>Skip</Text>
                </MorphButton>
              </View>

              {s.misses > 0 && (
                <Text style={[font.muted, { marginTop: spacing.sm }]}>
                  {s.misses} wrong {s.misses === 1 ? 'guess' : 'guesses'} so far
                </Text>
              )}
            </View>
          )}
        </>
      )}
    </MatchFrame>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.md,
      borderWidth: 1, borderColor: colors.border,
    },
    answerBox: {
      minHeight: 56, borderRadius: radius.md, backgroundColor: colors.surfaceAlt,
      alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm,
      borderWidth: 1, borderColor: colors.border,
    },
    answer: { letterSpacing: 3 },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md, justifyContent: 'center' },
    tile: {
      width: 44, height: 50, borderRadius: radius.sm,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
    },
    tileUsed: { backgroundColor: colors.accentPink, borderColor: colors.accentPink },
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
    finished: { textAlign: 'center', marginTop: spacing.lg },
  });
