// The arcade.
//
// Every game here is played against your partner. There is no solo section
// any more, because there are no solo games left: the five that were
// single-player are now races over the same seeded content, and Draw Duel
// was already live over sockets.
//
// Draw Duel is the one that does not go through the match layer — it is a
// live socket game with no board state to be authoritative about — so it is
// listed from the catalogue rather than from /games/matches.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '../services/api';
import { spacing, radius } from '../theme';
import { Stagger, MorphButton, Pop } from '../components/Motion';
import Icon from '../components/Icon';
import StickerField from '../components/Stickers';
import { useTheme } from '../components/ThemeContext';

const ROUTE_BY_SLUG = {
  'tic-tac-toe': 'TicTacToe',
  'four-in-a-row': 'FourInARow',
  checkers: 'Checkers',
  chess: 'Chess',
  'uno-reverse': 'UnoReverse',
  'block-blitz': 'BlockBlitz',
  anagrams: 'Anagrams',
  'love-golf': 'LoveGolf',
  'draw-duel': 'DrawDuel',
  'what-you-saying': 'WhatYouSaying',
  'perfect-pair': 'PerfectPair',
  'love-letters': 'LoveLetters',
};

export default function GamesScreen({ navigation }) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [catalog, setCatalog] = useState([]);
  const [matches, setMatches] = useState([]);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const [cat, live] = await Promise.allSettled([
      apiFetch('/games'),
      apiFetch('/games/matches'),
    ]);
    if (cat.status === 'fulfilled') setCatalog(cat.value.games || []);
    // /games/matches needs a pair; solo accounts just see the catalogue.
    setMatches(live.status === 'fulfilled' ? live.value.games || [] : []);
    setError(cat.status === 'rejected' ? cat.reason?.message : null);
    setRefreshing(false);
    setLoaded(true);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const matchBySlug = Object.fromEntries(matches.map((m) => [m.game, m]));
  // Anything with a match row goes in the main list; anything else (today
  // just Draw Duel) is still two-player, it simply keeps its state on the
  // socket rather than in game_matches.
  const withRecord = catalog.filter((g) => matchBySlug[g.slug]);
  const liveOnly = catalog.filter((g) => !matchBySlug[g.slug]);

  return (
    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
      <StickerField variant="minimal" />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={colors.accentPink}
          />
        }
      >
        <Text style={font.h1}>Arcade</Text>
        {error && <Text style={[font.muted, { marginTop: spacing.xs }]}>{error}</Text>}
        {/* An empty list with no error means the server answered but its
            games list was never filled — it used to be a blank page. The
            backend now fills it on every start; this says so if it did not. */}
        {loaded && !error && catalog.length === 0 && (
          <Text style={[font.muted, { marginTop: spacing.sm }]}>
            No games yet: the server's game list is empty. Restarting the backend fills it
            (docker compose up -d --build), then pull down here to refresh.
          </Text>
        )}

        {withRecord.length > 0 && (
          <>
            <View style={styles.sectionHead}>
              <Ionicons name="people" size={18} color={colors.accentPink} />
              <Text style={[font.h2, { marginLeft: spacing.sm }]}>Against your partner</Text>
            </View>

            <Stagger delayStep={45}>
              {withRecord.map((game) => {
                const row = matchBySlug[game.slug];
                const active = row.active;
                const yourMove = active?.yourTurn && active?.status === 'active';
                return (
                  <MorphButton
                    key={game.slug}
                    onPress={() => navigation.navigate(ROUTE_BY_SLUG[game.slug])}
                    style={[styles.row, yourMove && styles.rowHighlighted]}
                  >
                    <Icon name={game.emoji} chip chipSize={44} />
                    <View style={styles.rowText}>
                      <Text style={font.h2}>{game.title}</Text>
                      <Text style={font.muted} numberOfLines={1}>
                        {active
                          ? (active.freeplay
                            ? 'In progress — go whenever'
                            : yourMove ? 'Your move' : 'Waiting on them')
                          : game.subtitle}
                      </Text>
                      <Text style={[font.muted, styles.record]}>
                        {row.record.wins}W · {row.record.draws}D · {row.record.losses}L
                      </Text>
                    </View>
                    {yourMove ? (
                      <Pop active>
                        <View style={styles.turnDot} />
                      </Pop>
                    ) : (
                      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                    )}
                  </MorphButton>
                );
              })}
            </Stagger>
          </>
        )}

        {liveOnly.length > 0 && (
          <View style={styles.sectionHead}>
            <Ionicons name="flash" size={18} color={colors.accentIndigo} />
            <Text style={[font.h2, { marginLeft: spacing.sm }]}>
              {withRecord.length > 0 ? 'Live together' : 'Games'}
            </Text>
          </View>
        )}

        <View style={styles.grid}>
          {liveOnly.map((game) => (
            <MorphButton
              key={game.slug}
              onPress={() => navigation.navigate(ROUTE_BY_SLUG[game.slug])}
              style={styles.card}
            >
              <Icon name={game.emoji} chip chipSize={44} style={{ marginBottom: spacing.sm }} />
              <Text style={font.h2}>{game.title}</Text>
              {game.subtitle ? <Text style={font.muted}>{game.subtitle}</Text> : null}
            </MorphButton>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    content: { padding: spacing.lg, paddingBottom: 140 },
    sectionHead: {
      flexDirection: 'row', alignItems: 'center',
      marginTop: spacing.lg, marginBottom: spacing.sm,
    },
    row: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: colors.surface, borderRadius: radius.card,
      padding: spacing.md, marginBottom: spacing.sm,
      borderWidth: 1, borderColor: colors.border,
    },
    rowHighlighted: { borderColor: colors.accentPink, borderWidth: 2 },
    rowText: { flex: 1, marginLeft: spacing.md },
    record: { fontSize: 11, marginTop: 2 },
    turnDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.accentPink },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    card: {
      width: '48%', backgroundColor: colors.surface, borderRadius: radius.card,
      padding: spacing.md, minHeight: 148,
      borderWidth: 1, borderColor: colors.border,
    },
  });
