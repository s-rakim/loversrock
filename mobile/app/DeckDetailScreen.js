import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { apiFetch } from '../services/api';
import { spacing, radius } from '../theme';
import { FadeInUp, MorphButton } from '../components/Motion';
import StickerField from '../components/Stickers';
import { useTheme } from '../components/ThemeContext';

export default function DeckDetailScreen({ route, navigation }) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { slug, title } = route.params;
  const [loading, setLoading] = useState(true);
  const [questions, setQuestions] = useState([]);
  const [drafts, setDrafts] = useState({});

  useEffect(() => {
    navigation.setOptions({ title });
    apiFetch(`/decks/${slug}/questions`)
      .then((data) => setQuestions(data.questions))
      .catch((err) => Alert.alert('Could not load deck', err.message))
      .finally(() => setLoading(false));
  }, [slug]);

  async function submit(questionId) {
    const answerText = (drafts[questionId] || '').trim();
    if (!answerText) return;
    try {
      await apiFetch(`/decks/questions/${questionId}/respond`, { method: 'POST', body: { answerText } });
      setQuestions((prev) =>
        prev.map((q) => (q.id === questionId ? { ...q, myAnswer: answerText } : q))
      );
    } catch (err) {
      Alert.alert('Could not submit answer', err.message);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StickerField variant="minimal" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        {questions.map((q, i) => (
          <FadeInUp key={q.id} delay={i * 40}>
            <View style={styles.card}>
              <Text style={font.h2}>{q.questionText}</Text>

              {q.myAnswer === null ? (
                <>
                  <TextInput
                    placeholder="Your answer…"
                    placeholderTextColor={colors.textMuted}
                    value={drafts[q.id] || ''}
                    onChangeText={(text) => setDrafts((d) => ({ ...d, [q.id]: text }))}
                    style={styles.input}
                    multiline
                  />
                  <MorphButton onPress={() => submit(q.id)} style={styles.submitButton}>
                    <Text style={styles.submitButtonText}>Answer</Text>
                  </MorphButton>
                </>
              ) : (
                <View style={{ marginTop: spacing.sm }}>
                  <Text style={font.muted}>You said</Text>
                  <Text style={font.body}>{q.myAnswer}</Text>
                  {q.bothAnswered ? (
                    <>
                      <Text style={[font.muted, { marginTop: spacing.sm }]}>They said</Text>
                      <Text style={font.body}>{q.partnerAnswer}</Text>
                    </>
                  ) : (
                    <Text style={[font.muted, { marginTop: spacing.sm }]}>Waiting on your partner…</Text>
                  )}
                </View>
              )}
            </View>
          </FadeInUp>
        ))}
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  centered: { flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  input: {
    backgroundColor: colors.surfaceAlt, color: colors.text, borderRadius: radius.md,
    padding: spacing.md, marginTop: spacing.sm, minHeight: 60, textAlignVertical: 'top',
  },
  submitButton: { backgroundColor: colors.accent, borderRadius: radius.pill, alignSelf: 'flex-start', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, marginTop: spacing.sm },
  submitButtonText: { color: '#fff', fontWeight: '700' },
});
