// Swipe through this week's date ideas (tailored to where you live). Swipe
// right to like, left to pass — when you both like one, it's a match.
import React, { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, PanResponder, Dimensions, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch } from '../services/api';
import { useCouple } from '../components/CoupleContext';
import { Button, Chip, Screen, Empty, Pill, ui } from '../components/ui';
import Icon from '../components/Icon';
import CelebrationBurst from '../components/Celebration';
import { useI18n } from '../i18n';
import { colors, font, spacing, radius } from '../theme';

const { width: SCREEN_W } = Dimensions.get('window');
const SETTINGS = ['city', 'suburbs', 'rural', 'long_distance'];
const CATEGORY_TINT = { at_home: '#FFE1E7', outdoors: '#DDF5EA', culture: '#EDE7F6', sentimental: '#FFF0D6', going_out: '#E3F2FD', splurge: '#FFF4DA', long_distance: '#E0F7FA' };
const CATEGORY_ICON = { at_home: 'home', outdoors: 'leaf', culture: 'color-palette', sentimental: 'heart', going_out: 'sparkles', splurge: 'diamond', long_distance: 'airplane' };

export default function DateDiscoverScreen({ navigation }) {
  const { t } = useI18n();
  const { pair, refresh } = useCouple();
  const [deck, setDeck] = useState(null);
  const [index, setIndex] = useState(0);
  const [match, setMatch] = useState(null);
  const position = useRef(new Animated.ValueXY()).current;
  const current = useRef(null);

  const load = useCallback(() => apiFetch('/dates/discover').then((d) => { setDeck(d); setIndex(0); }).catch((err) => Alert.alert(t('common.error'), err.message)), []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const idea = deck?.ideas[index];
  current.current = idea;

  async function vote(liked) {
    const it = current.current;
    if (!it) return;
    Animated.timing(position, { toValue: { x: liked ? SCREEN_W * 1.3 : -SCREEN_W * 1.3, y: 0 }, duration: 220, useNativeDriver: false }).start(() => {
      position.setValue({ x: 0, y: 0 });
      setIndex((i) => i + 1);
    });
    try {
      const r = await apiFetch(`/dates/ideas/${it.id}/vote`, { method: 'POST', body: { liked } });
      if (r.match) setMatch(r.idea);
    } catch (err) {
      Alert.alert(t('common.error'), err.message);
    }
  }

  const responder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8,
    onPanResponderMove: Animated.event([null, { dx: position.x, dy: position.y }], { useNativeDriver: false }),
    onPanResponderRelease: (_, g) => {
      if (g.dx > 110) vote(true);
      else if (g.dx < -110) vote(false);
      else Animated.spring(position, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
    },
  })).current;

  async function setSetting(s) {
    await apiFetch('/profile/pair', { method: 'PATCH', body: { dateSetting: s } }).catch(() => {});
    refresh();
    load();
  }

  const rotate = position.x.interpolate({ inputRange: [-SCREEN_W, 0, SCREEN_W], outputRange: ['-14deg', '0deg', '14deg'] });
  const likeOpacity = position.x.interpolate({ inputRange: [0, 120], outputRange: [0, 1], extrapolate: 'clamp' });
  const nopeOpacity = position.x.interpolate({ inputRange: [-120, 0], outputRange: [1, 0], extrapolate: 'clamp' });

  if (match) {
    return (
      <Screen sticker="celebrate" style={{ alignItems: 'center', paddingTop: spacing.xl * 2 }}>
        <CelebrationBurst trigger={match.id} size={220} />
        <Text style={[font.h1, { fontSize: 32 }]}>{t('dates.match')}</Text>
        <Text style={[font.body, { textAlign: 'center', marginVertical: spacing.md }]}>{t('dates.matchBody', { title: match.title })}</Text>
        <Button title={t('dates.schedule')} icon="calendar" onPress={() => { setMatch(null); navigation.navigate('DatePlans', { scheduleIdea: match }); }} style={{ alignSelf: 'stretch' }} />
        <Button kind="secondary" title={t('dates.keepSwiping')} onPress={() => setMatch(null)} style={{ alignSelf: 'stretch', marginTop: spacing.sm }} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <View style={[ui.row, { justifyContent: 'space-between' }]}>
        <Text style={font.muted}>{deck ? t('dates.week', { week: deck.week }) : ''}</Text>
        <Button small kind="secondary" icon="heart-circle-outline" title={t('dates.plans')} onPress={() => navigation.navigate('DatePlans')} />
      </View>
      <View style={[ui.wrap, { marginVertical: spacing.sm }]}>
        {SETTINGS.map((s) => <Chip key={s} label={t(`dates.setting.${s}`)} active={(deck?.setting || pair?.dateSetting) === s} onPress={() => setSetting(s)} />)}
      </View>

      <View style={styles.stack}>
        {!deck ? null : !idea ? (
          <Empty icon="calendar-outline" text={t('dates.deckDone')} />
        ) : (
          <>
            {deck.ideas[index + 1] && (
              <View style={[styles.card, styles.behind, { backgroundColor: CATEGORY_TINT[deck.ideas[index + 1].category] || colors.surface }]} />
            )}
            <Animated.View {...responder.panHandlers} style={[styles.card, { backgroundColor: CATEGORY_TINT[idea.category] || colors.surface, transform: [{ translateX: position.x }, { translateY: position.y }, { rotate }] }]}>
              <Animated.Text style={[styles.stamp, styles.like, { opacity: likeOpacity }]}>{t('dates.like')}</Animated.Text>
              <Animated.Text style={[styles.stamp, styles.nope, { opacity: nopeOpacity }]}>{t('dates.pass')}</Animated.Text>
              <Icon name={CATEGORY_ICON[idea.category] || 'heart'} size={40} chip chipSize={88} chipColor="rgba(255,255,255,0.7)" />
              <Text style={[font.h1, { fontSize: 28, marginTop: spacing.lg }]}>{idea.title}</Text>
              <Text style={[font.body, { marginTop: spacing.sm, color: colors.textMuted }]}>{idea.description}</Text>
              <View style={[ui.row, { marginTop: spacing.lg }]}>
                <Pill text={idea.cost_tier || 'free'} />
                <Pill text={t(`dates.category.${idea.category}`)} />
                {idea.is_premium && <Pill icon="sparkles" text={t('dates.premium')} />}
              </View>
            </Animated.View>
          </>
        )}
      </View>

      {idea && (
        <View style={styles.buttons}>
          <Icon name="close" size={30} chip chipSize={64} color={colors.danger} chipColor={colors.surface} onPress={() => vote(false)} />
          <Icon name="heart" size={30} chip chipSize={64} color="#fff" chipColor={colors.accent} onPress={() => vote(true)} />
        </View>
      )}
      {deck && !deck.premiumUnlocked && (
        <Button small kind="secondary" icon="sparkles" title={t('dates.unlockPremium', { n: deck.premiumAvailable })} onPress={() => navigation.navigate('Sparks')} style={{ alignSelf: 'center', marginTop: spacing.sm }} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { position: 'absolute', width: '100%', height: '92%', borderRadius: radius.xl, padding: spacing.lg, justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 14, elevation: 3 },
  behind: { transform: [{ scale: 0.95 }, { translateY: 14 }], opacity: 0.7 },
  stamp: { position: 'absolute', top: 28, fontSize: 28, fontWeight: '900', borderWidth: 3, borderRadius: 10, paddingHorizontal: 10 },
  like: { left: 24, color: colors.success, borderColor: colors.success, transform: [{ rotate: '-12deg' }] },
  nope: { right: 24, color: colors.danger, borderColor: colors.danger, transform: [{ rotate: '12deg' }] },
  buttons: { flexDirection: 'row', justifyContent: 'center', gap: spacing.xl, paddingVertical: spacing.md },
});
