// "Which picture is you?"
//
// The app ships one picture of each of you, and the same app goes on both
// phones, so each phone has to be told which one is its owner. The server
// guesses until somebody answers (the person tracking their own cycle is
// usually the right guess), and one answer settles both phones: picking
// yours makes the other one your partner's, on their phone too.
import React, { useMemo, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, Alert } from 'react-native';
import { apiFetch } from '../services/api';
import { refreshWidgets } from '../services/widgetBridge';
import { ART_SETS } from '../assets/mascot';
import { spacing, radius } from '../theme';
import { useTheme } from './ThemeContext';
import useMascotOwners, { adoptMascotArt } from './useMascotOwners';

const CHOICES = ['a', 'b'];

export default function MascotPicker() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const owners = useMascotOwners();
  const [saving, setSaving] = useState(null);

  async function pick(art) {
    if (art === owners.me || saving) return;
    setSaving(art);
    try {
      await apiFetch('/profile/preferences', { method: 'PATCH', body: { mascotArt: art } });
      adoptMascotArt(art);
      // The distance widget draws both of you; it should swap too.
      refreshWidgets();
    } catch (err) {
      Alert.alert('Could not save', err.message);
    } finally {
      setSaving(null);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={font.body}>Which picture is you?</Text>
      <Text style={font.muted}>
        The other one becomes your partner, on both phones and on the distance widget.
      </Text>
      <View style={styles.row}>
        {CHOICES.map((art) => {
          const active = owners.me === art;
          return (
            <Pressable
              key={art}
              onPress={() => pick(art)}
              accessibilityRole="button"
              accessibilityState={{ selected: active, busy: saving === art }}
              accessibilityLabel={active ? 'This picture is you' : 'Choose this picture as you'}
              style={[styles.option, active && styles.optionActive, saving === art && { opacity: 0.5 }]}
            >
              <Image source={ART_SETS[art].neutral} style={styles.photo} resizeMode="contain" />
              <Text style={[styles.label, active && styles.labelActive]}>
                {active ? 'You' : 'Your partner'}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm, gap: 4,
  },
  row: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  option: {
    flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md,
    borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surfaceAlt,
  },
  optionActive: { borderColor: colors.accentPink },
  // Head to toe, the way the widget shows them.
  photo: { height: 150, aspectRatio: 0.4 },
  label: { marginTop: spacing.xs, fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  labelActive: { color: colors.accentPink },
});
