// The tracker's Calendar tab.
//
// Period days are filled pink, the fertile window is the soft yellow band,
// ovulation gets its own ringed dot and every day carries its cycle-day
// number underneath — the reference app's calendar, legend included. Tapping
// a day opens that day's log; the selected day gets the pink Edit pill.
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import { useTheme } from '../../components/ThemeContext';
import { Stagger, MorphButton, Pop } from '../../components/Motion';
import { useCycle, shiftMonth, todayDateString } from '../../components/cycle/CycleContext';
import { SYMPTOMS_BY_ID, MOODS_BY_ID } from '../../data/cycleCatalog';
import { useCycleContentPadding } from '../../components/cycle/layout';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function monthLabel(month) {
  const [year, m] = month.split('-').map(Number);
  return new Date(year, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function buildMonthGrid(month) {
  const [year, m] = month.split('-').map(Number);
  const daysInMonth = new Date(year, m, 0).getDate();
  const startWeekday = new Date(year, m - 1, 1).getDay();

  const cells = Array.from({ length: startWeekday }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(`${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  return cells;
}

function daysBetween(from, to) {
  return Math.round(
    (new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000
  );
}

function prettyDate(date) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

// `readOnly` is the partner's calendar: their partner's month, drawn from
// what was shared with them, with nothing that writes. It used to be accepted
// by nobody — the shell passed it and this ignored it — so the partner saw
// their OWN empty month with an Edit button on every day.
export default function CycleCalendarScreen({ navigation, readOnly = false }) {
  // Clears the floating add button and the app's tab bar; see cycle/layout.
  const bottomPad = useCycleContentPadding();
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const cycle = useCycle();
  const { month, setMonth } = cycle;
  // Same four fields either way, so everything below draws both months.
  const { predictions, periodDates, logsByDate, cycles } = readOnly ? cycle.partnerView : cycle;
  const [selected, setSelected] = useState(todayDateString());

  const grid = buildMonthGrid(month);
  const today = todayDateString();

  // The cycle day printed under each date, counted from whichever recorded
  // period started most recently on or before it.
  const starts = cycles
    .map((c) => String(c.start_date).slice(0, 10))
    .sort();
  const cycleDayFor = (date) => {
    let start = null;
    for (const s of starts) if (s <= date) start = s;
    return start ? daysBetween(start, date) + 1 : null;
  };

  const inFertileWindow = (date) =>
    predictions?.fertileWindowStart &&
    date >= predictions.fertileWindowStart &&
    date <= predictions.fertileWindowEnd;

  const selectedLog = logsByDate[selected];

  if (readOnly && !cycle.partnerView.sharingEnabled) {
    return (
      <View style={styles.notShared}>
        <Ionicons name="lock-closed-outline" size={36} color={colors.textSecondary} />
        <Text style={[font.h2, { marginTop: spacing.sm, textAlign: 'center' }]}>Not shared yet</Text>
        <Text style={[font.muted, { marginTop: spacing.xs, textAlign: 'center' }]}>
          Their calendar appears here once they turn on sharing — and only the parts they choose.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}>
      <Stagger delayStep={50}>
        <View style={styles.header}>
          <MorphButton onPress={() => setMonth(shiftMonth(month, -1))} style={styles.arrow}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </MorphButton>
          <Text style={font.h2}>{monthLabel(month)}</Text>
          <MorphButton onPress={() => setMonth(shiftMonth(month, 1))} style={styles.arrow}>
            <Ionicons name="chevron-forward" size={22} color={colors.textPrimary} />
          </MorphButton>
        </View>

        <View style={styles.card}>
          <View style={styles.weekdayRow}>
            {WEEKDAYS.map((d, i) => (
              <Text key={i} style={[font.muted, styles.weekday]}>{d}</Text>
            ))}
          </View>

          <View style={styles.grid}>
            {grid.map((date, i) => {
              if (!date) return <View key={`blank-${i}`} style={styles.cell} />;

              const isPeriod = periodDates.has(date);
              const isPredictedPeriod = !isPeriod && predictions?.nextPeriodDate === date;
              const isOvulation = predictions?.ovulationDate === date;
              const isFertile = !isPeriod && inFertileWindow(date);
              const log = logsByDate[date];
              const cycleDay = cycleDayFor(date);

              return (
                <Pressable key={date} onPress={() => setSelected(date)} style={styles.cell}>
                  <Pop active={selected === date}>
                    <View
                      style={[
                        styles.day,
                        isFertile && { backgroundColor: 'rgba(255,179,0,0.22)' },
                        isPeriod && { backgroundColor: colors.period },
                        isPredictedPeriod && { borderWidth: 1.5, borderColor: colors.period, borderStyle: 'dashed' },
                        selected === date && { borderWidth: 2, borderColor: colors.accentIndigo },
                      ]}
                    >
                      <Text style={[font.body, isPeriod && { color: '#fff', fontWeight: '600' }]}>
                        {Number(date.slice(-2))}
                      </Text>
                      {isOvulation && <View style={styles.ovulationDot} />}
                    </View>
                  </Pop>
                  <Text style={[font.muted, styles.cycleDay]}>
                    {cycleDay && cycleDay > 0 && cycleDay < 60 ? cycleDay : ''}
                  </Text>
                  <View style={[styles.logDot, log ? { backgroundColor: colors.gold } : null]} />
                </Pressable>
              );
            })}
          </View>

          <View style={styles.legend}>
            <Legend color={colors.period} label="Period" />
            <Legend color="rgba(255,179,0,0.45)" label="Fertile" />
            <Legend color="#FF8A00" label="Ovulation" />
            <Legend color={colors.gold} label="Logged" />
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={font.h2}>
              {prettyDate(selected)}
              {selected === today ? ' · Today' : ''}
            </Text>
            {!readOnly && (
              <MorphButton
                onPress={() => navigation.navigate('CycleDailyLog', { date: selected })}
                style={styles.editPill}
              >
                <Ionicons name="create-outline" size={15} color="#fff" />
                <Text style={styles.editPillText}>Edit</Text>
              </MorphButton>
            )}
          </View>

          {selectedLog ? (
            <View style={{ marginTop: spacing.sm }}>
              {selectedLog.flow && (
                <Text style={font.body}>Flow: {selectedLog.flow}</Text>
              )}
              {selectedLog.symptoms?.length > 0 && (
                <Text style={[font.body, { marginTop: 2 }]}>
                  Symptoms: {selectedLog.symptoms.map((id) => SYMPTOMS_BY_ID[id]?.label || id).join(', ')}
                </Text>
              )}
              {selectedLog.moods?.length > 0 && (
                <Text style={[font.body, { marginTop: 2 }]}>
                  Mood: {selectedLog.moods.map((id) => MOODS_BY_ID[id]?.label || id).join(', ')}
                </Text>
              )}
              {selectedLog.hasIntercourse && (
                <Text style={[font.body, { marginTop: 2 }]}>Intercourse logged</Text>
              )}
              {selectedLog.hasNotes && (
                <Text style={[font.muted, { marginTop: 2 }]}>Has a note</Text>
              )}
            </View>
          ) : readOnly ? (
            // "Nothing logged" would be a claim about their day; all this
            // phone knows is that nothing was SHARED for it.
            <Text style={[font.muted, { marginTop: spacing.sm }]}>Nothing shared for this day.</Text>
          ) : (
            <Pressable
              onPress={() => navigation.navigate('CycleDailyLog', { date: selected })}
              style={styles.emptyNote}
            >
              <Ionicons name="arrow-forward-circle-outline" size={18} color={colors.accentPink} />
              <Text style={[font.muted, { marginLeft: spacing.xs }]}>Tap to add note</Text>
            </Pressable>
          )}
        </View>
      </Stagger>
    </ScrollView>
  );
}

function Legend({ color, label }) {
  const { colors, font } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: spacing.md, marginTop: spacing.xs }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color, marginRight: 5 }} />
      <Text style={[font.muted, { fontSize: 11 }]}>{label}</Text>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: 'transparent' },
    content: { padding: spacing.lg, paddingBottom: spacing.xl },
    notShared: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
    header: {
      flexDirection: 'row', alignItems: 'center',
      justifyContent: 'space-between', marginBottom: spacing.md,
    },
    arrow: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    card: {
      backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.md,
      marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border,
    },
    weekdayRow: { flexDirection: 'row' },
    weekday: { width: '14.28%', textAlign: 'center', fontSize: 11 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs },
    cell: { width: '14.28%', alignItems: 'center', paddingVertical: 2 },
    day: {
      width: 34, height: 34, borderRadius: 17,
      alignItems: 'center', justifyContent: 'center',
    },
    ovulationDot: {
      position: 'absolute', bottom: 1, width: 6, height: 6,
      borderRadius: 3, backgroundColor: '#FF8A00',
    },
    cycleDay: { fontSize: 9 },
    logDot: { width: 4, height: 4, borderRadius: 2, marginTop: 1, backgroundColor: 'transparent' },
    legend: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    editPill: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: colors.accentPink, borderRadius: radius.pill,
      paddingHorizontal: spacing.md, paddingVertical: 6,
    },
    editPillText: { color: '#fff', fontWeight: '600', fontSize: 13 },
    emptyNote: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  });
