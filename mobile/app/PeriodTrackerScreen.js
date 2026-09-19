import React, { useCallback, useState, useMemo } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, Pressable, Alert, Switch } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch } from '../services/api';
import { spacing, radius } from '../theme';
import { FadeInUp, MorphButton } from '../components/Motion';
import Icon from '../components/Icon';
import StickerField from '../components/Stickers';
import { useTheme } from '../components/ThemeContext';

const PHASE_META = {
  menstrual: { label: 'Menstrual', tone: 'period', icon: 'water' },
  follicular: { label: 'Follicular', tone: 'success', icon: 'leaf' },
  ovulation: { label: 'Ovulation', tone: 'fertility', icon: 'sparkles' },
  luteal: { label: 'Luteal', color: '#8f6aff', icon: 'moon' },
};

const FLOW_OPTIONS = ['spotting', 'light', 'medium', 'heavy'];
const SYMPTOM_OPTIONS = [
  'Cramps', 'Headache', 'Bloating', 'Fatigue', 'Acne', 'Backache', 'Nausea', 'Tender breasts', 'Mood swings',
];
const MOOD_OPTIONS = ['Happy', 'Calm', 'Energetic', 'Irritable', 'Anxious', 'Sad'];

function monthLabel(month) {
  const [year, m] = month.split('-').map(Number);
  return new Date(year, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function shiftMonth(month, delta) {
  const [year, m] = month.split('-').map(Number);
  const d = new Date(year, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Builds a Sunday-first grid of date strings (or null for leading/trailing
// blanks) for the given YYYY-MM month.
function buildMonthGrid(month) {
  const [year, m] = month.split('-').map(Number);
  const firstDay = new Date(year, m - 1, 1);
  const daysInMonth = new Date(year, m, 0).getDate();
  const startWeekday = firstDay.getDay();

  const cells = [];
  for (let i = 0; i < startWeekday; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(`${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  return cells;
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

export default function PeriodTrackerScreen() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [month, setMonth] = useState(todayDateString().slice(0, 7));
  const [calendar, setCalendar] = useState(null);
  const [cycles, setCycles] = useState([]);
  const [settings, setSettings] = useState(null);
  const [partner, setPartner] = useState(null);
  const [loading, setLoading] = useState(true);

  const [selectedDate, setSelectedDate] = useState(null);
  const [dayLog, setDayLog] = useState({ flow: null, symptoms: [], mood: null, notes: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [calendarRes, cyclesRes, settingsRes, partnerRes] = await Promise.allSettled([
      apiFetch(`/period/calendar?month=${month}`),
      apiFetch('/period/cycles'),
      apiFetch('/period/settings'),
      apiFetch('/period/partner'),
    ]);
    if (calendarRes.status === 'fulfilled') setCalendar(calendarRes.value);
    if (cyclesRes.status === 'fulfilled') setCycles(cyclesRes.value.cycles);
    if (settingsRes.status === 'fulfilled') setSettings(settingsRes.value.settings);
    if (partnerRes.status === 'fulfilled') setPartner(partnerRes.value);
    setLoading(false);
  }, [month]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openCycle = cycles.find((c) => !c.end_date);

  async function toggleCycle() {
    try {
      if (openCycle) {
        await apiFetch(`/period/cycles/${openCycle.id}/end`, { method: 'POST', body: { endDate: todayDateString() } });
      } else {
        await apiFetch('/period/cycles/start', { method: 'POST', body: { startDate: todayDateString() } });
      }
      load();
    } catch (err) {
      Alert.alert('Could not update period', err.message);
    }
  }

  async function selectDate(date) {
    setSelectedDate(date);
    try {
      const data = await apiFetch(`/period/log/${date}`);
      setDayLog({
        flow: data.log?.flow || null,
        symptoms: data.log?.symptoms || [],
        mood: data.log?.mood || null,
        notes: data.log?.notes || '',
      });
    } catch {
      setDayLog({ flow: null, symptoms: [], mood: null, notes: '' });
    }
  }

  function toggleSymptom(symptom) {
    setDayLog((prev) => ({
      ...prev,
      symptoms: prev.symptoms.includes(symptom)
        ? prev.symptoms.filter((s) => s !== symptom)
        : [...prev.symptoms, symptom],
    }));
  }

  async function saveDayLog() {
    setSaving(true);
    try {
      await apiFetch('/period/log', { method: 'POST', body: { date: selectedDate, ...dayLog } });
      load();
    } catch (err) {
      Alert.alert('Could not save', err.message);
    } finally {
      setSaving(false);
    }
  }

  async function updateSettings(patch) {
    try {
      const data = await apiFetch('/period/settings', { method: 'PATCH', body: patch });
      setSettings(data.settings);
    } catch (err) {
      Alert.alert('Could not update settings', err.message);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <Text style={font.muted}>Loading…</Text>
      </View>
    );
  }

  const predictions = calendar?.predictions;
  const phaseMeta = predictions?.phase ? PHASE_META[predictions.phase] : null;
  const grid = buildMonthGrid(month);
  const loggedDates = new Set(
    (calendar?.cycles || []).flatMap((c) => {
      const dates = [];
      const start = new Date(`${c.startDate || c.start_date}T00:00:00Z`);
      const end = c.endDate || c.end_date ? new Date(`${c.endDate || c.end_date}T00:00:00Z`) : start;
      for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        dates.push(d.toISOString().slice(0, 10));
      }
      return dates;
    })
  );
  const logsByDate = Object.fromEntries((calendar?.logs || []).map((l) => [l.date, l]));

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
      <StickerField variant="minimal" />

      <FadeInUp>
        <Text style={font.h1}>Cycle Tracker</Text>
      </FadeInUp>

      <FadeInUp delay={60}>
        <View style={styles.phaseCard}>
          {phaseMeta ? (
            <>
              <Icon name={phaseMeta.icon} chip chipSize={48} chipColor={phaseMeta.color + '33'} color={phaseMeta.color} />
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text style={font.h2}>{phaseMeta.label} phase</Text>
                <Text style={font.muted}>Cycle day {predictions.cycleDay}</Text>
                {predictions.nextPeriodDate && (
                  <Text style={font.muted}>Next period expected {predictions.nextPeriodDate}</Text>
                )}
              </View>
            </>
          ) : (
            <Text style={font.muted}>Log your first period to see predictions.</Text>
          )}
        </View>

        <MorphButton onPress={toggleCycle} style={[styles.primaryButton, openCycle && styles.endButton]}>
          <Icon name={openCycle ? 'stop-circle-outline' : 'add-circle-outline'} chip={false} color="#fff" size={18} />
          <Text style={styles.primaryButtonText}>{openCycle ? 'End period today' : 'Start period today'}</Text>
        </MorphButton>
      </FadeInUp>

      {partner?.sharingEnabled && partner.predictions && (
        <FadeInUp delay={90}>
          <View style={styles.partnerCard}>
            <Icon name="heart-outline" chip chipColor={colors.accentSoft} />
            <View style={{ marginLeft: spacing.sm }}>
              <Text style={font.body}>Partner: {PHASE_META[partner.predictions.phase]?.label} phase</Text>
              <Text style={font.muted}>Next period expected {partner.predictions.nextPeriodDate}</Text>
            </View>
          </View>
        </FadeInUp>
      )}

      <FadeInUp delay={120}>
        <View style={styles.calendarHeader}>
          <Icon name="chevron-back-outline" chip={false} onPress={() => setMonth((m) => shiftMonth(m, -1))} />
          <Text style={font.h2}>{monthLabel(month)}</Text>
          <Icon name="chevron-forward-outline" chip={false} onPress={() => setMonth((m) => shiftMonth(m, 1))} />
        </View>

        <View style={styles.grid}>
          {grid.map((date, i) => {
            if (!date) return <View key={i} style={styles.cell} />;
            const isPeriod = loggedDates.has(date);
            const isPredicted = predictions?.nextPeriodDate === date;
            const isFertile =
              predictions?.fertileWindowStart && date >= predictions.fertileWindowStart && date <= predictions.fertileWindowEnd;
            const hasLog = Boolean(logsByDate[date]);
            const dayNum = Number(date.slice(-2));

            return (
              <Pressable key={date} onPress={() => selectDate(date)} style={styles.cell}>
                <View
                  style={[
                    styles.dayCircle,
                    isPeriod && { backgroundColor: colors.accent },
                    !isPeriod && isPredicted && { borderWidth: 2, borderColor: colors.accent },
                    !isPeriod && !isPredicted && isFertile && { backgroundColor: colors.accentSoft },
                  ]}
                >
                  <Text style={[font.body, isPeriod && { color: '#fff' }]}>{dayNum}</Text>
                </View>
                {hasLog && <View style={styles.logDot} />}
              </Pressable>
            );
          })}
        </View>
      </FadeInUp>

      {selectedDate && (
        <FadeInUp delay={140}>
          <View style={styles.logCard}>
            <Text style={font.h2}>{selectedDate}</Text>

            <Text style={[font.muted, { marginTop: spacing.sm }]}>Flow</Text>
            <View style={styles.chipRow}>
              {FLOW_OPTIONS.map((f) => (
                <MorphButton
                  key={f}
                  onPress={() => setDayLog((p) => ({ ...p, flow: p.flow === f ? null : f }))}
                  style={[styles.chip, dayLog.flow === f && styles.chipActive]}
                >
                  <Text style={dayLog.flow === f ? styles.chipTextActive : font.body}>{f}</Text>
                </MorphButton>
              ))}
            </View>

            <Text style={[font.muted, { marginTop: spacing.sm }]}>Symptoms</Text>
            <View style={styles.chipRow}>
              {SYMPTOM_OPTIONS.map((s) => (
                <MorphButton
                  key={s}
                  onPress={() => toggleSymptom(s)}
                  style={[styles.chip, dayLog.symptoms.includes(s) && styles.chipActive]}
                >
                  <Text style={dayLog.symptoms.includes(s) ? styles.chipTextActive : font.body}>{s}</Text>
                </MorphButton>
              ))}
            </View>

            <Text style={[font.muted, { marginTop: spacing.sm }]}>Mood</Text>
            <View style={styles.chipRow}>
              {MOOD_OPTIONS.map((m) => (
                <MorphButton
                  key={m}
                  onPress={() => setDayLog((p) => ({ ...p, mood: p.mood === m ? null : m }))}
                  style={[styles.chip, dayLog.mood === m && styles.chipActive]}
                >
                  <Text style={dayLog.mood === m ? styles.chipTextActive : font.body}>{m}</Text>
                </MorphButton>
              ))}
            </View>

            <TextInput
              placeholder="Notes…"
              placeholderTextColor={colors.textMuted}
              value={dayLog.notes}
              onChangeText={(notes) => setDayLog((p) => ({ ...p, notes }))}
              style={styles.input}
              multiline
            />

            <MorphButton onPress={saveDayLog} disabled={saving} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>{saving ? 'Saving…' : 'Save'}</Text>
            </MorphButton>
          </View>
        </FadeInUp>
      )}

      {settings && (
        <FadeInUp delay={160}>
          <View style={styles.settingsCard}>
            <Text style={font.h2}>Settings</Text>

            <View style={styles.settingRow}>
              <Text style={font.body}>Avg. cycle length</Text>
              <TextInput
                keyboardType="number-pad"
                value={String(settings.averageCycleLength)}
                onChangeText={(v) => setSettings((s) => ({ ...s, averageCycleLength: Number(v) || s.averageCycleLength }))}
                onEndEditing={() => updateSettings({ averageCycleLength: settings.averageCycleLength })}
                style={styles.numberInput}
              />
            </View>
            <View style={styles.settingRow}>
              <Text style={font.body}>Avg. period length</Text>
              <TextInput
                keyboardType="number-pad"
                value={String(settings.averagePeriodLength)}
                onChangeText={(v) => setSettings((s) => ({ ...s, averagePeriodLength: Number(v) || s.averagePeriodLength }))}
                onEndEditing={() => updateSettings({ averagePeriodLength: settings.averagePeriodLength })}
                style={styles.numberInput}
              />
            </View>

            <View style={styles.settingRow}>
              <View style={{ flex: 1 }}>
                <Text style={font.body}>Share cycle phase with partner</Text>
                <Text style={font.muted}>They'll only see your phase and predicted dates — never symptoms or notes.</Text>
              </View>
              <Switch
                value={settings.sharingEnabled}
                onValueChange={(v) => {
                  setSettings((s) => ({ ...s, sharingEnabled: v }));
                  updateSettings({ sharingEnabled: v });
                }}
                trackColor={{ true: colors.accent }}
              />
            </View>
          </View>
        </FadeInUp>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  phaseCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.md, marginTop: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  primaryButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    backgroundColor: colors.accent, borderRadius: radius.pill, paddingVertical: spacing.md, marginTop: spacing.md,
  },
  endButton: { backgroundColor: colors.danger },
  primaryButtonText: { color: '#fff', fontWeight: '700' },
  partnerCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.accentSoft, borderRadius: radius.lg,
    padding: spacing.md, marginTop: spacing.md,
  },
  calendarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.lg, marginBottom: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '14.28%', alignItems: 'center', marginBottom: spacing.sm },
  dayCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  logDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.gold, marginTop: 2 },
  logCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    marginTop: spacing.lg, borderWidth: 1, borderColor: colors.border,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  chip: {
    backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  input: {
    backgroundColor: colors.surfaceAlt, color: colors.text, borderRadius: radius.md, padding: spacing.md,
    marginTop: spacing.md, minHeight: 60, textAlignVertical: 'top',
  },
  settingsCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    marginTop: spacing.lg, borderWidth: 1, borderColor: colors.border,
  },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md },
  numberInput: {
    backgroundColor: colors.surfaceAlt, color: colors.text, borderRadius: radius.sm, padding: spacing.sm,
    width: 60, textAlign: 'center', borderWidth: 1, borderColor: colors.border,
  },
});
