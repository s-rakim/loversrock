// Picking any colour for the app, not just one of the five presets.
//
// A hue strip and a saturation strip rather than a 2D gradient square,
// because a square needs a pan responder tracking a point and this needs two
// taps. Lightness is deliberately NOT offered: the accent's readable
// companion shade is derived from luminance (see glyphForAccent), and letting
// someone choose a near-white accent would mean a button nobody can read
// sitting next to icons that are still, correctly, perfectly legible. Hue and
// saturation are the choices that matter; the third one only breaks things.
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius, hslToHex, hexToHsl, isHexColor, glyphForAccent } from '../theme';
import { useTheme } from './ThemeContext';

const HUES = Array.from({ length: 12 }, (_, i) => i / 12);
const SATURATIONS = [0.25, 0.45, 0.65, 0.85, 1];
// Offered only where readability is not at stake — a widget background can
// be navy or pastel; an accent that buttons are drawn in cannot.
const LIGHTNESSES = [0.12, 0.25, 0.4, 0.55, 0.7, 0.85, 0.95];

/**
 * @param lightness  also offer light and dark shades (the widget colours).
 * @param clearLabel the text of the clear button; hidden when no onClear.
 */
export default function ColorPicker({ value, onChange, onClear, lightness = false, clearLabel = 'Use a preset' }) {
  const { colors, font, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const current = isHexColor(value) ? hexToHsl(value) : { h: 0.95, s: 0.85, l: 0.55 };
  const [hue, setHue] = useState(current.h);
  const [sat, setSat] = useState(current.s || 0.85);
  const [light, setLight] = useState(lightness ? current.l : 0.55);
  const [typed, setTyped] = useState(value || '');

  const pick = (h, s, l = light) => {
    setHue(h);
    setSat(s);
    setLight(l);
    const hex = hslToHex(h, s, l);
    setTyped(hex);
    onChange(hex);
  };

  const preview = hslToHex(hue, sat, light);

  return (
    <View>
      <View style={styles.previewRow}>
        <View style={[styles.previewSwatch, { backgroundColor: preview }]}>
          {/* The derived icon shade, shown on its own chip — so you can see
              what the icons will look like before committing to a colour. */}
          <View style={[styles.previewChip, { backgroundColor: `${preview}33` }]}>
            <Ionicons name="heart" size={18} color={glyphForAccent(preview, isDark)} />
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={font.body}>{preview.toUpperCase()}</Text>
          <Text style={font.muted}>
            Icons pick their own shade from this so they stay readable.
          </Text>
        </View>
      </View>

      <Text style={[font.muted, styles.label]}>Hue</Text>
      <View style={styles.strip}>
        {HUES.map((h) => (
          <Pressable key={h} onPress={() => pick(h, sat)} style={{ flex: 1 }}>
            <View
              style={[
                styles.stripCell,
                { backgroundColor: hslToHex(h, 0.85, 0.55) },
                Math.abs(h - hue) < 0.001 && styles.stripCellActive,
              ]}
            />
          </Pressable>
        ))}
      </View>

      <Text style={[font.muted, styles.label]}>Strength</Text>
      <View style={styles.strip}>
        {SATURATIONS.map((s) => (
          <Pressable key={s} onPress={() => pick(hue, s)} style={{ flex: 1 }}>
            <View
              style={[
                styles.stripCell,
                { backgroundColor: hslToHex(hue, s, lightness ? light : 0.55) },
                Math.abs(s - sat) < 0.001 && styles.stripCellActive,
              ]}
            />
          </Pressable>
        ))}
      </View>

      {lightness && (
        <>
          <Text style={[font.muted, styles.label]}>Light</Text>
          <View style={styles.strip}>
            {LIGHTNESSES.map((l) => (
              <Pressable key={l} onPress={() => pick(hue, sat, l)} style={{ flex: 1 }}>
                <View
                  style={[
                    styles.stripCell,
                    { backgroundColor: hslToHex(hue, sat, l) },
                    Math.abs(l - light) < 0.02 && styles.stripCellActive,
                  ]}
                />
              </Pressable>
            ))}
          </View>
        </>
      )}

      <Text style={[font.muted, styles.label]}>Or type one</Text>
      <View style={styles.hexRow}>
        <TextInput
          value={typed}
          onChangeText={(t) => {
            setTyped(t);
            if (isHexColor(t)) {
              const parsed = hexToHsl(t);
              setHue(parsed.h);
              setSat(parsed.s);
              if (lightness) setLight(parsed.l);
              onChange(t);
            }
          }}
          placeholder="#FF5C8D"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          style={styles.hexInput}
        />
        {onClear && (
          <Pressable onPress={onClear} style={styles.clearButton}>
            <Text style={{ color: colors.accent, fontWeight: '600' }}>{clearLabel}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    previewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
    previewSwatch: {
      width: 64, height: 64, borderRadius: 18,
      alignItems: 'center', justifyContent: 'center',
    },
    previewChip: {
      width: 38, height: 38, borderRadius: 12,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.35)',
    },
    label: { marginTop: spacing.sm, marginBottom: 4 },
    strip: { flexDirection: 'row', gap: 3 },
    stripCell: {
      height: 34, borderRadius: 8,
      borderWidth: 3, borderColor: 'transparent',
    },
    stripCellActive: { borderColor: colors.textPrimary },
    hexRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
    hexInput: {
      flex: 1, backgroundColor: colors.surfaceAlt, color: colors.textPrimary,
      borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      borderWidth: 1, borderColor: colors.border,
    },
    clearButton: {
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      backgroundColor: colors.accentSoft, borderRadius: radius.pill,
    },
  });
