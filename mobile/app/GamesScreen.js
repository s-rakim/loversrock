import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Alert } from 'react-native';
import { apiFetch } from '../services/api';
import { colors, font, spacing, radius } from '../theme';
import { FadeInUp, MorphButton } from '../components/Motion';

const ROUTE_BY_SLUG = {
  'four-in-a-row': 'FourInARow',
  anagrams: 'Anagrams',
  'love-golf': 'LoveGolf',
  'draw-duel': 'DrawDuel',
  'what-you-saying': 'WhatYouSaying',
  'perfect-pair': 'PerfectPair',
  'love-letters': 'LoveLetters',
};

export default function GamesScreen({ navigation }) {
  const [games, setGames] = useState([]);

  useEffect(() => {
    apiFetch('/games').then((d) => setGames(d.games)).catch((err) => Alert.alert('Error', err.message));
  }, []);

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
      data={games}
      keyExtractor={(item) => item.id}
      numColumns={2}
      columnWrapperStyle={{ gap: spacing.sm }}
      renderItem={({ item, index }) => (
        <FadeInUp delay={index * 30} style={{ flex: 1 }}>
          <MorphButton
            onPress={() => navigation.navigate(ROUTE_BY_SLUG[item.slug])}
            disabled={!item.is_implemented}
            style={styles.card}
          >
            <Text style={styles.emoji}>{item.emoji}</Text>
            <Text style={font.h2}>{item.title}</Text>
            {item.subtitle ? <Text style={font.muted}>{item.subtitle}</Text> : null}
            {!item.is_implemented && <Text style={styles.comingSoon}>Coming soon</Text>}
          </MorphButton>
        </FadeInUp>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  card: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    minHeight: 140, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm,
  },
  emoji: { fontSize: 30, marginBottom: spacing.sm },
  comingSoon: { ...font.muted, marginTop: spacing.xs, color: colors.textMuted },
});
