// The Sun–Sat strip across the top of the daily log, with the selected day
// ringed and any day that already has a log marked with a dot.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { spacing } from '../../theme';
import { useTheme } from '../ThemeContext';
import { Pop } from '../Motion';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The seven dates of the Sunday-first week containing `date` (YYYY-MM-DD). */
export function weekOf(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(d);
    day.setUTCDate(d.getUTCDate() + i);
    return day.toISOString().slice(0, 10);
  });
}

export default function WeekStrip({ date, onSelect, loggedDates = new Set(), periodDates = new Set() }) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const week = weekOf(date);

  return (
    <View style={styles.row}>
      {week.map((d, i) => {
        const selected = d === date;
        const dayNum = Number(d.slice(-2));
        return (
          <Pressable key={d} onPress={() => onSelect(d)} style={styles.cell} accessibilityLabel={d}>
            <Text style={[font.muted, styles.dayName]}>{DAY_NAMES[i]}</Text>
            <Pop active={selected}>
              <View
                style={[
                  styles.circle,
                  periodDates.has(d) && { backgroundColor: colors.period },
                  selected && { borderWidth: 2, borderColor: colors.accentIndigo },
                ]}
              >
                <Text
                  style={[
                    font.body,
                    periodDates.has(d) && { color: '#fff' },
                    selected && { fontWeight: '700' },
                  ]}
                >
                  {dayNum}
                </Text>
              </View>
            </Pop>
            <View style={[styles.dot, loggedDates.has(d) ? { backgroundColor: colors.gold } : null]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
    cell: { alignItems: 'center', width: '14.28%' },
    dayName: { fontSize: 11, marginBottom: 4 },
    circle: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
    },
    dot: { width: 4, height: 4, borderRadius: 2, marginTop: 4, backgroundColor: 'transparent' },
  });
