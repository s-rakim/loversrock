// The Intercourse sheet: Condom (Protected / Unprotected), Female orgasm
// (Yes / No), and a −/+ Times stepper, with the pink Save at the bottom —
// the reference app's screen, field for field.
//
// The whole record stays on the owner's account. A partner with sharing on
// only ever learns that something was logged (docs/SPEC.md #5, amended):
// protection, orgasm and the count are never returned by /period/partner.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import { useTheme } from '../../components/ThemeContext';
import { Stagger, MorphButton, Pop } from '../../components/Motion';
import SheetHeader from '../../components/cycle/SheetHeader';
import { useCycle, todayDateString } from '../../components/cycle/CycleContext';

function Choice({ options, value, onChange, tint }) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.choiceRow}>
      {options.map((option) => {
        const active = value === option.value;
        return (
          <MorphButton key={String(option.value)} onPress={() => onChange(option.value)} style={{ flex: 1 }}>
            <Pop active={active}>
              <View style={[styles.choice, active && { backgroundColor: tint, borderColor: tint }]}>
                {option.icon && (
                  <Ionicons name={option.icon} size={16} color={active ? '#fff' : tint} />
                )}
                <Text style={[font.body, active && { color: '#fff', fontWeight: '700' }]}>
                  {option.label}
                </Text>
              </View>
            </Pop>
          </MorphButton>
        );
      })}
    </View>
  );
}

export default function IntercourseScreen({ navigation, route }) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { getLog, saveLog } = useCycle();

  const date = route.params?.date || todayDateString();
  const [protection, setProtection] = useState(null);
  const [orgasm, setOrgasm] = useState(null);
  const [times, setTimes] = useState(1);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getLog(date)
      .then((row) => {
        const rec = row?.intercourse;
        if (!rec) return;
        setProtection(rec.protection ?? null);
        setOrgasm(rec.orgasm ?? null);
        setTimes(rec.times ?? 1);
      })
      .catch(() => {});
  }, [date, getLog]);

  async function save() {
    setSaving(true);
    try {
      await saveLog({
        date,
        intercourse: { had: true, protection, orgasm, times },
      });
      navigation.goBack();
    } catch (err) {
      Alert.alert('Could not save', err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <SheetHeader title="Intercourse" onClose={() => navigation.goBack()} onConfirm={save} saving={saving} />

      <Stagger delayStep={55} initialDelay={40}>
        <View style={styles.card}>
          <Text style={font.h3}>Condom</Text>
          <Choice
            tint={colors.accentIndigo}
            value={protection}
            onChange={setProtection}
            options={[
              { value: 'protected', label: 'Protected', icon: 'shield-checkmark-outline' },
              { value: 'unprotected', label: 'Unprotected', icon: 'shield-outline' },
            ]}
          />
        </View>

        <View style={styles.card}>
          <Text style={font.h3}>Female orgasm</Text>
          <Choice
            tint={colors.accentPink}
            value={orgasm}
            onChange={setOrgasm}
            options={[
              { value: true, label: 'Yes', icon: 'checkmark-circle-outline' },
              { value: false, label: 'No', icon: 'close-circle-outline' },
            ]}
          />
        </View>

        <View style={styles.card}>
          <Text style={font.h3}>Times</Text>
          <View style={styles.stepper}>
            <MorphButton onPress={() => setTimes((t) => Math.max(1, t - 1))} style={styles.stepButton}>
              <Ionicons name="remove" size={22} color={colors.accentPink} />
            </MorphButton>
            <Text style={font.h1}>{times}</Text>
            <MorphButton onPress={() => setTimes((t) => Math.min(20, t + 1))} style={styles.stepButton}>
              <Ionicons name="add" size={22} color={colors.accentPink} />
            </MorphButton>
          </View>
        </View>

        <Text style={[font.muted, styles.privacyNote]}>
          Only you can see this. With sharing on, your partner sees that
          something was logged — never the details.
        </Text>

        <MorphButton onPress={save} disabled={saving} style={styles.saveButton}>
          <Text style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save'}</Text>
        </MorphButton>
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
      marginTop: spacing.md, borderWidth: 1, borderColor: colors.border,
    },
    choiceRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    choice: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
      backgroundColor: colors.surfaceAlt, paddingVertical: spacing.sm,
    },
    stepper: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginTop: spacing.sm, paddingHorizontal: spacing.xl,
    },
    stepButton: {
      width: 44, height: 44, borderRadius: 22,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    privacyNote: { marginTop: spacing.md },
    saveButton: {
      backgroundColor: colors.accentPink, borderRadius: radius.pill,
      paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.md,
    },
    saveButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  });
