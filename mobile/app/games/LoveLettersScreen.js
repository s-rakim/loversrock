import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { colors, font, spacing, radius } from '../../theme';
import { MorphButton, FadeInUp } from '../../components/Motion';
import StickerField from '../../components/Stickers';

// Standard Scrabble letter point values.
const LETTER_VALUES = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1,
  M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
};

const VOWELS = 'AEIOU';
const CONSONANTS = 'BCDFGHJKLMNPQRSTVWXYZ';

function randomRack() {
  const rack = [];
  for (let i = 0; i < 3; i += 1) rack.push(VOWELS[Math.floor(Math.random() * VOWELS.length)]);
  for (let i = 0; i < 4; i += 1) rack.push(CONSONANTS[Math.floor(Math.random() * CONSONANTS.length)]);
  return rack.sort(() => Math.random() - 0.5);
}

export default function LoveLettersScreen() {
  const [rack, setRack] = useState(randomRack);
  const [usedIdx, setUsedIdx] = useState([]);
  const [totalScore, setTotalScore] = useState(0);
  const [lastWordScore, setLastWordScore] = useState(null);

  const word = usedIdx.map((i) => rack[i]).join('');

  function pick(i) {
    if (usedIdx.includes(i)) return;
    setUsedIdx((prev) => [...prev, i]);
  }

  function undo() {
    setUsedIdx((prev) => prev.slice(0, -1));
  }

  function submit() {
    if (word.length < 2) {
      Alert.alert('Too short', 'Build a word with at least 2 letters.');
      return;
    }
    const score = word.split('').reduce((sum, letter) => sum + (LETTER_VALUES[letter] || 0), 0) + (word.length >= 5 ? 5 : 0);
    setLastWordScore({ word, score });
    setTotalScore((s) => s + score);
    setRack(randomRack());
    setUsedIdx([]);
  }

  return (
    <View style={styles.container}>
      <StickerField variant="minimal" />
      <FadeInUp>
        <Text style={font.muted}>Total score: {totalScore}</Text>
        {lastWordScore && (
          <Text style={[font.muted, { marginTop: spacing.xs }]}>
            Last word: {lastWordScore.word} (+{lastWordScore.score})
          </Text>
        )}
        <Text style={styles.wordDisplay}>{word || '—'}</Text>
      </FadeInUp>

      <View style={styles.rack}>
        {rack.map((letter, i) => {
          const used = usedIdx.includes(i);
          return (
            <Pressable key={i} onPress={() => pick(i)} disabled={used} style={[styles.tile, used && styles.tileUsed]}>
              <Text style={styles.tileLetter}>{letter}</Text>
              <Text style={styles.tileValue}>{LETTER_VALUES[letter]}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.actions}>
        <MorphButton onPress={undo} disabled={usedIdx.length === 0} style={styles.secondaryButton}>
          <Text style={font.body}>Undo</Text>
        </MorphButton>
        <MorphButton onPress={submit} style={styles.primaryButton}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>Submit word</Text>
        </MorphButton>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  wordDisplay: { fontSize: 32, fontWeight: '800', color: colors.accent, letterSpacing: 4, marginVertical: spacing.lg, minHeight: 40 },
  rack: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center', marginBottom: spacing.xl },
  tile: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  tileUsed: { opacity: 0.3 },
  tileLetter: { color: colors.text, fontWeight: '800', fontSize: 18 },
  tileValue: { color: colors.textMuted, fontSize: 10, position: 'absolute', bottom: 3, right: 5 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  primaryButton: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  secondaryButton: { backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
});
