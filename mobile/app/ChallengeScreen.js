// Today's random challenge (the same for both of you), with rerolls, plus a
// "can't decide?" spinner that picks anything in the app for you.
import React, { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert, Animated, Easing } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch } from '../services/api';
import { Button, Card, Chip, Screen, SectionTitle, Pill, ui } from '../components/ui';
import Icon from '../components/Icon';
import CelebrationBurst from '../components/Celebration';
import { useI18n } from '../i18n';
import { colors, font, spacing } from '../theme';

const GAME_ROUTES = { 'four-in-a-row': 'FourInARow', anagrams: 'Anagrams', 'love-golf': 'LoveGolf', 'draw-duel': 'DrawDuel', 'what-you-saying': 'WhatYouSaying', 'perfect-pair': 'PerfectPair', 'love-letters': 'LoveLetters', 'whos-more-likely': 'WhosMoreLikely', chess: 'Chess' };

export default function ChallengeScreen({ navigation }) {
  const { t } = useI18n();
  const [today, setToday] = useState(null);
  const [random, setRandom] = useState(null);
  const [kind, setKind] = useState('any');
  const [burst, setBurst] = useState(0);
  const spin = useRef(new Animated.Value(0)).current;

  const load = useCallback(() => apiFetch('/challenges/today').then(setToday).catch((err) => Alert.alert(t('common.error'), err.message)), []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function act(path) {
    try {
      setToday(await apiFetch(path, { method: 'POST' }));
      if (path.endsWith('complete')) setBurst((b) => b + 1);
    } catch (err) {
      Alert.alert(t('common.error'), err.message);
    }
  }

  async function pick() {
    spin.setValue(0);
    Animated.timing(spin, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    try {
      setRandom(await apiFetch(`/challenges/random${kind === 'any' ? '' : `?kind=${kind}`}`));
    } catch (err) {
      Alert.alert(t('common.error'), err.message);
    }
  }

  function go(r) {
    const { screen, slug } = r.target || {};
    if (screen === 'Games' && slug && GAME_ROUTES[slug]) navigation.navigate(GAME_ROUTES[slug]);
    else if (screen === 'DeckDetail') navigation.navigate('DeckDetail', { slug, title: r.title });
    else if (screen === 'Challenge') setRandom(null);
    else if (screen) navigation.navigate(screen);
  }

  return (
    <Screen sticker="celebrate">
      <SectionTitle>{t('challenge.today')}</SectionTitle>
      {today && (
        <Card tint="#FFF0D6" style={{ padding: spacing.lg }}>
          <Icon name={today.challenge.icon} size={30} chip chipSize={60} chipColor="rgba(255,255,255,0.7)" />
          <Text style={[font.h1, { marginTop: spacing.md }]}>{today.challenge.title}</Text>
          <Text style={[font.body, { marginTop: spacing.xs, color: colors.textMuted }]}>{today.challenge.description}</Text>
          <View style={[ui.row, { marginTop: spacing.md }]}>
            <Pill icon="sparkles" text={t('challenge.reward', { n: today.reward })} />
          </View>
          {today.completed ? (
            <Text style={[font.h2, { color: colors.success, marginTop: spacing.md }]}>✓ {t('challenge.done')}</Text>
          ) : (
            <View style={[ui.row, { marginTop: spacing.md }]}>
              <Button kind="secondary" icon="refresh" title={t('challenge.reroll', { n: today.rerollsLeft })} onPress={() => act('/challenges/today/reroll')} disabled={today.rerollsLeft === 0} style={{ flex: 1 }} />
              <Button icon="checkmark" title={t('challenge.complete')} onPress={() => act('/challenges/today/complete')} style={{ flex: 1 }} />
            </View>
          )}
          <CelebrationBurst trigger={burst} />
        </Card>
      )}

      <SectionTitle>{t('challenge.cantDecide')}</SectionTitle>
      <View style={[ui.wrap, { marginBottom: spacing.md }]}>
        {['any', 'challenge', 'date', 'game', 'deck'].map((k) => <Chip key={k} label={t(`challenge.kind.${k}`)} active={kind === k} onPress={() => setKind(k)} />)}
      </View>
      <Animated.View style={{ alignItems: 'center', transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '720deg'] }) }] }}>
        <Icon name="dice" size={40} chip chipSize={84} onPress={pick} />
      </Animated.View>
      <Text style={[font.muted, { textAlign: 'center', marginVertical: spacing.sm }]}>{t('challenge.tapDice')}</Text>
      {random && (
        <Card>
          <Text style={[font.muted, { textTransform: 'uppercase' }]}>{t(`challenge.kind.${random.kind}`)}</Text>
          <Text style={[font.h2, { marginTop: 4 }]}>{random.title}</Text>
          {random.description ? <Text style={font.muted}>{random.description}</Text> : null}
          <Button small title={t('challenge.letsGo')} icon="arrow-forward" onPress={() => go(random)} style={{ alignSelf: 'flex-start', marginTop: spacing.sm }} />
        </Card>
      )}
    </Screen>
  );
}
