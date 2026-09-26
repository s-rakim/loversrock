// The tracker's Analysis tab: averages, the three-period unlock gate, the
// weight and temperature cards, and the timeline of recorded cycles.
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import { useTheme } from '../../components/ThemeContext';
import { Stagger, MorphButton, GrowBar } from '../../components/Motion';
import { useCycle, todayDateString } from '../../components/cycle/CycleContext';
import { useCycleContentPadding } from '../../components/cycle/layout';

function prettyDate(date) {
  if (!date) return '—';
  return new Date(`${String(date).slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

function daysBetween(from, to) {
  return Math.round(
    (new Date(`${String(to).slice(0, 10)}T00:00:00Z`) - new Date(`${String(from).slice(0, 10)}T00:00:00Z`)) / 86400000
  );
}

export default function CycleAnalysisScreen({ navigation }) {
  // Clears the floating add button and the app's tab bar; see cycle/layout.
  const bottomPad = useCycleContentPadding();
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { settings, cycles, analysis, logsByDate, saveLog, updateSettings } = useCycle();

  const today = todayDateString();
  const todayLog = logsByDate[today];
  const [weight, setWeight] = useState('');
  const [temperature, setTemperature] = useState('');
  const [draft, setDraft] = useState(null);

  const fields = draft || {
    averageCycleLength: settings?.averageCycleLength ?? 28,
    averagePeriodLength: settings?.averagePeriodLength ?? 5,
  };

  async function saveNumber(field, raw, label) {
    const value = Number(raw);
    if (!raw || Number.isNaN(value)) return;
    try {
      await saveLog({ date: today, [field]: value });
      if (field === 'weightKg') setWeight('');
      else setTemperature('');
    } catch (err) {
      Alert.alert(`Could not save ${label}`, err.message);
    }
  }

  async function commitSetting(patch) {
    try {
      await updateSettings(patch);
      setDraft(null);
    } catch (err) {
      Alert.alert('Could not update settings', err.message);
    }
  }

  const completed = cycles.filter((c) => c.end_date);

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}>
      <Stagger delayStep={55}>
        <View style={styles.card}>
          <Text style={font.h2}>Cycle analysis</Text>
          <View style={styles.statRow}>
            <View style={[styles.stat, { backgroundColor: colors.categoryChip }]}>
              <Ionicons name="water" size={22} color={colors.period} style={{ alignSelf: 'flex-end' }} />
              <Text style={font.h1}>{settings?.averagePeriodLength ?? '–'} Days</Text>
              <Text style={[font.muted, { color: colors.period }]}>Average period</Text>
            </View>
            <View style={[styles.stat, { backgroundColor: 'rgba(255,179,0,0.14)' }]}>
              <Ionicons name="sync-circle" size={22} color={colors.fertility} style={{ alignSelf: 'flex-end' }} />
              <Text style={font.h1}>{settings?.averageCycleLength ?? '–'} Days</Text>
              <Text style={[font.muted, { color: colors.fertility }]}>Average cycle</Text>
            </View>
          </View>

          {!analysis.analysisUnlocked && (
            <View style={styles.lockRow}>
              <Text style={font.muted}>
                Log {Math.max(0, 3 - analysis.cyclesLogged)} more period
                {3 - analysis.cyclesLogged === 1 ? '' : 's'} to unlock analysis.
              </Text>
            </View>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={styles.titleRow}>
              <Ionicons name="scale-outline" size={20} color={colors.accentIndigo} />
              <Text style={[font.h2, { marginLeft: spacing.sm }]}>Weight</Text>
            </View>
            <Text style={font.h1}>
              {todayLog?.weightKg ?? todayLog?.weight_kg ?? '--'} kg
            </Text>
          </View>
          <View style={styles.inlineRow}>
            <TextInput
              value={weight}
              onChangeText={setWeight}
              keyboardType="decimal-pad"
              placeholder="Add weight"
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
            />
            <MorphButton onPress={() => saveNumber('weightKg', weight, 'weight')} style={styles.saveSmall}>
              <Text style={styles.saveSmallText}>Save</Text>
            </MorphButton>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={styles.titleRow}>
              <Ionicons name="thermometer-outline" size={20} color={colors.period} />
              <Text style={[font.h2, { marginLeft: spacing.sm }]}>Temperature</Text>
            </View>
            <Text style={font.h1}>
              {todayLog?.temperatureC ?? todayLog?.temperature_c ?? '--'} °C
            </Text>
          </View>
          <View style={styles.inlineRow}>
            <TextInput
              value={temperature}
              onChangeText={setTemperature}
              keyboardType="decimal-pad"
              placeholder="Add temperature"
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
            />
            <MorphButton
              onPress={() => saveNumber('temperatureC', temperature, 'temperature')}
              style={styles.saveSmall}
            >
              <Text style={styles.saveSmallText}>Save</Text>
            </MorphButton>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.titleRow}>
            <Ionicons name="time-outline" size={20} color={colors.accentIndigo} />
            <Text style={[font.h2, { marginLeft: spacing.sm }]}>Timeline</Text>
          </View>
          {completed.length === 0 ? (
            <Text style={[font.muted, { marginTop: spacing.sm }]}>
              Finished periods show up here with their length.
            </Text>
          ) : (
            completed.slice(0, 8).map((cycle) => {
              const length = daysBetween(cycle.start_date, cycle.end_date) + 1;
              return (
                <View key={cycle.id} style={{ marginTop: spacing.sm }}>
                  <Text style={font.muted}>
                    {prettyDate(cycle.start_date)} – {prettyDate(cycle.end_date)} · {length} days
                  </Text>
                  <View style={styles.timelineTrack}>
                    <GrowBar
                      value={Math.min(1, length / 10)}
                      style={[styles.timelineFill, { backgroundColor: colors.period }]}
                    />
                  </View>
                </View>
              );
            })
          )}
        </View>

        <View style={styles.card}>
          <Text style={font.h2}>Prediction settings</Text>
          <Text style={[font.muted, { marginTop: 2 }]}>For period, cycle, and ovulation</Text>

          <View style={styles.settingRow}>
            <Text style={font.body}>Average cycle length</Text>
            <TextInput
              keyboardType="number-pad"
              value={String(fields.averageCycleLength)}
              onChangeText={(v) => setDraft({ ...fields, averageCycleLength: v.replace(/\D/g, '') })}
              onEndEditing={() =>
                commitSetting({ averageCycleLength: Number(fields.averageCycleLength) || 28 })
              }
              style={styles.numberInput}
            />
          </View>

          <View style={styles.settingRow}>
            <Text style={font.body}>Average period length</Text>
            <TextInput
              keyboardType="number-pad"
              value={String(fields.averagePeriodLength)}
              onChangeText={(v) => setDraft({ ...fields, averagePeriodLength: v.replace(/\D/g, '') })}
              onEndEditing={() =>
                commitSetting({ averagePeriodLength: Number(fields.averagePeriodLength) || 5 })
              }
              style={styles.numberInput}
            />
          </View>

          <MorphButton onPress={() => navigation.navigate('CycleSharing')} style={styles.linkRow}>
            <Ionicons name="people-outline" size={20} color={colors.accentPink} />
            <Text style={[font.body, { flex: 1, marginLeft: spacing.sm }]}>Partner sharing</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </MorphButton>
        </View>
      </Stagger>
    </ScrollView>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: 'transparent' },
    content: { padding: spacing.lg, paddingBottom: spacing.xl },
    card: {
      backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.md,
      marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border,
    },
    statRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    stat: { flex: 1, borderRadius: radius.md, padding: spacing.md },
    lockRow: {
      marginTop: spacing.md, backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md, padding: spacing.sm,
    },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    titleRow: { flexDirection: 'row', alignItems: 'center' },
    inlineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
    input: {
      flex: 1, backgroundColor: colors.surfaceAlt, color: colors.textPrimary,
      borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      borderWidth: 1, borderColor: colors.border,
    },
    saveSmall: {
      backgroundColor: colors.accentIndigo, borderRadius: radius.pill,
      paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    },
    saveSmallText: { color: '#fff', fontWeight: '700' },
    timelineTrack: {
      height: 10, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, marginTop: 4,
    },
    timelineFill: { height: 10, borderRadius: radius.pill },
    settingRow: {
      flexDirection: 'row', alignItems: 'center',
      justifyContent: 'space-between', marginTop: spacing.md,
    },
    numberInput: {
      backgroundColor: colors.surfaceAlt, color: colors.textPrimary, borderRadius: radius.sm,
      paddingVertical: spacing.sm, width: 64, textAlign: 'center',
      borderWidth: 1, borderColor: colors.border,
    },
    linkRow: {
      flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg,
      borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md,
    },
  });
