import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { apiFetch } from '../services/api';
import { colors, font, spacing, radius } from '../theme';
import { FadeInUp, MorphButton } from '../components/Motion';
import Icon from '../components/Icon';
import StickerField from '../components/Stickers';
import CelebrationBurst from '../components/Celebration';

export default function DailyPromptScreen() {
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState(null);
  const [myAnswer, setMyAnswer] = useState(null);
  const [partnerAnswer, setPartnerAnswer] = useState(null);
  const [bothAnswered, setBothAnswered] = useState(false);
  const [streak, setStreak] = useState(0);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [celebrateTrigger, setCelebrateTrigger] = useState(0);

  useEffect(() => {
    apiFetch('/daily-prompt/today')
      .then((data) => {
        setPrompt(data.prompt);
        setMyAnswer(data.myAnswer);
        setPartnerAnswer(data.partnerAnswer);
        setBothAnswered(data.bothAnswered);
        setStreak(data.streakCount);
      })
      .catch((err) => Alert.alert('Could not load prompt', err.message))
      .finally(() => setLoading(false));
  }, []);

  async function submit() {
    if (!draft.trim()) return;
    setSubmitting(true);
    try {
      const data = await apiFetch('/daily-prompt/today/respond', { method: 'POST', body: { answerText: draft.trim() } });
      setMyAnswer(data.myAnswer);
      setPartnerAnswer(data.partnerAnswer);
      setBothAnswered(data.bothAnswered);
      setStreak(data.streakCount);
      if (data.bothAnswered) setCelebrateTrigger((n) => n + 1);
    } catch (err) {
      Alert.alert('Could not submit', err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!prompt) {
    return (
      <View style={styles.centered}>
        <Text style={font.body}>No prompt scheduled for today. Check back tomorrow.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StickerField variant={bothAnswered ? 'celebrate' : 'form'} />
      {bothAnswered && (
        <View style={styles.celebrationLayer}>
          <CelebrationBurst trigger={celebrateTrigger} />
        </View>
      )}
      <FadeInUp>
        <View style={styles.streakPill}>
          <Icon name="flame" size={16} color={colors.gold} />
          <Text style={styles.streakText}>{streak} day streak</Text>
        </View>
        <Text style={styles.prompt}>{prompt.content}</Text>
      </FadeInUp>

      {myAnswer === null ? (
        <FadeInUp delay={80}>
          <TextInput
            placeholder="Your answer…"
            placeholderTextColor={colors.textMuted}
            value={draft}
            onChangeText={setDraft}
            multiline
            style={styles.input}
          />
          <MorphButton onPress={submit} disabled={submitting} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>{submitting ? 'Submitting…' : 'Submit answer'}</Text>
          </MorphButton>
        </FadeInUp>
      ) : (
        <FadeInUp delay={80}>
          <View style={styles.answerCard}>
            <Text style={font.muted}>Your answer</Text>
            <Text style={font.body}>{myAnswer}</Text>
          </View>

          {bothAnswered ? (
            <View style={styles.answerCard}>
              <Text style={font.muted}>Their answer</Text>
              <Text style={font.body}>{partnerAnswer}</Text>
            </View>
          ) : (
            <View style={styles.waitingCard}>
              <Icon name="hourglass-outline" size={16} color={colors.textMuted} />
              <Text style={font.muted}>Waiting for your partner to answer to reveal theirs…</Text>
            </View>
          )}
        </FadeInUp>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  centered: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  streakPill: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start',
    backgroundColor: colors.surface, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginBottom: spacing.md,
  },
  streakText: { color: colors.text, fontWeight: '700' },
  prompt: { ...font.h1, marginBottom: spacing.lg },
  input: {
    backgroundColor: colors.surface, color: colors.text, borderRadius: radius.md, padding: spacing.md,
    minHeight: 100, textAlignVertical: 'top', borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
  },
  primaryButton: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingVertical: spacing.md, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '700' },
  answerCard: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  waitingCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed',
  },
  celebrationLayer: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 220, alignItems: 'center', justifyContent: 'center', zIndex: 5,
  },
});
