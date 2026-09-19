import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, TextInput, StyleSheet, Alert } from 'react-native';
import { spacing, radius } from '../../theme';
import { MorphButton, FadeInUp } from '../../components/Motion';
import StickerField from '../../components/Stickers';
import { useTheme } from '../../components/ThemeContext';

const WORD_BANK = ['ANNIVERSARY', 'CHOCOLATE', 'FIREWORKS', 'VACATION', 'PROPOSAL', 'SERENADE', 'MOONLIGHT', 'BOUQUET'];
const REVEAL_INTERVAL_MS = 2500;

function maskWord(word, revealedCount) {
  return word
    .split('')
    .map((letter, i) => (i < revealedCount ? letter : '_'))
    .join(' ');
}

export default function WhatYouSayingScreen() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [wordIndex, setWordIndex] = useState(0);
  const [revealedCount, setRevealedCount] = useState(1);
  const [guess, setGuess] = useState('');
  const [score, setScore] = useState(0);
  const [solved, setSolved] = useState(false);

  const word = WORD_BANK[wordIndex % WORD_BANK.length];

  useEffect(() => {
    if (solved) return;
    if (revealedCount >= word.length) return;
    const id = setTimeout(() => setRevealedCount((c) => c + 1), REVEAL_INTERVAL_MS);
    return () => clearTimeout(id);
  }, [revealedCount, word, solved]);

  function submitGuess() {
    if (guess.trim().toUpperCase() === word) {
      const points = Math.max(1, word.length - revealedCount + 1);
      setScore((s) => s + points);
      setSolved(true);
    } else {
      Alert.alert('Not quite', 'Try again, or wait for another letter to reveal.');
    }
  }

  function next() {
    setWordIndex((i) => i + 1);
    setRevealedCount(1);
    setGuess('');
    setSolved(false);
  }

  return (
    <View style={styles.container}>
      <StickerField variant="minimal" />
      <FadeInUp>
        <Text style={font.muted}>Score: {score}</Text>
        <Text style={styles.masked}>{maskWord(word, revealedCount)}</Text>
        <Text style={[font.muted, { textAlign: 'center' }]}>
          {solved ? 'Solved!' : `A new letter reveals every ${REVEAL_INTERVAL_MS / 1000}s — guess fast for more points.`}
        </Text>
      </FadeInUp>

      {!solved ? (
        <View style={styles.guessRow}>
          <TextInput
            placeholder="Your guess…"
            placeholderTextColor={colors.textMuted}
            value={guess}
            onChangeText={setGuess}
            autoCapitalize="characters"
            onSubmitEditing={submitGuess}
            style={styles.input}
          />
          <MorphButton onPress={submitGuess} style={styles.primaryButton}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Guess</Text>
          </MorphButton>
        </View>
      ) : (
        <MorphButton onPress={next} style={styles.primaryButton}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>Next word</Text>
        </MorphButton>
      )}
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  masked: { fontSize: 30, fontWeight: '800', letterSpacing: 4, color: colors.accent, marginVertical: spacing.lg, textAlign: 'center' },
  guessRow: { flexDirection: 'row', gap: spacing.sm, width: '100%' },
  input: { flex: 1, backgroundColor: colors.surface, color: colors.text, borderRadius: radius.pill, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border },
  primaryButton: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: spacing.lg, justifyContent: 'center', alignItems: 'center', paddingVertical: spacing.sm },
});
