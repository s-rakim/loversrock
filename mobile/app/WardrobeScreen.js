// Dressing your own character.
//
// You dress yours; they see it. That asymmetry is the feature — the little
// person at the top of their Home is you, wearing what you put on this
// morning and the mood you set. Dressing THEIR character would make it a
// dress-up game about someone else.
//
// The preview is the real renderer, not a thumbnail, so what you are looking
// at while choosing is exactly what lands on their phone.
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '../services/api';
import { spacing, radius } from '../theme';
import { useTheme } from '../components/ThemeContext';
import { MorphButton } from '../components/Motion';
import Character, { SKINS, HAIR_COLORS, GARMENT_COLORS } from '../components/Character';
import { hasArtFor } from '../assets/mascot';
import usePartnerMood from '../components/usePartnerMood';

const SLOTS = [
  { key: 'top', label: 'Top', icon: 'shirt-outline' },
  { key: 'bottom', label: 'Bottoms', icon: 'construct-outline' },
  { key: 'shoes', label: 'Shoes', icon: 'footsteps-outline' },
  { key: 'accessory', label: 'Extras', icon: 'glasses-outline' },
];

const TABS = [
  { key: 'you', label: 'You', icon: 'person-outline' },
  ...SLOTS,
];

export default function WardrobeScreen() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { mine } = usePartnerMood();

  const [avatar, setAvatar] = useState(null);
  const [wardrobe, setWardrobe] = useState(null);
  const [tab, setTab] = useState('you');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useFocusEffect(useCallback(() => {
    Promise.all([apiFetch('/presence/avatars'), apiFetch('/presence/wardrobe')])
      .then(([a, w]) => { setAvatar(a.mine); setWardrobe(w); })
      .catch(() => {});
  }, []));

  const change = (patch) => {
    setAvatar((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };
  const wear = (slot, patch) => {
    setAvatar((prev) => ({
      ...prev,
      outfit: { ...prev.outfit, [slot]: { ...prev.outfit[slot], ...patch } },
    }));
    setDirty(true);
  };

  async function save() {
    setSaving(true);
    try {
      const { avatar: saved } = await apiFetch('/presence/avatars', { method: 'PUT', body: avatar });
      setAvatar(saved);
      setDirty(false);
    } catch (err) {
      Alert.alert('Could not save', err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!avatar || !wardrobe) {
    return <View style={styles.centered}><ActivityIndicator color={colors.accent} /></View>;
  }

  const slot = SLOTS.find((s) => s.key === tab);
  const garments = slot ? wardrobe.WARDROBE[slot.key] : null;
  const chosen = slot ? avatar.outfit[slot.key] : null;
  const garmentSpec = slot ? garments[chosen?.id] : null;

  const Swatches = ({ palette, value, onPick }) => (
    <View style={styles.swatchRow}>
      {Object.entries(palette).map(([id, hex]) => (
        <Pressable key={id} onPress={() => onPick(id)}>
          <View style={[styles.swatch, { backgroundColor: hex }, value === id && styles.swatchOn]} />
        </Pressable>
      ))}
    </View>
  );

  return (
    <View style={styles.root}>
      <View style={styles.stage}>
        {/* The real renderer, wearing your current mood — so you can see
            exactly what they see. */}
        <Character avatar={avatar} mood={mine?.mood} who="me" height={230} />
        {/* Artwork is used as supplied. Drawing a hoodie over a picture of a
            real person would look exactly as bad as it sounds, so when there
            IS art the wardrobe stops claiming it applies. */}
        <Text style={[font.muted, styles.stageNote]}>
          {hasArtFor('me')
            ? 'Your artwork is what they see. The wardrobe dresses the drawn character.'
            : 'This is what they see on their phone.'}
        </Text>
      </View>

      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable key={t.key} onPress={() => setTab(t.key)} style={{ flex: 1 }}>
            <View style={[styles.tab, tab === t.key && styles.tabOn]}>
              <Ionicons name={t.icon} size={17}
                color={tab === t.key ? colors.accent : colors.textSecondary} />
              <Text style={[styles.tabLabel, tab === t.key && { color: colors.accent, fontWeight: '700' }]}>
                {t.label}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.panel}>
        {tab === 'you' ? (
          <>
            <Text style={font.h3}>Skin</Text>
            <Swatches palette={SKINS} value={avatar.skin} onPick={(skin) => change({ skin })} />

            <Text style={[font.h3, styles.heading]}>Hair</Text>
            <View style={styles.chipRow}>
              {Object.entries(wardrobe.HAIR_STYLES).map(([id, spec]) => (
                <Pressable key={id} onPress={() => change({ hair: id })}
                  style={[styles.chip, avatar.hair === id && styles.chipOn]}>
                  <Text style={[styles.chipLabel, avatar.hair === id && styles.chipLabelOn]}>
                    {spec.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Swatches palette={HAIR_COLORS} value={avatar.hairColor}
              onPick={(hairColor) => change({ hairColor })} />

            <Text style={[font.h3, styles.heading]}>Build</Text>
            <View style={styles.chipRow}>
              {Object.entries(wardrobe.BUILDS).map(([id, label]) => (
                <Pressable key={id} onPress={() => change({ build: id })}
                  style={[styles.chip, avatar.build === id && styles.chipOn]}>
                  <Text style={[styles.chipLabel, avatar.build === id && styles.chipLabelOn]}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : (
          <>
            <View style={styles.chipRow}>
              {Object.entries(garments).map(([id, spec]) => (
                <Pressable key={id} onPress={() => wear(slot.key, { id })}
                  style={[styles.chip, chosen?.id === id && styles.chipOn]}>
                  <Text style={[styles.chipLabel, chosen?.id === id && styles.chipLabelOn]}>
                    {spec.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Only offered where the garment takes a colour — a football
                shirt is not a solid block of whatever you fancy. */}
            {garmentSpec?.palette && (
              <>
                <Text style={[font.h3, styles.heading]}>Colour</Text>
                <Swatches palette={GARMENT_COLORS} value={chosen?.color}
                  onPick={(color) => wear(slot.key, { color })} />
              </>
            )}
            {garmentSpec?.accent && (
              <>
                <Text style={[font.h3, styles.heading]}>Trim</Text>
                <Swatches palette={GARMENT_COLORS} value={chosen?.accent}
                  onPick={(accent) => wear(slot.key, { accent })} />
              </>
            )}
          </>
        )}
      </ScrollView>

      <MorphButton onPress={save} disabled={!dirty || saving}
        style={[styles.save, (!dirty || saving) && styles.saveOff]}>
        {saving
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.saveText}>{dirty ? 'Save' : 'Saved'}</Text>}
      </MorphButton>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent', paddingHorizontal: spacing.lg },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
    stage: {
      alignItems: 'center', paddingVertical: spacing.md,
      backgroundColor: colors.surface, borderRadius: radius.card,
      borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
    },
    stageNote: { marginTop: spacing.xs },
    tabs: { flexDirection: 'row', gap: 4, marginBottom: spacing.md },
    tab: {
      alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md,
      backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, gap: 2,
    },
    tabOn: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
    tabLabel: { fontSize: 11, color: colors.textSecondary },
    panel: { paddingBottom: spacing.xl },
    heading: { marginTop: spacing.lg },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
    chip: {
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill,
      backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
    },
    chipOn: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
    chipLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
    chipLabelOn: { color: colors.accent },
    swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
    swatch: {
      width: 38, height: 38, borderRadius: 19,
      borderWidth: 3, borderColor: 'transparent',
    },
    swatchOn: { borderColor: colors.textPrimary },
    save: {
      backgroundColor: colors.accent, borderRadius: radius.pill,
      paddingVertical: spacing.md, alignItems: 'center', marginBottom: 110,
    },
    saveOff: { opacity: 0.45 },
    saveText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  });
