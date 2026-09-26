import React, { useCallback, useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiFetch, connectSocket, getSocket } from '../services/api';
import { spacing, radius } from '../theme';
import { useBarClearance } from '../components/LumaBar';
import { FadeInUp, MorphButton, ProgressDot } from '../components/Motion';
import Icon from '../components/Icon';
import StickerField from '../components/Stickers';
import CelebrationBurst from '../components/Celebration';
import { useTheme } from '../components/ThemeContext';
import QuizResult from '../components/QuizResult';

export default function QuizScreen() {
  const { colors, font } = useTheme();
  // The quiz is a bottom tab now rather than a pushed screen, so there is no
  // stack header supplying a title or clearing the status bar. It carries its
  // own.
  const insets = useSafeAreaInsets();
  // Prev/Next sit last on a tab screen, under the floating tab bar's reach.
  const clearance = useBarClearance();
  const styles = useMemo(() => makeStyles(colors, font), [colors, font]);
  const [loading, setLoading] = useState(true);
  const [questions, setQuestions] = useState([]);
  const [index, setIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [celebrateTrigger, setCelebrateTrigger] = useState(0);
  const [progress, setProgress] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [result, setResult] = useState(null);

  const load = useCallback(async (isFirst = false) => {
    try {
      const data = await apiFetch('/quiz/today');
      setQuestions(data.questions);
      setProgress(data.progress);
      setRevealed(Boolean(data.revealed));
      setResult(data.result || null);
      if (isFirst) {
        const firstUnanswered = data.questions.findIndex((q) => q.myAnswer === null);
        setIndex(firstUnanswered === -1 ? 0 : firstUnanswered);
      }
    } catch (err) {
      if (isFirst) Alert.alert('Could not load quiz', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(true); }, [load]);

  // The reveal usually lands while you are sitting on the waiting screen,
  // because the thing you are waiting for is your partner tapping an answer
  // on their phone. Without this you would have to leave and come back.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const socket = await connectSocket();
      if (cancelled) return;
      socket.on('quiz:revealed', () => load());
    })();
    return () => { cancelled = true; getSocket()?.off('quiz:revealed'); };
  }, [load]);

  async function answer(questionId, choice) {
    setSubmitting(true);
    try {
      const outcome = await apiFetch(`/quiz/${questionId}/respond`, { method: 'POST', body: { answer: choice } });
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === questionId
            ? { ...q, myAnswer: outcome.answer, myCorrectnessState: outcome.correctnessState, isCorrect: outcome.isCorrect }
            : q
        )
      );
      if (outcome.correctnessState === 'computed' && outcome.isCorrect) setCelebrateTrigger((n) => n + 1);
      // Answering the last one can complete the day, which brings the
      // partner's answers into the payload for the first time.
      if (outcome.dayComplete) {
        await load();
        setCelebrateTrigger((n) => n + 1);
      } else if (outcome.progress) {
        setProgress((p) => ({ ...(p || {}), ...outcome.progress }));
      }
    } catch (err) {
      Alert.alert('Could not submit answer', err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const Header = ({ subtitle }) => (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Icon name="help-circle" chip chipSize={38} />
      <View style={{ flex: 1 }}>
        <Text style={font.h1}>Daily Quiz</Text>
        {subtitle ? <Text style={font.muted}>{subtitle}</Text> : null}
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (questions.length === 0) {
    return (
      <View style={styles.container}>
        <Header />
        <View style={styles.centered}>
          <Icon name="calendar-outline" size={36} color={colors.textMuted} />
          <Text style={[font.body, { marginTop: spacing.sm }]}>No quiz scheduled for today.</Text>
          <Text style={[font.muted, { marginTop: 2 }]}>A new one lands overnight.</Text>
        </View>
      </View>
    );
  }

  const q = questions[index];
  const iAmDone = progress?.iAmDone ?? questions.every((item) => item.myAnswer !== null);
  const waitingOnThem = iAmDone && !revealed;

  // Once you have both finished, the quiz is a result to read rather than a
  // set of questions to answer.
  if (revealed && result) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: spacing.xl * 4 }}>
        <StickerField variant="minimal" />
        <View style={styles.celebrationLayer}>
          <CelebrationBurst trigger={celebrateTrigger} />
        </View>
        <Header subtitle="Both finished — here's how you did" />
        <QuizResult result={result} questions={questions} />
      </ScrollView>
    );
  }

  // Answered everything, they have not. Their answers are not in the payload
  // yet, so there is nothing to show even by accident.
  if (waitingOnThem) {
    return (
      <View style={styles.container}>
        <StickerField variant="minimal" />
        <Header subtitle="Waiting on them" />
        <View style={styles.centered}>
        <Icon name="hourglass-outline" size={40} color={colors.accent} />
        <Text style={[font.h2, styles.waitTitle]}>All answered</Text>
        <Text style={[font.muted, styles.waitBody]}>
          Your answers stay hidden until your partner finishes theirs.
        </Text>
        {progress && (
          <Text style={[font.muted, styles.waitBody]}>
            They've done {progress.partner} of {progress.total}.
          </Text>
        )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StickerField variant="minimal" />
      <View style={styles.celebrationLayer}>
        <CelebrationBurst trigger={celebrateTrigger} />
      </View>
      <Header subtitle={`Question ${index + 1} of ${questions.length}`} />
      <FadeInUp>
        <View style={styles.dots}>
          {questions.map((item, i) => (
            <ProgressDot key={item.id} active={i === index} />
          ))}
        </View>
        {progress && (
          <Text style={[font.muted, styles.progressLine]}>
            You {progress.mine}/{progress.total} · Them {progress.partner}/{progress.total}
          </Text>
        )}
      </FadeInUp>

      <FadeInUp key={q.id} delay={40}>
        <Text style={styles.questionText}>{q.questionText}</Text>

        <View style={styles.choices}>
          {(q.choices || []).map((choice) => {
            const selected = q.myAnswer === choice;
            return (
              <MorphButton
                key={choice}
                onPress={() => !q.myAnswer && answer(q.id, choice)}
                disabled={submitting || Boolean(q.myAnswer)}
                style={[
                  styles.choiceButton,
                  selected && { borderColor: colors.accent, backgroundColor: colors.surfaceAlt },
                ]}
              >
                <Text style={font.body}>{choice}</Text>
              </MorphButton>
            );
          })}
        </View>

        {q.myAnswer && (
          <View style={styles.resultCard}>
            {q.myCorrectnessState === 'waiting_for_partner' && (
              <View style={styles.resultRow}>
                <Icon name="hourglass-outline" size={16} color={colors.textMuted} />
                <Text style={font.muted}>Waiting for your partner to answer…</Text>
              </View>
            )}
            {q.myCorrectnessState === 'computed' && q.isCorrect !== null && (
              <View style={styles.resultRow}>
                <Icon
                  name={q.isCorrect ? 'checkmark-circle' : 'close-circle'}
                  color={q.isCorrect ? colors.success : colors.danger}
                  size={18}
                />
                <Text style={{ color: q.isCorrect ? colors.success : colors.danger, fontWeight: '700' }}>
                  {q.isCorrect ? 'Correct!' : 'Not quite'}
                </Text>
              </View>
            )}
            {q.myCorrectnessState === 'computed' && q.isCorrect === null && (
              <Text style={font.muted}>Answer locked in.</Text>
            )}
            <Text style={[font.muted, { marginTop: spacing.xs, fontSize: 11 }]}>
              Hidden from your partner until they've answered everything.
            </Text>
          </View>
        )}
      </FadeInUp>

      <View style={[styles.nav, { marginBottom: clearance.above }]}>
        <MorphButton
          onPress={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
          style={styles.navButton}
        >
          <Text style={font.body}>Back</Text>
        </MorphButton>
        <MorphButton
          onPress={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}
          disabled={index === questions.length - 1}
          style={styles.navButton}
        >
          <Text style={font.body}>Next</Text>
        </MorphButton>
      </View>
    </View>
  );
}

const makeStyles = (colors, font) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', paddingHorizontal: spacing.lg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingBottom: spacing.md,
  },
  centered: { flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', marginBottom: spacing.sm },
  progressLine: { textAlign: 'center', marginBottom: spacing.lg },
  waitTitle: { marginTop: spacing.md },
  waitBody: { textAlign: 'center', marginTop: spacing.xs, paddingHorizontal: spacing.xl },
  questionText: { ...font.h1, marginBottom: spacing.lg },
  choices: { gap: spacing.sm },
  choiceButton: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm,
  },
  resultCard: { marginTop: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  nav: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xl },
  navButton: { backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  celebrationLayer: {
    position: 'absolute', top: 60, left: 0, right: 0, height: 200, alignItems: 'center', justifyContent: 'center', zIndex: 5,
  },
});
