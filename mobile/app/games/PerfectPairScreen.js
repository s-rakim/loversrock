import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { spacing, radius } from '../../theme';
import { MorphButton, FadeInUp } from '../../components/Motion';
import StickerField from '../../components/Stickers';
import { useTheme } from '../../components/ThemeContext';

// Each word maps to its one "correct" association plus a few distractors —
// picking the correct word continues the chain; any wrong pick ends it.
const ASSOCIATIONS = {
  SUN: { correct: 'BEACH', distractors: ['SNOW', 'MIDNIGHT', 'CELLAR'] },
  BEACH: { correct: 'WAVES', distractors: ['DESERT', 'ATTIC', 'GLACIER'] },
  WAVES: { correct: 'OCEAN', distractors: ['MOUNTAIN', 'PAVEMENT', 'CEILING'] },
  OCEAN: { correct: 'SHIP', distractors: ['CACTUS', 'ELEVATOR', 'CANDLE'] },
  SHIP: { correct: 'ANCHOR', distractors: ['KEYBOARD', 'BALLOON', 'PILLOW'] },
  ANCHOR: { correct: 'HARBOR', distractors: ['GALAXY', 'NOTEBOOK', 'FOREST'] },
  HARBOR: { correct: 'LIGHTHOUSE', distractors: ['SUBWAY', 'BAKERY', 'ORCHARD'] },
  LIGHTHOUSE: { correct: 'STORM', distractors: ['LIBRARY', 'STADIUM', 'GARDEN'] },
  STORM: { correct: 'RAINBOW', distractors: ['DESK', 'BRIDGE', 'FENCE'] },
  RAINBOW: { correct: 'SUN', distractors: ['TUNNEL', 'CARPET', 'MIRROR'] },
};

function shuffled(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export default function PerfectPairScreen() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [current, setCurrent] = useState('SUN');
  const [chain, setChain] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [options, setOptions] = useState(() => buildOptions('SUN'));

  function buildOptions(word) {
    const entry = ASSOCIATIONS[word];
    return shuffled([entry.correct, ...entry.distractors]);
  }

  function pick(choice) {
    if (gameOver) return;
    const entry = ASSOCIATIONS[current];
    if (choice === entry.correct) {
      const nextChain = chain + 1;
      setChain(nextChain);
      const next = ASSOCIATIONS[choice] ? choice : 'SUN';
      setCurrent(next);
      setOptions(buildOptions(next));
    } else {
      setGameOver(true);
    }
  }

  function restart() {
    setCurrent('SUN');
    setChain(0);
    setGameOver(false);
    setOptions(buildOptions('SUN'));
  }

  return (
    <View style={styles.container}>
      <StickerField variant="minimal" />
      <FadeInUp>
        <Text style={font.muted}>Chain: {chain}</Text>
        <Text style={[font.h1, { marginVertical: spacing.lg, textAlign: 'center' }]}>{current}</Text>
        <Text style={[font.muted, { textAlign: 'center', marginBottom: spacing.lg }]}>
          What does this make you think of?
        </Text>
      </FadeInUp>

      {!gameOver ? (
        <View style={styles.optionsGrid}>
          {options.map((opt) => (
            <MorphButton key={opt} onPress={() => pick(opt)} style={styles.optionButton}>
              <Text style={font.body}>{opt}</Text>
            </MorphButton>
          ))}
        </View>
      ) : (
        <FadeInUp>
          <Text style={[font.h2, { color: colors.danger, textAlign: 'center' }]}>Chain broken!</Text>
          <Text style={[font.muted, { textAlign: 'center', marginBottom: spacing.md }]}>Final chain: {chain}</Text>
          <MorphButton onPress={restart} style={styles.restartButton}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Try again</Text>
          </MorphButton>
        </FadeInUp>
      )}
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  optionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' },
  optionButton: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderWidth: 1, borderColor: colors.border, minWidth: '40%', alignItems: 'center' },
  restartButton: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, alignSelf: 'center' },
});
