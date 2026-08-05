import { useState } from "react";
import { View, Text, TextInput, Button, StyleSheet, Alert, Share } from "react-native";
import { api } from "../services/api";

export default function PairingScreen({ navigation, route }) {
  const [code, setCode] = useState(route.params?.code || "");
  const [inviteCode, setInviteCode] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleCreateInvite() {
    setLoading(true);
    try {
      // Pair timezone is pinned at creation to the inviter's device timezone (SPEC.md pinned decision #2).
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const data = await api.createInvite(timezone);
      setInviteCode(data.invite_code);
      await Share.share({ message: `Join me on CandleApp! Use code: ${data.invite_code}` });
    } catch (err) {
      Alert.alert("Couldn't create invite", err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAcceptInvite() {
    setLoading(true);
    try {
      await api.acceptInvite(code.toUpperCase());
      navigation.replace("DailyPrompt");
    } catch (err) {
      Alert.alert("Couldn't link partner", err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Link with your partner</Text>

      <Button title="Generate invite code" onPress={handleCreateInvite} disabled={loading} />
      {inviteCode && <Text style={styles.codeDisplay}>Your code: {inviteCode}</Text>}

      <Text style={styles.orText}>— or —</Text>

      <TextInput
        style={styles.input}
        placeholder="Enter partner's code"
        autoCapitalize="characters"
        value={code}
        onChangeText={setCode}
      />
      <Button title={loading ? "Linking..." : "Accept code"} onPress={handleAcceptInvite} disabled={loading} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, gap: 16 },
  heading: { fontSize: 22, fontWeight: "600", textAlign: "center", marginBottom: 16 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 12, fontSize: 16 },
  codeDisplay: { textAlign: "center", fontSize: 18, fontWeight: "500" },
  orText: { textAlign: "center", color: "#888" },
});
