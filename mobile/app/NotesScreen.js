// Shared notes: little thoughts and love notes, pinned or colour-coded.
// Your partner's newest note also shows on the Love Note widget.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, Modal } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch, connectSocket } from '../services/api';
import { useCouple } from '../components/CoupleContext';
import { Button, Card, Screen, Empty, ui } from '../components/ui';
import { MorphButton, FadeInUp } from '../components/Motion';
import Icon from '../components/Icon';
import { useI18n } from '../i18n';
import { colors, font, spacing, radius } from '../theme';

const NOTE_COLORS = ['#FFF6D6', '#FFE1E7', '#E3F2FD', '#DDF5EA', '#EDE7F6'];

export default function NotesScreen() {
  const { t } = useI18n();
  const { me } = useCouple();
  const [notes, setNotes] = useState([]);
  const [editing, setEditing] = useState(null); // null | {} (new) | note

  const load = useCallback(() => apiFetch('/notes').then((d) => setNotes(d.notes)).catch((err) => Alert.alert(t('common.error'), err.message)), []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => {
    let socket;
    connectSocket().then((s) => { socket = s; s.on('note:update', load); }).catch(() => {});
    return () => socket?.off('note:update', load);
  }, [load]);

  async function save() {
    const { id, title, body, color } = editing;
    if (!body?.trim()) return;
    try {
      if (id) await apiFetch(`/notes/${id}`, { method: 'PATCH', body: { title, body, color } });
      else await apiFetch('/notes', { method: 'POST', body: { title, body, color } });
      setEditing(null);
      load();
    } catch (err) {
      Alert.alert(t('common.error'), err.message);
    }
  }
  async function togglePin(n) {
    await apiFetch(`/notes/${n.id}`, { method: 'PATCH', body: { isPinned: !n.is_pinned } }).catch(() => {});
    load();
  }
  async function remove(n) {
    await apiFetch(`/notes/${n.id}`, { method: 'DELETE' }).catch((err) => Alert.alert(t('common.error'), err.message));
    setEditing(null);
    load();
  }

  return (
    <Screen>
      <Button title={t('notes.new')} icon="create-outline" onPress={() => setEditing({ color: NOTE_COLORS[0] })} style={{ marginBottom: spacing.md }} />
      {notes.length === 0 ? <Empty icon="document-text-outline" text={t('notes.empty')} /> : (
        <View style={styles.grid}>
          {notes.map((n, i) => (
            <FadeInUp key={n.id} delay={i * 30} style={styles.cell}>
              <Card tint={n.color || NOTE_COLORS[0]} onPress={() => (n.author_id === me?.id ? setEditing(n) : null)} style={{ minHeight: 140 }}>
                <View style={[ui.row, { justifyContent: 'space-between' }]}>
                  <Text style={[font.muted, { fontSize: 11 }]}>{n.author_id === me?.id ? t('common.you') : n.author_name}</Text>
                  <Icon name={n.is_pinned ? 'pin' : 'pin-outline'} size={15} color={n.is_pinned ? colors.accent : colors.textMuted} onPress={() => togglePin(n)} />
                </View>
                {n.title ? <Text style={[font.h2, { marginTop: 4 }]} numberOfLines={2}>{n.title}</Text> : null}
                <Text style={[font.body, { marginTop: 4 }]} numberOfLines={6}>{n.body}</Text>
              </Card>
            </FadeInUp>
          ))}
        </View>
      )}
      <Modal visible={Boolean(editing)} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={styles.modalBg}>
          <View style={[styles.modal, { backgroundColor: editing?.color || colors.surface }]}>
            <TextInput placeholder={t('notes.titlePlaceholder')} placeholderTextColor={colors.textMuted} value={editing?.title || ''}
              onChangeText={(v) => setEditing((e) => ({ ...e, title: v }))} style={[font.h2, { paddingVertical: spacing.sm }]} />
            <TextInput placeholder={t('notes.bodyPlaceholder')} placeholderTextColor={colors.textMuted} value={editing?.body || ''} multiline
              onChangeText={(v) => setEditing((e) => ({ ...e, body: v }))} style={[font.body, { minHeight: 140, textAlignVertical: 'top' }]} />
            <View style={[ui.row, { marginVertical: spacing.md }]}>
              {NOTE_COLORS.map((c) => (
                <MorphButton key={c} onPress={() => setEditing((e) => ({ ...e, color: c }))}
                  style={[styles.swatch, { backgroundColor: c }, editing?.color === c && { borderColor: colors.accent }]} />
              ))}
            </View>
            <View style={ui.row}>
              {editing?.id && <Button kind="danger" icon="trash-outline" title={t('common.delete')} onPress={() => remove(editing)} small />}
              <View style={{ flex: 1 }} />
              <Button kind="secondary" title={t('common.cancel')} onPress={() => setEditing(null)} small />
              <Button title={t('common.save')} onPress={save} small />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  cell: { width: '48.5%' },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', padding: spacing.lg },
  modal: { borderRadius: radius.xl, padding: spacing.lg },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: colors.border },
});
