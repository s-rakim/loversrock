import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Image } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch, mediaUrl } from '../services/api';
import { colors, font, spacing, radius, gradientForCategory } from '../theme';
import { FadeInUp, MorphButton, PulsingText } from '../components/Motion';

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
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: spacing.xl }}>
      <FadeInUp>
        <View style={styles.headerRow}>
          <Text style={font.wordmark}>loversrock.</Text>
          <View style={styles.streakPill}>
            <Text style={styles.streakEmoji}>🔥</Text>
            <Text style={styles.streakText}>{streak}</Text>
          </View>
        </View>
      </FadeInUp>

      <FadeInUp delay={60}>
        <View style={styles.widgetRow}>
          <MorphButton onPress={() => navigation.navigate('DailyPrompt')} style={[styles.widgetCard, { flex: 1 }]}>
            <Text style={font.h2}>Daily Prompt</Text>
            <Text style={font.muted}>Answer today's question</Text>
          </MorphButton>
          <MorphButton onPress={() => navigation.navigate('Quiz')} style={[styles.widgetCard, { flex: 1 }]}>
            <Text style={font.h2}>Daily Quiz</Text>
            <Text style={font.muted}>5 questions, revealed together</Text>
          </MorphButton>
        </View>

        <MorphButton onPress={() => navigation.navigate('Canvas')} style={styles.widgetWide}>
          {widgetPhoto ? (
            <Image source={{ uri: mediaUrl(widgetPhoto.imageUrl || widgetPhoto.image_url) }} style={styles.widgetPhoto} />
          ) : (
            <Text style={font.muted}>Send a doodle or photo drop</Text>
          )}
        </MorphButton>
      </FadeInUp>

      <FadeInUp delay={100}>
        <MorphButton onPress={() => navigation.navigate('ThumbKiss')} style={styles.thumbKissBanner}>
          <PulsingText style={styles.thumbKissText}>👆 Thumb Kiss — touch to connect</PulsingText>
        </MorphButton>
      </FadeInUp>

      <FadeInUp delay={140}>
        <View style={styles.quickLinks}>
          {[
            ['Memories', 'Memories'],
            ['BucketList', 'Bucket List'],
            ['DateIdeas', 'Date Ideas'],
            ['Countdown', 'Countdowns'],
            ['Messages', 'Messages'],
            ['DistanceApart', 'Distance Apart'],
          ].map(([route, label]) => (
            <MorphButton key={route} onPress={() => navigation.navigate(route)} style={styles.quickLink}>
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
              const [c1] = gradientForCategory(category);
              return (
                <MorphButton
                  key={deck.id}
                  onPress={() => navigation.navigate('DeckDetail', { slug: deck.slug, title: deck.title })}
                  style={[styles.deckCard, { borderColor: c1 }]}
                >
                  <Text style={styles.deckEmoji}>{deck.emoji}</Text>
                  <Text style={font.body}>{deck.title}</Text>
                  {deck.is_locked && <Text style={styles.lockedTag}>🔒 Premium</Text>}
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
            <MorphButton
              key={game.id}
              onPress={() => navigation.navigate('Games')}
              style={styles.gameCard}
            >
              <Text style={styles.deckEmoji}>{game.emoji}</Text>
              <Text style={font.body}>{game.title}</Text>
            </MorphButton>
          ))}
        </ScrollView>
      </FadeInUp>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  streakPill: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
  },
  streakEmoji: { fontSize: 16, marginRight: spacing.xs },
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
  widgetPhoto: { width: '100%', height: 140, borderRadius: radius.md },
  thumbKissBanner: {
    backgroundColor: colors.surfaceAlt, borderRadius: radius.lg, padding: spacing.md,
    alignItems: 'center', marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.accent,
  },
  thumbKissText: { color: colors.accent, fontWeight: '700' },
  quickLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  quickLink: {
    backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  sectionTitle: { ...font.h2, marginBottom: spacing.sm, marginTop: spacing.sm },
  deckCard: {
    width: 130, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    marginRight: spacing.sm, borderWidth: 1, minHeight: 110, justifyContent: 'space-between',
  },
  gameCard: {
    width: 110, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    marginRight: spacing.sm, borderWidth: 1, borderColor: colors.border, minHeight: 90, justifyContent: 'center', alignItems: 'center',
  },
  deckEmoji: { fontSize: 26, marginBottom: spacing.xs },
  lockedTag: { ...font.muted, marginTop: spacing.xs },
});
