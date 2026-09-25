import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Image } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch, mediaUrl } from '../services/api';
import { colors, font, spacing, radius, gradientForCategory } from '../theme';
import { FadeInUp, MorphButton, PulsingText } from '../components/Motion';
import Icon from '../components/Icon';
import StickerField from '../components/Stickers';
import { CoupleMascots } from '../components/Mascot';
import MoodPicker from '../components/MoodPicker';
import { useCouple } from '../components/CoupleContext';
import { useI18n } from '../i18n';

const QUICK_LINKS = [
  ['BucketList', 'Bucket List', 'checkbox-outline'],
  ['DateIdeas', 'Date Ideas', 'bulb-outline'],
  ['Countdown', 'Countdowns', 'hourglass-outline'],
  ['DistanceApart', 'Distance Apart', 'navigate-outline'],
  ['PeriodTracker', 'Cycle Tracker', 'water-outline'],
];

// Candle / Lovers X additions, labelled through i18n.
const MORE_LINKS = [
  ['Connect', 'home.link.connect', 'chatbubbles-outline'],
  ['DailySnap', 'home.link.snap', 'camera-outline'],
  ['SharedCanvas', 'home.link.canvas', 'color-palette-outline'],
  ['CanvasGallery', 'home.link.gallery', 'albums-outline'],
  ['DateDiscover', 'home.link.dateDiscover', 'heart-circle-outline'],
  ['DatePlans', 'home.link.datePlans', 'calendar-outline'],
  ['CheckIn', 'home.link.checkin', 'pulse-outline'],
  ['Challenge', 'home.link.challenge', 'dice-outline'],
  ['Notes', 'home.link.notes', 'document-text-outline'],
  ['SecretMessage', 'home.link.secret', 'mail-unread-outline'],
  ['Timeline', 'home.link.timeline', 'calendar-number-outline'],
  ['Achievements', 'home.link.achievements', 'trophy-outline'],
  ['Sparks', 'home.link.sparks', 'sparkles-outline'],
];

