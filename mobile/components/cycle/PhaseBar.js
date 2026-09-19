// The cycle bar from the reference app's Today and partner screens: a rounded
// track split into period / fertile / ovulation stretches, with a vertical
// marker sitting on today and "Day N" underneath it.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { spacing, radius } from '../../theme';
import { useTheme } from '../ThemeContext';
import { GrowBar } from '../Motion';

/**
 * @param cycleDay   1-based day of the current cycle
 * @param cycleLength average cycle length, i.e. the width of the whole track
 * @param periodLength how many leading days render as the period stretch
 * @param ovulationDay which day the fertile stretch centres on
 */
export default function PhaseBar({
  cycleDay,
  cycleLength = 28,
  periodLength = 5,
  ovulationDay,
  showDayLabel = true,
}) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const length = Math.max(cycleLength || 28, 1);
  const ovDay = ovulationDay || Math.max(1, length - 14);
  const pct = (day) => `${Math.min(100, Math.max(0, (day / length) * 100))}%`;

  const fertileStart = Math.max(1, ovDay - 5);
  const fertileEnd = Math.min(length, ovDay + 1);
  const markerAt = Math.min(Math.max(cycleDay || 1, 1), length);

  return (
    <View>
      <View style={styles.track}>
        {/* Period stretch — always anchored at the start of the cycle. */}
        <GrowBar
          value={Math.min(periodLength, length) / length}
          style={[styles.segment, styles.periodSegment, { left: 0 }]}
        />
        {/* Fertile window, with the ovulation day marked inside it. */}
        <View
          style={[
            styles.segment,
            styles.fertileSegment,
            { left: pct(fertileStart - 1), width: pct(fertileEnd - fertileStart + 1) },
          ]}
        />
        <View style={[styles.ovulationDot, { left: pct(ovDay - 0.5) }]} />
        {/* Today. */}
        <View style={[styles.marker, { left: pct(markerAt - 0.5) }]} />
      </View>
      {showDayLabel && (
        <Text style={[font.h3, styles.dayLabel]}>Day {cycleDay ?? '–'}</Text>
      )}
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    track: {
      height: 18,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceAlt,
      overflow: 'visible',
      justifyContent: 'center',
      marginTop: spacing.sm,
    },
    segment: { position: 'absolute', height: 18, borderRadius: radius.pill },
    periodSegment: { backgroundColor: colors.period },
    fertileSegment: { backgroundColor: colors.fertility },
    ovulationDot: {
      position: 'absolute',
      width: 10,
      height: 10,
      borderRadius: 5,
      marginLeft: -5,
      backgroundColor: '#FF8A00',
      borderWidth: 2,
      borderColor: '#fff',
    },
    marker: {
      position: 'absolute',
      width: 3,
      height: 28,
      marginLeft: -1.5,
      borderRadius: 2,
      backgroundColor: colors.textPrimary,
    },
    dayLabel: { textAlign: 'center', marginTop: spacing.sm },
  });
