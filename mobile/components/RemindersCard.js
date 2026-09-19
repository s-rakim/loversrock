import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Switch, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch } from '../services/api';
import {
  DEFAULT_REMINDERS, getReminderSettings, setReminderSettings, rescheduleLocalReminders,
} from '../services/notifications';
import Icon from './Icon';
import { useTheme } from './ThemeContext';
import { spacing, radius } from '../theme';

const ROWS = [
  ['periodSoon', 'Period due soon', 'Two days before the predicted start'],
  ['fertilityStart', 'Fertile window starts', 'On the first day of the window'],
  ['ovulationDay', 'Ovulation day', 'On the predicted day'],
  ['dailyLog', 'Daily log reminder', 'Every evening'],
  ['water', 'Drink water', 'Through the day, towards 2000 ml'],
];

/**
 * Local reminders. These are scheduled on the device rather than pushed, so
 * they still fire when the server is unreachable — which, on a self-hosted
 * backend reached over a tailnet, is a normal state rather than an outage.
 */
export default function RemindersCard() {
  const { colors, font } = useTheme();
  const styles = useMemoStyles(colors);
  const [settings, setSettings] = useState(null);

  const load = useCallback(async () => {
    const saved = await getReminderSettings();
    setSettings(saved);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function toggle(key, value) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    await setReminderSettings(next);

    // Cycle reminders need real dates. Fetch them only when one is switched
    // on, so an unpaired or fresh account doesn't fire a pointless request.
    if (value && ['periodSoon', 'fertilityStart', 'ovulationDay'].includes(key)) {
      try {
        const { predictions } = await apiFetch('/period/predictions');
        await rescheduleLocalReminders(next, predictions);
      } catch {
        // No predictions yet just means nothing to schedule.
      }
    }
  }

  if (!settings) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={colors.accentPink} />
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Icon name="notifications-outline" size={18} />
        <Text style={font.h2}>Reminders</Text>
      </View>

      {ROWS.map(([key, label, hint], i) => (
        <View key={key} style={[styles.row, i > 0 && styles.rowDivided]}>
          <View style={{ flex: 1 }}>
            <Text style={font.body}>{label}</Text>
            <Text style={font.muted}>{hint}</Text>
          </View>
          <Switch
            value={Boolean(settings[key])}
            onValueChange={(value) => toggle(key, value)}
            trackColor={{ true: colors.accentPink }}
          />
        </View>
      ))}
    </View>
  );
}

function useMemoStyles(colors) {
  return React.useMemo(
    () =>
      StyleSheet.create({
        card: {
          backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
          borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
        },
        headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
        row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
        rowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
      }),
    [colors]
  );
}
