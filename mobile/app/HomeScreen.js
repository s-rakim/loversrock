import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Image } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch, mediaUrl } from '../services/api';
import { spacing, radius } from '../theme';
import { FadeInUp, MorphButton, PulsingText } from '../components/Motion';
import Icon from '../components/Icon';
import ShineBorder from '../components/ShineBorder';
import MoodBar from '../components/MoodBar';
import StickerField from '../components/Stickers';
import { useTheme } from '../components/ThemeContext';
import CallButtons from '../components/calls/CallButtons';
import ChallengeCard from '../components/ChallengeCard';

const QUICK_LINKS = [
  ['BucketList', 'Bucket List', 'checkbox-outline'],
  // The deck first: choosing what to do is the thing people open this for,
  // and the list is where the ones you both said yes to end up.
  ['SwipeDeck', 'Swipe Dates', 'albums-outline'],
  ['DateIdeas', 'Date Ideas', 'bulb-outline'],
  ['Countdown', 'Countdowns', 'hourglass-outline'],
  ['DistanceApart', 'Distance Apart', 'navigate-outline'],
  ['Cycle', 'Cycle Tracker', 'water-outline'],
  ['Checkin', 'Monthly Check-In', 'clipboard-outline'],
  ['Feed', 'Your Story', 'time-outline'],
];

export default function HomeScreen({ navigation }) {
  const { colors, font, gradientForCategory } = useTheme();
  const styles = useMemo(() => makeStyles(colors, font), [colors, font]);
  const [streak, setStreak] = useState(0);
  const [decksByCategory, setDecksByCategory] = useState({});
  const [seasonalSoon, setSeasonalSoon] = useState([]);
  const [games, setGames] = useState([]);
  const [widgetPhoto, setWidgetPhoto] = useState(null);
  const [profile, setProfile] = useState(null);

  const load = useCallback(async () => {
    const [prompt, decks, gamesRes, widget, profileRes] = await Promise.allSettled([
      apiFetch('/daily-prompt/today'),
      apiFetch('/decks'),
      apiFetch('/games'),
      apiFetch('/widget-photos/latest'),
      apiFetch('/profile'),
    ]);
    if (prompt.status === 'fulfilled') setStreak(prompt.value.streakCount || 0);
    if (decks.status === 'fulfilled') {
      setDecksByCategory(decks.value.decksByCategory || {});
      setSeasonalSoon(decks.value.seasonalSoon || []);
    }
    if (gamesRes.status === 'fulfilled') setGames(gamesRes.value.games || []);
    if (widget.status === 'fulfilled') setWidgetPhoto(widget.value.widgetPhoto);
    if (profileRes.status === 'fulfilled') setProfile(profileRes.value);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
      <StickerField variant="home" />
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 140 }}>
        <FadeInUp>
          <View style={styles.headerRow}>
            <Text style={font.wordmark}>loversrock.</Text>
            <View style={styles.streakPill}>
              <Icon name="flame" size={16} color={colors.gold} />
              <Text style={styles.streakText}>{streak}</Text>
            </View>
          </View>
          {profile?.paired && (
            <Text style={styles.greeting}>
              you &amp; <Text style={styles.greetingName}>{profile.partner.displayName}</Text>
            </Text>
          )}
        </FadeInUp>

        <FadeInUp delay={50}>
          {/* Top of Home, because it is the one thing here that is about
              THEM rather than about something to do. */}
          <MoodBar partnerName={profile?.partner?.displayName} />
        </FadeInUp>

        <FadeInUp delay={55}>
          {/* One thing to actually do, right under how they are feeling. */}
          <ChallengeCard />
        </FadeInUp>

        <FadeInUp delay={60}>
          {/* The two things that are new every day get the moving border, and
              the phases are offset so they do not pulse in unison. */}
          <View style={styles.widgetRow}>
            <ShineBorder variant="beam" radius={radius.card} style={{ flex: 1 }} phase={0}>
              <MorphButton onPress={() => navigation.navigate('DailyPrompt')} style={styles.widgetCardInner}>
                <Icon name="chatbox-ellipses-outline" chip chipSize={36} style={{ marginBottom: spacing.xs }} />
                <Text style={font.h2}>Daily Prompt</Text>
                <Text style={font.muted}>Answer today's question</Text>
              </MorphButton>
            </ShineBorder>
            <ShineBorder variant="beam" radius={radius.card} style={{ flex: 1 }} phase={0.5}>
              <MorphButton onPress={() => navigation.navigate('Quiz')} style={styles.widgetCardInner}>
                <Icon name="help-buoy-outline" chip chipSize={36} style={{ marginBottom: spacing.xs }} />
                <Text style={font.h2}>Daily Quiz</Text>
                <Text style={font.muted}>5 questions, revealed together</Text>
              </MorphButton>
            </ShineBorder>
          </View>

          <ShineBorder variant="shine" radius={radius.card} phase={0.25} style={{ marginTop: spacing.md }}>
          <MorphButton onPress={() => navigation.navigate('Locket')} style={styles.widgetWideInner}>
            {widgetPhoto ? (
              <>
                <Image source={{ uri: mediaUrl(widgetPhoto.imageUrl || widgetPhoto.image_url) }} style={styles.widgetPhoto} />
                <View style={styles.widgetPhotoOverlay}>
                  <Icon name="camera" chip={false} size={14} color="#fff" />
                  <Text style={styles.widgetPhotoOverlayText}>
                    {widgetPhoto.caption || 'Tap to send a new one'}
                  </Text>
                </View>
              </>
            ) : (
              <View style={styles.widgetWideEmpty}>
                <Icon name="camera-outline" chip chipSize={36} />
                <Text style={font.muted}>Send a photo to their home screen</Text>
              </View>
            )}
          </MorphButton>
          </ShineBorder>

          <View style={styles.doodleSplit}>
            <MorphButton onPress={() => navigation.navigate('Canvas')} style={styles.doodleRow}>
              <Icon name="brush-outline" chip={false} size={16} color={colors.accent} />
              <Text style={font.body}>Doodle</Text>
            </MorphButton>
            {/* The shelf. Worth its own way in from Home: a drawing you can
                reopen is only useful if finding it is one tap. */}
            <MorphButton onPress={() => navigation.navigate('Doodle')} style={styles.doodleRow}>
              <Icon name="images-outline" chip={false} size={16} color={colors.accent} />
              <Text style={font.body}>Your drawings</Text>
            </MorphButton>
          </View>
        </FadeInUp>

        <FadeInUp delay={100}>
          <MorphButton onPress={() => navigation.navigate('ThumbKiss')} style={styles.thumbKissBanner}>
            <Icon name="finger-print-outline" color={colors.accent} size={18} />
            <PulsingText style={styles.thumbKissText}>Thumb Kiss — touch to connect</PulsingText>
          </MorphButton>
        </FadeInUp>

        <FadeInUp delay={130}>
          <View style={{ marginTop: spacing.md }}>
            <CallButtons />
          </View>
        </FadeInUp>

        <FadeInUp delay={140}>
          <View style={styles.quickLinks}>
            {QUICK_LINKS.map(([route, label, icon]) => (
              <MorphButton key={route} onPress={() => navigation.navigate(route)} style={styles.quickLink}>
                <Icon name={icon} size={16} />
                <Text style={font.body}>{label}</Text>
              </MorphButton>
            ))}
          </View>
        </FadeInUp>

        {/* Decks that are nearly in season. Announced rather than hidden,
            because "Christmas questions, back in 9 days" is something to look
            forward to and a silently absent deck is nothing at all. */}
        {seasonalSoon.length > 0 && (
          <FadeInUp delay={150}>
            <Text style={styles.sectionTitle}>Coming up</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: spacing.lg }}>
              {seasonalSoon.map((deck) => (
                <MorphButton
                  key={deck.id}
                  onPress={() => navigation.navigate('DeckDetail', { slug: deck.slug, title: deck.title })}
                  style={[styles.deckCard, styles.soonCard]}
                >
                  <Icon name={deck.emoji} chip chipColor={colors.surfaceAlt} size={20} />
                  <Text style={[font.body, { marginTop: spacing.sm }]}>{deck.title}</Text>
                  <Text style={[font.muted, { fontSize: 11 }]}>
                    in {deck.daysUntilSeason} day{deck.daysUntilSeason === 1 ? '' : 's'}
                  </Text>
                </MorphButton>
              ))}
            </ScrollView>
          </FadeInUp>
        )}

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
                    {deck.seasonal && (
                      <Text style={[font.muted, { fontSize: 10, fontWeight: '700' }]}>IN SEASON</Text>
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
    </View>
  );
}

