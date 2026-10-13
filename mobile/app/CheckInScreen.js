// Monthly check-in: five quick 1–5 ratings and a few open questions. Your
// partner's answers appear once you've both finished.
import React, { useCallback, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, Pressable } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch } from '../services/api';
import { useCouple } from '../components/CoupleContext';
import { Button, Card, Screen, SectionTitle, ui } from '../components/ui';
import CelebrationBurst from '../components/Celebration';
import { HeartShape } from '../components/Stickers';
import { useI18n } from '../i18n';
import { colors, font, spacing } from '../theme';

function Hearts({ value, onChange, readOnly }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6, marginTop: spacing.xs }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} disabled={readOnly} onPress={() => onChange?.(n)} hitSlop={4}>
          <HeartShape size={readOnly ? 18 : 30} color={n <= (value || 0) ? colors.accent : colors.border} />
        </Pressable>
      ))}
    </View>
  );
}

export default function CheckInScreen() {
  const { t } = useI18n();
  const { partner } = useCouple();
  const [data, setData] = useState(null);
  const [answers, setAnswers] = useState({});
  const [history, setHistory] = useState([]);
  const [burst, setBurst] = useState(0);

  const load = useCallback(async () => {
    try {
      const [cur, hist] = await Promise.all([apiFetch('/checkins/current'), apiFetch('/checkins/history')]);
      setData(cur);
      setAnswers(cur.myAnswers || {});
      setHistory(hist.history.filter((h) => h.month !== cur.month));
    } catch (err) {
      Alert.alert(t('common.error'), err.message);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function submit() {
    try {
      const next = await apiFetch('/checkins/current', { method: 'POST', body: { answers } });
      setData(next);
      setBurst((b) => b + 1);
    } catch (err) {
      Alert.alert(t('common.error'), err.message);
    }
  }

  if (!data) return <Screen><Text style={font.muted}>{t('common.loading')}</Text></Screen>;
  const ratingsDone = data.questions.filter((q) => q.type === 'rating').every((q) => answers[q.key]);
  const monthName = new Date(`${data.month}-01T12:00:00`).toLocaleDateString([], { month: 'long', year: 'numeric' });

  return (
    <Screen sticker="home">
      <Text style={font.h1}>{t('checkin.title', { month: monthName })}</Text>
      <Text style={[font.muted, { marginBottom: spacing.md }]}>
        {data.bothDone ? t('checkin.revealed') : data.myAnswers ? t('checkin.waiting', { name: partner?.name || '' }) : data.partnerDone ? t('checkin.partnerDone', { name: partner?.name || '' }) : t('checkin.intro')}
      </Text>
      <CelebrationBurst trigger={burst} />
      {data.questions.map((q) => (
        <Card key={q.key}>
          <Text style={font.h2}>{t(`checkin.q.${q.key}`)}</Text>
          {q.type === 'rating' ? (
            <Hearts value={answers[q.key]} onChange={(v) => setAnswers((a) => ({ ...a, [q.key]: v }))} />
          ) : (
            <TextInput style={[ui.input, { marginTop: spacing.sm, minHeight: 50 }]} multiline value={answers[q.key] || ''}
              onChangeText={(v) => setAnswers((a) => ({ ...a, [q.key]: v }))} placeholder={t('checkin.optional')} placeholderTextColor={colors.textMuted} />
          )}
          {data.bothDone && data.partnerAnswers && (
            <View style={styles.theirs}>
              <Text style={font.muted}>{partner?.name}</Text>
              {q.type === 'rating' ? <Hearts value={data.partnerAnswers[q.key]} readOnly /> : <Text style={font.body}>{data.partnerAnswers[q.key] || '—'}</Text>}
            </View>
          )}
        </Card>
      ))}
      <Button title={data.myAnswers ? t('checkin.update') : t('checkin.submit')} icon="heart" onPress={submit} disabled={!ratingsDone} />

      {history.length > 0 && <SectionTitle>{t('checkin.history')}</SectionTitle>}
      {history.map((h) => (
        <Card key={h.month}>
          <Text style={font.h2}>{new Date(`${h.month}-01T12:00:00`).toLocaleDateString([], { month: 'long', year: 'numeric' })}</Text>
          {Object.entries(h.averages).map(([k, v]) => (
            <View key={k} style={[ui.row, { justifyContent: 'space-between' }]}>
              <Text style={font.muted}>{t(`checkin.short.${k}`)}</Text>
              <Text style={{ fontWeight: '700', color: colors.text }}>{v ? v.toFixed(1) : '—'} / 5</Text>
            </View>
          ))}
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  theirs: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
});
