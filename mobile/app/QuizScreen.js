import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { apiFetch } from '../services/api';
import { colors, font, spacing, radius } from '../theme';
import { FadeInUp, MorphButton, ProgressDot } from '../components/Motion';

export default function QuizScreen() {
  const [loading, setLoading] = useState(true);
  const [questions, setQuestions] = useState([]);
  const [index, setIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch('/quiz/today')
      .then((data) => {
        setQuestions(data.questions);
        const firstUnanswered = data.questions.findIndex((q) => q.myAnswer === null);
        setIndex(firstUnanswered === -1 ? 0 : firstUnanswered);
      })
      .catch((err) => Alert.alert('Could not load quiz', err.message))
      .finally(() => setLoading(false));
  }, []);

  async function answer(questionId, choice) {
    setSubmitting(true);
    try {
      const result = await apiFetch(`/quiz/${questionId}/respond`, { method: 'POST', body: { answer: choice } });
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === questionId
            ? { ...q, myAnswer: result.answer, myCorrectnessState: result.correctnessState, isCorrect: result.isCorrect }
            : q
        )
      );
    } catch (err) {
      Alert.alert('Could not submit answer', err.message);
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

  if (questions.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={font.body}>No quiz scheduled for today.</Text>
      </View>
    );
  }

  const q = questions[index];

  return (
    <View style={styles.container}>
      <FadeInUp>
        <View style={styles.dots}>
          {questions.map((item, i) => (
            <ProgressDot key={item.id} active={i === index} />
          ))}
        </View>
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
              <Text style={font.muted}>Waiting for your partner to answer…</Text>
            )}
            {q.myCorrectnessState === 'computed' && q.isCorrect !== null && (
              <Text style={{ color: q.isCorrect ? colors.success : colors.danger, fontWeight: '700' }}>
                {q.isCorrect ? '✅ Correct!' : '❌ Not quite'}
              </Text>
            )}
            {q.myCorrectnessState === 'computed' && q.isCorrect === null && (
              <Text style={font.muted}>Answer locked in.</Text>
            )}
          </View>
        )}
      </FadeInUp>

      <View style={styles.nav}>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  centered: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', marginBottom: spacing.xl },
  questionText: { ...font.h1, marginBottom: spacing.lg },
  choices: { gap: spacing.sm },
  choiceButton: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm,
  },
  resultCard: { marginTop: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md },
  nav: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xl },
  navButton: { backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
});
