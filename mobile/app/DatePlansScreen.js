// Matches and scheduled dates, with statuses: planned → confirmed → done
// (or cancelled). Finished dates land in the Memories timeline.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, Modal } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch } from '../services/api';
import { Button, Card, Chip, Screen, SectionTitle, Empty, Pill, ui } from '../components/ui';
import { useI18n } from '../i18n';
import { colors, font, spacing, radius } from '../theme';

const STATUS_COLOR = { idea: colors.textMuted, planned: colors.gold, confirmed: colors.accent, done: colors.success, cancelled: colors.textMuted };

export default function DatePlansScreen({ navigation, route }) {
  const { t } = useI18n();
  const [plans, setPlans] = useState([]);
  const [matches, setMatches] = useState([]);
  const [editor, setEditor] = useState(null);

  const load = useCallback(async () => {
    const [p, m] = await Promise.all([apiFetch('/dates/plans'), apiFetch('/dates/matches')]).catch((err) => { Alert.alert(t('common.error'), err.message); return [{ plans: [] }, { matches: [] }]; });
    setPlans(p.plans);
    setMatches(m.matches);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    const idea = route.params?.scheduleIdea;
    if (idea) setEditor({ ideaId: idea.id, title: idea.title, date: '', time: '19:00', notes: '' });
  }, [route.params?.scheduleIdea]);

  async function saveEditor() {
    const { id, ideaId, title, date, time, notes } = editor;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return Alert.alert(t('common.error'), t('dates.dateFormat'));
    const scheduledFor = date ? new Date(`${date}T${/^\d{2}:\d{2}$/.test(time) ? time : '19:00'}:00`).toISOString() : null;
    try {
      if (id) await apiFetch(`/dates/plans/${id}`, { method: 'PATCH', body: { title, notes, scheduledFor } });
      else await apiFetch('/dates/plans', { method: 'POST', body: { ideaId, title, notes, scheduledFor, status: scheduledFor ? 'planned' : 'idea' } });
      setEditor(null);
      navigation.setParams({ scheduleIdea: undefined });
      load();
    } catch (err) {
      Alert.alert(t('common.error'), err.message);
    }
  }

  async function setStatus(plan, status) {
    await apiFetch(`/dates/plans/${plan.id}`, { method: 'PATCH', body: { status } }).catch((err) => Alert.alert(t('common.error'), err.message));
    load();
  }

  const upcoming = plans.filter((p) => !['done', 'cancelled'].includes(p.status));
  const past = plans.filter((p) => ['done', 'cancelled'].includes(p.status));

  const PlanCard = ({ plan }) => (
    <Card>
      <View style={[ui.row, { justifyContent: 'space-between' }]}>
        <Text style={[font.h2, { flex: 1 }]}>{plan.title}</Text>
        <Text style={{ color: STATUS_COLOR[plan.status], fontWeight: '800' }}>{t(`dates.status.${plan.status}`)}</Text>
      </View>
      {plan.scheduled_for ? <Text style={font.muted}>📅 {new Date(plan.scheduled_for).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text> : null}
      {plan.notes ? <Text style={[font.body, { marginTop: 4 }]}>{plan.notes}</Text> : null}
      {!['done', 'cancelled'].includes(plan.status) && (
        <View style={[ui.wrap, { marginTop: spacing.sm }]}>
          {plan.status !== 'confirmed' && plan.scheduled_for && <Chip label={t('dates.confirm')} icon="checkmark" onPress={() => setStatus(plan, 'confirmed')} />}
          <Chip label={t('dates.markDone')} icon="heart" onPress={() => setStatus(plan, 'done')} />
          <Chip label={t('common.edit')} icon="create-outline" onPress={() => {
            const d = plan.scheduled_for ? new Date(plan.scheduled_for) : null;
            setEditor({ id: plan.id, title: plan.title, notes: plan.notes || '', date: d ? d.toISOString().slice(0, 10) : '', time: d ? d.toTimeString().slice(0, 5) : '19:00' });
          }} />
          <Chip label={t('dates.cancel')} icon="close" onPress={() => setStatus(plan, 'cancelled')} />
        </View>
      )}
    </Card>
  );

  return (
    <Screen>
      <View style={ui.row}>
        <Button title={t('dates.discover')} icon="heart-circle" onPress={() => navigation.navigate('DateDiscover')} style={{ flex: 1 }} />
        <Button kind="secondary" title={t('dates.newPlan')} icon="add" onPress={() => setEditor({ title: '', date: '', time: '19:00', notes: '' })} style={{ flex: 1 }} />
      </View>

      <SectionTitle>{t('dates.matches')}</SectionTitle>
      {matches.length === 0 ? <Empty icon="heart-dislike-outline" text={t('dates.noMatches')} /> : matches.map((m) => (
        <Card key={m.id} style={ui.row}>
          <View style={{ flex: 1 }}>
            <Text style={font.h2}>{m.title}</Text>
            <Text style={font.muted} numberOfLines={2}>{m.description}</Text>
          </View>
          {m.planned ? <Pill icon="checkmark-circle" color={colors.success} text={t('dates.planned')} /> : (
            <Button small title={t('dates.schedule')} onPress={() => setEditor({ ideaId: m.id, title: m.title, date: '', time: '19:00', notes: '' })} />
          )}
        </Card>
      ))}

      <SectionTitle>{t('dates.upcoming')}</SectionTitle>
      {upcoming.length === 0 ? <Empty icon="calendar-outline" text={t('dates.noPlans')} /> : upcoming.map((p) => <PlanCard key={p.id} plan={p} />)}
      {past.length > 0 && <SectionTitle>{t('dates.past')}</SectionTitle>}
      {past.map((p) => <PlanCard key={p.id} plan={p} />)}

      <Modal visible={Boolean(editor)} transparent animationType="fade" onRequestClose={() => setEditor(null)}>
        <View style={styles.modalBg}>
          <View style={styles.modal}>
            <Text style={font.h1}>{editor?.id ? t('common.edit') : t('dates.schedule')}</Text>
            <Text style={styles.label}>{t('dates.what')}</Text>
            <TextInput style={ui.input} value={editor?.title || ''} onChangeText={(v) => setEditor((e) => ({ ...e, title: v }))} />
            <View style={ui.row}>
              <View style={{ flex: 2 }}>
                <Text style={styles.label}>{t('dates.date')}</Text>
                <TextInput style={ui.input} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} value={editor?.date || ''} onChangeText={(v) => setEditor((e) => ({ ...e, date: v }))} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>{t('dates.time')}</Text>
                <TextInput style={ui.input} placeholder="19:00" placeholderTextColor={colors.textMuted} value={editor?.time || ''} onChangeText={(v) => setEditor((e) => ({ ...e, time: v }))} />
              </View>
            </View>
            <Text style={styles.label}>{t('dates.notes')}</Text>
            <TextInput style={[ui.input, { minHeight: 60 }]} multiline value={editor?.notes || ''} onChangeText={(v) => setEditor((e) => ({ ...e, notes: v }))} />
            <View style={[ui.row, { marginTop: spacing.lg }]}>
              <Button kind="secondary" title={t('common.cancel')} onPress={() => setEditor(null)} style={{ flex: 1 }} />
              <Button title={t('common.save')} onPress={saveEditor} style={{ flex: 1 }} disabled={!editor?.title?.trim()} />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', padding: spacing.lg },
  modal: { backgroundColor: colors.bg, borderRadius: radius.xl, padding: spacing.lg },
  label: { ...font.muted, marginTop: spacing.md, marginBottom: 4 },
});
