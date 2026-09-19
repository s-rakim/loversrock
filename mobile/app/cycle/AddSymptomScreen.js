// Add Symptom — the grouped chip grid.
//
// Head / Body / Cervix / Fluid / Abdomen / Mental, each an accordion over a
// four-column grid, with a running count in the section header and a sticky
// Save at the bottom. Straight from the reference app, except that the chips
// carry vector glyphs rather than illustrations (see data/cycleCatalog.js).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import { useTheme } from '../../components/ThemeContext';
import { MorphButton, Collapse } from '../../components/Motion';
import SheetHeader from '../../components/cycle/SheetHeader';
import ChipGrid from '../../components/cycle/ChipGrid';
import { useCycle, todayDateString } from '../../components/cycle/CycleContext';
import { SYMPTOM_GROUPS, countChosen } from '../../data/cycleCatalog';

export default function AddSymptomScreen({ navigation, route }) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { getLog, saveLog } = useCycle();

  const date = route.params?.date || todayDateString();
  const [selected, setSelected] = useState([]);
  const [saving, setSaving] = useState(false);
  // Every group open by default: the reference app shows them all expanded,
  // and collapsing is for getting past one you don't care about.
  const [open, setOpen] = useState(() => Object.fromEntries(SYMPTOM_GROUPS.map((g) => [g.id, true])));

  useEffect(() => {
    getLog(date)
      .then((row) => setSelected(row?.symptoms || []))
      .catch(() => setSelected([]));
  }, [date, getLog]);

  const toggle = useCallback((id) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }, []);

  async function save() {
    setSaving(true);
    try {
      await saveLog({ date, symptoms: selected });
      navigation.goBack();
    } catch (err) {
      Alert.alert('Could not save your symptoms', err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.headerWrap}>
        <SheetHeader
          title="Add Symptom"
          onClose={() => navigation.goBack()}
          onConfirm={save}
          saving={saving}
        />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {SYMPTOM_GROUPS.map((group) => {
          const count = countChosen(selected, group);
          return (
            <View key={group.id} style={styles.section}>
              <Pressable
                onPress={() => setOpen((p) => ({ ...p, [group.id]: !p[group.id] }))}
                style={styles.sectionHead}
              >
                <Text style={font.h2}>{group.label}</Text>
                {count > 0 && (
                  <View style={styles.countBadge}>
                    <Text style={styles.countBadgeText}>{count}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }} />
                <Ionicons
                  name={open[group.id] ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={colors.textSecondary}
                />
              </Pressable>

              <Collapse open={open[group.id]}>
                <View style={{ paddingTop: spacing.md }}>
                  <ChipGrid items={group.items} selected={selected} onToggle={toggle} />
                </View>
              </Collapse>
            </View>
          );
        })}
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
    section: {
      backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.md,
      marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border,
    },
    sectionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    countBadge: {
      minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6,
      alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentPink,
    },
    countBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
    footer: {
      padding: spacing.md,
      backgroundColor: colors.surface,
      borderTopWidth: 1, borderTopColor: colors.border,
    },
    saveButton: {
      backgroundColor: colors.accentPink, borderRadius: radius.pill,
      paddingVertical: spacing.md, alignItems: 'center',
    },
    saveButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  });
