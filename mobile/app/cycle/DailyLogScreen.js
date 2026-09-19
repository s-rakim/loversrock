// One day's log — the sheet behind the + button and the calendar's Edit pill.
//
// Laid out like the reference app's daily log: the close/date/confirm header,
// the Sun–Sat week strip with the chosen day ringed, Period Start/End, the
// flow pills (Light · Medium · Heavy · Disaster), a note field, and rows into
// Intercourse, Symptoms and Mood.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import { useTheme } from '../../components/ThemeContext';
import { Stagger, MorphButton, Pop } from '../../components/Motion';
import SheetHeader from '../../components/cycle/SheetHeader';
import WeekStrip from '../../components/cycle/WeekStrip';
import { useCycle, todayDateString } from '../../components/cycle/CycleContext';
import {
  FLOW_LEVELS, SEX_DRIVE_LEVELS, SYMPTOMS_BY_ID, MOODS_BY_ID,
} from '../../data/cycleCatalog';

function headerTitle(date) {
  if (date === todayDateString()) return 'Today';
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

export default function DailyLogScreen({ navigation, route }) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const {
    getLog, saveLog, periodDates, logsByDate, openCycle, startPeriod, endPeriod,
  } = useCycle();

  const [date, setDate] = useState(route.params?.date || todayDateString());
  const [log, setLog] = useState({ flow: null, notes: '', sexDrive: null, symptoms: [], moods: [], intercourse: null });
  const [saving, setSaving] = useState(false);

  const pull = useCallback(async () => {
    try {
      const row = await getLog(date);
      setLog({
        flow: row?.flow || null,
        notes: row?.notes || '',
        sexDrive: row?.sex_drive || null,
        moment: row?.moment || null,
        symptoms: row?.symptoms || [],
        moods: row?.moods || (row?.mood ? [row.mood] : []),
        intercourse: row?.intercourse || null,
      });
    } catch {
      setLog({ flow: null, notes: '', sexDrive: null, symptoms: [], moods: [], intercourse: null });
    }
  }, [date, getLog]);

  useEffect(() => { pull(); }, [pull]);
  // Coming back from Add Symptom / Add Mood must show what was just saved.
  useFocusEffect(useCallback(() => { pull(); }, [pull]));

  async function confirm() {
    setSaving(true);
    try {
      await saveLog({
        date,
        flow: log.flow,
        notes: log.notes,
        sexDrive: log.sexDrive,
      });
      navigation.goBack();
    } catch (err) {
      Alert.alert('Could not save this day', err.message);
    } finally {
      setSaving(false);
    }
  }

  async function togglePeriod() {
    try {
      if (openCycle) await endPeriod(openCycle.id, date);
      else await startPeriod(date);
    } catch (err) {
      Alert.alert('Could not update your period', err.message);
    }
  }

  const loggedDates = new Set(Object.keys(logsByDate));
  const intercourse = log.intercourse;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <SheetHeader
        title={headerTitle(date)}
        onClose={() => navigation.goBack()}
        onConfirm={confirm}
        saving={saving}
      />

      <WeekStrip
        date={date}
        onSelect={setDate}
        loggedDates={loggedDates}
        periodDates={periodDates}
      />

      <Stagger delayStep={50} initialDelay={40}>
        <MorphButton onPress={togglePeriod} style={styles.periodRow}>
          <Ionicons
            name={openCycle ? 'stop-circle-outline' : 'play-circle-outline'}
            size={22}
            color={colors.period}
          />
          <Text style={[font.body, { flex: 1, marginLeft: spacing.sm }]}>
            {openCycle ? 'Period End' : 'Period Start'}
          </Text>
          <Text style={font.muted}>{date}</Text>
        </MorphButton>

        <View style={styles.card}>
          <Text style={font.h3}>Flow</Text>
          <View style={styles.pillRow}>
            {FLOW_LEVELS.map((level) => {
              const active = log.flow === level.id;
              return (
                <MorphButton
                  key={level.id}
                  onPress={() => setLog((p) => ({ ...p, flow: active ? null : level.id }))}
                  style={styles.pillWrap}
                >
                  <Pop active={active}>
                    <View style={[styles.pill, active && { backgroundColor: colors.period, borderColor: colors.period }]}>
                      <View style={{ flexDirection: 'row' }}>
                        {Array.from({ length: level.drops }, (_, i) => (
                          <Ionicons
                            key={i}
                            name="water"
                            size={12}
                            color={active ? '#fff' : colors.period}
                          />
                        ))}
                      </View>
                      <Text style={[font.muted, styles.pillText, active && { color: '#fff', fontWeight: '700' }]}>
                        {level.label}
                      </Text>
                    </View>
                  </Pop>
                </MorphButton>
              );
            })}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={font.h3}>Note</Text>
          <TextInput
            value={log.notes}
            onChangeText={(notes) => setLog((p) => ({ ...p, notes }))}
            placeholder="How did today go?"
            placeholderTextColor={colors.textSecondary}
            multiline
            style={styles.noteInput}
          />
        </View>

        <MorphButton
          onPress={() => navigation.navigate('CycleIntercourse', { date })}
          style={styles.linkCard}
        >
          <Ionicons name="heart-outline" size={20} color={colors.accentPink} />
          <View style={{ flex: 1, marginLeft: spacing.sm }}>
            <Text style={font.body}>Intercourse</Text>
            <Text style={font.muted}>
              {intercourse
                ? [
                    intercourse.protection === 'protected' ? 'Protected' : 'Unprotected',
                    intercourse.orgasm ? 'Orgasm' : null,
                    intercourse.times ? `${intercourse.times}×` : null,
                  ].filter(Boolean).join(' · ')
                : 'Not logged'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </MorphButton>

        <View style={styles.card}>
          <Text style={font.h3}>Sex drive</Text>
          <View style={styles.pillRow}>
            {SEX_DRIVE_LEVELS.map((level) => {
              const active = log.sexDrive === level.id;
              return (
                <MorphButton
                  key={level.id}
                  onPress={() => setLog((p) => ({ ...p, sexDrive: active ? null : level.id }))}
                  style={styles.pillWrap}
                >
                  <Pop active={active}>
                    <View style={[styles.pill, active && { backgroundColor: colors.accentPink, borderColor: colors.accentPink }]}>
                      <Ionicons name={level.icon} size={14} color={active ? '#fff' : colors.accentPink} />
                      <Text style={[font.muted, styles.pillText, active && { color: '#fff', fontWeight: '700' }]}>
                        {level.label}
                      </Text>
                    </View>
                  </Pop>
                </MorphButton>
              );
            })}
          </View>
        </View>

        <MorphButton
          onPress={() => navigation.navigate('CycleAddSymptom', { date })}
          style={styles.linkCard}
        >
          <Ionicons name="medkit-outline" size={20} color={colors.accentIndigo} />
          <View style={{ flex: 1, marginLeft: spacing.sm }}>
            <Text style={font.body}>Symptoms</Text>
            <Text style={font.muted} numberOfLines={1}>
              {log.symptoms.length
                ? log.symptoms.map((id) => SYMPTOMS_BY_ID[id]?.label || id).join(', ')
                : 'None logged'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </MorphButton>

        <MorphButton
          onPress={() => navigation.navigate('CycleAddMood', { date })}
          style={styles.linkCard}
        >
          <Ionicons name="happy-outline" size={20} color={colors.accentIndigo} />
          <View style={{ flex: 1, marginLeft: spacing.sm }}>
            <Text style={font.body}>Mood</Text>
            <Text style={font.muted} numberOfLines={1}>
              {log.moods.length
                ? log.moods.map((id) => MOODS_BY_ID[id]?.label || id).join(', ')
                : 'None logged'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </MorphButton>
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
      marginTop: spacing.md, borderWidth: 1, borderColor: colors.border,
    },
    periodRow: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: colors.categoryChip, borderRadius: radius.card,
      padding: spacing.md, marginTop: spacing.lg,
    },
    pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
    pillWrap: {},
    pill: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    },
    pillText: { fontSize: 13 },
    noteInput: {
      backgroundColor: colors.surfaceAlt, color: colors.textPrimary, borderRadius: radius.md,
      padding: spacing.md, marginTop: spacing.sm, minHeight: 84, textAlignVertical: 'top',
      borderWidth: 1, borderColor: colors.border,
    },
    linkCard: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.md,
      marginTop: spacing.md, borderWidth: 1, borderColor: colors.border,
    },
  });
