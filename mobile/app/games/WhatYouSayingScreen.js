// What You Saying — a race.
//
// Letters reveal on demand rather than on a timer. A timer would have meant
// the player whose app happened to be open first got a head start, and it
// would make a round unwinnable if you looked away. Instead every reveal you
// take costs points, so the question is "how few letters do you need?".
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import { useTheme } from '../../components/ThemeContext';
import { MorphButton } from '../../components/Motion';
import { useMatch } from '../../components/games/useMatch';
import MatchFrame from '../../components/games/MatchFrame';
import RaceHeader from '../../components/games/RaceHeader';

export default function WhatYouSayingScreen() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const m = useMatch('what-you-saying');
  const s = m.match?.state;

  const [guess, setGuess] = useState('');
  useEffect(() => { setGuess(''); }, [s?.round]);

  const canPlay = m.match?.status === 'active' && !s?.done && !m.busy;
  const fullyRevealed = s && s.revealed >= s.length;

  return (
    <MatchFrame
      title="What You Saying"
      subtitle="Same six words. Guess with as few letters showing as you can."
      {...m}
      onStart={() => { setGuess(''); return m.start(); }}
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
              All six done. {s.opponentDone ? '' : 'Waiting for them…'}
            </Text>
          ) : (
            <View style={styles.card}>
              <Text style={[font.h1, styles.mask]}>{s.mask}</Text>
              <Text style={[font.muted, { textAlign: 'center' }]}>
                {s.revealed} of {s.length} letters showing
                {' · '}
                worth {Math.max(5, (s.length - s.revealed) * 10)} if you get it now
              </Text>

              <TextInput
                value={guess}
                onChangeText={setGuess}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="Your guess"
                placeholderTextColor={colors.textSecondary}
                style={styles.input}
                onSubmitEditing={() => canPlay && guess.trim() && m.play({ guess })}
              />

              <View style={styles.actions}>
                <MorphButton
                  onPress={() => m.play({ action: 'reveal' })}
                  disabled={!canPlay || fullyRevealed}
                  style={[styles.secondary, (!canPlay || fullyRevealed) && styles.disabled]}
                >
                  <Ionicons name="eye-outline" size={18} color={colors.accentIndigo} />
                  <Text style={font.body}>Reveal</Text>
                </MorphButton>

                <MorphButton
                  onPress={() => { m.play({ guess }); setGuess(''); }}
                  disabled={!canPlay || !guess.trim()}
                  style={[styles.primary, (!canPlay || !guess.trim()) && styles.disabled]}
                >
                  <Text style={styles.primaryText}>Guess</Text>
                </MorphButton>

                <MorphButton onPress={() => m.play({ action: 'skip' })} disabled={!canPlay} style={styles.secondary}>
                  <Text style={font.muted}>Skip</Text>
                </MorphButton>
              </View>

              <Text style={[font.muted, styles.hint]}>
                A wrong guess reveals a letter too.
              </Text>
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
    mask: { textAlign: 'center', letterSpacing: 2, marginBottom: spacing.sm },
    input: {
      backgroundColor: colors.surfaceAlt, color: colors.textPrimary,
      borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md,
      textAlign: 'center', letterSpacing: 2, fontSize: 18,
      borderWidth: 1, borderColor: colors.border,
    },
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
    hint: { textAlign: 'center', marginTop: spacing.sm },
    finished: { textAlign: 'center', marginTop: spacing.lg },
  });