const makeStyles = (colors, font) =>
  StyleSheet.create({
  container: { flex: 1, padding: spacing.lg },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  greeting: { fontSize: 15, color: colors.textMuted, marginTop: -spacing.xs, marginBottom: spacing.lg },
  greetingName: { color: colors.accent, fontWeight: '700' },
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
  // The inner halves of the ShineBorder cards. No border or background of
  // their own — the wrapper paints both, and a second border on top of the
  // moving one reads as a mistake.
  widgetCardInner: { padding: spacing.md, minHeight: 104, justifyContent: 'center' },
  widgetWideInner: { padding: spacing.md, minHeight: 90, justifyContent: 'center' },
  widgetWide: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md, minHeight: 90, justifyContent: 'center',
  },
  widgetWideEmpty: { alignItems: 'center', gap: spacing.xs },
  widgetPhoto: { width: '100%', height: 140, borderRadius: radius.md },
  widgetPhotoOverlay: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: spacing.sm, paddingVertical: 6,
    borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md,
  },
  widgetPhotoOverlayText: { color: '#fff', fontSize: 12, flex: 1 },
  doodleSplit: { flexDirection: 'row', gap: spacing.sm },
  doodleRow: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.sm, paddingVertical: spacing.sm,
    justifyContent: 'center',
  },
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
  // Muted rather than gradient, so a deck that is not open yet does not
  // compete with the ones you can actually use today.
  soonCard: {
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed',
  },
  gameCard: {
    width: 110, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    marginRight: spacing.sm, borderWidth: 1, borderColor: colors.border, minHeight: 100, justifyContent: 'center', alignItems: 'center',
  },
});
