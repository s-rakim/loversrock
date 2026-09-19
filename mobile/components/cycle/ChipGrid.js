// The four-column grid of round pale chips used by Add Symptom and Add Mood.
//
// Layout is taken straight from the reference app: a circle of soft colour
// with the glyph centred in it, the label wrapped underneath on up to two
// lines, four to a row, and a springy pop when it is chosen.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import { useTheme } from '../ThemeContext';
import { Pop } from '../Motion';

const COLUMNS = 4;

export function GridChip({ item, selected, onPress, tint }) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const accent = tint || colors.accentPink;

  return (
    <Pressable
      onPress={() => onPress(item.id)}
      style={styles.cell}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={item.label}
    >
      <Pop active={selected}>
        <View
          style={[
            styles.bubble,
            selected && { backgroundColor: accent, borderColor: accent },
          ]}
        >
          <Ionicons
            name={item.icon}
            size={26}
            color={selected ? '#fff' : accent}
          />
        </View>
      </Pop>
      <Text
        numberOfLines={2}
        style={[
          font.muted,
          styles.label,
          selected && { color: colors.textPrimary, fontWeight: '600' },
        ]}
      >
        {item.label}
      </Text>
    </Pressable>
  );
}

export default function ChipGrid({ items, selected = [], onToggle, tint }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const chosen = new Set(selected);

  // Pad the last row so four-across chips stay left-aligned instead of
  // spreading out when the row is short.
  const filler = (COLUMNS - (items.length % COLUMNS)) % COLUMNS;

  return (
    <View style={styles.grid}>
      {items.map((item) => (
        <GridChip
          key={item.id}
          item={item}
          tint={tint}
          selected={chosen.has(item.id)}
          onPress={onToggle}
        />
      ))}
      {Array.from({ length: filler }, (_, i) => (
        <View key={`filler-${i}`} style={styles.cell} />
      ))}
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    cell: {
      width: `${100 / COLUMNS}%`,
      alignItems: 'center',
      marginBottom: spacing.md,
      paddingHorizontal: spacing.xs,
    },
    bubble: {
      // Fixed, not minHeight: this is a circle around a glyph, and a
      // borderRadius of half the width only stays round while the height
      // matches it. The label below is what has to grow with the font
      // setting, and it does - it has no height of its own.
      width: 62,
      height: 62,
      borderRadius: 31,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
      borderWidth: 1,
      borderColor: colors.border,
    },
    label: { marginTop: spacing.xs, textAlign: 'center', fontSize: 12 },
  });
