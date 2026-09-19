// Add Mood — one flat four-column grid, sticky Save, same chip language as
// Add Symptom. Several moods can be chosen for one day, which is how the
// reference app behaves and what period_daily_logs.moods stores.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { spacing, radius } from '../../theme';
import { useTheme } from '../../components/ThemeContext';
import { MorphButton } from '../../components/Motion';
import SheetHeader from '../../components/cycle/SheetHeader';
import ChipGrid from '../../components/cycle/ChipGrid';
import { useCycle, todayDateString } from '../../components/cycle/CycleContext';
import { MOODS } from '../../data/cycleCatalog';

export default function AddMoodScreen({ navigation, route }) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { getLog, saveLog } = useCycle();

  const date = route.params?.date || todayDateString();
  const [selected, setSelected] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getLog(date)
      .then((row) => setSelected(row?.moods || (row?.mood ? [row.mood] : [])))
      .catch(() => setSelected([]));
  }, [date, getLog]);

  const toggle = useCallback((id) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));
  }, []);

  async function save() {
    setSaving(true);
    try {
      // `moment` is the single mood the partner view surfaces; the first one
      // chosen stands in for the day so that card is never blank when moods
      // are shared.
      await saveLog({ date, moods: selected, moment: selected[0] ?? null });
      navigation.goBack();
    } catch (err) {
      Alert.alert('Could not save your mood', err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.headerWrap}>
        <SheetHeader title="Add Mood" onClose={() => navigation.goBack()} onConfirm={save} saving={saving} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={font.muted}>Pick as many as fit today.</Text>
          <View style={{ marginTop: spacing.md }}>
            <ChipGrid items={MOODS} selected={selected} onToggle={toggle} tint={colors.accentIndigo} />
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <MorphButton onPress={save} disabled={saving} style={styles.saveButton}>
          <Text style={styles.saveButtonText}>
            {saving ? 'Saving…' : `Save${selected.length ? ` (${selected.length})` : ''}`}
          </Text>
        </MorphButton>
      </View>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent' },
    headerWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
    content: { padding: spacing.lg, paddingBottom: spacing.xl },
    card: {
      backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.md,
      borderWidth: 1, borderColor: colors.border,
    },
    footer: {
      padding: spacing.md, backgroundColor: colors.surface,
      borderTopWidth: 1, borderTopColor: colors.border,
    },
    saveButton: {
      backgroundColor: colors.accentPink, borderRadius: radius.pill,
      paddingVertical: spacing.md, alignItems: 'center',
    },
    saveButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  });
