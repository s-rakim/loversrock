// The tracker's Today tab.
//
// Mirrors the reference app's layout: the period CTA at the top, a "How are
// you feeling today?" prompt into Add Symptom, the cycle-day card with the
// phase bar, the two-up averages, and the history strip.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import { useTheme } from '../../components/ThemeContext';
import { Stagger, MorphButton } from '../../components/Motion';
import PhaseBar from '../../components/cycle/PhaseBar';
import { useCycle, todayDateString } from '../../components/cycle/CycleContext';
import { PHASE_META, SYMPTOMS_BY_ID, MOODS_BY_ID } from '../../data/cycleCatalog';
import { useCycleContentPadding } from '../../components/cycle/layout';

function prettyDate(date) {
  if (!date) return '—';
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

export default function CycleTodayScreen({ navigation }) {
  // Clears the floating add button and the app's tab bar; see cycle/layout.
  const bottomPad = useCycleContentPadding();
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const {
    predictions, settings, cycles, openCycle, analysis, logsByDate,
    startPeriod, endPeriod, partner, sharing,
  } = useCycle();

  const today = todayDateString();
  const todayLog = logsByDate[today];
  const phase = predictions?.phase ? PHASE_META[predictions.phase] : null;

  async function togglePeriod() {
    try {
      if (openCycle) await endPeriod(openCycle.id, today);
      else await startPeriod(today);
    } catch (err) {
      Alert.alert('Could not update your period', err.message);
    }
  }

  const recent = cycles.slice(0, 4);

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}>
      <Stagger delayStep={55}>
        {/* The reference app leads with this when there is nothing to predict
            from; once a period is running it becomes the "end it" action. */}
        <View style={styles.heroCard}>
          <Text style={font.h1}>
            {openCycle
              ? 'Your period is running'
              : predictions
                ? 'Tracking your cycle'
                : 'Please enter your period for next prediction'}
          </Text>
          <MorphButton
            onPress={togglePeriod}
            style={[styles.heroButton, openCycle && { backgroundColor: colors.danger }]}
          >
            <Text style={styles.heroButtonText}>
              {openCycle ? 'Period Ends' : 'Period Starts'}
            </Text>
          </MorphButton>
        </View>

        {partner && (
          <MorphButton onPress={() => navigation.navigate('CycleSharing')} style={styles.sharingRow}>
            <Ionicons
              name={sharing?.sharingEnabled ? 'people' : 'lock-closed-outline'}
              size={20}
              color={colors.accentPink}
            />
            <Text style={[font.body, { flex: 1, marginLeft: spacing.sm }]}>
              {sharing?.sharingEnabled ? 'Sharing with your partner' : 'Not sharing with your partner'}
            </Text>
            <Ionicons name="options-outline" size={20} color={colors.textSecondary} />
          </MorphButton>
        )}

        <View style={styles.card}>
          <Text style={font.h2}>How are you feeling today?</Text>
          <Text style={[font.muted, { marginTop: 2 }]}>
            Tell us more about your body to get analysis
          </Text>
          <View style={styles.feelingRow}>
            <MorphButton
              onPress={() => navigation.navigate('CycleAddSymptom', { date: today })}
              style={styles.feelingButton}
            >
              <Text style={styles.feelingButtonText}>Add Symptom</Text>
            </MorphButton>
            <MorphButton
              onPress={() => navigation.navigate('CycleAddMood', { date: today })}
              style={[styles.feelingButton, styles.feelingButtonAlt]}
            >
              <Text style={[styles.feelingButtonText, { color: colors.accentIndigo }]}>Add Mood</Text>
            </MorphButton>
          </View>

          {(todayLog?.symptoms?.length || todayLog?.moods?.length) ? (
            <Text style={[font.muted, { marginTop: spacing.sm }]}>
              Logged today:{' '}
              {[
                ...(todayLog.symptoms || []).map((id) => SYMPTOMS_BY_ID[id]?.label || id),
                ...(todayLog.moods || []).map((id) => MOODS_BY_ID[id]?.label || id),
              ].join(' · ')}
            </Text>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={font.h2}>
            Today{predictions?.cycleDay ? ` — Cycle Day ${predictions.cycleDay}` : ''}
          </Text>
          {phase ? (
            <Text style={[font.muted, { marginTop: 2 }]}>
              {phase.label} phase · next period {prettyDate(predictions.nextPeriodDate)}
            </Text>
          ) : (
            <Text style={[font.muted, { marginTop: 2 }]}>
              Log a period and predictions appear here.
            </Text>
          )}
          <PhaseBar
            cycleDay={predictions?.cycleDay}
            cycleLength={settings?.averageCycleLength}
            periodLength={settings?.averagePeriodLength}
            ovulationDay={
              settings ? settings.averageCycleLength - settings.lutealPhaseLength : undefined
            }
          />
        </View>

        <MorphButton onPress={() => navigation.navigate('CycleDailyLog', { date: today })} style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1 }}>
              <Text style={font.h2}>Cycle analysis</Text>
              <Text style={font.muted}>Based on your last {analysis.cyclesLogged || 0} cycles</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
          </View>

          <View style={styles.statRow}>
            <View style={[styles.stat, { backgroundColor: colors.categoryChip }]}>
              <Ionicons name="water" size={22} color={colors.period} style={styles.statIcon} />
              <Text style={font.h1}>{settings?.averagePeriodLength ?? '–'} Days</Text>
              <Text style={[font.muted, { color: colors.period }]}>Average period</Text>
            </View>
            <View style={[styles.stat, { backgroundColor: 'rgba(255,179,0,0.14)' }]}>
              <Ionicons name="sync-circle" size={22} color={colors.fertility} style={styles.statIcon} />
              <Text style={font.h1}>{settings?.averageCycleLength ?? '–'} Days</Text>
              <Text style={[font.muted, { color: colors.fertility }]}>Average cycle</Text>
            </View>
          </View>

          {!analysis.analysisUnlocked && (
            <Text style={[font.muted, styles.lockNote]}>
              Log {Math.max(0, 3 - (analysis.cyclesLogged || 0))} more period
              {3 - (analysis.cyclesLogged || 0) === 1 ? '' : 's'} to unlock analysis.
            </Text>
          )}
        </MorphButton>

        <View style={styles.card}>
          <Text style={font.h2}>History</Text>
          {recent.length === 0 ? (
            <Text style={[font.muted, { marginTop: spacing.xs }]}>No periods recorded yet.</Text>
          ) : (
            recent.map((cycle) => (
              <View key={cycle.id} style={styles.historyRow}>
                <View style={styles.historyDot} />
                <Text style={font.body}>
                  {prettyDate(String(cycle.start_date).slice(0, 10))}
                  {cycle.end_date ? ` – ${prettyDate(String(cycle.end_date).slice(0, 10))}` : ' – ongoing'}
                </Text>
              </View>
            ))
          )}
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
    heroCard: {
      backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.lg,
      marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center',
    },
    heroButton: {
      backgroundColor: colors.accentPink, borderRadius: radius.pill,
      paddingVertical: spacing.md, paddingHorizontal: spacing.xl, marginTop: spacing.md,
    },
    heroButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
    sharingRow: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: colors.categoryChip,
      borderRadius: radius.card, padding: spacing.md, marginBottom: spacing.md,
    },
    feelingRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    feelingButton: {
      flex: 1, backgroundColor: colors.accentIndigo, borderRadius: radius.pill,
      paddingVertical: spacing.sm, alignItems: 'center',
    },
    feelingButtonAlt: { backgroundColor: colors.surfaceAlt },
    feelingButtonText: { color: '#fff', fontWeight: '700' },
    rowBetween: { flexDirection: 'row', alignItems: 'center' },
    statRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    stat: { flex: 1, borderRadius: radius.md, padding: spacing.md },
    statIcon: { alignSelf: 'flex-end' },
    lockNote: { marginTop: spacing.sm },
    historyRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
    historyDot: {
      width: 8, height: 8, borderRadius: 4,
      backgroundColor: colors.period, marginRight: spacing.sm,
    },
  });
