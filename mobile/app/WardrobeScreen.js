// The wardrobe: dress your character. Changes preview live and, once saved,
// appear on your partner's phone straight away (avatar:update).
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
import { useCouple } from '../components/CoupleContext';
import Mascot from '../components/Mascot';
import {
  ACCESSORIES, BOTTOM_STYLES, CLOTH_COLORS, HAIR_COLORS, HAIR_STYLES, PRESETS, SHOE_STYLES, SKIN_TONES, TOP_STYLES, normalizeAvatar,
} from '../components/avatar/wardrobe';
import { Button, Chip } from '../components/ui';
import { MOODS } from '../components/moods';
import { useI18n } from '../i18n';
import { colors, font, spacing, radius } from '../theme';

const TABS = ['body', 'hair', 'top', 'bottom', 'shoes', 'extras'];

function Swatches({ colorsList, value, onPick }) {
  return (
    <View style={styles.swatches}>
      {colorsList.map((c) => (
        <Pressable key={c} onPress={() => onPick(c)} style={[styles.swatch, { backgroundColor: c }, value === c && styles.swatchActive]} />
      ))}
    </View>
  );
}

export default function WardrobeScreen({ navigation }) {
  const { t } = useI18n();
  const { me, saveAvatar } = useCouple();
  const [avatar, setAvatar] = useState(() => normalizeAvatar(me?.avatar));
  const [tab, setTab] = useState('body');
  const [emotionIdx, setEmotionIdx] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (me?.avatar) setAvatar(normalizeAvatar(me.avatar)); }, [me?.id]);

  const update = (part, patch) => setAvatar((a) => ({ ...a, [part]: typeof patch === 'object' && !Array.isArray(patch) ? { ...a[part], ...patch } : patch }));
  const toggleAccessory = (k) => setAvatar((a) => ({ ...a, accessories: a.accessories.includes(k) ? a.accessories.filter((x) => x !== k) : [...a.accessories, k] }));

  async function save() {
    setSaving(true);
    try {
      await saveAvatar(avatar);
      navigation.goBack();
    } catch (err) {
      Alert.alert(t('common.error'), err.message);
    } finally {
      setSaving(false);
    }
  }

  const emotion = MOODS[emotionIdx % MOODS.length].emotion;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.stage}>
        <Mascot avatar={avatar} emotion={emotion} context="hero" onPress={() => setEmotionIdx((i) => i + 1)} />
        <Text style={font.muted}>{t('wardrobe.tapToTry')}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {TABS.map((k) => <Chip key={k} label={t(`wardrobe.${k}`)} active={tab === k} onPress={() => setTab(k)} />)}
      </ScrollView>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}>
        {tab === 'body' && (
          <>
            <Text style={styles.label}>{t('wardrobe.presets')}</Text>
            <View style={styles.row}>
              {Object.keys(PRESETS).map((p) => <Chip key={p} label={t(`onboarding.character.${p}`)} active={avatar.preset === p} onPress={() => setAvatar({ ...PRESETS[p] })} />)}
            </View>
            <Text style={styles.label}>{t('wardrobe.skin')}</Text>
            <Swatches colorsList={SKIN_TONES} value={avatar.skin} onPick={(c) => setAvatar((a) => ({ ...a, skin: c }))} />
          </>
        )}
        {tab === 'hair' && (
          <>
            <View style={styles.row}>{HAIR_STYLES.map((h) => <Chip key={h.key} label={t(`wardrobe.hair.${h.key}`)} active={avatar.hair.style === h.key} onPress={() => update('hair', { style: h.key })} />)}</View>
            <Text style={styles.label}>{t('wardrobe.colour')}</Text>
            <Swatches colorsList={HAIR_COLORS} value={avatar.hair.color} onPick={(c) => update('hair', { color: c })} />
          </>
        )}
        {[['top', TOP_STYLES], ['bottom', BOTTOM_STYLES], ['shoes', SHOE_STYLES]].map(([part, options]) => tab === part && (
          <View key={part}>
            <View style={styles.row}>{options.map((o) => <Chip key={o.key} label={t(`wardrobe.${part}.${o.key}`)} active={avatar[part].style === o.key} onPress={() => update(part, { style: o.key })} />)}</View>
            <Text style={styles.label}>{t('wardrobe.colour')}</Text>
            <Swatches colorsList={CLOTH_COLORS} value={avatar[part].color} onPick={(c) => update(part, { color: c })} />
            {part === 'shoes' && (
              <View style={[styles.row, { marginTop: spacing.md }]}>
                <Chip label={t('wardrobe.socks')} active={Boolean(avatar.socks)} onPress={() => setAvatar((a) => ({ ...a, socks: !a.socks }))} />
              </View>
            )}
          </View>
        ))}
        {tab === 'extras' && (
          <View style={styles.row}>{ACCESSORIES.map((a) => <Chip key={a.key} label={t(`wardrobe.acc.${a.key}`)} active={avatar.accessories.includes(a.key)} onPress={() => toggleAccessory(a.key)} />)}</View>
        )}
      </ScrollView>
      <View style={styles.footer}>
        <Button title={saving ? t('common.saving') : t('wardrobe.save')} icon="shirt" onPress={save} disabled={saving} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { alignItems: 'center', paddingTop: spacing.md, backgroundColor: colors.surfaceAlt, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl, paddingBottom: spacing.sm },
  tabs: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  label: { ...font.h2, marginTop: spacing.lg, marginBottom: spacing.sm },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  swatch: { width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderColor: colors.border },
  swatchActive: { borderColor: colors.accent, borderWidth: 4 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg, backgroundColor: colors.bg },
});
