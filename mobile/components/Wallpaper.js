// The wallpaper behind the message thread.
//
// Personal, not shared: what you want behind your own reading is a reading
// preference, and the two of you having different taste is not a conflict to
// resolve. It lives on the account rather than the device, so it follows you
// to a new phone.
//
// Every built-in has a light and a dark variant. A single palette that looks
// right on the light theme is muddy on the dark one, and a chat background
// is exactly where that shows — the bubbles have to stay readable on it.
import React, { useMemo } from 'react';
import { View, StyleSheet, Image } from 'react-native';
import Svg, { Path, Circle, Rect, Defs, Pattern, G } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { mediaUrl } from '../services/api';
import { useTheme } from './ThemeContext';

export const PHOTO_PREFIX = 'photo:';

/**
 * `tint` is what patterns draw in, kept deliberately low-contrast: a
 * wallpaper that competes with the text is a worse wallpaper.
 */
export const WALLPAPERS = [
  {
    id: 'none',
    label: 'None',
    light: { colors: ['#EDE9FB', '#F8E8F1'], tint: null },
    dark: { colors: ['#0B0B1A', '#1A1030'], tint: null },
    // The lava lamp shows through this one, which is the app's own look.
    transparent: true,
  },
  {
    id: 'blush',
    label: 'Blush',
    light: { colors: ['#FFE3EC', '#FFF1E6'], tint: null },
    dark: { colors: ['#2A0F1E', '#3B1428'], tint: null },
  },
  {
    id: 'dusk',
    label: 'Dusk',
    light: { colors: ['#E6E2FB', '#F3E4F5'], tint: null },
    dark: { colors: ['#14102B', '#251640'], tint: null },
  },
  {
    id: 'mint',
    label: 'Mint',
    light: { colors: ['#E3F6EE', '#E8F3FB'], tint: null },
    dark: { colors: ['#0D2320', '#12302C'], tint: null },
  },
  {
    id: 'sunset',
    label: 'Sunset',
    light: { colors: ['#FFE9CF', '#FFD6D6'], tint: null },
    dark: { colors: ['#2C1509', '#3A1418'], tint: null },
  },
  {
    id: 'ink',
    label: 'Ink',
    light: { colors: ['#EFEFF4', '#E4E4EC'], tint: null },
    dark: { colors: ['#07070D', '#101018'], tint: null },
  },
  {
    id: 'hearts',
    label: 'Hearts',
    pattern: 'hearts',
    light: { colors: ['#FFF1F4', '#FFE8F0'], tint: 'rgba(255,92,141,0.18)' },
    dark: { colors: ['#180A12', '#24101C'], tint: 'rgba(255,92,141,0.22)' },
  },
  {
    id: 'stars',
    label: 'Stars',
    pattern: 'stars',
    light: { colors: ['#EEF1FB', '#F6F0FA'], tint: 'rgba(75,31,209,0.14)' },
    dark: { colors: ['#06060F', '#0E0C1E'], tint: 'rgba(255,255,255,0.35)' },
  },
  {
    id: 'lattice',
    label: 'Lattice',
    pattern: 'lattice',
    light: { colors: ['#F6F2EC', '#EFE9E2'], tint: 'rgba(0,0,0,0.07)' },
    dark: { colors: ['#0C0C12', '#15151F'], tint: 'rgba(255,255,255,0.08)' },
  },
];

export const WALLPAPERS_BY_ID = Object.fromEntries(WALLPAPERS.map((w) => [w.id, w]));

/** Splits 'photo:<key>' into its key, or null for a built-in. */
export function photoKeyOf(value) {
  if (typeof value !== 'string' || !value.startsWith(PHOTO_PREFIX)) return null;
  const key = value.slice(PHOTO_PREFIX.length);
  return key || null;
}

/** The repeating motif, drawn as a tiled SVG rather than a shipped bitmap. */
function PatternLayer({ pattern, tint }) {
  if (!pattern || !tint) return null;

  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
      <Defs>
        <Pattern id="motif" patternUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          {pattern === 'hearts' && (
            <G>
              {/* Two per tile, offset, so the repeat is less obvious. */}
              <Path
                d="M16 26 C16 20, 8 20, 8 26 C8 31, 16 36, 16 36 C16 36, 24 31, 24 26 C24 20, 16 20, 16 26 Z"
                fill={tint}
              />
              <Path
                d="M48 58 C48 52, 40 52, 40 58 C40 63, 48 68, 48 68 C48 68, 56 63, 56 58 C56 52, 48 52, 48 58 Z"
                fill={tint}
              />
            </G>
          )}
          {pattern === 'stars' && (
            <G>
              <Circle cx="12" cy="14" r="1.6" fill={tint} />
              <Circle cx="44" cy="8" r="1.1" fill={tint} />
              <Circle cx="28" cy="34" r="2" fill={tint} />
              <Circle cx="56" cy="46" r="1.3" fill={tint} />
              <Circle cx="8" cy="52" r="1.5" fill={tint} />
              <Circle cx="38" cy="58" r="1" fill={tint} />
            </G>
          )}
          {pattern === 'lattice' && (
            <G>
              <Path d="M0 32 L32 0 M32 64 L64 32" stroke={tint} strokeWidth="1.2" fill="none" />
              <Path d="M0 32 L32 64 M32 0 L64 32" stroke={tint} strokeWidth="1.2" fill="none" />
            </G>
          )}
        </Pattern>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#motif)" />
    </Svg>
  );
}

/**
 * Renders behind the thread. `value` is a wallpaper id, 'photo:<key>', or
 * null — an unknown id falls back to 'none' rather than rendering nothing,
 * so a wallpaper removed in a later version degrades instead of breaking.
 */
export default function Wallpaper({ value, children, style }) {
  const { isDark } = useTheme();

  const photoKey = photoKeyOf(value);
  const preset = photoKey ? null : (WALLPAPERS_BY_ID[value] || WALLPAPERS_BY_ID.none);
  const variant = preset ? (isDark ? preset.dark : preset.light) : null;

  const body = useMemo(() => {
    if (photoKey) {
      return (
        <>
          <Image source={{ uri: mediaUrl(photoKey) }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          {/* A scrim, or the bubbles are unreadable over a bright photo.
              Heavier in dark mode because the text is light. */}
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: isDark ? 'rgba(0,0,0,0.58)' : 'rgba(255,255,255,0.55)' },
            ]}
          />
        </>
      );
    }
    if (preset?.transparent) return null;   // let the lava lamp through
    return (
      <>
        <LinearGradient
          colors={variant.colors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <PatternLayer pattern={preset.pattern} tint={variant.tint} />
      </>
    );
  }, [photoKey, preset, variant, isDark]);

  return (
    <View style={[{ flex: 1 }, style]}>
      {body}
      {children}
    </View>
  );
}

/** The small square used in the picker. Same renderer, fixed size. */
export function WallpaperSwatch({ value, size = 64 }) {
  return (
    <View style={{ width: size, height: size * 1.4, borderRadius: 12, overflow: 'hidden' }}>
      <Wallpaper value={value} />
    </View>
  );
}
