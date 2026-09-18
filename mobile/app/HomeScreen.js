import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Image } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch, mediaUrl } from '../services/api';
import { colors, font, spacing, radius, gradientForCategory } from '../theme';
import { FadeInUp, MorphButton, PulsingText } from '../components/Motion';
import Icon from '../components/Icon';
import StickerField from '../components/Stickers';

const QUICK_LINKS = [
  ['BucketList', 'Bucket List', 'checkbox-outline'],
  ['DateIdeas', 'Date Ideas', 'bulb-outline'],
  ['Countdown', 'Countdowns', 'hourglass-outline'],
  ['DistanceApart', 'Distance Apart', 'navigate-outline'],
];

export default function HomeScreen({ navigation }) {
  const [streak, setStreak] = useState(0);
  const [decksByCategory, setDecksByCategory] = useState({});
  const [games, setGames] = useState([]);
  const [widgetPhoto, setWidgetPhoto] = useState(null);

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

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
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
});
