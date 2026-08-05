import { useEffect, useState, useCallback } from "react";
import { View, Text, TextInput, Button, StyleSheet, ActivityIndicator } from "react-native";
import { api } from "../services/api";

export default function DailyPromptScreen() {
  const [data, setData] = useState(null);
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getTodayPrompt();
      setData(result);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await api.respondToPrompt(answer);
      await load(); // refetch — will now show "waiting on partner" or the reveal
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <ActivityIndicator style={styles.centered} />;
  if (!data) return <Text style={styles.centered}>No prompt today yet.</Text>;

  return (
    <View style={styles.container}>
      <Text style={styles.streak}>🔥 {data.streakCount} day streak</Text>
      <Text style={styles.prompt}>{data.prompt.content}</Text>

      {!data.myResponse && (
        <>
          <TextInput
            style={styles.input}
            placeholder="Your answer..."
            value={answer}
            onChangeText={setAnswer}
            multiline
          />
          <Button title={submitting ? "Submitting..." : "Submit"} onPress={handleSubmit} disabled={submitting} />
        </>
      )}

      {data.myResponse && !data.bothAnswered && (
        <Text style={styles.waiting}>You answered. Waiting on your partner to reveal both answers...</Text>
      )}

      {data.bothAnswered && (
        <View style={styles.reveal}>
          <Text style={styles.answerLabel}>You said:</Text>
          <Text style={styles.answerText}>{data.myResponse.answer_text}</Text>
          <Text style={styles.answerLabel}>They said:</Text>
          <Text style={styles.answerText}>{data.partnerResponse.answer_text}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16 },
  centered: { flex: 1, textAlign: "center", marginTop: 40 },
  streak: { fontSize: 14, color: "#888" },
  prompt: { fontSize: 22, fontWeight: "600" },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 12, fontSize: 16, minHeight: 80 },
  waiting: { color: "#888", fontStyle: "italic" },
  reveal: { gap: 8 },
  answerLabel: { fontWeight: "600", color: "#888" },
  answerText: { fontSize: 16 },
});
