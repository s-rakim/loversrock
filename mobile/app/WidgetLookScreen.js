// Widget look: the colour, gradient or pattern behind every home-screen
// widget (all but the locket, which is the photo itself).
//
// Everything here is previewed live, drawn by the same rules the widgets use
// (components/widgetLook.js), and nothing reaches the widgets until Apply —
// each apply repaints every widget on the home screen, which is not
// something to do on every slider step.
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, useWindowDimensions,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius } from '../theme';
import { useTheme } from '../components/ThemeContext';
import ColorPicker from '../components/ColorPicker';
import WidgetBackdrop from '../components/WidgetBackdrop';
import {
  GRADIENTS, MAX_COLORS, PATTERNS, PRESETS, applyPreset, normalizeLook, tint,
} from '../components/widgetLook';
import {
  WIDGET_OPACITY, getWidgetLook, getWidgetOpacity, setWidgetLook, setWidgetOpacity,
  widgetLooksSupported,
} from '../services/widgetBridge';

const KIND_LABELS = { glass: 'Grey glass', solid: 'Colour', gradient: 'Gradient', pattern: 'Pattern' };
const GRADIENT_LABELS = { linear: 'Linear', radial: 'Radial', aurora: 'Aurora', blend: 'Four corners' };
const PATTERN_LABELS = { stripes: 'Stripes', dots: 'Dots', checks: 'Checks', waves: 'Waves' };
const INK_LABELS = { auto: 'Auto', dark: 'Dark', light: 'Light' };

// A stand-in wallpaper behind the preview, so translucency shows as it will
// on a real home screen rather than against the app's own background.
const WALLPAPER = ['#3A1C71', '#D76D77', '#FFAF7B'];

/** How many colours a look can use: one for a solid, four for the corners. */
function colorLimits(look) {
  if (look.kind === 'solid') return [1, 1];
  if (look.kind === 'gradient' && look.gradient === 'blend') return [2, 4];
  return [1, MAX_COLORS];
}

