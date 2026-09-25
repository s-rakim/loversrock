// Who's More Likely: both point at "me" or "you". The round reveals once you
// have both voted — agree and it's a match.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch, connectSocket } from '../../services/api';
import { useCouple } from '../../components/CoupleContext';
import Mascot from '../../components/Mascot';
import { Button, Card, Pill, ui } from '../../components/ui';
import { FadeInUp } from '../../components/Motion';
import CelebrationBurst from '../../components/Celebration';
import { useI18n } from '../../i18n';
import { colors, font, spacing } from '../../theme';

export default function WhosMoreLikelyScreen() {
  const { t } = useI18n();
  const { me, partner } = useCouple();
  const [data, setData] = useState(null);
  const [index, setIndex] = useState(0);
  const [result, setResult] = useState(null);
  const [burst, setBurst] = useState(0);

  const load = useCallback(() => apiFetch('/games/wml').then((d) => {
    setData(d);
    const firstOpen = d.questions.findIndex((q) => !q.myVote);
    setIndex(firstOpen === -1 ? 0 : firstOpen);
  }).catch((err) => Alert.alert(t('common.error'), err.message)), []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => {
    let socket;
    const onVote = () => apiFetch('/games/wml').then(setData).catch(() => {});
    connectSocket().then((s) => { socket = s; s.on('wml:vote', onVote); }).catch(() => {});
    return () => socket?.off('wml:vote', onVote);
  }, []);

  if (!data) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  const q = data.questions[index % data.questions.length];

  async function vote(voteFor) {
    try {
      const r = await apiFetch(`/games/wml/${q.key}/vote`, { method: 'POST', body: { voteFor } });
      setResult(r);
      if (r.match) setBurst((b) => b + 1);
      apiFetch('/games/wml').then(setData).catch(() => {});
    } catch (err) {
      Alert.alert(t('common.error'), err.message);
    }
  }
  const next = () => { setResult(null); setIndex((i) => i + 1); };
  const nameFor = (id) => (id === data.myId ? t('common.you') : partner?.name || t('profile.partner'));
  const shown = result || (q.revealed ? { revealed: true, myVote: q.myVote, partnerVote: q.partnerVote, match: q.match } : q.myVote ? { revealed: false, myVote: q.myVote } : null);

  return (
    <View style={styles.container}>
      <View style={[ui.row, { justifyContent: 'space-between' }]}>
        <Pill icon="heart" text={t('wml.score', { matches: data.score.matches, answered: data.score.answered })} />
        <Text style={font.muted}>{(index % data.questions.length) + 1} / {data.questions.length}</Text>
      </View>
      <FadeInUp key={q.key}>
        <Card style={{ padding: spacing.lg, marginTop: spacing.md }}>
          <Text style={ui.bigQuestion}>{q.text}</Text>
        </Card>
      </FadeInUp>
      <View style={styles.people}>
        <Mascot avatar={me?.avatar} emotion={shown?.myVote === data.myId ? 'excited' : 'happy'} context="game" label={t('common.me')} onPress={() => !shown && vote('me')} />
        <Mascot avatar={partner?.avatar} emotion={shown?.myVote === data.partnerId ? 'excited' : 'happy'} context="game" label={partner?.name} onPress={() => !shown && vote('partner')} />
      </View>
      <CelebrationBurst trigger={burst} size={200} />
      {!shown ? (
        <View style={ui.row}>
          <Button title={t('common.me')} onPress={() => vote('me')} style={{ flex: 1 }} />
          <Button title={partner?.name || t('profile.partner')} onPress={() => vote('partner')} style={{ flex: 1 }} />
        </View>
      ) : shown.revealed ? (
        <Card>
          <Text style={[font.h2, { color: shown.match ? colors.success : colors.accent }]}>{shown.match ? t('wml.match') : t('wml.differ')}</Text>
          <Text style={font.muted}>{t('wml.youSaid', { name: nameFor(shown.myVote) })} · {t('wml.theySaid', { name: nameFor(shown.partnerVote) })}</Text>
          <Button small title={t('common.next')} onPress={next} style={{ alignSelf: 'flex-end', marginTop: spacing.sm }} />
        </Card>
      ) : (
        <Card>
          <Text style={font.body}>{t('wml.waiting', { name: partner?.name || '' })}</Text>
          <Button small title={t('common.next')} onPress={next} style={{ alignSelf: 'flex-end', marginTop: spacing.sm }} />
        </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  people: { flexDirection: 'row', justifyContent: 'space-around', marginVertical: spacing.md },
});
