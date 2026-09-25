// Real vector icons (Ionicons, bundled with Expo) instead of emoji glyphs —
// emoji render inconsistently across devices/fonts and can't take a chip
// background or an animated press state the way a vector glyph can.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radius, spacing } from '../theme';
import { MorphButton } from './Motion';
import { useTheme } from './ThemeContext';

/**
 * Ionicons ships most glyphs as a thin `-outline` and a filled solid, e.g.
 * "heart-outline" and "heart". The app asked for the outline everywhere,
 * which at 16-20px is a one-pixel hairline — thin, pale, and weightless.
 *
 * `solidOf` drops the suffix, but ONLY when the filled glyph genuinely
 * exists: Ionicons renders an unknown name as a "?" box, so guessing would
 * trade a thin icon for a broken one. The glyph map is bundled, so this is a
 * lookup rather than a hope.
 */
const GLYPHS = Ionicons.glyphMap || {};

export function solidOf(name) {
  if (typeof name !== 'string' || !name.endsWith('-outline')) return name;
  const filled = name.slice(0, -'-outline'.length);
  return filled in GLYPHS ? filled : name;
}

/**
 * The other direction, for the same reason: a set of icon names written as
 * solids (the way a nav or a segmented control names them) still wants a
 * hairline version for the inactive state. Falls back to the solid when
 * Ionicons has no outline for that glyph, rather than rendering a "?" box.
 */
export function outlineOf(name) {
  if (typeof name !== 'string' || name.endsWith('-outline')) return name;
  const thin = `${name}-outline`;
  return thin in GLYPHS ? thin : name;
}

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
  // 'bold' fills the glyph where a filled variant exists. Chips default to
  // bold because a chip is a deliberate emphasis; a bare inline icon does not.
  weight,
}) {
  const { colors } = useTheme();

  // iconGlyph is a deep rose rather than the mid-pink accent. accent on
  // accentSoft measured 2.02:1 — pink on pink — which is why every icon in
  // the app read as washed out. This measures 4.66:1 on the same chip.
  const glyphColor = color ?? colors.iconGlyph ?? colors.accent;
  const chipBackground = chipColor ?? colors.iconChip ?? colors.accentSoft;
  const bold = weight ? weight === 'bold' : chip;

  const glyph = <Ionicons name={bold ? solidOf(name) : name} size={size} color={glyphColor} />;

  const wrapperStyle = chip
    ? [
        styles.chip,
        {
          width: chipSize,
          height: chipSize,
          borderRadius: radius.icon,
          backgroundColor: chipBackground,
          // A hairline edge. On a translucent chip over a drifting
          // background, the shape otherwise dissolves into whatever blob
          // happens to be passing underneath.
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: colors.iconChipBorder ?? 'transparent',
        },
        style,
      ]
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