export default function WidgetLookScreen() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { width: screenWidth } = useWindowDimensions();
  const [look, setLook] = useState(() => normalizeLook(null));
  const [saved, setSaved] = useState(null);
  const [opacity, setOpacity] = useState(WIDGET_OPACITY.default);
  const [editing, setEditing] = useState(null);     // index of the colour being picked
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    getWidgetLook().then((l) => { setLook(l); setSaved(JSON.stringify(l)); });
    getWidgetOpacity().then(setOpacity);
  }, []);

  const update = (patch) => setLook((current) => {
    const next = normalizeLook({ ...current, ...patch });
    const [, most] = colorLimits(next);
    if (next.colors.length > most) next.colors = next.colors.slice(0, most);
    return normalizeLook(next);
  });

  const setColor = (i, hex) => update({ colors: look.colors.map((c, k) => (k === i ? hex : c)) });
  const addColor = () => {
    const last = look.colors[look.colors.length - 1];
    update({ colors: [...look.colors, tint(last)] });
    setEditing(look.colors.length);
  };
  const removeColor = (i) => {
    update({ colors: look.colors.filter((_, k) => k !== i) });
    setEditing(null);
  };

  async function apply() {
    setApplying(true);
    try {
      const value = await setWidgetLook(look);
      await setWidgetOpacity(opacity);
      setLook(value);
      setSaved(JSON.stringify(value));
    } finally {
      setApplying(false);
    }
  }

  const dirty = saved !== JSON.stringify(look);
  const previewW = Math.min(screenWidth - spacing.lg * 2, 380);
  const previewH = previewW * 0.5;
  const ink = look.ink === 'light' ? '#FFFFFF' : '#2B2320';
  const inkMuted = look.ink === 'light' ? 'rgba(255,255,255,0.8)' : '#555A62';
  const [fewest, most] = colorLimits(look);
  const showAngle = look.kind === 'pattern' || (look.kind === 'gradient' && ['linear', 'aurora'].includes(look.gradient));

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {/* The preview: a 4x2 widget on a stand-in wallpaper. */}
      <View style={[styles.wallpaper, { width: previewW + spacing.md * 2 }]}>
        <LinearGradient colors={WALLPAPER} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <View style={{ width: previewW, height: previewH }}>
          <WidgetBackdrop look={look} opacity={opacity} width={previewW} height={previewH} />
          <View style={styles.previewText}>
            <Text style={{ color: inkMuted, fontSize: 12 }}>
              Our distance: <Text style={{ color: ink, fontWeight: '700', fontSize: 16 }}>1,305 km</Text>
            </Text>
            <Text style={{ color: inkMuted, fontSize: 11, marginTop: 'auto' }}>Last known distance</Text>
          </View>
        </View>
      </View>

      {!widgetLooksSupported && (
        <Text style={[font.muted, styles.note]}>
          This build's widgets cannot draw colours yet. Install the latest APK and they will pick this up.
        </Text>
      )}

      <Text style={[font.h3, styles.heading]}>Start from</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetRow}>
        {PRESETS.map((preset) => {
          const sample = normalizeLook(applyPreset(look, preset));
          return (
            <Pressable key={preset.name} onPress={() => { setLook(sample); setEditing(null); }} style={styles.preset}>
              <WidgetBackdrop look={sample} opacity={100} width={76} height={44} radius={12} />
              <Text style={styles.presetLabel}>{preset.name}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={[font.h3, styles.heading]}>Style</Text>
      <Segments value={look.kind} labels={KIND_LABELS} onChange={(kind) => update({ kind })} styles={styles} />

      {look.kind === 'gradient' && (
        <Segments value={look.gradient} labels={GRADIENT_LABELS} keys={GRADIENTS}
          onChange={(gradient) => update({ gradient })} styles={styles} />
      )}
      {look.kind === 'pattern' && (
        <Segments value={look.pattern} labels={PATTERN_LABELS} keys={PATTERNS}
          onChange={(pattern) => update({ pattern })} styles={styles} />
      )}

      {look.kind !== 'glass' && (
        <>
          <Text style={[font.h3, styles.heading]}>Colours</Text>
          <View style={styles.swatchRow}>
            {look.colors.map((c, i) => (
              <Pressable
                key={`${i}-${c}`}
                onPress={() => setEditing(editing === i ? null : i)}
                accessibilityLabel={`Colour ${i + 1}, ${c}`}
                style={[styles.swatch, { backgroundColor: c }, editing === i && styles.swatchActive]}
              />
            ))}
            {look.colors.length < most && (
              <Pressable onPress={addColor} style={[styles.swatch, styles.addSwatch]} accessibilityLabel="Add a colour">
                <Ionicons name="add" size={22} color={colors.textSecondary} />
              </Pressable>
            )}
          </View>
          {look.kind === 'gradient' && look.gradient === 'blend' && (
            <Text style={font.muted}>Top left, top right, bottom left, bottom right.</Text>
          )}
          {editing !== null && editing < look.colors.length && (
            <View style={styles.pickerCard}>
              <ColorPicker
                key={editing}
                lightness
                value={look.colors[editing]}
                onChange={(hex) => setColor(editing, hex)}
                onClear={look.colors.length > fewest ? () => removeColor(editing) : undefined}
                clearLabel="Remove colour"
              />
            </View>
          )}

          {showAngle && (
            <>
              <Text style={[font.h3, styles.heading]}>Angle · {look.angle}°</Text>
              <Slider
                minimumValue={0} maximumValue={355} step={5} value={look.angle}
                onValueChange={(angle) => update({ angle })}
                minimumTrackTintColor={colors.accent} maximumTrackTintColor={colors.border} thumbTintColor={colors.accent}
              />
            </>
          )}
          {look.kind === 'pattern' && (
            <>
              <Text style={[font.h3, styles.heading]}>Size</Text>
              <Slider
                minimumValue={1} maximumValue={10} step={1} value={look.scale}
                onValueChange={(scale) => update({ scale })}
                minimumTrackTintColor={colors.accent} maximumTrackTintColor={colors.border} thumbTintColor={colors.accent}
              />
            </>
          )}

          <Text style={[font.h3, styles.heading]}>Text</Text>
          <Segments value={look.inkMode} labels={INK_LABELS} onChange={(inkMode) => update({ inkMode })} styles={styles} />
          <Text style={font.muted}>Auto picks white text on dark colours and dark text on light ones.</Text>
        </>
      )}

      <Text style={[font.h3, styles.heading]}>Translucency · {opacity}%</Text>
      <Slider
        minimumValue={WIDGET_OPACITY.min} maximumValue={WIDGET_OPACITY.max} step={WIDGET_OPACITY.step}
        value={opacity} onValueChange={setOpacity}
        minimumTrackTintColor={colors.accent} maximumTrackTintColor={colors.border} thumbTintColor={colors.accent}
      />
      <View style={styles.sliderEnds}>
        <Text style={[font.muted, { fontSize: 11 }]}>Clear</Text>
        <Text style={[font.muted, { fontSize: 11 }]}>Solid</Text>
      </View>

      <Pressable
        onPress={apply}
        disabled={applying}
        style={[styles.apply, !dirty && styles.applyDone]}
        accessibilityRole="button"
      >
        <Text style={styles.applyLabel}>{applying ? 'Applying…' : dirty ? 'Apply to widgets' : 'Applied'}</Text>
      </Pressable>
    </ScrollView>
  );
}

function Segments({ value, labels, keys, onChange, styles }) {
  return (
    <View style={styles.segmentRow}>
      {(keys || Object.keys(labels)).map((key) => (
        <Pressable
          key={key}
          onPress={() => onChange(key)}
          accessibilityRole="button"
          accessibilityState={{ selected: value === key }}
          style={[styles.segment, value === key && styles.segmentActive]}
        >
          <Text style={[styles.segmentLabel, value === key && styles.segmentLabelActive]}>{labels[key]}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 3 },
  wallpaper: {
    alignSelf: 'center', padding: spacing.md, borderRadius: radius.lg, overflow: 'hidden',
    marginBottom: spacing.md,
  },
  previewText: { ...StyleSheet.absoluteFillObject, padding: 14 },
  note: { marginBottom: spacing.md },
  heading: { marginTop: spacing.lg, marginBottom: spacing.sm },
  presetRow: { gap: spacing.sm, paddingRight: spacing.lg },
  preset: { alignItems: 'center', width: 80 },
  presetLabel: { marginTop: 4, fontSize: 11, color: colors.textSecondary, fontWeight: '600' },
  segmentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  segment: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  segmentActive: { backgroundColor: colors.tabBarActivePill, borderColor: colors.accentPink },
  segmentLabel: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  segmentLabelActive: { color: colors.accentPink },
  swatchRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  swatch: {
    width: 48, height: 48, borderRadius: 14, borderWidth: 3, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  swatchActive: { borderColor: colors.textPrimary },
  addSwatch: { borderStyle: 'dashed', backgroundColor: colors.surface },
  pickerCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, marginTop: spacing.sm,
  },
  sliderEnds: { flexDirection: 'row', justifyContent: 'space-between' },
  apply: {
    marginTop: spacing.xl, backgroundColor: colors.accentPink, borderRadius: radius.pill,
    paddingVertical: spacing.md, alignItems: 'center',
  },
  applyDone: { opacity: 0.55 },
  applyLabel: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