export default function HomeScreen({ navigation }) {
  const [streak, setStreak] = useState(0);
  const [decksByCategory, setDecksByCategory] = useState({});
  const [games, setGames] = useState([]);
  const [widgetPhoto, setWidgetPhoto] = useState(null);
  const { t } = useI18n();
  const { me, partner, pair, sparks, myCharacter, partnerCharacter, refresh } = useCouple();
  const [moodOpen, setMoodOpen] = useState(false);
  const [today, setToday] = useState({});

  const load = useCallback(async () => {
    const [prompt, decks, gamesRes, widget] = await Promise.allSettled([
      apiFetch('/daily-prompt/today'),
      apiFetch('/decks'),
      apiFetch('/games'),
      apiFetch('/widget-photos/latest'),
    ]);
    if (prompt.status === 'fulfilled') setStreak(prompt.value.streakCount || 0);
    if (decks.status === 'fulfilled') setDecksByCategory(decks.value.decksByCategory || {});
    if (gamesRes.status === 'fulfilled') setGames(gamesRes.value.games || []);
    if (widget.status === 'fulfilled') setWidgetPhoto(widget.value.widgetPhoto);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Dashboard extras: what's waiting today, so there's always something to do.
  const loadToday = useCallback(async () => {
    const fresh = await refresh();
    if (fresh?.me && !fresh.me.onboardedAt) {
      navigation.navigate('Onboarding');
      return;
    }
    const [challenge, nextDate, secrets, checkin] = await Promise.allSettled([
      apiFetch('/challenges/today'),
      apiFetch('/dates/next'),
      apiFetch('/secrets'),
      apiFetch('/checkins/current'),
    ]);
    setToday({
      challenge: challenge.status === 'fulfilled' ? challenge.value : null,
      nextDate: nextDate.status === 'fulfilled' ? nextDate.value.plan : null,
      unopenedSecrets: secrets.status === 'fulfilled' ? secrets.value.unopened : 0,
      checkin: checkin.status === 'fulfilled' ? checkin.value : null,
    });
  }, [refresh, navigation]);
  useFocusEffect(useCallback(() => { loadToday(); }, [loadToday]));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StickerField variant="home" />
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 140 }}>
        <FadeInUp>
          <View style={styles.headerRow}>
            <Text style={font.wordmark}>loversrock.</Text>
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              <MorphButton onPress={() => navigation.navigate('Sparks')} style={styles.streakPill}>
                <Icon name="sparkles" size={16} color={colors.gold} />
                <Text style={styles.streakText}>{sparks}</Text>
              </MorphButton>
              <View style={styles.streakPill}>
                <Icon name="flame" size={16} color={colors.gold} />
                <Text style={styles.streakText}>{streak}</Text>
              </View>
            </View>
          </View>
        </FadeInUp>

        {/* The couple: each character wears its own person's current mood. */}
        <FadeInUp delay={30}>
          <View style={styles.coupleCard}>
            <CoupleMascots
              me={myCharacter || { emotion: 'happy' }}
              partner={partnerCharacter || { emotion: 'happy', avatar: { preset: 'her' } }}
              context="home"
              onPressPartner={() => navigation.navigate('Profile', { who: 'partner' })}
              onLongPressMe={() => setMoodOpen(true)}
            />
            <Text style={[font.muted, { textAlign: 'center', marginTop: spacing.xs }]}>
              {partner?.mood
                ? t('home.partnerFeeling', { name: partner.name, mood: `${partner.mood.emoji}${partner.mood.text ? ` ${partner.mood.text}` : ''}` })
                : partner ? t('home.partnerNoMood', { name: partner.name }) : ''}
              {pair ? `  ·  ${t('home.daysTogether', { n: pair.daysTogether })}` : ''}
            </Text>
            <View style={styles.coupleActions}>
              <MorphButton onPress={() => setMoodOpen(true)} style={styles.coupleButton}>
                <Text style={{ fontSize: 16 }}>{me?.mood?.emoji || '🙂'}</Text>
                <Text style={styles.coupleButtonText}>{t('mood.set')}</Text>
              </MorphButton>
              <MorphButton onPress={() => navigation.navigate('DailySnap')} style={styles.coupleButton}>
                <Icon name="camera-outline" size={15} chip={false} />
                <Text style={styles.coupleButtonText}>{t('home.link.snap')}</Text>
              </MorphButton>
              <MorphButton onPress={() => apiFetch('/nudges', { method: 'POST', body: { kind: 'kiss' } }).catch(() => {})} style={styles.coupleButton}>
                <Text style={{ fontSize: 15 }}>😘</Text>
                <Text style={styles.coupleButtonText}>{t('home.sendKiss')}</Text>
              </MorphButton>
            </View>
          </View>
        </FadeInUp>

        <FadeInUp delay={45}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }}>
            {widgetPhoto && (
              <MorphButton onPress={() => navigation.navigate('DailySnap')} style={[styles.todayCard, { padding: 0, overflow: 'hidden' }]}>
                <Image source={{ uri: mediaUrl(widgetPhoto.imageUrl || widgetPhoto.image_url) }} style={{ width: '100%', height: 90 }} />
                <Text style={[styles.todayTitle, { padding: spacing.sm }]} numberOfLines={1}>{widgetPhoto.caption || t('home.today.snap')}</Text>
              </MorphButton>
            )}
            {today.unopenedSecrets > 0 && (
              <MorphButton onPress={() => navigation.navigate('SecretMessage')} style={[styles.todayCard, { backgroundColor: '#FFE1E7' }]}>
                <Icon name="mail-unread" chip chipColor="rgba(255,255,255,0.7)" />
                <Text style={styles.todayTitle}>{t('home.today.secret')}</Text>
              </MorphButton>
            )}
            {today.challenge && (
              <MorphButton onPress={() => navigation.navigate('Challenge')} style={[styles.todayCard, { backgroundColor: '#FFF0D6' }]}>
                <Icon name={today.challenge.challenge.icon} chip chipColor="rgba(255,255,255,0.7)" />
                <Text style={styles.todayLabel}>{today.challenge.completed ? t('home.today.challengeDone') : t('home.today.challenge')}</Text>
                <Text style={styles.todayTitle} numberOfLines={2}>{today.challenge.challenge.title}</Text>
              </MorphButton>
            )}
            <MorphButton onPress={() => navigation.navigate(today.nextDate ? 'DatePlans' : 'DateDiscover')} style={[styles.todayCard, { backgroundColor: '#E3F2FD' }]}>
              <Icon name="calendar" chip chipColor="rgba(255,255,255,0.7)" />
              <Text style={styles.todayLabel}>{today.nextDate ? t('home.today.nextDate') : t('home.today.findDate')}</Text>
              <Text style={styles.todayTitle} numberOfLines={2}>
                {today.nextDate ? `${today.nextDate.title} · ${new Date(today.nextDate.scheduled_for).toLocaleDateString([], { day: 'numeric', month: 'short' })}` : t('home.today.swipe')}
              </Text>
            </MorphButton>
            {today.checkin && !today.checkin.myAnswers && (
              <MorphButton onPress={() => navigation.navigate('CheckIn')} style={[styles.todayCard, { backgroundColor: '#DDF5EA' }]}>
                <Icon name="pulse" chip chipColor="rgba(255,255,255,0.7)" />
                <Text style={styles.todayLabel}>{t('home.today.checkin')}</Text>
                <Text style={styles.todayTitle} numberOfLines={2}>{today.checkin.partnerDone ? t('home.today.checkinPartner', { name: partner?.name || '' }) : t('home.today.checkinBody')}</Text>
              </MorphButton>
            )}
          </ScrollView>
        </FadeInUp>

        <FadeInUp delay={60}>
          <View style={styles.widgetRow}>
            <MorphButton onPress={() => navigation.navigate('DailyPrompt')} style={[styles.widgetCard, { flex: 1 }]}>
              <Icon name="chatbox-ellipses-outline" chip chipSize={36} style={{ marginBottom: spacing.xs }} />
              <Text style={font.h2}>Daily Prompt</Text>
              <Text style={font.muted}>Answer today's question</Text>
            </MorphButton>
            <MorphButton onPress={() => navigation.navigate('Quiz')} style={[styles.widgetCard, { flex: 1 }]}>
              <Icon name="help-buoy-outline" chip chipSize={36} style={{ marginBottom: spacing.xs }} />
              <Text style={font.h2}>Daily Quiz</Text>
              <Text style={font.muted}>5 questions, revealed together</Text>
            </MorphButton>
          </View>

          <MorphButton onPress={() => navigation.navigate('Canvas')} style={styles.widgetWide}>
            {widgetPhoto ? (
              <Image source={{ uri: mediaUrl(widgetPhoto.imageUrl || widgetPhoto.image_url) }} style={styles.widgetPhoto} />
            ) : (
              <View style={styles.widgetWideEmpty}>
                <Icon name="brush-outline" chip chipSize={36} />
                <Text style={font.muted}>Send a doodle or photo drop</Text>
              </View>
            )}
          </MorphButton>
        </FadeInUp>

        <FadeInUp delay={100}>
          <MorphButton onPress={() => navigation.navigate('ThumbKiss')} style={styles.thumbKissBanner}>
            <Icon name="finger-print-outline" color={colors.accent} size={18} />
            <PulsingText style={styles.thumbKissText}>Thumb Kiss — touch to connect</PulsingText>
          </MorphButton>
        </FadeInUp>

        <FadeInUp delay={140}>
          <View style={styles.quickLinks}>
            {QUICK_LINKS.map(([route, label, icon]) => (
              <MorphButton key={route} onPress={() => navigation.navigate(route)} style={styles.quickLink}>
                <Icon name={icon} size={16} />
                <Text style={font.body}>{label}</Text>
              </MorphButton>
            ))}
            {MORE_LINKS.map(([route, key, icon]) => (
              <MorphButton key={route} onPress={() => navigation.navigate(route)} style={styles.quickLink}>
                <Icon name={icon} size={16} />
                <Text style={font.body}>{t(key)}</Text>
              </MorphButton>
            ))}
          </View>
        </FadeInUp>

        {Object.entries(decksByCategory).map(([category, decks], i) => (
          <FadeInUp key={category} delay={160 + i * 40}>
            <Text style={styles.sectionTitle}>{category}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: spacing.lg }}>
              {decks.map((deck) => {
                const [c1, c2] = gradientForCategory(category);
                return (
                  <MorphButton
                    key={deck.id}
                    onPress={() => navigation.navigate('DeckDetail', { slug: deck.slug, title: deck.title })}
                    style={[styles.deckCard, { backgroundColor: c1 }]}
                  >
                    <Icon name={deck.emoji} chip chipColor="rgba(255,255,255,0.6)" size={20} />
                    <Text style={[font.body, { marginTop: spacing.sm }]}>{deck.title}</Text>
                    {deck.is_locked && (
                      <View style={styles.lockedTag}>
                        <Icon name="lock-closed-outline" size={11} chip={false} color={colors.text} />
                        <Text style={styles.lockedTagText}>Premium</Text>
                      </View>
                    )}
                  </MorphButton>
                );
              })}
            </ScrollView>
          </FadeInUp>
        ))}

        <FadeInUp delay={220}>
          <Text style={styles.sectionTitle}>Arcade</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: spacing.lg }}>
            {games.map((game) => (
              <MorphButton key={game.id} onPress={() => navigation.navigate('Games')} style={styles.gameCard}>
                <Icon name={game.emoji} chip chipSize={36} />
                <Text style={[font.body, { marginTop: spacing.xs }]}>{game.title}</Text>
              </MorphButton>
            ))}
          </ScrollView>
        </FadeInUp>
      </ScrollView>
      <MoodPicker visible={moodOpen} onClose={() => setMoodOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  streakPill: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.surface,
    borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    borderWidth: 1, borderColor: colors.border,
  },
  streakText: { color: colors.text, fontWeight: '700' },
  widgetRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  widgetCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, marginRight: spacing.sm,
  },
  widgetWide: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md, minHeight: 90, justifyContent: 'center',
  },
  widgetWideEmpty: { alignItems: 'center', gap: spacing.xs },
  widgetPhoto: { width: '100%', height: 140, borderRadius: radius.md },
  thumbKissBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.accentSoft, borderRadius: radius.lg, padding: spacing.md,
    marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.accent,
  },
  thumbKissText: { color: colors.accent, fontWeight: '700' },
  quickLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  quickLink: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.surface,
    borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  sectionTitle: { ...font.h2, marginBottom: spacing.sm, marginTop: spacing.sm },
  deckCard: {
    width: 130, borderRadius: radius.lg, padding: spacing.md,
    marginRight: spacing.sm, minHeight: 120, justifyContent: 'space-between',
  },
  gameCard: {
    width: 110, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    marginRight: spacing.sm, borderWidth: 1, borderColor: colors.border, minHeight: 100, justifyContent: 'center', alignItems: 'center',
  },
  lockedTag: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.xs },
  lockedTagText: { fontSize: 11, color: colors.text, fontWeight: '600' },
  coupleCard: {
    backgroundColor: colors.surface, borderRadius: radius.xl, paddingTop: spacing.md, paddingBottom: spacing.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
  },
  coupleActions: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.sm },
  coupleButton: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.accentSoft,
    borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2,
  },
  coupleButtonText: { color: colors.accent, fontWeight: '700', fontSize: 13 },
  todayCard: {
    width: 150, minHeight: 130, borderRadius: radius.lg, padding: spacing.md, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, justifyContent: 'flex-start',
  },
  todayLabel: { ...font.muted, fontSize: 11, marginTop: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  todayTitle: { fontWeight: '700', color: colors.text, marginTop: 2 },
});
