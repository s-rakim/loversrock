import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, FlatList, Alert, AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch, connectSocket } from '../services/api';
import { colors, font, spacing, radius } from '../theme';
import { FadeInUp, MorphButton } from '../components/Motion';

export default function BucketListScreen() {
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState('');

  const load = useCallback(() => {
    apiFetch('/bucket-list')
      .then((data) => setItems(data.items))
      .catch((err) => Alert.alert('Could not load bucket list', err.message));
  }, []);

  useFocusEffect(load);

  // Live sync via Socket.io, with an app-foreground refetch as a fallback
  // in case a socket event was missed while backgrounded.
  useEffect(() => {
    let socketRef;
    connectSocket().then((socket) => {
      socketRef = socket;
      socket.on('bucket:update', ({ item }) => {
        setItems((prev) => {
          const exists = prev.some((i) => i.id === item.id);
          return exists ? prev.map((i) => (i.id === item.id ? item : i)) : [item, ...prev];
        });
      });
    });

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') load();
    });

    return () => {
      socketRef?.off('bucket:update');
      sub.remove();
    };
  }, [load]);

  async function addItem() {
    if (!draft.trim()) return;
    try {
      await apiFetch('/bucket-list', { method: 'POST', body: { title: draft.trim() } });
      setDraft('');
    } catch (err) {
      Alert.alert('Could not add item', err.message);
    }
  }

  async function toggle(item) {
    try {
      await apiFetch(`/bucket-list/${item.id}`, { method: 'PATCH', body: { isCompleted: !item.is_completed } });
    } catch (err) {
      Alert.alert('Could not update item', err.message);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.addRow}>
        <TextInput
          placeholder="Add something to your list…"
          placeholderTextColor={colors.textMuted}
          value={draft}
          onChangeText={setDraft}
          style={styles.input}
          onSubmitEditing={addItem}
        />
        <MorphButton onPress={addItem} style={styles.addButton}>
          <Text style={styles.addButtonText}>Add</Text>
        </MorphButton>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: spacing.xl }}
        renderItem={({ item, index }) => (
          <FadeInUp delay={index * 25}>
            <MorphButton onPress={() => toggle(item)} style={styles.row}>
              <Text style={styles.checkbox}>{item.is_completed ? '✅' : '⬜️'}</Text>
              <Text style={[font.body, item.is_completed && styles.completedText]}>{item.title}</Text>
            </MorphButton>
          </FadeInUp>
        )}
        ListEmptyComponent={<Text style={[font.muted, { padding: spacing.lg }]}>Nothing on your list yet.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  addRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  input: {
    flex: 1, backgroundColor: colors.surface, color: colors.text, borderRadius: radius.md,
    padding: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  addButton: { backgroundColor: colors.accent, borderRadius: radius.md, paddingHorizontal: spacing.lg, justifyContent: 'center' },
  addButtonText: { color: '#000', fontWeight: '700' },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  checkbox: { fontSize: 18, marginRight: spacing.sm },
  completedText: { textDecorationLine: 'line-through', color: colors.textMuted },
});
