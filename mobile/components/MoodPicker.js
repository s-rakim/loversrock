// Bottom-sheet mood picker. Setting a mood changes your character on your
// partner's phone and (unless they muted it) sends them a notification.
import React, { useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, StyleSheet, Alert } from 'react-native';
import { MOODS } from './moods';
import { useCouple } from './CoupleContext';
import { useI18n } from '../i18n';
import { Button, ui } from './ui';
import { colors, font, spacing, radius } from '../theme';
import Mascot from './Mascot';

export default function MoodPicker({ visible, onClose }) {
  const { t } = useI18n();
  const { me, setMyMood } = useCouple();
  const [selected, setSelected] = useState(me?.mood?.emoji || null);
  const [text, setText] = useState(me?.mood?.text || '');
  const [saving, setSaving] = useState(false);
  const preview = MOODS.find((m) => m.emoji === selected);

  async function save() {
    if (!selected) return;
    setSaving(true);
    try {
      await setMyMood(selected, text.trim() || null);
      onClose();
    } catch (err) {
      Alert.alert(t('common.error'), err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <Text style={font.h1}>{t('mood.title')}</Text>
        <Text style={[font.muted, { marginBottom: spacing.sm }]}>{t('mood.subtitle')}</Text>
        <Mascot avatar={me?.avatar} emotion={preview?.emotion || 'neutral'} emoji={preview?.emoji} context="sheet" style={{ marginVertical: spacing.sm }} />
        <View style={styles.grid}>
          {MOODS.map((m) => (
            <Pressable key={m.emoji} onPress={() => setSelected(m.emoji)} style={[styles.mood, selected === m.emoji && styles.moodActive]}>
              <Text style={{ fontSize: 26 }}>{m.emoji}</Text>
              <Text style={styles.moodLabel}>{t(`mood.${m.key}`)}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t('mood.notePlaceholder')}
          placeholderTextColor={colors.textMuted}
          style={[ui.input, { marginVertical: spacing.md }]}
          maxLength={80}
        />
        <Button title={saving ? t('common.saving') : t('mood.share')} icon="heart" onPress={save} disabled={!selected || saving} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' },
  sheet: {
    backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing.lg, paddingBottom: spacing.xl * 1.5,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' },
  mood: {
    width: 72, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  moodActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  moodLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
});
