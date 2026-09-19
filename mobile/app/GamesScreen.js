import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, Alert } from 'react-native';
import { apiFetch } from '../services/api';
import { spacing, radius } from '../theme';
import { FadeInUp, MorphButton } from '../components/Motion';
import Icon from '../components/Icon';
import StickerField from '../components/Stickers';
import { useTheme } from '../components/ThemeContext';

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
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors, font), [colors, font]);
  const [games, setGames] = useState([]);

  useEffect(() => {
    apiFetch('/games').then((d) => setGames(d.games)).catch((err) => Alert.alert('Error', err.message));
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
      <StickerField variant="minimal" />
      <FlatList
        style={styles.container}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140, gap: spacing.sm }}
        data={games}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={{ gap: spacing.sm }}
        ListHeaderComponent={<Text style={[font.h1, { marginBottom: spacing.md }]}>Arcade</Text>}
        renderItem={({ item, index }) => (
          <FadeInUp delay={index * 30} style={{ flex: 1 }}>
            <MorphButton
              onPress={() => navigation.navigate(ROUTE_BY_SLUG[item.slug])}
              disabled={!item.is_implemented}
              style={styles.card}
            >
              <Icon name={item.emoji} chip chipSize={44} style={{ marginBottom: spacing.sm }} />
              <Text style={font.h2}>{item.title}</Text>
              {item.subtitle ? <Text style={font.muted}>{item.subtitle}</Text> : null}
              {!item.is_implemented && <Text style={styles.comingSoon}>Coming soon</Text>}
            </MorphButton>
          </FadeInUp>
        )}
      />
    </View>
  );
}

const makeStyles = (colors, font) =>
  StyleSheet.create({
  container: { flex: 1 },
  card: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    minHeight: 150, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm,
  },
  comingSoon: { ...font.muted, marginTop: spacing.xs, color: colors.textMuted },
});
