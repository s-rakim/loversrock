// Connect: every way to talk, as visually distinct entry points rather than
// one long feed — daily question, "For you" (adaptive), check-in, seasonal
// decks, Sparks exclusives, and every deck category.
import React, { useCallback, useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch } from '../services/api';
import { Button, Card, Screen, SectionTitle, Pill, ui } from '../components/ui';
import { MorphButton, FadeInUp } from '../components/Motion';
import Icon from '../components/Icon';
import { useI18n } from '../i18n';
import { colors, font, spacing, radius, gradientForCategory } from '../theme';

export default function ConnectScreen({ navigation }) {
  const { t } = useI18n();
  const [decksByCategory, setDecks] = useState({});
  const [forYou, setForYou] = useState([]);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [sparks, setSparks] = useState(null);

  const load = useCallback(async () => {
    const [d, f, s] = await Promise.allSettled([apiFetch('/decks'), apiFetch('/decks/for-you?limit=15'), apiFetch('/sparks')]);
    if (d.status === 'fulfilled') setDecks(d.value.decksByCategory);
    if (f.status === 'fulfilled') { setForYou(f.value.questions); setIndex(0); }
    if (s.status === 'fulfilled') setSparks(s.value.balance);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const q = forYou[index];
  const next = () => { setAnswer(''); setIndex((i) => i + 1); };

  async function skip() {
    if (!q) return;
    apiFetch(`/decks/questions/${q.id}/skip`, { method: 'POST' }).catch(() => {});
    next();
  }
  async function submit() {
    if (!q || !answer.trim()) return;
    try {
      await apiFetch(`/decks/questions/${q.id}/respond`, { method: 'POST', body: { answerText: answer.trim() } });
      next();
    } catch (err) {
      Alert.alert(t('common.error'), err.message);
    }
  }

  async function openDeck(deck) {
    if (deck.unlocked === false) {
      Alert.alert(t('connect.unlockTitle', { title: deck.title }), t('connect.unlockBody', { n: deck.spark_cost, balance: sparks ?? 0 }), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('connect.unlock'), onPress: async () => {
          try {
            await apiFetch('/sparks/unlock', { method: 'POST', body: { item: `deck:${deck.slug}` } });
            await load();
            navigation.navigate('DeckDetail', { slug: deck.slug, title: deck.title });
          } catch (err) {
            Alert.alert(t('common.error'), err.message);
          }
        } },
      ]);
      return;
    }
    navigation.navigate('DeckDetail', { slug: deck.slug, title: deck.title });
  }

  const ordered = Object.entries(decksByCategory).sort(([a], [b]) => (a === 'Seasonal' ? -1 : b === 'Seasonal' ? 1 : 0));

  return (
    <Screen sticker="home">
      <View style={[ui.row, { justifyContent: 'space-between', marginBottom: spacing.md }]}>
        <Text style={font.h1}>{t('connect.title')}</Text>
        {sparks !== null && <MorphButton onPress={() => navigation.navigate('Sparks')}><Pill icon="sparkles" text={String(sparks)} /></MorphButton>}
      </View>

      <View style={styles.tiles}>
        {[
          ['DailyPrompt', 'chatbox-ellipses-outline', 'connect.daily', '#FFE1E7'],
          ['Quiz', 'help-buoy-outline', 'connect.quiz', '#E3E6FF'],
          ['CheckIn', 'pulse-outline', 'connect.checkin', '#DDF5EA'],
          ['Challenge', 'dice-outline', 'connect.challenge', '#FFF0D6'],
        ].map(([route, icon, key, tint]) => (
          <MorphButton key={route} onPress={() => navigation.navigate(route)} style={[styles.tile, { backgroundColor: tint }]}>
            <Icon name={icon} chip chipColor="rgba(255,255,255,0.7)" />
            <Text style={[font.h2, { marginTop: spacing.sm }]}>{t(key)}</Text>
          </MorphButton>
        ))}
      </View>

      <SectionTitle right={<Text style={font.muted}>{t('connect.forYouHint')}</Text>}>{t('connect.forYou')}</SectionTitle>
      <FadeInUp key={q?.id || 'none'}>
        <Card tint={q ? gradientForCategory(q.category)[0] : undefined} style={{ padding: spacing.lg }}>
          {q ? (
            <>
              <Text style={styles.category}>{q.deckTitle}</Text>
              <Text style={ui.bigQuestion}>{q.questionText}</Text>
              <TextInput value={answer} onChangeText={setAnswer} placeholder={t('connect.yourAnswer')} placeholderTextColor={colors.textMuted}
                style={[ui.input, { marginTop: spacing.md, backgroundColor: 'rgba(255,255,255,0.8)', minHeight: 50 }]} multiline />
              <View style={[ui.row, { marginTop: spacing.md }]}>
                <Button kind="secondary" title={t('connect.skip')} icon="play-skip-forward-outline" onPress={skip} style={{ flex: 1 }} />
                <Button title={t('connect.answer')} icon="send" onPress={submit} style={{ flex: 1 }} />
              </View>
              <Text style={[font.muted, { marginTop: spacing.sm, textAlign: 'center' }]}>{t('connect.revealHint')}</Text>
            </>
          ) : (
            <Text style={font.muted}>{t('connect.allCaughtUp')}</Text>
          )}
        </Card>
      </FadeInUp>

      {ordered.map(([category, decks]) => (
        <View key={category}>
          <SectionTitle>{category === 'Seasonal' ? `🍂 ${t('connect.inSeason')}` : category === 'Sparks Exclusives' ? `✨ ${t('connect.sparksExclusives')}` : category}</SectionTitle>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {decks.map((deck) => (
              <MorphButton key={deck.id} onPress={() => openDeck(deck)} style={[styles.deck, { backgroundColor: gradientForCategory(category)[0] }]}>
                <Icon name={deck.emoji} chip chipColor="rgba(255,255,255,0.6)" />
                <Text style={[font.body, { marginTop: spacing.sm, fontWeight: '600' }]}>{deck.title}</Text>
                {deck.unlocked === false && <Pill icon="sparkles" text={String(deck.spark_cost)} style={{ marginTop: spacing.xs, alignSelf: 'flex-start' }} />}
              </MorphButton>
            ))}
          </ScrollView>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { width: '48.5%', borderRadius: radius.lg, padding: spacing.md, minHeight: 104 },
  category: { ...font.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.xs },
  deck: { width: 138, minHeight: 124, borderRadius: radius.lg, padding: spacing.md, marginRight: spacing.sm },
});
