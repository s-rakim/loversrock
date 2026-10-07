import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Image } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch, mediaUrl } from '../services/api';
import { spacing, radius } from '../theme';
import { FadeInUp, MorphButton, PulsingText } from '../components/Motion';
import Icon from '../components/Icon';
import Icon3D from '../components/Icon3D';
import ShineBorder from '../components/ShineBorder';
import MoodBar from '../components/MoodBar';
import StickerField from '../components/Stickers';
import { useTheme } from '../components/ThemeContext';
import CallButtons from '../components/calls/CallButtons';
import ChallengeCard from '../components/ChallengeCard';

// Everything else, as a grid of tiles: a colourful 3D icon over its name,
// the way a phone's own home screen shows apps. [route, label, 3D icon]
const QUICK_LINKS = [
  // The deck first: choosing what to do is the thing people open this for,
  // and the list is where the ones you both said yes to end up.
  ['SwipeDeck', 'Swipe Dates', 'love_letter'],
  ['BucketList', 'Bucket List', 'check'],
  ['DateIdeas', 'Date Ideas', 'bulb'],
  ['Countdown', 'Countdowns', 'hourglass'],
  ['DistanceApart', 'Distance', 'pin'],
  ['Cycle', 'Cycle', 'calendar'],
  ['Checkin', 'Check-In', 'memo'],
  ['Feed', 'Your Story', 'book'],
  ['Achievements', 'Badges', 'trophy'],
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
      // What your partner sent you, as on your Locket widget.
      apiFetch('/widget-photos/latest?from=partner'),
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
            <MorphButton onPress={() => navigation.navigate('Achievements')} style={styles.streakPill}>
              <Icon3D name="fire" size={20} />
              <Text style={styles.streakText}>{streak}</Text>
            </MorphButton>
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
                <Icon3D name="chat" size={52} style={styles.heroIcon} />
                <Text style={font.h2}>Daily Prompt</Text>
                <Text style={font.muted}>Answer today's question</Text>
              </MorphButton>
            </ShineBorder>
            <ShineBorder variant="beam" radius={radius.card} style={{ flex: 1 }} phase={0.5}>
              <MorphButton onPress={() => navigation.navigate('Quiz')} style={styles.widgetCardInner}>
                <Icon3D name="quiz" size={52} style={styles.heroIcon} />
                <Text style={font.h2}>Daily Quiz</Text>
                <Text style={font.muted}>5 questions, revealed together</Text>
              </MorphButton>
            </ShineBorder>
          </View>

          <ShineBorder variant="shine" radius={radius.card} phase={0.25} style={{ marginTop: spacing.md }}>
          <MorphButton onPress={() => navigation.navigate('Photos')} style={styles.widgetWideInner}>
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
                <Icon3D name="camera" size={52} />
                <Text style={font.muted}>Send a photo to their home screen</Text>
              </View>
            )}
          </MorphButton>
          </ShineBorder>

          <View style={styles.doodleSplit}>
            <MorphButton onPress={() => navigation.navigate('Canvas')} style={styles.doodleRow}>
              <Icon3D name="palette" size={32} />
              <Text style={font.body}>Doodle</Text>
            </MorphButton>
            {/* The shelf. Worth its own way in from Home: a drawing you can
                reopen is only useful if finding it is one tap. */}
            <MorphButton onPress={() => navigation.navigate('Play')} style={styles.doodleRow}>
              <Icon3D name="picture" size={32} />
              <Text style={font.body}>Your drawings</Text>
            </MorphButton>
          </View>
        </FadeInUp>

        <FadeInUp delay={100}>
          <MorphButton onPress={() => navigation.navigate('ThumbKiss')} style={styles.thumbKissBanner}>
            <Icon3D name="kiss" size={32} />
            <PulsingText style={styles.thumbKissText}>Thumb Kiss — touch to connect</PulsingText>
          </MorphButton>
        </FadeInUp>

        {/* The AI room (Esprits): its own button, one tap from Home, rather
            than a chip inside your partner's thread. */}
        <FadeInUp delay={115}>
          <MorphButton onPress={() => navigation.navigate('Esprits')} style={styles.fableCard}>
            <Icon3D name="robot" size={36} />
            <View style={{ flex: 1 }}>
              <Text style={[font.body, { fontWeight: '700' }]}>Esprits</Text>
              <Text style={font.muted}>The AI room: you, your partner and your models</Text>
            </View>
            <Icon name="chevron-forward" chip={false} size={16} color={colors.textMuted} />
          </MorphButton>
        </FadeInUp>

        <FadeInUp delay={130}>
          <View style={{ marginTop: spacing.md }}>
            <CallButtons />
          </View>
        </FadeInUp>

        <FadeInUp delay={140}>
          <View style={styles.tiles}>
            {QUICK_LINKS.map(([route, label, icon]) => (
              <MorphButton key={route} onPress={() => navigation.navigate(route)} style={styles.tile}>
                <Icon3D name={icon} size={44} />
                <Text style={styles.tileLabel} numberOfLines={1}>{label}</Text>
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
                  <Icon3D name={deck.emoji} size={36} />
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
                    <Icon3D name={deck.emoji} size={36} />
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

        {/* Nothing to play means no heading: an empty section looks broken. */}
        {games.length > 0 && (
        <FadeInUp delay={220}>
          <Text style={styles.sectionTitle}>Arcade</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: spacing.lg }}>
            {games.map((game) => (
              <MorphButton key={game.id} onPress={() => navigation.navigate('Play')} style={styles.gameCard}>
                <Icon3D name={game.emoji} size={44} />
                <Text style={[font.body, { marginTop: spacing.xs, textAlign: 'center' }]} numberOfLines={2}>{game.title}</Text>
              </MorphButton>
            ))}
          </ScrollView>
        </FadeInUp>
        )}
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
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
  },
  thumbKissBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.accentSoft, borderRadius: radius.lg, padding: spacing.md,
    marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.accent,
  },
  thumbKissText: { color: colors.accent, fontWeight: '700' },
  heroIcon: { marginBottom: spacing.xs },
  // Three to a row. A percentage width rather than a measured one, so the
  // grid is the same on every phone width without doing any arithmetic.
  tiles: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between',
    rowGap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.sm,
  },
  tile: {
    width: '31.5%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.xs,
  },
  tileLabel: { color: colors.text, fontSize: 13, fontWeight: '600' },
  fableCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
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
    width: 116, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    marginRight: spacing.sm, borderWidth: 1, borderColor: colors.border, minHeight: 100, justifyContent: 'center', alignItems: 'center',
  },
});
