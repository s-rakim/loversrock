import React, { useCallback, useEffect, useState, useMemo } from 'react';
import { View, Text, TextInput, StyleSheet, FlatList, Alert, AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch, connectSocket } from '../services/api';
import { spacing, radius } from '../theme';
import { FadeInUp, MorphButton } from '../components/Motion';
import Icon from '../components/Icon';
import StickerField from '../components/Stickers';
import { useTheme } from '../components/ThemeContext';
import Icon3D from '../components/Icon3D';

export default function BucketListScreen() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState('');
  const [ideas, setIdeas] = useState([]);

  const load = useCallback(() => {
    apiFetch('/bucket-list')
      .then((data) => setItems(data.items))
      .catch((err) => Alert.alert('Could not load bucket list', err.message));
    // Ideas are a nicety: an older server without them just shows none.
    apiFetch('/bucket-list/suggestions')
      .then((data) => setIdeas(data.suggestions || []))
      .catch(() => setIdeas([]));
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

  async function addIdea(title) {
    setIdeas((list) => list.filter((i) => i.title !== title));
    try {
      await apiFetch('/bucket-list', { method: 'POST', body: { title } });
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
      <StickerField variant="minimal" />
      <View style={styles.addRow}>
        <TextInput
          placeholder="Add something to your list…"
          placeholderTextColor={colors.textMuted}
          value={draft}
          onChangeText={setDraft}
          style={styles.input}
          onSubmitEditing={addItem}
        />
        <Icon name="add-circle" chip={false} color={colors.accent} size={40} onPress={addItem} />
      </View>

      {ideas.length > 0 && (
        <View style={{ marginBottom: spacing.md }}>
          <View style={styles.ideasHead}>
            <Icon3D name="sparkles" size={20} />
            <Text style={[font.muted, { fontWeight: '700' }]}>Ideas to add</Text>
          </View>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={ideas}
            keyExtractor={(idea) => idea.title}
            contentContainerStyle={{ gap: spacing.sm }}
            renderItem={({ item: idea }) => (
              <MorphButton onPress={() => addIdea(idea.title)} style={styles.idea}>
                <Icon name="add" chip={false} size={14} color={colors.accent} />
                <Text style={[font.body, { fontSize: 13 }]}>{idea.title}</Text>
              </MorphButton>
            )}
          />
        </View>
      )}

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: spacing.xl }}
        renderItem={({ item, index }) => (
          <FadeInUp delay={index * 25}>
            <MorphButton onPress={() => toggle(item)} style={styles.row}>
              <Icon
                name={item.is_completed ? 'checkmark-circle' : 'ellipse-outline'}
                chip={false}
                color={item.is_completed ? colors.success : colors.textMuted}
                size={22}
                style={{ marginRight: spacing.sm }}
              />
              <Text style={[font.body, item.is_completed && styles.completedText]}>{item.title}</Text>
            </MorphButton>
          </FadeInUp>
        )}
        ListEmptyComponent={
          <View style={styles.emptyRow}>
            <Icon3D name="check" size={56} />
            <Text style={font.muted}>Nothing on your list yet.</Text>
          </View>
        }
      />
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', padding: spacing.lg },
  addRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  input: {
    flex: 1, backgroundColor: colors.surface, color: colors.text, borderRadius: radius.md,
    padding: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  addButton: { backgroundColor: colors.accent, borderRadius: radius.md, paddingHorizontal: spacing.lg, justifyContent: 'center' },
  addButtonText: { color: '#fff', fontWeight: '700' },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  completedText: { textDecorationLine: 'line-through', color: colors.textMuted },
  ideasHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
  idea: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.accentSoft, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2,
  },
  emptyRow: { alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
});
