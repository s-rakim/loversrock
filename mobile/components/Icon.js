// Real vector icons (Ionicons, bundled with Expo) instead of emoji glyphs —
// emoji render inconsistently across devices/fonts and can't take a chip
// background or an animated press state the way a vector glyph can.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radius, spacing } from '../theme';
import { MorphButton } from './Motion';
import { useTheme } from './ThemeContext';

// `name` is any Ionicons glyph name, e.g. "heart-outline", "flame".
//
// The colour defaults are resolved in the BODY, not as default parameters.
// They used to be `color = colors.accent`, which read fine and was broken:
// default parameters are evaluated in their own scope before the body runs,
// so `colors` - a const from useTheme() below - was still in its temporal
// dead zone. Every <Icon> without an explicit colour threw
// "Property 'colors' doesn't exist" at render.
//
// It worked until the theme refactor, when `colors` stopped being a
// module-scope import and became a hook result. The defaults were not moved
// with it.
export default function Icon({
  name,
  size = 20,
  color,
  chip = false,
  chipSize = 40,
  chipColor,
  onPress,
  style,
}) {
  const { colors } = useTheme();
  const glyphColor = color ?? colors.accent;
  const chipBackground = chipColor ?? colors.accentSoft;
  const glyph = <Ionicons name={name} size={size} color={glyphColor} />;

  const wrapperStyle = chip
    ? [styles.chip, { width: chipSize, height: chipSize, borderRadius: radius.icon, backgroundColor: chipBackground }, style]
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
