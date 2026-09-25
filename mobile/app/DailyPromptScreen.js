import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, TextInput, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { apiFetch } from '../services/api';
import { spacing, radius } from '../theme';
import { FadeInUp, MorphButton } from '../components/Motion';
import Icon from '../components/Icon';
import StickerField from '../components/Stickers';
import CelebrationBurst from '../components/Celebration';
import { useTheme } from '../components/ThemeContext';

export default function DailyPromptScreen() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors, font), [colors, font]);
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState(null);
  const [myAnswer, setMyAnswer] = useState(null);
  const [partnerAnswer, setPartnerAnswer] = useState(null);
  const [bothAnswered, setBothAnswered] = useState(false);
  const [streak, setStreak] = useState(0);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [celebrateTrigger, setCelebrateTrigger] = useState(0);
  const [followUp, setFollowUp] = useState(null);
  const [followDraft, setFollowDraft] = useState('');
  const [followSending, setFollowSending] = useState(false);

  useEffect(() => {
    apiFetch('/daily-prompt/today')
      .then((data) => {
        setPrompt(data.prompt);
        setMyAnswer(data.myAnswer);
        setPartnerAnswer(data.partnerAnswer);
        setBothAnswered(data.bothAnswered);
        setStreak(data.streakCount);
        setFollowUp(data.followUp || null);
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
      if (data.bothAnswered) {
        setCelebrateTrigger((n) => n + 1);
        // The follow-up only exists once you have both answered, and it is
        // built server-side from THEIR answer — so it has to be fetched
        // rather than derived from what just came back.
        apiFetch('/daily-prompt/today')
          .then((fresh) => setFollowUp(fresh.followUp || null))
          .catch(() => {});
      }
    } catch (err) {
      Alert.alert('Could not submit', err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitFollowUp() {
    const text = followDraft.trim();
    if (!text || !followUp) return;
    setFollowSending(true);
    try {
      const data = await apiFetch(`/daily-prompt/follow-up/${followUp.id}/respond`, {
        method: 'POST', body: { answer: text },
      });
      setFollowUp((f) => ({ ...f, ...data }));
      setFollowDraft('');
    } catch (err) {
      Alert.alert('Could not send that', err.message);
    } finally {
      setFollowSending(false);
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
            <>
              <View style={styles.answerCard}>
                <Text style={font.muted}>Their answer</Text>
                <Text style={font.body}>{partnerAnswer}</Text>
              </View>

              {/* The follow-up. Built from what THEY said, which is why it
                  cannot appear until both of you have answered — the question
                  would otherwise leak their answer. */}
              {followUp && (
                <View style={styles.followCard}>
                  <Text style={styles.followLabel}>GOING DEEPER</Text>
                  <Text style={[font.h3, { marginTop: 2 }]}>{followUp.question}</Text>

                  {followUp.myAnswer === null ? (
                    <>
                      <TextInput
                        placeholder="Your answer…"
                        placeholderTextColor={colors.textMuted}
                        value={followDraft}
                        onChangeText={setFollowDraft}
                        multiline
                        style={styles.input}
                      />
                      <MorphButton
                        onPress={submitFollowUp}
                        disabled={followSending || !followDraft.trim()}
                        style={[styles.primaryButton, (followSending || !followDraft.trim()) && { opacity: 0.6 }]}
                      >
                        <Text style={styles.primaryButtonText}>
                          {followSending ? 'Sending…' : 'Answer'}
                        </Text>
                      </MorphButton>
                    </>
                  ) : (
                    <>
                      <View style={styles.answerCard}>
                        <Text style={font.muted}>You</Text>
                        <Text style={font.body}>{followUp.myAnswer}</Text>
                      </View>
                      {followUp.bothAnswered ? (
                        <View style={styles.answerCard}>
                          <Text style={font.muted}>Them</Text>
                          <Text style={font.body}>{followUp.partnerAnswer}</Text>
                        </View>
                      ) : (
                        <View style={styles.waitingCard}>
                          <Icon name="hourglass-outline" size={16} color={colors.textMuted} />
                          <Text style={font.muted}>Waiting on them for this one.</Text>
                        </View>
                      )}
                    </>
                  )}
                </View>
              )}
            </>
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

const makeStyles = (colors, font) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', padding: spacing.lg },
  centered: { flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
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
  followCard: {
    marginTop: spacing.md, padding: spacing.md,
    backgroundColor: colors.accentSoft, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.accent,
  },
  followLabel: {
    fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: colors.accent,
  },
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
