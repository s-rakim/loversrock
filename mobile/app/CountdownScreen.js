import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, FlatList, Alert, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch } from '../services/api';
import { colors, font, spacing, radius } from '../theme';
import { FadeInUp, MorphButton } from '../components/Motion';
import Icon from '../components/Icon';
import StickerField from '../components/Stickers';

function timeLeft(targetDate) {
  const diff = new Date(targetDate).getTime() - Date.now();
  if (diff <= 0) return 'Today!';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  return `${days}d ${hours}h`;
}

export default function CountdownScreen() {
  const [countdowns, setCountdowns] = useState([]);
  const [label, setLabel] = useState('');
  const [dateInput, setDateInput] = useState(''); // YYYY-MM-DD
  const [, forceTick] = useState(0);

  const load = useCallback(() => {
    apiFetch('/countdowns').then((d) => setCountdowns(d.countdowns)).catch((err) => Alert.alert('Error', err.message));
  }, []);

  useFocusEffect(load);

  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, []);

  async function add() {
    if (!label.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
      Alert.alert('Check your input', 'Enter a label and a date formatted YYYY-MM-DD.');
      return;
    }
    try {
      const data = await apiFetch('/countdowns', {
        method: 'POST',
        body: { label: label.trim(), targetDate: new Date(`${dateInput}T00:00:00`).toISOString() },
      });
      setCountdowns((prev) => [...prev, data.countdown].sort((a, b) => new Date(a.target_date) - new Date(b.target_date)));
      setLabel('');
      setDateInput('');
    } catch (err) {
      Alert.alert('Could not add countdown', err.message);
    }
  }

  async function remove(id) {
    try {
      await apiFetch(`/countdowns/${id}`, { method: 'DELETE' });
      setCountdowns((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      Alert.alert('Could not delete', err.message);
    }
  }

  return (
    <View style={styles.container}>
      <StickerField variant="minimal" />
      <View style={styles.form}>
        <TextInput
          placeholder="Label (e.g. Anniversary trip)"
          placeholderTextColor={colors.textMuted}
          value={label}
          onChangeText={setLabel}
          style={styles.input}
        />
        <TextInput
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.textMuted}
          value={dateInput}
          onChangeText={setDateInput}
          style={styles.input}
        />
        <MorphButton onPress={add} style={styles.addButton}>
          <Text style={styles.addButtonText}>Add countdown</Text>
        </MorphButton>
      </View>

      <FlatList
        data={countdowns}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: spacing.xl }}
        renderItem={({ item, index }) => (
          <FadeInUp delay={index * 30}>
            <View style={styles.card}>
              <Icon name="hourglass-outline" chip chipSize={36} style={{ marginRight: spacing.sm }} />
              <View style={{ flex: 1 }}>
                <Text style={font.h2}>{item.label}</Text>
                <Text style={styles.countdownText}>{timeLeft(item.target_date)}</Text>
              </View>
              <Icon name="trash-outline" chip={false} color={colors.danger} onPress={() => remove(item.id)} />
            </View>
          </FadeInUp>
        )}
        ListEmptyComponent={<Text style={[font.muted, { padding: spacing.lg }]}>No countdowns yet.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  form: { marginBottom: spacing.lg },
  input: {
    backgroundColor: colors.surface, color: colors.text, borderRadius: radius.md, padding: spacing.md,
    marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  addButton: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingVertical: spacing.sm, alignItems: 'center' },
  addButtonText: { color: '#fff', fontWeight: '700' },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  countdownText: { color: colors.accent, fontWeight: '700', marginTop: spacing.xs },
  removeButton: { paddingHorizontal: spacing.sm },
});
