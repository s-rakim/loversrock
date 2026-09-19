// Per-category partner sharing.
//
// The master switch sits on top; with it off every category below is
// irrelevant and the rows dim, because turning sharing off must be one
// action that cannot be half-done (docs/SPEC.md #5, amended). Each category
// is independently revocable and everything but the phase starts off.
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import { useTheme } from '../../components/ThemeContext';
import { Stagger } from '../../components/Motion';
import { useCycle } from '../../components/cycle/CycleContext';

const CATEGORIES = [
  { key: 'share_phase', label: 'Cycle phase and dates', hint: 'Which phase you are in, and when your next period is predicted.', icon: 'moon-outline' },
  { key: 'share_symptoms', label: 'Symptoms', hint: 'What you logged today, by name.', icon: 'medkit-outline' },
  { key: 'share_mood', label: 'Mood', hint: 'Today’s mood, and the one-word moment on their card.', icon: 'happy-outline' },
  { key: 'share_flow', label: 'Flow', hint: 'How heavy today is.', icon: 'water-outline' },
  { key: 'share_sex_drive', label: 'Sex drive', hint: 'Your sex-drive level, and that intercourse was logged — never the details.', icon: 'heart-outline' },
  { key: 'share_notes', label: 'Notes', hint: 'The note you wrote on the day.', icon: 'document-text-outline' },
];

export default function CycleSharingScreen({ navigation }) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { sharing, updateSharing } = useCycle();
  const [busy, setBusy] = useState(false);

  const enabled = Boolean(sharing?.sharingEnabled);
  const categories = sharing?.categories || {};

  async function patch(body) {
    setBusy(true);
    try {
      await updateSharing(body);
    } catch (err) {
      Alert.alert('Could not update sharing', err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Stagger delayStep={50}>
        <View style={styles.card}>
          <View style={styles.row}>
            <Ionicons name="people-outline" size={22} color={colors.accentPink} />
            <View style={styles.rowText}>
              <Text style={font.h2}>Share with your partner</Text>
              <Text style={font.muted}>
                Off by default. Turning this off hides everything at once,
                whatever the switches below say.
              </Text>
            </View>
            <Switch
              value={enabled}
              disabled={busy}
              onValueChange={(v) => patch({ sharingEnabled: v })}
              trackColor={{ true: colors.accentPink }}
            />
          </View>
        </View>

        <View style={[styles.card, !enabled && styles.dimmed]}>
          {CATEGORIES.map((category, i) => (
            <View key={category.key} style={[styles.row, i > 0 && styles.divider]}>
              <Ionicons
                name={category.icon}
                size={20}
                color={enabled ? colors.accentIndigo : colors.textSecondary}
              />
              <View style={styles.rowText}>
                <Text style={font.body}>{category.label}</Text>
                <Text style={font.muted}>{category.hint}</Text>
              </View>
              <Switch
                value={Boolean(categories[category.key])}
                disabled={!enabled || busy}
                onValueChange={(v) => patch({ [category.key]: v })}
                trackColor={{ true: colors.accentPink }}
              />
            </View>
          ))}
        </View>

        <Text style={[font.muted, { marginTop: spacing.sm }]}>
          Your partner can only look. There is no way for them to write to,
          change or acknowledge your log.
        </Text>
      </Stagger>
    </ScrollView>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent' },
    content: { padding: spacing.lg, paddingBottom: spacing.xl },
    card: {
      backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.md,
      marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border,
    },
    dimmed: { opacity: 0.5 },
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
    rowText: { flex: 1, marginHorizontal: spacing.sm },
    divider: { borderTopWidth: 1, borderTopColor: colors.border },
  });
