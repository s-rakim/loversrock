// Real vector icons (Ionicons, bundled with Expo) instead of emoji glyphs —
// emoji render inconsistently across devices/fonts and can't take a chip
// background or an animated press state the way a vector glyph can.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '../theme';
import { MorphButton } from './Motion';

// `name` is any Ionicons glyph name, e.g. "heart-outline", "flame".
export default function Icon({
  name,
  size = 20,
  color = colors.accent,
  chip = false,
  chipSize = 40,
  chipColor = colors.accentSoft,
  onPress,
  style,
}) {
  const glyph = <Ionicons name={name} size={size} color={color} />;

  const wrapperStyle = chip
    ? [styles.chip, { width: chipSize, height: chipSize, borderRadius: radius.icon, backgroundColor: chipColor }, style]
    : style;

  if (onPress) {
    return (
      <MorphButton onPress={onPress} style={wrapperStyle}>
        {glyph}
      </MorphButton>
    );
  }

  return <View style={wrapperStyle}>{glyph}</View>;
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
