import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch } from '../services/api';
import { colors, font, spacing, radius } from '../theme';
import { FadeInUp, MorphButton } from '../components/Motion';
import Icon from '../components/Icon';
import StickerField from '../components/Stickers';

export default function DateIdeasScreen() {
  const [tab, setTab] = useState('browse');
  const [browseIdeas, setBrowseIdeas] = useState([]);
  const [savedIdeas, setSavedIdeas] = useState([]);

  const load = useCallback(() => {
    apiFetch('/date-ideas').then((d) => setBrowseIdeas(d.ideas)).catch((err) => Alert.alert('Error', err.message));
    apiFetch('/date-ideas/saved').then((d) => setSavedIdeas(d.ideas)).catch((err) => Alert.alert('Error', err.message));
  }, []);

  useFocusEffect(load);

  async function save(idea) {
    try {
      const data = await apiFetch(`/date-ideas/${idea.id}/save`, { method: 'POST' });
      setSavedIdeas((prev) => [data.idea, ...prev]);
    } catch (err) {
      Alert.alert('Could not save idea', err.message);
    }
  }

  async function complete(idea) {
    try {
      await apiFetch(`/date-ideas/${idea.id}/complete`, { method: 'POST' });
      setSavedIdeas((prev) => prev.map((i) => (i.id === idea.id ? { ...i, is_completed: true } : i)));
    } catch (err) {
      Alert.alert('Could not mark complete', err.message);
    }
  }

  const list = tab === 'browse' ? browseIdeas : savedIdeas;

  return (
    <View style={styles.container}>
      <StickerField variant="minimal" />
      <View style={styles.tabs}>
        <MorphButton onPress={() => setTab('browse')} style={[styles.tab, tab === 'browse' && styles.tabActive]}>
          <Text style={font.body}>Browse</Text>
        </MorphButton>
        <MorphButton onPress={() => setTab('saved')} style={[styles.tab, tab === 'saved' && styles.tabActive]}>
          <Text style={font.body}>Saved</Text>
        </MorphButton>
      </View>

      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: spacing.xl }}
        renderItem={({ item, index }) => (
          <FadeInUp delay={index * 25}>
            <View style={styles.card}>
              <Text style={font.h2}>{item.title}</Text>
              {item.description ? <Text style={font.muted}>{item.description}</Text> : null}
              <View style={styles.metaRow}>
                {item.category ? <Text style={styles.tag}>{item.category}</Text> : null}
                {item.cost_tier ? <Text style={styles.tag}>{item.cost_tier}</Text> : null}
              </View>
              {tab === 'browse' ? (
                <MorphButton onPress={() => save(item)} style={styles.actionButton}>
                  <Text style={styles.actionButtonText}>Save</Text>
                </MorphButton>
              ) : item.is_completed ? (
                <View style={styles.doneRow}>
                  <Icon name="checkmark-circle" size={16} color={colors.success} />
                  <Text style={font.muted}>Done</Text>
                </View>
              ) : (
                <MorphButton onPress={() => complete(item)} style={styles.actionButton}>
                  <Text style={styles.actionButtonText}>Mark complete</Text>
                </MorphButton>
              )}
            </View>
          </FadeInUp>
        )}
        ListEmptyComponent={<Text style={[font.muted, { padding: spacing.lg }]}>Nothing here yet.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  tabs: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  tab: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.pill, paddingVertical: spacing.sm, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  tabActive: { borderColor: colors.accent },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  metaRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm },
  tag: { ...font.muted, backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  actionButton: { backgroundColor: colors.accent, borderRadius: radius.pill, alignSelf: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginTop: spacing.sm },
  actionButtonText: { color: '#fff', fontWeight: '700' },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
});
