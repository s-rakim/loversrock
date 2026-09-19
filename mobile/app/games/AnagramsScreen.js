import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { spacing, radius } from '../../theme';
import { MorphButton, FadeInUp } from '../../components/Motion';
import Icon from '../../components/Icon';
import StickerField from '../../components/Stickers';
import { useTheme } from '../../components/ThemeContext';

const WORD_BANK = [
  'LOVE', 'HEART', 'KISS', 'HUGS', 'DATE', 'SWEET', 'DREAM', 'TOGETHER',
  'FOREVER', 'ADVENTURE', 'LAUGH', 'CUDDLE', 'SUNSET', 'HOLDHANDS', 'PARTNER',
];

function shuffle(word) {
  const letters = word.split('');
  for (let i = letters.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }
  const scrambled = letters.join('');
  return scrambled === word ? shuffle(word) : scrambled;
}

export default function AnagramsScreen() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [wordIndex, setWordIndex] = useState(0);
  const [scrambled, setScrambled] = useState(() => shuffle(WORD_BANK[0]));
  const [picked, setPicked] = useState([]);
  const [remainingIdx, setRemainingIdx] = useState(() => shuffle(WORD_BANK[0]).split('').map((_, i) => i));
  const [score, setScore] = useState(0);
  const [feedback, setFeedback] = useState(null);

  const word = WORD_BANK[wordIndex % WORD_BANK.length];
  const letters = useMemo(() => scrambled.split(''), [scrambled]);

  function pickLetter(i) {
    if (!remainingIdx.includes(i)) return;
    setPicked((prev) => [...prev, i]);
    setRemainingIdx((prev) => prev.filter((idx) => idx !== i));
  }

  function undo() {
    const last = picked[picked.length - 1];
    if (last === undefined) return;
    setPicked((prev) => prev.slice(0, -1));
    setRemainingIdx((prev) => [...prev, last]);
  }

  function checkAnswer() {
    const guess = picked.map((i) => letters[i]).join('');
    if (guess === word) {
      setScore((s) => s + 1);
      setFeedback('correct');
      setTimeout(nextWord, 700);
    } else {
      setFeedback('wrong');
    }
  }

  function nextWord() {
    const nextIndex = wordIndex + 1;
    const nextWordText = WORD_BANK[nextIndex % WORD_BANK.length];
    const nextScrambled = shuffle(nextWordText);
    setWordIndex(nextIndex);
    setScrambled(nextScrambled);
    setPicked([]);
    setRemainingIdx(nextScrambled.split('').map((_, i) => i));
    setFeedback(null);
  }

  return (
    <View style={styles.container}>
      <StickerField variant="minimal" />
      <FadeInUp>
        <Text style={font.muted}>Score: {score}</Text>
        <Text style={[font.h2, { marginVertical: spacing.md }]}>Unscramble the word</Text>
      </FadeInUp>

      <View style={styles.answerRow}>
        {picked.map((i, idx) => (
          <Pressable key={idx} onPress={undo} style={styles.tile}>
            <Text style={styles.tileText}>{letters[i]}</Text>
          </Pressable>
        ))}
        {picked.length === 0 && <Text style={font.muted}>Tap letters below</Text>}
      </View>

      <View style={styles.lettersRow}>
        {remainingIdx.map((i) => (
          <Pressable key={i} onPress={() => pickLetter(i)} style={[styles.tile, styles.tileAvailable]}>
            <Text style={styles.tileText}>{letters[i]}</Text>
          </Pressable>
        ))}
      </View>

      {feedback === 'wrong' && <Text style={{ color: colors.danger, marginTop: spacing.md }}>Not quite — try again.</Text>}
      {feedback === 'correct' && (
        <View style={styles.correctRow}>
          <Icon name="sparkles" color={colors.gold} size={16} />
          <Text style={{ color: colors.success, fontWeight: '700' }}>Correct!</Text>
        </View>
      )}

      <View style={styles.actions}>
        <MorphButton onPress={checkAnswer} disabled={remainingIdx.length > 0} style={styles.checkButton}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>Check</Text>
        </MorphButton>
        <MorphButton onPress={nextWord} style={styles.skipButton}>
          <Text style={font.body}>Skip</Text>
        </MorphButton>
      </View>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', alignItems: 'center', padding: spacing.lg },
  correctRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.md },
  answerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, minHeight: 56, marginVertical: spacing.lg, justifyContent: 'center' },
  lettersRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, justifyContent: 'center' },
  tile: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  tileAvailable: { backgroundColor: colors.surface },
  tileText: { color: colors.text, fontWeight: '700', fontSize: 18 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  checkButton: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  skipButton: { backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
});
